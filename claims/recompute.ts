/**
 * Every way a claim can be recomputed, by name. Each function reads results/ (and, for the few
 * claims about the annotators or the rebuilt files, data/build) and returns the number or hash
 * the article states. `claims.json` names the function and its arguments; `verify.ts` compares.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { mcnemarExact } from "../vendor/paired_compare.js";
import { consensusAt, reportOrder, replySeparation } from "../vendor/reply_arbiter.js";
import type { ReplyRow } from "../vendor/reply_behaviour.js";
import { parseSappelliCsv } from "../vendor/sappelli.js";
import { lanes, progression } from "../harness/figures/extract.js";
import { Results, type LabelRow, type PipelineVerdict, type PromptVerdict, type StepId } from "../harness/results.js";
import { REPLY_LABELS, binaryStats, perClass, toBinary } from "../harness/scoring/binary.js";

export class NeedsData extends Error {}

export interface Paths {
  root: string;
  results: string;
  /** data/build/out: the rebuilt probes and sheets. */
  built: string;
  /** data/build/cache: the downloaded annotation CSV and dump. */
  cache: string;
}

type Args = Record<string, unknown>;
export type Metric = (ctx: Context, args: Args) => number | string;

const SEED = 1610;

/** Another metric's value, as a number. */
function num(name: string, ctx: Context, args: Args = {}): number {
  const metric = METRICS[name];
  if (!metric) throw new Error(`no metric ${name}`);
  return Number(metric(ctx, args));
}
const pct = (n: number, d: number): number => (100 * n) / d;

export class Context {
  readonly results: Results;
  private readonly memo = new Map<string, unknown>();

  constructor(readonly paths: Paths) {
    this.results = new Results(paths.results);
  }

  labels(): LabelRow[] {
    return this.results.labels(path.join(this.paths.root, "data", "labels.csv"));
  }

  /**
   * Correct two-way answers for a model at a step, recomputed from the answers themselves: an
   * answer that is not one of the labels is wrong, at every step, as METHODS states. The stored
   * `correct` flag is never counted — `validateReports` asserts it agrees with this.
   */
  correct(step: StepId, model: string): number {
    return this.cached(`correct:${step}:${model}`, () =>
      binaryStats(step === "step0" ? this.results.prompt(step, model).verdicts : this.results.pipeline(step, model).verdicts).correct
    );
  }

  accuracy(step: StepId, model: string): number {
    return pct(this.correct(step, model), this.labels().length);
  }

  /** The eight models of the subject-and-body Step 0 run that match the four-way labels best. */
  fourWayTop(n: number): Array<{ model: string; verdicts: PromptVerdict[] }> {
    return this.cached(`top:${n}`, () =>
      this.results
        .arm("step0-subject-body")
        .map((model) => {
          const verdicts = this.results.prompt("step0-subject-body", model).verdicts;
          const m = perClass(verdicts);
          return { model, verdicts, accuracy: m.accuracy, macroRecall: m.macroRecall };
        })
        .sort((a, b) => b.accuracy - a.accuracy || b.macroRecall - a.macroRecall || (a.model < b.model ? -1 : 1))
        .slice(0, n)
    );
  }

  csvRows(): ReturnType<typeof parseSappelliCsv> {
    return this.cached("csv", () => {
      const file = path.join(this.paths.cache, "AllDataENRON-transposed-final.csv");
      if (!existsSync(file)) throw new NeedsData("needs data/build (the annotation CSV is not downloaded)");
      return parseSappelliCsv(readFileSync(file, "utf8"));
    });
  }

  adjudication(): { key: SheetKey; verdicts: Record<string, string> } {
    return {
      key: this.results.json<SheetKey>("adjudication/key.json"),
      verdicts: this.results.json<Record<string, string>>("adjudication/verdicts.json")
    };
  }

  private cached<T>(key: string, load: () => T): T {
    if (!this.memo.has(key)) this.memo.set(key, load());
    return this.memo.get(key) as T;
  }
}

interface SheetKey {
  top_models: string[];
  sheets: Record<string, { id: string; group: "agree" | "disagree"; gold: string; models: string }>;
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? (s[mid] as number) : ((s[mid - 1] as number) + (s[mid] as number)) / 2;
}

function str(args: Args, name: string): string {
  const v = args[name];
  if (typeof v !== "string") throw new Error(`argument ${name} must be a string`);
  return v;
}

function field(value: unknown, dotted: string): unknown {
  return dotted.split(".").reduce<unknown>((o, k) => (o && typeof o === "object" ? (o as Record<string, unknown>)[k] : undefined), value);
}

