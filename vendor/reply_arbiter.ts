/**
 * Scoring the Sappelli gold and a model consensus against what the recipients ACTUALLY DID.
 *
 * The gold is a *sender-side* label: two annotators read a message and said what response its
 * sender expected, and they agreed 44.4 % of the time. Reply behaviour, derived in
 * `reply_behaviour.ts`, is a third reading of the same corpus — the *recipient's* action — and
 * these functions ask which side that behaviour sides with.
 *
 * Two limits are structural, and every caller reports them rather than leaving them to the
 * reader:
 *  (i) the annotators labelled the SENDER's expectation; behaviour records the RECIPIENT's
 *      action. A busy recipient may ignore an urgent ask, so `none` under an `immediate reply`
 *      gold is not proof the gold is wrong — it is evidence, weighed as such.
 *  (ii) the 24 h fast/slow line is a CHOICE, not a measurement. `bucketAt` re-buckets a row at
 *      any other cut, so a caller can show how much of a result is the threshold.
 */

import { mcnemarExact, pairedBootstrapCI } from "./paired_compare.js";
import { mulberry32 } from "./prng.js";
import { bucketAt, type ReplyBucket, type ReplyRow } from "./reply_behaviour.js";

export interface Verdict {
  id: string;
  gold: string;
  answer: string | null;
  correct: boolean;
}

export interface Report {
  header: { model: string; probesVersion?: number | null };
  metrics: { accuracy: number; macroRecall: number };
  verdicts: Verdict[];
}

/** The behaviour each gold/model class PREDICTS of the recipient. The two non-reply classes make
 *  the same prediction — `accountable non-answer` and `ignore` differ in what the sender is owed,
 *  not in whether a reply is sent — so a row can be consistent with both sides at once. */
export const EXPECTED_BUCKET: Readonly<Record<string, ReplyBucket>> = {
  "immediate reply": "fast",
  "postponed reply": "slow",
  "accountable non-answer": "none",
  ignore: "none"
};

export const BUCKETS: readonly ReplyBucket[] = ["fast", "slow", "none", "unobservable"];

/** Does this label's prediction match what the recipient did? `null` where no claim is possible
 *  — an unobservable row, or a label outside the taxonomy (an unparsed model answer). */
export function consistent(label: string | null, bucket: ReplyBucket): boolean | null {
  if (label === null || bucket === "unobservable") return null;
  const expected = EXPECTED_BUCKET[label];
  if (expected === undefined) return null;
  return expected === bucket;
}

export interface Consensus {
  /** The label a strict majority of the arm gave, or null on a tie. */
  label: string | null;
  /** Every model in the arm gave the same label. */
  unanimous: boolean;
  votes: number;
  of: number;
}

/** Majority vote across an arm's reports at one position; a tie leaves the row out. */
export function consensusAt(answers: ReadonlyArray<string | null>): Consensus {
  const tally = new Map<string, number>();
  for (const a of answers) if (a !== null) tally.set(a, (tally.get(a) ?? 0) + 1);
  let best: string | null = null;
  let bestN = 0;
  let tied = false;
  for (const [label, n] of tally) {
    if (n > bestN) {
      best = label;
      bestN = n;
      tied = false;
    } else if (n === bestN) {
      tied = true;
    }
  }
  return {
    label: tied ? null : best,
    unanimous: best !== null && bestN === answers.length,
    votes: bestN,
    of: answers.length
  };
}

export type Crosstab = Record<string, Record<ReplyBucket, number>>;

/** Rows by label × bucket, over the rows a caller has already filtered. */
export function crosstab(
  rows: readonly ReplyRow[],
  labelOf: (i: number) => string | null,
  fastCutHours: number
): Crosstab {
  const out: Crosstab = {};
  rows.forEach((row, i) => {
    const label = labelOf(i);
    if (label === null) return;
    const cell = (out[label] ??= { fast: 0, slow: 0, none: 0, unobservable: 0 });
    cell[bucketAt(row, fastCutHours)] += 1;
  });
  return out;
}

export interface SideCut {
  n: number;
  goldOnly: number;
  modelOnly: number;
  both: number;
  neither: number;
  goldRate: number;
  modelRate: number;
  goldCI: { lo: number; hi: number };
  modelCI: { lo: number; hi: number };
  /** Gold-consistent rate minus model-consistent rate, and the CI of that paired difference. */
  delta: number;
  deltaCI: { lo: number; hi: number };
  p: number;
  discordant: number;
}

