/**
 * What every results file must be before any number is recomputed from it.
 *
 * A claim check reads a few fields out of a few files; on its own it cannot tell a result that
 * moved from one that did not. This does: each report is held against `data/labels.csv` row by
 * row, every pin in its header against the manifest, its correctness flags against the answers
 * they describe, and each documented metric against the verdicts underneath it. `verify` runs it
 * first, and a single problem fails the run — so a shifted row, a stale flag, a swapped report, a
 * falsified pin or a metric that has gone missing cannot pass by going unread.
 */
import type { Context } from "./recompute.js";
import type { ArmDir, PipelineVerdict, PromptVerdict } from "../harness/results.js";
import { toBinary } from "../harness/scoring/binary.js";

export interface StructuralProblem {
  file: string;
  problem: string;
}

/** Reports read, and everything wrong with them. */
export interface StructureReport {
  files: number;
  rows: number;
  problems: StructuralProblem[];
}

const PROMPT_ARMS = new Set<ArmDir>(["step0", "step0-subject-body"]);

/** Metrics every report of that kind must carry, as a number. A missing metric is a hole in the
 *  file, not an absence of evidence, so it fails rather than being skipped. */
const REQUIRED_METRICS = {
  prompt: ["total", "decided", "unparsed", "correct", "accuracy", "macroRecall", "majorityClassFloor"],
  pipeline: [
    "total",
    "decided",
    "unparsed",
    "correct",
    "accuracy",
    "needsYouRecall",
    "waitingRecall",
    "macroRecall",
    "floorCount",
    "majorityClassFloor"
  ]
} as const;

/** Metrics that are a block of counts rather than one number; each count must be a number. */
const REQUIRED_COUNTS = {
  prompt: ["confusion"],
  pipeline: ["support", "home", "judgment", "errorsByCode", "refusals"]
} as const;