type Setting = "cards" | "ships" | "both";
const SHOWN: Record<Setting, (v: PipelineVerdict, step0: string | null) => boolean> = {
  cards: (v) => v.judgment === "compose",
  ships: (v) => v.judgment === "compose" || v.judgment === "external",
  both: (v, s0) => v.judgment === "compose" || v.judgment === "external" || (s0 !== null && REPLY_LABELS.includes(s0))
};

function needsYouList(ctx: Context, model: string, setting: Setting): { shown: number; caught: number } {
  // By position: seven ids repeat, so an id lookup would read one row's Step 0 answer against
  // another row's Step 3 verdict.
  const step0 = ctx.results.prompt("step0", model).verdicts;
  const shown = ctx.results.pipeline("step3", model).verdicts.filter((v) => SHOWN[setting](v, step0[v.position]?.answer ?? null));
  return { shown: shown.length, caught: shown.filter((v) => REPLY_LABELS.includes(v.gold)).length };
}

/** The three observability rules; see the `reply.observable` metric. */
function observableUnder(row: ReplyRow, rule: string): boolean {
  if (rule === "roster") return row.rosterRecipients > 0;
  if (rule === "strict") return row.observableStrict;
  if (rule === "loose") return row.observable;
  throw new Error(`no observability rule ${rule}`);
}

function replyRows(ctx: Context): ReplyRow[] {
  return ctx.results.json<{ rows: ReplyRow[] }>("reply-behaviour/rows.json").rows;
}

