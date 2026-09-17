/**
 * The paired-comparison kernel: a change is accepted by a paired test, never by a headline delta.
 * Same corpus, same seed, run A against run B, aligned probe by probe; the difference rides with
 * a confidence interval and the exact McNemar p over the discordant pairs, and a change the test
 * refutes is recorded rather than retried.
 */
import { mulberry32 } from "./prng.js";

export interface McNemarResult {
  /** Exact two-sided binomial p over the discordant pairs at p=0.5. */
  p: number;
  discordant: number;
}

/** Exact McNemar: b = A-only wins, c = B-only wins. No chi-square approximation — the
 *  discordant counts here are small enough that exactness is free. */
export function mcnemarExact(b: number, c: number): McNemarResult {
  const n = b + c;
  if (n === 0) {
    return { p: 1, discordant: 0 };
  }
  const k = Math.min(b, c);
  // log-space binomial tail so n=1,000 cannot overflow
  const logChoose = (nn: number, kk: number): number => {
    let s = 0;
    for (let i = 1; i <= kk; i += 1) s += Math.log(nn - kk + i) - Math.log(i);
    return s;
  };
  let tail = 0;
  for (let i = 0; i <= k; i += 1) {
    tail += Math.exp(logChoose(n, i) - n * Math.LN2);
  }
  return { p: Math.min(1, 2 * tail), discordant: n };
}

/** Percentile bootstrap over per-probe deltas; seeded, so a re-run is the same number. */
export function pairedBootstrapCI(
  deltas: readonly number[],
  options: { seed: number; resamples?: number; level?: number }
): { lo: number; hi: number } {
  const resamples = options.resamples ?? 10_000;
  const level = options.level ?? 0.95;
  const rand = mulberry32(options.seed);
  const means: number[] = [];
  for (let r = 0; r < resamples; r += 1) {
    let sum = 0;
    for (let i = 0; i < deltas.length; i += 1) {
      sum += deltas[Math.floor(rand() * deltas.length)]!;
    }
    means.push(sum / deltas.length);
  }
  means.sort((a, b) => a - b);
  const edge = (1 - level) / 2;
  return {
    lo: means[Math.min(means.length - 1, Math.floor(edge * means.length))]!,
    hi: means[Math.min(means.length - 1, Math.floor((1 - edge) * means.length))]!
  };
}
