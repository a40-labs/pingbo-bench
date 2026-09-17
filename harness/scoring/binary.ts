/**
 * Scoring on the two-way question the article grades: does the email need a reply?
 *
 *   needs a reply  = immediate reply + postponed reply   (a pipeline answers "needs you")
 *   does not       = accountable non-answer + ignore      (a pipeline answers "waiting")
 *
 * An answer that is not one of those words is wrong on either side. Paired comparisons use the
 * exact two-sided McNemar test over discordant emails and a seeded 10,000-resample percentile
 * bootstrap of the per-email difference (`vendor/paired_compare.ts`).
 */
import { mcnemarExact, pairedBootstrapCI } from "../../vendor/paired_compare.js";

export const REPLY_LABELS: readonly string[] = ["immediate reply", "postponed reply"];
export const NO_REPLY_LABELS: readonly string[] = ["accountable non-answer", "ignore"];
export const NEEDS_YOU = "needs you";
export const WAITING = "waiting";

/** A four-way label or a pipeline word, projected onto the two-way question; null when neither. */
export function toBinary(label: string | null | undefined): string | null {
  if (label === null || label === undefined) return null;
  if (label === NEEDS_YOU || REPLY_LABELS.includes(label)) return NEEDS_YOU;
  if (label === WAITING || NO_REPLY_LABELS.includes(label)) return WAITING;
  return null;
}

export interface BinaryStats {
  n: number;
  correct: number;
  accuracy: number;
  support: { needsYou: number; waiting: number };
  /** What answering "no reply needed" to everything scores, as a count. */
  floorCount: number;
  needsYouRecall: number;
  waitingRecall: number;
  macroRecall: number;
  /** Per-email correctness, in position order: the vector paired tests run on. */
  hits: boolean[];
}

export function binaryStats(verdicts: ReadonlyArray<{ id: string; gold: string; answer: string | null }>): BinaryStats {
  let needsYou = 0;
  let waiting = 0;
  let needsYouHit = 0;
  let waitingHit = 0;
  const hits: boolean[] = [];
  for (const v of verdicts) {
    const gold = toBinary(v.gold);
    if (gold === null) throw new Error(`gold "${v.gold}" on ${v.id} is not a four-way label`);
    const hit = toBinary(v.answer) === gold;
    hits.push(hit);
    if (gold === NEEDS_YOU) {
      needsYou += 1;
      if (hit) needsYouHit += 1;
    } else {
      waiting += 1;
      if (hit) waitingHit += 1;
    }
  }
  const n = verdicts.length;
  const correct = needsYouHit + waitingHit;
  const needsYouRecall = needsYou === 0 ? 0 : needsYouHit / needsYou;
  const waitingRecall = waiting === 0 ? 0 : waitingHit / waiting;
  return {
    n,
    correct,
    accuracy: n === 0 ? 0 : correct / n,
    support: { needsYou, waiting },
    floorCount: Math.max(needsYou, waiting),
    needsYouRecall,
    waitingRecall,
    macroRecall: (needsYouRecall + waitingRecall) / 2,
    hits
  };
}

export interface Paired {
  delta: number;
  ci: { lo: number; hi: number };
  p: number;
  referenceOnly: number;
  candidateOnly: number;
}

/** Candidate minus reference on per-email correctness, paired by position. */
export function pairBinary(reference: readonly boolean[], candidate: readonly boolean[], seed: number): Paired {
  if (reference.length !== candidate.length) throw new Error("paired comparison needs the same emails in the same order");
  const deltas: number[] = [];
  let referenceOnly = 0;
  let candidateOnly = 0;
  reference.forEach((was, i) => {
    const is = candidate[i] === true;
    if (was && !is) referenceOnly += 1;
    if (!was && is) candidateOnly += 1;
    deltas.push((is ? 1 : 0) - (was ? 1 : 0));
  });
  return {
    delta: deltas.reduce((s, d) => s + d, 0) / deltas.length,
    ci: pairedBootstrapCI(deltas, { seed, resamples: 10_000 }),
    p: mcnemarExact(referenceOnly, candidateOnly).p,
    referenceOnly,
    candidateOnly
  };
}

export interface ClassMetrics {
  label: string;
  support: number;
  predicted: number;
  correct: number;
  recall: number | null;
  precision: number | null;
}

/** Four-way per-class recall and precision; an unparsed answer is a miss in nobody's denominator. */
export function perClass(verdicts: ReadonlyArray<{ gold: string; answer: string | null }>): {
  classes: ClassMetrics[];
  macroRecall: number;
  accuracy: number;
} {
  const tally = new Map<string, { support: number; predicted: number; correct: number }>();
  const at = (label: string) => {
    let t = tally.get(label);
    if (!t) tally.set(label, (t = { support: 0, predicted: 0, correct: 0 }));
    return t;
  };
  let correct = 0;
  for (const v of verdicts) {
    at(v.gold).support += 1;
    if (v.answer === null) continue;
    at(v.answer).predicted += 1;
    if (v.answer === v.gold) {
      at(v.answer).correct += 1;
      correct += 1;
    }
  }
  const classes = [...tally.entries()]
    .map(([label, t]) => ({
      label,
      ...t,
      recall: t.support === 0 ? null : t.correct / t.support,
      precision: t.predicted === 0 ? null : t.correct / t.predicted
    }))
    .sort((a, b) => b.support - a.support || (a.label < b.label ? -1 : 1));
  const supported = classes.filter((c) => c.support > 0);
  return {
    classes,
    macroRecall: supported.reduce((s, c) => s + (c.recall ?? 0), 0) / supported.length,
    accuracy: verdicts.length === 0 ? 0 : correct / verdicts.length
  };
}
