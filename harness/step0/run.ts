/**
 * Step 0: ask one model the bare question for each of the 508 emails, with your own API key.
 *
 *   npx tsx harness/step0/run.ts --model gpt-5.5 --endpoint https://api.openai.com/v1 \
 *     --auth-env OPENAI_API_KEY --out runs/step0/gpt-5.5.json \
 *     [--probes data/build/out/probes.v2.json] [--max-tokens 64] [--concurrency 4] \
 *     [--body-overrides '{"max_tokens":null,"max_completion_tokens":2048,"reasoning_effort":"none"}']
 *
 * Any OpenAI-compatible chat-completions endpoint works. The instruction is `prompt.rev2.txt`,
 * byte for byte; the answer must be exactly one of the four labels after trimming and lowercasing,
 * and anything else is scored wrong. The output has the shape of `results/v1/step0/<model>.json`,
 * so `harness/scoring` reads it the same way.
 *
 * Decoding defaults to temperature 0 and top_p 1. A `--body-overrides` entry set to `null` REMOVES
 * that parameter from the request, which is how the published runs on providers that reject it
 * were made: 23 of the 32 headers delete `temperature` and `top_p` and so ran at the provider's
 * own default. Each published header records the settings its model ran with; pass them back to
 * match it. The header's `seed` is this benchmark's analysis seed and is never sent to a provider.
 *
 * Expect small differences from the published answers: the runs are not repeatable even with
 * decoding pinned as far as a provider allows (METHODS.md, Limitations, gives the measured
 * run-to-run churn).
 */
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";

import { binaryStats, perClass } from "../scoring/binary.js";

export const LABELS = ["immediate reply", "postponed reply", "accountable non-answer", "ignore"] as const;

export interface Probe {
  id: string;
  gold: string;
  subject?: string;
  body?: string;
  from?: string;
  date?: string;
  to?: string[];
  cc?: string[];
}

/** The user message: the envelope the annotators saw, then subject and body. */
export function probeText(probe: Probe): string {
  const header: string[] = [];
  if (probe.from) header.push(`From: ${probe.from}`);
  if (probe.to && probe.to.length > 0) header.push(`To: ${probe.to.join(", ")}`);
  if (probe.cc && probe.cc.length > 0) header.push(`Cc: ${probe.cc.join(", ")}`);
  if (probe.date) header.push(`Date: ${probe.date}`);
  if (header.length === 0) return `Subject: ${probe.subject ?? ""}\n\n${probe.body ?? ""}`;
  return `${header.join("\n")}\nSubject: ${probe.subject ?? ""}\n\n${probe.body ?? ""}`;
}

/** Exactly one label after trim and lowercase, or null. Nothing forgiving. */
export function parseLabel(raw: string): string | null {
  const t = raw.trim().toLowerCase();
  return LABELS.find((l) => l === t) ?? null;
}

/** Refusals about one input (too long, filtered, language) become an unparsed answer, not a crash. */
const REFUSALS = ["context_length_exceeded", "content_filter", "unsupported_language"];

interface Args {
  model: string;
  endpoint: string;
  out: string;
  probes: string;
  authEnv?: string;
  maxTokens: number;
  concurrency: number;
  bodyOverrides: Record<string, unknown>;
}

function parseArgs(argv: string[]): Args {
  const o: Record<string, string> = {};
  for (let i = 0; i < argv.length; i += 2) {
    const k = argv[i];
    if (!k?.startsWith("--")) throw new Error(`unexpected argument ${k}`);
    o[k.slice(2)] = argv[i + 1] ?? "";
  }
  if (!o.model || !o.endpoint || !o.out) {
    console.error(
      "usage: npx tsx harness/step0/run.ts --model <id> --endpoint <OpenAI-compatible base URL> --out <file>\n" +
        "         [--auth-env <ENV VAR holding the key>] [--probes data/build/out/probes.v2.json]\n" +
        "         [--max-tokens 64] [--concurrency 4] [--body-overrides '<JSON>']"
    );
    process.exit(2);
  }
  return {
    model: o.model,
    endpoint: o.endpoint.replace(/\/$/, ""),
    out: o.out,
    probes: o.probes ?? "data/build/out/probes.v2.json",
    ...(o["auth-env"] ? { authEnv: o["auth-env"] } : {}),
    maxTokens: Number(o["max-tokens"] ?? 64),
    concurrency: Number(o.concurrency ?? 4),
    bodyOverrides: o["body-overrides"] ? (JSON.parse(o["body-overrides"]) as Record<string, unknown>) : {}
  };
}

