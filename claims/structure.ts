/**
 * What every results file must be before any number is recomputed from it.
 *
 * A claim check reads a few fields out of a few files; on its own it cannot tell a result that
 * moved from one that did not. This does: each report is held against `data/labels.csv` row by
 * row, its header against the manifest's pins, its correctness flags against the answers they
 * describe, and its metrics block against the verdicts underneath it. `verify` runs it first, and
 * a single problem fails the run — so a shifted row, a stale flag or a swapped report cannot pass
 * by going unread.
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
        const derived = prompt ? v.answer === v.gold : toBinary(v.answer) !== null && toBinary(v.answer) === toBinary(v.gold);
        if (derived !== v.correct) say(`row ${i} is marked ${v.correct ? "correct" : "wrong"} but answers ${JSON.stringify(v.answer)} against ${v.gold}`);
        if (derived) correct += 1;
      });

      const metrics = report.metrics as Record<string, unknown>;
      if (typeof metrics.total === "number" && metrics.total !== verdicts.length) say(`metrics total ${metrics.total}, ${verdicts.length} verdicts`);
      if (typeof metrics.correct === "number" && metrics.correct !== correct) say(`metrics correct ${metrics.correct}, the answers give ${correct}`);
      if (typeof metrics.accuracy === "number" && Math.abs(metrics.accuracy - correct / verdicts.length) > 1e-9) {
        say(`metrics accuracy ${metrics.accuracy}, the answers give ${correct / verdicts.length}`);
      }
    }
  }
  return { files, rows, problems };
}