/**
 * The decisive cut. For each row: does the behaviour match what the gold predicts, what the
 * models predict, both, or neither? Discordant rows drive an exact two-sided McNemar; the rates
 * and their difference ride with seeded percentile-bootstrap CIs.
 */
export function sideWith(
  rows: readonly ReplyRow[],
  indices: readonly number[],
  goldOf: (i: number) => string,
  modelOf: (i: number) => string | null,
  fastCutHours: number,
  seed: number,
  resamples = 10_000
): SideCut {
  const goldHits: number[] = [];
  const modelHits: number[] = [];
  const deltas: number[] = [];
  let goldOnly = 0;
  let modelOnly = 0;
  let both = 0;
  let neither = 0;
  for (const i of indices) {
    const row = rows[i] as ReplyRow;
    const bucket = bucketAt(row, fastCutHours);
    if (bucket === "unobservable") continue;
    const g = consistent(goldOf(i), bucket) === true;
    const m = consistent(modelOf(i), bucket) === true;
    goldHits.push(g ? 1 : 0);
    modelHits.push(m ? 1 : 0);
    deltas.push((g ? 1 : 0) - (m ? 1 : 0));
    if (g && m) both += 1;
    else if (g) goldOnly += 1;
    else if (m) modelOnly += 1;
    else neither += 1;
  }
  const n = goldHits.length;
  const mean = (xs: readonly number[]): number =>
    xs.length === 0 ? 0 : xs.reduce((a, b) => a + b, 0) / xs.length;
  const ci = (xs: number[]): { lo: number; hi: number } =>
    xs.length === 0 ? { lo: 0, hi: 0 } : pairedBootstrapCI(xs, { seed, resamples });
  const mc = mcnemarExact(goldOnly, modelOnly);
  return {
    n,
    goldOnly,
    modelOnly,
    both,
    neither,
    goldRate: mean(goldHits),
    modelRate: mean(modelHits),
    goldCI: ci(goldHits),
    modelCI: ci(modelHits),
    delta: mean(deltas),
    deltaCI: ci(deltas),
    p: mc.p,
    discordant: mc.discordant
  };
}

/**
 * A control set drawn from the unanimous-AGREEMENT rows with the same gold-class mix as the
 * contested rows, so the two cut rates are not just reading a class-prior difference. Seeded, so
 * a re-run draws the same control. A stratum with too few candidates contributes all it has, and
 * the shortfall is reported rather than silently filled from another class.
 */