async function ask(args: Args, instruction: string, text: string): Promise<{ raw: string; finishReason: string | null }> {
  const body: Record<string, unknown> = {
    model: args.model,
    temperature: 0,
    top_p: 1,
    max_tokens: args.maxTokens,
    messages: [
      { role: "system", content: instruction },
      { role: "user", content: text }
    ]
  };
  for (const [k, v] of Object.entries(args.bodyOverrides)) {
    if (v === null) delete body[k];
    else body[k] = v;
  }
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (args.authEnv) {
    const token = process.env[args.authEnv];
    if (!token) throw new Error(`${args.authEnv} is not set`);
    headers.authorization = `Bearer ${token}`;
  }
  const res = await fetch(`${args.endpoint}/chat/completions`, { method: "POST", headers, body: JSON.stringify(body) });
  const payload = await res.text();
  if (!res.ok) {
    let code: unknown;
    try {
      code = (JSON.parse(payload) as { error?: { code?: unknown } }).error?.code;
    } catch {
      code = undefined;
    }
    if (res.status === 400 && typeof code === "string" && REFUSALS.includes(code)) return { raw: "", finishReason: code };
    throw new Error(`endpoint ${res.status}: ${payload.slice(0, 200)}`);
  }
  const choice = (JSON.parse(payload) as { choices?: Array<{ message?: { content?: string }; finish_reason?: string }> })
    .choices?.[0];
  return { raw: choice?.message?.content ?? "", finishReason: choice?.finish_reason ?? null };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const instruction = readFileSync(new URL("./prompt.rev2.txt", import.meta.url), "utf8");
  const bytes = readFileSync(args.probes);
  const probes = (JSON.parse(bytes.toString("utf8")) as { probes: Probe[] }).probes;
  type Row = { index: number; id: string; gold: string; answer: string | null; raw: string; finishReason: string | null; correct: boolean };
  // The row's place is decided before it is dispatched and travels with it. Seven ids repeat, so
  // workers that finish out of order would otherwise hand two rows of one id back in completion
  // order, and a sort by id alone cannot put them back.
  const ordered = probes
    .map((probe, index) => ({ probe, index }))
    .sort((a, b) => (a.probe.id < b.probe.id ? -1 : a.probe.id > b.probe.id ? 1 : a.index - b.index));
  const rows = new Array<Row | undefined>(ordered.length);
  const queue = ordered.map((entry, position) => ({ ...entry, position }));
  let done = 0;
  await Promise.all(
    Array.from({ length: Math.max(1, args.concurrency) }, async () => {
      for (let job = queue.shift(); job; job = queue.shift()) {
        const p = job.probe;
        const { raw, finishReason } = await ask(args, instruction, probeText(p));
        const answer = parseLabel(raw);
        rows[job.position] = { index: job.position, id: p.id, gold: p.gold, answer, raw: raw.slice(0, 200), finishReason, correct: answer === p.gold };
        done += 1;
        if (done % 50 === 0) console.log(`${done}/${probes.length}`);
      }
    })
  );
  const verdicts = rows.map((row, position) => {
    if (row === undefined) throw new Error(`no answer recorded for position ${position}`);
    const { index: _index, ...rest } = row;
    return rest;
  });
  const four = perClass(verdicts);
  const two = binaryStats(verdicts);
  const report = {
    header: {
      model: args.model,
      step: "step0",
      probes: path.basename(args.probes),
      corpusSha256: createHash("sha256").update(bytes).digest("hex"),
      promptSha256: createHash("sha256").update(instruction).digest("hex"),
      seed: 1610,
      sample: verdicts.length,
      decode: { maxTokens: args.maxTokens, bodyOverrides: args.bodyOverrides },
      generatedAt: new Date().toISOString()
    },
    metrics: {
      total: verdicts.length,
      decided: verdicts.filter((v) => v.answer !== null).length,
      correct: verdicts.filter((v) => v.correct).length,
      accuracy: four.accuracy,
      macroRecall: four.macroRecall,
      perClass: four.classes,
      twoWay: { correct: two.correct, accuracy: two.accuracy, needsYouRecall: two.needsYouRecall, waitingRecall: two.waitingRecall }
    },
    verdicts: verdicts.map((v, position) => ({ position, ...v }))
  };
  mkdirSync(path.dirname(args.out), { recursive: true });
  writeFileSync(args.out, JSON.stringify(report, null, 1));
  console.log(`four-way ${(100 * four.accuracy).toFixed(1)}% · two-way ${(100 * two.accuracy).toFixed(1)}% → ${args.out}`);
}

if (process.argv[1]?.endsWith("run.ts")) await main();