export const METRICS: Record<string, Metric> = {
  "labels.count": (ctx, a) =>
    ctx.labels().filter((r) => (a.label4 === undefined || r.label4 === a.label4) && (a.label2 === undefined || r.label2 === a.label2))
      .length,
  "labels.distinctIds": (ctx) => new Set(ctx.labels().map((r) => r.id)).size,
  "labels.repeatedIds": (ctx) => ctx.labels().length - new Set(ctx.labels().map((r) => r.id)).size,
  "labels.noReplyShare": (ctx) => pct(ctx.labels().filter((r) => r.label2 === "no_reply").length, ctx.labels().length),

  "models.count": (ctx, a) =>
    ctx.results.manifest().models.filter((m) => (a.group === undefined || m.group === a.group) && (a.small === undefined || m.small === a.small))
      .length,
  "arm.modelCount": (ctx, a) => ctx.results.arm(str(a, "step") as StepId).length,

  "step.accuracy": (ctx, a) => ctx.accuracy(str(a, "step") as StepId, str(a, "model")),
  "step.median": (ctx, a) => median(ctx.results.models().map((m) => ctx.accuracy(str(a, "step") as StepId, m))),
  "step.max": (ctx, a) => Math.max(...ctx.results.models().map((m) => ctx.accuracy(str(a, "step") as StepId, m))),
  "step.beatsFloor": (ctx, a) => {
    const floor = ctx.labels().filter((r) => r.label2 === "no_reply").length;
    return ctx.results.models().filter((m) => ctx.correct(str(a, "step") as StepId, m) > floor).length;
  },
  /** 1 when the model beats answering "no reply needed" to every email at that step, else 0. */
  "model.beatsFloor": (ctx, a) =>
    ctx.correct(str(a, "step") as StepId, str(a, "model")) > ctx.labels().filter((r) => r.label2 === "no_reply").length ? 1 : 0,
  "step.cannotBeatFloor": (ctx, a) => ctx.results.models().length - num("step.beatsFloor", ctx, a),
  /** Models whose accuracy at `step` is below (`lt`) or at least (`ge`) their own Step 0 accuracy. */
  "step.vsStep0": (ctx, a) =>
    ctx.results.models().filter((m) => {
      const here = ctx.correct(str(a, "step") as StepId, m);
      const bare = ctx.correct("step0", m);
      return a.compare === "lt" ? here < bare : here >= bare;
    }).length,
  "step.delta": (ctx, a) => ctx.accuracy(str(a, "to") as StepId, str(a, "model")) - ctx.accuracy(str(a, "from") as StepId, str(a, "model")),
  "step.belowMedian": (ctx, a) => num("step.median", ctx, a) - ctx.accuracy(str(a, "step") as StepId, str(a, "model")),
  "step.needsYouRecall": (ctx, a) => {
    const step = str(a, "step") as StepId;
    const verdicts = step === "step0" ? ctx.results.prompt("step0", str(a, "model")).verdicts : ctx.results.pipeline(step, str(a, "model")).verdicts;
    return 100 * binaryStats(verdicts).needsYouRecall;
  },
  /** Verdicts at a pipeline step matching every `where` [field, value] pair and no `not` pair. */
  "verdicts.count": (ctx, a) => {
    const where = (a.where as Array<[string, unknown]> | undefined) ?? [];
    const not = (a.not as Array<[string, unknown]> | undefined) ?? [];
    return ctx.results
      .pipeline(str(a, "step") as "step1" | "step2" | "step3", str(a, "model"))
      .verdicts.filter((v) => where.every(([f, x]) => field(v, f) === x) && !not.some(([f, x]) => field(v, f) === x)).length;
  },

  "table1": (ctx, a) => {
    const { shown, caught } = needsYouList(ctx, str(a, "model"), str(a, "setting") as Setting);
    const owed = ctx.labels().filter((r) => r.label2 === "needs_reply").length;
    return { shown, caught, recall: pct(caught, owed), precision: pct(caught, shown) }[str(a, "field") as "shown"];
  },
  "table1.added": (ctx, a) => {
    const from = needsYouList(ctx, str(a, "model"), str(a, "from") as Setting);
    const to = needsYouList(ctx, str(a, "model"), str(a, "to") as Setting);
    const shown = to.shown - from.shown;
    const caught = to.caught - from.caught;
    return { shown, caught, notOwed: shown - caught }[str(a, "field") as "shown"];
  },
  "table1.waiting": (ctx, a) => {
    const { shown, caught } = needsYouList(ctx, str(a, "model"), str(a, "setting") as Setting);
    const total = ctx.labels().length;
    const owed = ctx.labels().filter((r) => r.label2 === "needs_reply").length;
    const waiting = total - shown;
    const missed = owed - caught;
    return { waiting, missed, quiet: waiting - missed, quietShare: (waiting - missed) / waiting }[str(a, "field") as "waiting"];
  },
  /** The article's worked example: two systems at the same accuracy, one flagging nothing extra. */
  "example.twoSystems": (ctx, a) => {
    const total = ctx.labels().length;
    const owed = ctx.labels().filter((r) => r.label2 === "needs_reply").length;
    const correct = Math.round(Number(a.accuracy) * total);
    const firstCaught = correct - (total - owed);
    const secondCaught = Number(a.secondCaught);
    return {
      correct,
      firstCaught,
      secondFlagged: secondCaught - firstCaught,
      firstMissed: owed - firstCaught,
      secondMissed: owed - secondCaught
    }[str(a, "field") as "correct"];
  },

  "figure2.point": (ctx, a) => {
    const point = progression(ctx.results, str(a, "model")).find((p) => p.arm === str(a, "arm"));
    if (!point) throw new Error(`no ${str(a, "arm")} point`);
    return point.accuracy;
  },
  "figure3.point": (ctx, a) => field(lanes(ctx.results, str(a, "model")), str(a, "field")) as number,

  "fourway.pairwiseAgreement": (ctx, a) => {
    const top = ctx.fourWayTop(Number(a.top));
    const n = ctx.labels().length;
    let sum = 0;
    let pairs = 0;
    for (let i = 0; i < top.length; i += 1) {
      for (let j = i + 1; j < top.length; j += 1) {
        const x = top[i]?.verdicts ?? [];
        const y = top[j]?.verdicts ?? [];
        sum += x.filter((v, k) => v.answer === y[k]?.answer).length / n;
        pairs += 1;
      }
    }
    return (100 * sum) / pairs;
  },
  "fourway.goldAgreement": (ctx, a) => {
    const top = ctx.fourWayTop(Number(a.top));
    return (100 * top.reduce((s, t) => s + perClass(t.verdicts).accuracy, 0)) / top.length;
  },

  "adjudication.count": (ctx, a) => {
    const { key, verdicts } = ctx.adjudication();
    return Object.entries(key.sheets).filter(([sid, s]) => {
      if (a.group !== undefined && s.group !== a.group) return false;
      const judged = verdicts[sid];
      if (a.outcome === "models") return judged === s.models;
      if (a.outcome === "gold") return judged === s.gold;
      if (a.outcome === "neither") return judged !== s.models && judged !== s.gold;
      if (a.outcome === "decided") return judged === s.models || judged === s.gold;
      return true;
    }).length;
  },
  /** The contested emails, re-derived from the sealed key's eight models: all eight gave the same
   *  four-way answer and the label says otherwise, one sheet per distinct email. */
  "adjudication.contestedRecomputed": (ctx) => {
    const { key } = ctx.adjudication();
    const answers = key.top_models.map((m) => ctx.results.prompt("step0-subject-body", m).verdicts);
    const ids = new Set<string>();
    ctx.labels().forEach((row, i) => {
      const set = new Set(answers.map((v) => v[i]?.answer ?? null));
      const only = [...set][0];
      if (set.size === 1 && only !== null && only !== undefined && only !== row.label4) ids.add(row.id);
    });
    return ids.size;
  },
  "adjudication.pValue": (ctx) => {
    return mcnemarExact(
      num("adjudication.count", ctx, { group: "disagree", outcome: "models" }),
      num("adjudication.count", ctx, { group: "disagree", outcome: "gold" })
    ).p;
  },
  "adjudication.oneInMillions": (ctx) => 1 / num("adjudication.pValue", ctx) / 1e6,
  /**
   * Adjudicated emails where the judge's own answer disagrees with the dataset on the two-way
   * question. Every sheet counts, whether or not the judge's four-way answer is the models': a
   * verdict of `postponed reply` against a gold of `accountable non-answer` flips whether a reply
   * is owed just as much as an exact match with the models does.
   */
  "adjudication.replyFlips": (ctx) => {
    const { key, verdicts } = ctx.adjudication();
    return Object.entries(key.sheets).filter(([sid, s]) => {
      const verdict = verdicts[sid];
      return verdict !== undefined && toBinary(verdict) !== toBinary(s.gold);
    }).length;
  },
  "adjudication.replyFlipShare": (ctx) => pct(num("adjudication.replyFlips", ctx), ctx.labels().length),

  /**
   * How many emails a reply could have been seen for. `strict` is the published rule — a recipient
   * on the archive's roster, OR a reply already observed; `roster` drops that second clause, which
   * conditions the set on the outcome being measured; `loose` admits any recipient who sends mail
   * anywhere in the archive.
   */
  "reply.observable": (ctx, a) => replyRows(ctx).filter((r) => observableUnder(r, str(a, "rule"))).length,
  "reply.windowDays": (ctx) =>
    ctx.results.json<{ header: { thresholds: { windowDays: number } } }>("reply-behaviour/rows.json").header.thresholds.windowDays,
  /** Did a recipient reply, split by whether the label (the dataset's, or the eight-model majority
   *  of the subject-and-body Step 0 run) expects one. Same code path as the published scorer. */
  "reply.separation": (ctx, a) => {
    const rule = str(a, "rule");
    const rows = reportOrder(replyRows(ctx)).map((r) => ({ ...r, observable: observableUnder(r, rule) }));
    const labels = ctx.labels();
    rows.forEach((r, i) => {
      if (r.id !== labels[i]?.id) throw new Error(`reply-behaviour row ${i} is ${r.id}, labels.csv has ${labels[i]?.id}`);
    });
    const indices = rows.map((_, i) => i);
    const top = ctx.fourWayTop(8);
    const labelOf =
      a.source === "gold"
        ? (i: number): string | null => (rows[i] as ReplyRow).gold
        : (i: number): string | null => consensusAt(top.map((t) => t.verdicts[i]?.answer ?? null)).label;
    const d = replySeparation(rows, indices, labelOf, SEED);
    return 100 * ({ expects: d.a.rate, none: d.b.rate, diff: d.diff, lo: d.ci.lo, hi: d.ci.hi }[str(a, "field") as "diff"]);
  },

  "annotations.count": (ctx, a) => {
    const rows = ctx.csvRows();
    const labelled = (x: string): boolean => x.length > 0 && x !== "{}";
    const both = rows.filter((r) => labelled(r.responseExpectationA1) && labelled(r.responseExpectationA2));
    const differ = both.filter((r) => r.responseExpectationA1 !== r.responseExpectationA2);
    const reply = (x: string): boolean => REPLY_LABELS.includes(x);
    const counts = {
      annotated: rows.length,
      bothLabelled: both.length,
      disagreed: differ.length,
      agreed: both.length - differ.length,
      replyTimingOnly: differ.filter((r) => reply(r.responseExpectationA1) && reply(r.responseExpectationA2)).length,
      noReplyKindOnly: differ.filter((r) => !reply(r.responseExpectationA1) && !reply(r.responseExpectationA2)).length,
      twoWayAgreed: both.filter((r) => reply(r.responseExpectationA1) === reply(r.responseExpectationA2)).length
    };
    return counts[str(a, "what") as keyof typeof counts];
  },
  "annotations.share": (ctx, a) =>
    pct(num("annotations.count", ctx, { what: a.numerator }), num("annotations.count", ctx, { what: a.denominator })),
  "annotations.kindNotWhether": (ctx) =>
    num("annotations.count", ctx, { what: "replyTimingOnly" }) + num("annotations.count", ctx, { what: "noReplyKindOnly" }),

  "built.sha256": (ctx, a) => {
    const file = path.join(ctx.paths.built, str(a, "file"));
    if (!existsSync(file)) throw new NeedsData(`needs data/build (${str(a, "file")} is not built)`);
    return createHash("sha256").update(readFileSync(file)).digest("hex");
  },
  "results.corpusSha256": (ctx, a) => {
    const step = ctx.results.manifest().steps.find((s) => s.id === str(a, "step"));
    if (!step) throw new Error(`no step ${str(a, "step")} in the manifest`);
    return step.corpusSha256;
  }
};