export function matchedControl(
  contested: readonly number[],
  candidates: readonly number[],
  goldOf: (i: number) => string,
  seed: number
): { indices: number[]; shortfall: Record<string, number> } {
  const want = new Map<string, number>();
  for (const i of contested) want.set(goldOf(i), (want.get(goldOf(i)) ?? 0) + 1);
  const pool = new Map<string, number[]>();
  for (const i of candidates) {
    const list = pool.get(goldOf(i));
    if (list) list.push(i);
    else pool.set(goldOf(i), [i]);
  }
  const rand = mulberry32(seed);
  const indices: number[] = [];
  const shortfall: Record<string, number> = {};
  for (const [label, k] of [...want.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    const list = [...(pool.get(label) ?? [])];
    // Fisher-Yates on the seeded stream, then take the first k.
    for (let j = list.length - 1; j > 0; j -= 1) {
      const swap = Math.floor(rand() * (j + 1));
      [list[j], list[swap]] = [list[swap] as number, list[j] as number];
    }
    if (list.length < k) shortfall[label] = k - list.length;
    indices.push(...list.slice(0, k));
  }
  indices.sort((a, b) => a - b);
  return { indices, shortfall };
}

export interface ProportionDifference {
  a: { n: number; k: number; rate: number };
  b: { n: number; k: number; rate: number };
  diff: number;
  ci: { lo: number; hi: number };
}

/**
 * Difference of two INDEPENDENT proportions with a seeded percentile-bootstrap CI (each arm
 * resampled to its own size). The paired kernel cannot serve here: the contested set and its
 * control are different probes, and on the control gold and consensus carry the same label BY
 * CONSTRUCTION, so a McNemar over them has b = c = 0 and says nothing.
 */
export function proportionDifference(
  a: readonly number[],
  b: readonly number[],
  seed: number,
  resamples = 10_000
): ProportionDifference {
  const sum = (xs: readonly number[]): number => xs.reduce((s, x) => s + x, 0);
  const rate = (xs: readonly number[]): number => (xs.length === 0 ? 0 : sum(xs) / xs.length);
  const rand = mulberry32(seed);
  const diffs: number[] = [];
  for (let r = 0; r < resamples; r += 1) {
    let sa = 0;
    for (let i = 0; i < a.length; i += 1) sa += a[Math.floor(rand() * a.length)] ?? 0;
    let sb = 0;
    for (let i = 0; i < b.length; i += 1) sb += b[Math.floor(rand() * b.length)] ?? 0;
    diffs.push((a.length === 0 ? 0 : sa / a.length) - (b.length === 0 ? 0 : sb / b.length));
  }
  diffs.sort((x, y) => x - y);
  const at = (q: number): number => diffs[Math.min(diffs.length - 1, Math.floor(q * diffs.length))] ?? 0;
  return {
    a: { n: a.length, k: sum(a), rate: rate(a) },
    b: { n: b.length, k: sum(b), rate: rate(b) },
    diff: rate(a) - rate(b),
    ci: { lo: at(0.025), hi: at(0.975) }
  };
}

/** Did a recipient reply at all, split by whether the label EXPECTS a reply? This is the
 *  construct's own claim, tested against behaviour without any threshold at all. */
export function replySeparation(
  rows: readonly ReplyRow[],
  indices: readonly number[],
  labelOf: (i: number) => string | null,
  seed: number
): ProportionDifference {
  const expects: number[] = [];
  const doesNot: number[] = [];
  for (const i of indices) {
    const row = rows[i] as ReplyRow;
    if (!row.observable) continue;
    const label = labelOf(i);
    if (label === null || EXPECTED_BUCKET[label] === undefined) continue;
    const hit = row.repliedByRecipient ? 1 : 0;
    if (EXPECTED_BUCKET[label] === "none") doesNot.push(hit);
    else expects.push(hit);
  }
  return proportionDifference(expects, doesNot, seed);
}

/** The behaviour rows in the order a report's `verdicts[]` are written: the runner sorts by id
 *  over the probe-file order, so the same comparator over the same input reproduces it. */
export function reportOrder(rows: readonly ReplyRow[]): ReplyRow[] {
  return [...rows].sort((a, b) => (a.id < b.id ? -1 : 1));
}

export interface BinaryAgreement {
  n: number;
  agreement: number;
  /** What the constant predictor scores. A signal below this line is worse than saying nothing. */
  majorityBaseline: number;
  positiveRate: number;
  signalRate: number;
  truePositive: number;
  falsePositive: number;
  falseNegative: number;
  trueNegative: number;
}

/** Reply latency AS a Needs-you signal, on its own: `fast` predicts the positive class. */
export function binaryAgreement(
  rows: readonly ReplyRow[],
  indices: readonly number[],
  positive: (i: number) => boolean | null,
  fastCutHours: number
): BinaryAgreement {
  let tp = 0;
  let fp = 0;
  let fn = 0;
  let tn = 0;
  for (const i of indices) {
    const bucket = bucketAt(rows[i] as ReplyRow, fastCutHours);
    if (bucket === "unobservable") continue;
    const truth = positive(i);
    if (truth === null) continue;
    const signal = bucket === "fast";
    if (signal && truth) tp += 1;
    else if (signal && !truth) fp += 1;
    else if (!signal && truth) fn += 1;
    else tn += 1;
  }
  const n = tp + fp + fn + tn;
  const positiveRate = n === 0 ? 0 : (tp + fn) / n;
  return {
    n,
    agreement: n === 0 ? 0 : (tp + tn) / n,
    majorityBaseline: Math.max(positiveRate, 1 - positiveRate),
    positiveRate,
    signalRate: n === 0 ? 0 : (tp + fp) / n,
    truePositive: tp,
    falsePositive: fp,
    falseNegative: fn,
    trueNegative: tn
  };
}
