/**
 * Rebuild the 508-email test set and the adjudication sheets from their public sources.
 *
 *   npx tsx data/build/build.ts [--cache data/build/cache] [--out data/build/out]
 *
 * 1. Download the Sappelli et al. (2016) annotation CSV and the Enron MySQL dump the benchmark
 *    joined it to (skipped when already in the cache), and check both against `sources.json`.
 * 2. Stream the dump for the 1,145 annotated messages, join them, keep the 508 on which both
 *    annotators agree, and write `probes.json` (subject and body) and `probes.v2.json` (with the
 *    sender, recipients and date the annotators saw). Both must match their published sha256.
 * 3. Render `adjudication/SHEETS.md` from `probes.v2.json` and the sealed key, and check it too.
 *
 * Nothing here needs a database, an API key or this repository's history. The email text stays
 * on your machine: none of it is redistributed in this repository.
 */
import { createHash } from "node:crypto";
import { createReadStream, createWriteStream, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createGunzip } from "node:zlib";

import { MessageDumpScanner, joinSappelli, parseSappelliCsv, probesInputFiles } from "../../vendor/sappelli.js";
import { selectProbes } from "../../vendor/sappelli_probes.js";
import { probeFile } from "./probes.js";
import { labelDefinitions, renderSheets, type SheetKey } from "./sheets.js";

export interface Sources {
  version: string;
  inputs: Record<"annotations" | "dump", { url: string; file: string; sha256: string; bytes: number }>;
  outputs: Record<"probes.json" | "probes.v2.json" | "adjudication/SHEETS.md", string>;
}

const here = path.dirname(fileURLToPath(import.meta.url));

export function sha256(data: string | Buffer): string {
  return createHash("sha256").update(data).digest("hex");
}

async function sha256File(file: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(file)) hash.update(chunk as Buffer);
  return hash.digest("hex");
}

async function fetchInput(input: Sources["inputs"]["dump"], cache: string): Promise<string> {
  const target = path.join(cache, input.file);
  if (!existsSync(target)) {
    console.log(`[fetch] ${input.url}`);
    const res = await fetch(input.url, { redirect: "follow" });
    if (!res.ok || !res.body) throw new Error(`GET ${input.url} answered ${res.status}`);
    mkdirSync(cache, { recursive: true });
    const partial = `${target}.partial`;
    await pipeline(Readable.fromWeb(res.body as import("node:stream/web").ReadableStream), createWriteStream(partial));
    renameSync(partial, target);
  }
  const got = await sha256File(target);
  if (got !== input.sha256) {
    throw new Error(`${input.file}: sha256 ${got}, expected ${input.sha256}. The source changed; this build cannot reproduce v1.`);
  }
  console.log(`[ok]    ${input.file} sha256 ${got}`);
  return target;
}

function expect(name: keyof Sources["outputs"], bytes: string, sources: Sources): void {
  const got = sha256(bytes);
  if (got !== sources.outputs[name]) throw new Error(`${name}: sha256 ${got}, expected ${sources.outputs[name]}`);
  console.log(`[ok]    ${name} sha256 ${got}`);
}

/** `root` is the repository root: where `data/build/sources.json`, the sealed key and the Step 0 prompt live. */
export async function build(options: { cache: string; out: string; root?: string }): Promise<void> {
  const root = options.root ?? path.resolve(here, "..", "..");
  const sources = JSON.parse(readFileSync(path.join(root, "data", "build", "sources.json"), "utf8")) as Sources;
  const csv = await fetchInput(sources.inputs.annotations, options.cache);
  const dump = await fetchInput(sources.inputs.dump, options.cache);

  const rows = parseSappelliCsv(readFileSync(csv, "utf8"));
  const scanner = new MessageDumpScanner(new Set(rows.map((r) => r.mid)));
  const decoder = new TextDecoder("utf-8");
  console.log(`[scan]  ${path.basename(dump)} for ${rows.length} annotated messages`);
  for await (const chunk of createReadStream(dump).pipe(createGunzip())) {
    scanner.push(decoder.decode(chunk as Buffer, { stream: true }));
  }
  scanner.push(decoder.decode());
  const inputs = probesInputFiles(joinSappelli(rows, scanner.found, scanner.recipients));

  const v1 = probeFile(selectProbes(inputs.v1, 1), 1);
  const v2 = probeFile(selectProbes(inputs.v2, 2, v1.file.probes.map((p) => p.id)), 2);
  expect("probes.json", v1.bytes, sources);
  expect("probes.v2.json", v2.bytes, sources);

  const key = JSON.parse(readFileSync(path.join(root, "results", sources.version, "adjudication", "key.json"), "utf8")) as SheetKey;
  const instruction = readFileSync(path.join(root, "harness", "step0", "prompt.rev2.txt"), "utf8");
  const sheets = renderSheets(key, v2.file.probes, labelDefinitions(instruction));
  expect("adjudication/SHEETS.md", sheets, sources);

  mkdirSync(path.join(options.out, "adjudication"), { recursive: true });
  writeFileSync(path.join(options.out, "probes.json"), v1.bytes);
  writeFileSync(path.join(options.out, "probes.v2.json"), v2.bytes);
  writeFileSync(path.join(options.out, "adjudication", "SHEETS.md"), sheets);
  console.log(`[done]  ${v2.file.probes.length} probes and ${Object.keys(key.sheets).length} sheets in ${options.out}`);
}

if (process.argv[1]?.endsWith("build.ts")) {
  const arg = (name: string, fallback: string): string => {
    const i = process.argv.indexOf(`--${name}`);
    return i >= 0 ? (process.argv[i + 1] as string) : fallback;
  };
  await build({ cache: arg("cache", path.join(here, "cache")), out: arg("out", path.join(here, "out")) });
}
