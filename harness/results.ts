/**
 * The shapes of `results/<version>/` and the one loader every script in this repository reads
 * them through. Every per-model file is `{ header, metrics, verdicts }`, and `verdicts[i]` is the
 * probe at `position` i: the order is the same in every file (probe ids sorted as strings), and
 * seven ids repeat — six appear three times, one twice — so rows pair by position, never by id.
 */
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

export type StepId = "step0" | "step1" | "step2" | "step3";
/** Step 0 again, on the older subject-and-body probes (the appendix's four-way reading). */
export type ArmDir = StepId | "step0-subject-body";

export const FOUR_WAY_LABELS = ["immediate reply", "postponed reply", "accountable non-answer", "ignore"] as const;
export const NEEDS_REPLY = "needs_reply";
export const NO_REPLY = "no_reply";

export interface PromptVerdict {
  position: number;
  id: string;
  gold: string;
  /** The label parsed from the model's answer, or null when it was not exactly one label. The
   *  model's own words are not published: asked the bare question, a model often answers in prose
   *  and quotes the email back, and the email text is not ours to redistribute. */
  answer: string | null;
  finishReason: string | null;
  correct: boolean;
}

export interface PipelineVerdict {
  position: number;
  id: string;
  gold: string;
  /** "needs you" | "waiting" | null (the run failed for this email and counts as wrong). */
  answer: string | null;
  correct: boolean;
  home: string | null;
  judgment: string | null;
  whoseMove?: string | null;
  senderRelation: string | null;
  retries: Record<string, boolean>;
  error?: { code: string; refusal?: string };
}

export interface ModelEntry {
  id: string;
  group: "openai" | "anthropic" | "self-hosted";
  /** Small enough that a phone could carry it. */
  small: boolean;
}

export interface StepEntry {
  id: ArmDir;
  label: string;
  probes: "probes.v2.json" | "probes.json";
  /** sha256 of that probe file as `data/build` rebuilds it. */
  corpusSha256: string;
  pipelineVersion?: string;
  promptSha256?: string;
  sortingPromptSha256?: string;
  judgeVersion?: number;
}

export interface Manifest {
  version: string;
  article: { title: string; url: string; publishedOn: string };
  seed: number;
  sample: number;
  models: ModelEntry[];
  steps: StepEntry[];
}

export interface Report<V> {
  header: Record<string, unknown> & { model: string; step: string };
  metrics: Record<string, unknown>;
  verdicts: V[];
}

export interface LabelRow {
  position: number;
  id: string;
  label4: string;
  label2: string;
}

export function readJson<T>(file: string): T {
  return JSON.parse(readFileSync(file, "utf8")) as T;
}

export class Results {
  private readonly cache = new Map<string, unknown>();

  constructor(readonly dir: string) {}

  manifest(): Manifest {
    return this.memo("manifest", () => readJson<Manifest>(path.join(this.dir, "manifest.json")));
  }

  models(): string[] {
    return this.manifest().models.map((m) => m.id);
  }

  prompt(arm: "step0" | "step0-subject-body", model: string): Report<PromptVerdict> {
    return this.memo(`${arm}/${model}`, () => readJson(path.join(this.dir, arm, `${model}.json`)));
  }

  pipeline(step: "step1" | "step2" | "step3", model: string): Report<PipelineVerdict> {
    return this.memo(`${step}/${model}`, () => readJson(path.join(this.dir, step, `${model}.json`)));
  }

  /** Every model file present for an arm, in manifest order. */
  arm(arm: ArmDir): string[] {
    const present = new Set(readdirSync(path.join(this.dir, arm)).map((f) => f.replace(/\.json$/, "")));
    return this.models().filter((m) => present.has(m));
  }

  labels(labelsCsv: string): LabelRow[] {
    return this.memo(`labels:${labelsCsv}`, () => parseLabels(readFileSync(labelsCsv, "utf8")));
  }

  json<T>(relative: string): T {
    return this.memo(relative, () => readJson<T>(path.join(this.dir, relative)));
  }

  private memo<T>(key: string, load: () => T): T {
    if (!this.cache.has(key)) this.cache.set(key, load());
    return this.cache.get(key) as T;
  }
}

export function parseLabels(text: string): LabelRow[] {
  const [header, ...lines] = text.trim().split("\n");
  if (header !== "position,id,label_4way,label_2way") throw new Error(`labels.csv: unexpected header ${header}`);
  return lines.map((line) => {
    const [position, id, label4, label2] = line.split(",");
    if (position === undefined || id === undefined || label4 === undefined || label2 === undefined) {
      throw new Error(`labels.csv: malformed row ${line}`);
    }
    return { position: Number(position), id, label4, label2 };
  });
}
