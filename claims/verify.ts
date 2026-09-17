/**
 * Recompute every number the article states and compare it with `claims.json`.
 *
 *   npx tsx claims/verify.ts [--json] [--id <claim id or prefix>]
 *
 * `--id step0.median` checks one claim and prints it; `--id figure2` checks every claim under it.
 * Each claim is one of:
 *   reproducible      recomputed from results/ (or data/build) and compared; a mismatch fails
 *   not-reproducible  listed with the reason no stored data can recompute it
 *   context           a number the article uses that is not a measurement of this benchmark
 * A reproducible claim that needs the rebuilt probes or the annotation CSV is reported as
 * `skipped (needs data/build)` until `npx tsx data/build/build.ts` has run.
 *
 * Every results file is checked first, row by row, against `data/labels.csv` and the manifest's
 * pins (`claims/structure.ts`): a claim recomputed from a file that moved is worth nothing, so a
 * structural problem fails the run before any claim is read. Exit code 1 on any failure, 0
 * otherwise.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { Context, METRICS, NeedsData, type Paths } from "./recompute.js";
import { validateReports, type StructureReport } from "./structure.js";

export interface Claim {
  id: string;
  /** What the article says, as close to its wording as a short string allows. */
  text: string;
  /** Where in the article. */
  where: string;
  status: "reproducible" | "not-reproducible" | "context";
  value?: number | string;
  metric?: string;
  args?: Record<string, unknown>;
  /** Compare after rounding the recomputed number to this many decimals… */
  decimals?: number;
  /** …or to this many significant figures… */
  significant?: number;
  /** …or within this absolute tolerance (full-precision chart data). */
  tolerance?: number;
  reason?: string;
}

export interface ClaimsFile {
  version: string;
  article: { title: string; url: string };
  claims: Claim[];
}

export type Outcome = "passed" | "failed" | "skipped-needs-data" | "not-reproducible" | "context";

export interface Checked {
  claim: Claim;
  outcome: Outcome;
  got?: number | string;
  detail?: string;
}

export function matches(claim: Claim, got: number | string): boolean {
  const want = claim.value;
  if (typeof want === "string" || typeof got === "string") return want === got;
  if (want === undefined) return false;
  if (claim.tolerance !== undefined) return Math.abs(got - want) <= claim.tolerance;
  if (claim.significant !== undefined) return Number(got.toPrecision(claim.significant)) === want;
  return Number(got.toFixed(claim.decimals ?? 0)) === want;
}

export function verify(file: ClaimsFile, paths: Paths): Checked[] {
  const ctx = new Context(paths);
  return file.claims.map((claim): Checked => {
    if (claim.status !== "reproducible") return { claim, outcome: claim.status };
    const metric = claim.metric ? METRICS[claim.metric] : undefined;
    if (!metric) return { claim, outcome: "failed", detail: `unknown metric ${claim.metric}` };
    try {
      const got = metric(ctx, claim.args ?? {});
      return { claim, outcome: matches(claim, got) ? "passed" : "failed", got };
    } catch (err) {
      if (err instanceof NeedsData) return { claim, outcome: "skipped-needs-data", detail: err.message };
      return { claim, outcome: "failed", detail: err instanceof Error ? err.message : String(err) };
    }
  });
}

export function summarize(checked: readonly Checked[]): Record<Outcome, number> {
  const out: Record<Outcome, number> = { passed: 0, failed: 0, "skipped-needs-data": 0, "not-reproducible": 0, context: 0 };
  for (const c of checked) out[c.outcome] += 1;
  return out;
}

function structureLine(structure: StructureReport): string {
  return structure.problems.length === 0
    ? `${structure.files} result files and ${structure.rows.toLocaleString("en-US")} rows check out against labels.csv and the manifest`
    : `${structure.problems.length} structural problem(s) in ${structure.files} result files`;
}

function main(): void {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const all = JSON.parse(readFileSync(path.join(root, "claims", "claims.json"), "utf8")) as ClaimsFile;
  const idArg = process.argv.indexOf("--id");
  const only = idArg >= 0 ? process.argv[idArg + 1] : undefined;
  const file = only ? { ...all, claims: all.claims.filter((c) => c.id === only || c.id.startsWith(`${only}.`)) } : all;
  if (only && file.claims.length === 0) {
    console.error(`no claim ${only}`);
    process.exitCode = 2;
    return;
  }
  const paths = {
    root,
    results: path.join(root, "results", file.version),
    built: path.join(root, "data", "build", "out"),
    cache: path.join(root, "data", "build", "cache")
  };
  const structure = validateReports(new Context(paths));
  const checked = verify(file, paths);
  if (process.argv.includes("--json")) {
    console.log(
      JSON.stringify(
        { structure, claims: checked.map((c) => ({ id: c.claim.id, outcome: c.outcome, got: c.got, detail: c.detail })) },
        null,
        1
      )
    );
  } else {
    for (const p of structure.problems) console.log(`BAD   ${p.file}: ${p.problem}`);
    for (const c of checked) {
      if (only && c.outcome === "passed") {
        console.log(`PASS  ${c.claim.id}: article ${JSON.stringify(c.claim.value)}, recomputed ${JSON.stringify(c.got)}`);
      }
      if (only && c.outcome === "context") console.log(`CTX   ${c.claim.id}: ${c.claim.reason}`);
      if (c.outcome === "failed") {
        console.log(`FAIL  ${c.claim.id}: article ${JSON.stringify(c.claim.value)}, recomputed ${JSON.stringify(c.got)}${c.detail ? ` (${c.detail})` : ""}`);
      }
    }
    for (const c of checked.filter((x) => x.outcome === "skipped-needs-data")) console.log(`SKIP  ${c.claim.id}: ${c.detail}`);
    for (const c of checked.filter((x) => x.outcome === "not-reproducible")) console.log(`N/R   ${c.claim.id}: ${c.claim.reason}`);
    const s = summarize(checked);
    console.log(
      `\n${structureLine(structure)}\n` +
        `${s.passed} passed, ${s.failed} failed, ${s["skipped-needs-data"]} skipped (needs data/build), ` +
        `${s["not-reproducible"]} not reproducible, ${s.context} context — ${file.claims.length} claims`
    );
  }
  process.exitCode = checked.some((c) => c.outcome === "failed") || structure.problems.length > 0 ? 1 : 0;
}

if (process.argv[1]?.endsWith("verify.ts")) main();
