/**
 * Print the two-way table for one step: accuracy, both recalls, whether the model beats answering
 * "no reply needed" to every email, and a paired comparison against a reference model.
 *
 *   npx tsx harness/scoring/score.ts --step step3 [--reference qwen3.6-35b-a3b-mxfp4] [--results results/v1]
 *   npx tsx harness/scoring/score.ts --step step3 --against step0     # each model against its own Step 0
 */
import process from "node:process";

import { Results, type ArmDir, type StepId } from "../results.js";
import { binaryStats, pairBinary, perClass, type BinaryStats } from "./binary.js";

const SEED = 1610;

export function statsFor(results: Results, arm: ArmDir, model: string): BinaryStats {
  return arm === "step0" || arm === "step0-subject-body"
    ? binaryStats(results.prompt(arm, model).verdicts)
    : binaryStats(results.pipeline(arm, model).verdicts);
}

function flag(name: string, fallback?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

function main(): void {
  const results = new Results(flag("results", "results/v1") as string);
  const step = flag("step", "step3") as ArmDir;
  const reference = flag("reference", "qwen3.6-35b-a3b-mxfp4") as string;
  const against = flag("against") as StepId | undefined;
  const pct = (x: number): string => (100 * x).toFixed(1);
  const signed = (x: number): string => `${x >= 0 ? "+" : ""}${pct(x)}`;
  const ref = statsFor(results, step, reference);
  const header = against ? `Δ vs own ${against}` : `Δ vs ${reference}`;
  console.log(`| model | accuracy | needs-reply recall | no-reply recall | beats the floor | ${header} |`);
  console.log("|---|---|---|---|---|---|");
  const rows = results.arm(step).map((model) => ({ model, s: statsFor(results, step, model) }));
  rows.sort((a, b) => b.s.accuracy - a.s.accuracy || a.model.localeCompare(b.model));
  for (const { model, s } of rows) {
    const base = against ? statsFor(results, against, model) : ref;
    const d = !against && model === reference ? null : pairBinary(base.hits, s.hits, SEED);
    const cell = d ? `${signed(d.delta)} [${signed(d.ci.lo)}, ${signed(d.ci.hi)}] p=${d.p.toFixed(3)}` : "reference";
    console.log(
      `| ${model} | ${pct(s.accuracy)} | ${pct(s.needsYouRecall)} | ${pct(s.waitingRecall)} | ${s.correct > s.floorCount ? "yes" : "no"} | ${cell} |`
    );
  }
  if (step === "step0" || step === "step0-subject-body") {
    console.log("\nFour-way macro recall (the question as the annotators asked it):");
    for (const { model } of rows) {
      console.log(`  ${model}: ${pct(perClass(results.prompt(step, model).verdicts).macroRecall)}`);
    }
  }
}

if (process.argv[1]?.endsWith("score.ts")) main();