export function validateReports(ctx: Context): StructureReport {
  const labels = ctx.labels();
  const manifest = ctx.results.manifest();
  const problems: StructuralProblem[] = [];
  let files = 0;
  let rows = 0;

  for (const step of manifest.steps) {
    const prompt = PROMPT_ARMS.has(step.id);
    const models = ctx.results.arm(step.id);
    if (models.length !== manifest.models.length) {
      problems.push({ file: `${step.id}/`, problem: `${models.length} model files, the manifest lists ${manifest.models.length}` });
    }
    for (const model of models) {
      const file = `${step.id}/${model}.json`;
      const report = prompt
        ? ctx.results.prompt(step.id as "step0" | "step0-subject-body", model)
        : ctx.results.pipeline(step.id as "step1" | "step2" | "step3", model);
      files += 1;
      const say = (problem: string): void => {
        problems.push({ file, problem });
      };
      const header = report.header as Record<string, unknown>;
      if (header.model !== model) say(`header model is ${String(header.model)}`);
      if (header.step !== step.id) say(`header step is ${String(header.step)}`);
      if (header.corpusSha256 !== step.corpusSha256) say(`corpus ${String(header.corpusSha256)} is not the manifest's ${step.corpusSha256}`);
      if (step.promptSha256 !== undefined && header.promptSha256 !== step.promptSha256) {
        say(`prompt digest ${String(header.promptSha256)} is not the manifest's ${step.promptSha256}`);
      }
      if (step.sortingPromptSha256 !== undefined && header.sortingPromptSha256 !== step.sortingPromptSha256) {
        say(`sorting digest ${String(header.sortingPromptSha256)} is not the manifest's ${step.sortingPromptSha256}`);
      }
      if (step.judgeVersion !== undefined && header.judgeVersion !== step.judgeVersion) {
        say(`judge version ${String(header.judgeVersion)} is not the manifest's ${step.judgeVersion}`);
      }
      if (step.pipelineVersion !== undefined && header.pipelineVersion !== step.pipelineVersion) {
        say(`pipeline version ${String(header.pipelineVersion)} is not the manifest's ${step.pipelineVersion}`);
      }
      if (header.probes !== step.probes) say(`probe file ${String(header.probes)} is not the manifest's ${step.probes}`);
      if (header.seed !== manifest.seed) say(`seed ${String(header.seed)} is not the manifest's ${manifest.seed}`);
      if (header.sample !== manifest.sample) say(`sample ${String(header.sample)} is not the manifest's ${manifest.sample}`);

      const verdicts = report.verdicts as Array<PromptVerdict | PipelineVerdict>;
      if (verdicts.length !== labels.length) {
        say(`${verdicts.length} verdicts, labels.csv has ${labels.length}`);
        continue;
      }
      let correct = 0;
      verdicts.forEach((v, i) => {
        const row = labels[i];
        rows += 1;
        if (v.position !== i) say(`row ${i} carries position ${v.position}`);
        if (row === undefined || v.id !== row.id) say(`row ${i} is ${v.id}, labels.csv has ${row?.id}`);
        if (row !== undefined && v.gold !== row.label4) say(`row ${i} gold ${v.gold}, labels.csv has ${row.label4}`);
        // The stored flag is what the run recorded; this is what its own answer says. Step 0
        // answers four ways, the pipeline two, and an answer that is neither is wrong.
        // A Step 0 row answers the four-way question; a pipeline row answers the two-way one.
        const answered = prompt ? v.answer === v.gold : toBinary(v.answer) !== null && toBinary(v.answer) === toBinary(v.gold);
        // A row whose call failed is wrong however its answer reads, as METHODS states.
        const failed = !prompt && (v as PipelineVerdict).error !== undefined;
        const derived = answered && !failed;
        if (failed && v.correct) say(`row ${i} is marked correct although its run failed`);
        else if (derived !== v.correct) say(`row ${i} is marked ${v.correct ? "correct" : "wrong"} but answers ${JSON.stringify(v.answer)} against ${v.gold}`);
        if (derived) correct += 1;
      });

      const metrics = report.metrics as Record<string, unknown>;
      const kind = prompt ? "prompt" : "pipeline";
      for (const name of REQUIRED_METRICS[kind]) {
        if (typeof metrics[name] !== "number") say(`metrics ${name} is ${JSON.stringify(metrics[name])}, not a number`);
      }
      for (const name of REQUIRED_COUNTS[kind]) {
        const block = metrics[name];
        if (block === null || typeof block !== "object" || Array.isArray(block)) {
          say(`metrics ${name} is ${JSON.stringify(block)}, not a block of counts`);
          continue;
        }
        // `confusion` and `support` nest a level, so every leaf is checked rather than every key.
        const leaves = (value: unknown, at: string): void => {
          if (typeof value === "number") return;
          if (value !== null && typeof value === "object" && !Array.isArray(value)) {
            for (const [key, inner] of Object.entries(value as Record<string, unknown>)) leaves(inner, `${at}.${key}`);
            return;
          }
          say(`metrics ${at} is ${JSON.stringify(value)}, not a number`);
        };
        leaves(block, name);
      }
      if (metrics.total !== verdicts.length) say(`metrics total ${JSON.stringify(metrics.total)}, ${verdicts.length} verdicts`);
      if (metrics.correct !== correct) say(`metrics correct ${JSON.stringify(metrics.correct)}, the answers give ${correct}`);
      if (typeof metrics.accuracy !== "number" || Math.abs(metrics.accuracy - correct / verdicts.length) > 1e-9) {
        say(`metrics accuracy ${JSON.stringify(metrics.accuracy)}, the answers give ${correct / verdicts.length}`);
      }
      const refusals = verdicts.filter((v) => (v as PipelineVerdict).error?.refusal !== undefined).length;
      const counted = Object.values((metrics.refusals ?? {}) as Record<string, number>).reduce((a, b) => a + b, 0);
      if (!prompt && refusals !== counted) say(`metrics refusals count ${counted}, the rows give ${refusals}`);
    }
  }
  return { files, rows, problems };
}
