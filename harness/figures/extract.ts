/**
 * Rebuild the article's chart data from results/.
 *
 *   npx tsx harness/figures/extract.ts [--results results/v1] [--write <dir>]
 *
 * Figure 2 (`pipeline-progression-data.json`): per model, Step 0 (the four-way answer collapsed to
 * "needs a reply"; an answer that is neither is wrong, as at every other step) and Steps 1-3 (each
 * run's own accuracy).
 * Figure 3 (`precision-recall-data.json`): per model at Step 3, three ways to build Needs you —
 * reply cards (`compose`), plus To Act cards (`external`), plus a second read (the model's own
 * Step 0 answer says a reply is owed). Step 0 answers pair with Step 3 rows BY POSITION: seven ids
 * repeat, so an id lookup would read one row's answer against another row's verdict.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";

import { Results } from "../results.js";
import { REPLY_LABELS, binaryStats } from "../scoring/binary.js";

export const PIPELINE_STEPS = [
  { step: "step1", arm: "rev1" },
  { step: "step2", arm: "rev3" },
  { step: "step3", arm: "rev5" }
] as const;

export interface ProgressionPoint {
  arm: string;
  accuracy: number;
  n: number;
}

export function progression(results: Results, model: string): ProgressionPoint[] {
  const s0 = results.prompt("step0", model).verdicts;
  const points: ProgressionPoint[] = [{ arm: "rev2-ctx", accuracy: (100 * binaryStats(s0).correct) / s0.length, n: s0.length }];
  for (const { step, arm } of PIPELINE_STEPS) {
    const report = results.pipeline(step, model);
    const correct = report.verdicts.filter((v) => v.correct).length;
    points.push({ arm, accuracy: round(100 * (correct / report.verdicts.length), 6), n: report.verdicts.length });
  }
  return points;
}

export interface Reading {
  recall: number;
  precision: number;
  shown: number;
}

export interface LaneRow {
  model: string;
  accuracy: number;
  cards: Reading;
  ships: Reading;
  both: Reading;
}

export function lanes(results: Results, model: string): LaneRow {
  const e2e = results.pipeline("step3", model).verdicts;
  const step0 = results.prompt("step0", model).verdicts;
  const needs = e2e.filter((v) => REPLY_LABELS.includes(v.gold)).length;
  const reading = (shownIf: (v: (typeof e2e)[number]) => boolean): Reading => {
    const shown = e2e.filter(shownIf);
    const hit = shown.filter((v) => REPLY_LABELS.includes(v.gold)).length;
    return {
      recall: round((100 * hit) / needs, 2),
      precision: shown.length ? round((100 * hit) / shown.length, 2) : 0,
      shown: shown.length
    };
  };
  // A failed call wrote no card, so a lane it still carries shows nothing. Every published failed
  // row has a null judgment anyway; the guard is what makes that a property of the reading rather
  // than of this data. The second read is a separate Step 0 run and did not fail, so it still
  // places a row the pipeline lost.
  const ran = (v: (typeof e2e)[number]): boolean => v.error === undefined;
  const cards = (v: (typeof e2e)[number]): boolean => ran(v) && v.judgment === "compose";
  const ships = (v: (typeof e2e)[number]): boolean => ran(v) && (v.judgment === "compose" || v.judgment === "external");
  const both = (v: (typeof e2e)[number]): boolean => {
    const answer = step0[v.position]?.answer ?? null;
    return ships(v) || (answer !== null && REPLY_LABELS.includes(answer));
  };
  const correct = e2e.filter((v) => v.correct).length;
  return {
    model,
    accuracy: round(100 * (correct / e2e.length), 2),
    cards: reading(cards),
    ships: reading(ships),
    both: reading(both)
  };
}

/**
 * Python's round(x, digits): the nearest value on the exact binary number, ties to even. JS's
 * toFixed also works on the exact number but breaks ties upward, so only an exact tie differs.
 */
export function round(x: number, digits: number): number {
  if (x < 0) return -round(-x, digits);
  const fixed = x.toFixed(digits);
  const fraction = x.toPrecision(100).split(".")[1] ?? "";
  if (/^50*$/.test(fraction.slice(digits))) {
    const n = Math.round(Number(fixed) * 10 ** digits);
    if (n % 2 === 1) return Number(((n - 1) / 10 ** digits).toFixed(digits));
  }
  return Number(fixed);
}

function main(): void {
  const args = process.argv.slice(2);
  const at = (name: string, fallback: string): string => {
    const i = args.indexOf(`--${name}`);
    return i >= 0 ? (args[i + 1] as string) : fallback;
  };
  const results = new Results(at("results", "results/v1"));
  const models = results.models();
  const golds = results.prompt("step0", models[0] as string).verdicts.map((v) => v.gold);
  const needsYou = golds.filter((g) => REPLY_LABELS.includes(g)).length;
  const floor = round((100 * (golds.length - needsYou)) / golds.length, 1);
  const progressionData = { floor, series: Object.fromEntries(models.map((m) => [m, progression(results, m)])) };
  const precisionRecall = { total: golds.length, needsYou, models: models.map((m) => lanes(results, m)) };
  const target = args.includes("--write") ? at("write", "") : null;
  if (!target) {
    console.log(JSON.stringify({ progression: progressionData, precisionRecall }, null, 1));
    return;
  }
  mkdirSync(target, { recursive: true });
  writeFileSync(path.join(target, "pipeline-progression-data.json"), JSON.stringify(progressionData, null, 1));
  writeFileSync(path.join(target, "precision-recall-data.json"), JSON.stringify(precisionRecall, null, 1));
  console.log(`wrote ${target}`);
}

if (process.argv[1]?.endsWith("extract.ts")) main();
