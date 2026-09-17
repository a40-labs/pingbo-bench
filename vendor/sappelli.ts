/**
 * Sappelli et al. 2016 annotated Enron: pure parsing + join logic for the staged corpus. The
 * gold policy lives beside it in `sappelli_probes.ts`, and the I/O runner calls both. Two
 * halves:
 *
 *  - the annotation CSV (semicolon-separated, TWO annotators as `<field>A1;<field>A2` column
 *    pairs, 1,145 annotated rows keyed by `mid` in the Schulz MySQL export of Enron);
 *  - a streaming scanner that pulls exactly the annotated messages out of that 178MB
 *    `enron-mysqldump_v5.sql.gz` without a MySQL server. It reads TWO of the dump's four
 *    tables — `INSERT INTO `message` (`mid`, `sender`, `date`, `message_id`, `subject`,
 *    `body`, `folder`)` and `INSERT INTO `recipientinfo` (`rid`, `mid`, `rtype`, `rvalue`,
 *    `dater`)` — with backslash string escapes, so a char state machine over decompressed
 *    chunks is enough, and chunk boundaries may fall anywhere, which is why the scanner keeps
 *    all state between push() calls.
 *
 * Sender, date and recipients are kept because THE ANNOTATORS SAW THEM. An earlier probe file
 * carried subject and body alone, and on it eight frontier models agreed with each other 78%
 * while agreeing with the gold 63% — a disagreement about the instrument, not the models.
 * `probes.v2.json` gives the model the header the annotator was reading.
 *
 * Measured on the real CSV (2026-08-29): inter-annotator agreement on response expectation is
 * only 44.4% (508/1145) — the gold policy keeps ONLY both-agree rows and reports the rest, on
 * the rule that a disputed label is not ground truth.
 */

import {
  SqlDumpScanner,
  nullableField,
  type SqlDumpSink,
  type SqlTableSpec
} from "./sql_dump_scanner.js";

export interface SappelliRow {
  mid: number;
  responseExpectationA1: string;
  responseExpectationA2: string;
  act1A1: string;
  act1A2: string;
  numTasksA1: string;
  numTasksA2: string;
}

/** `{}` is the annotators' explicit "none" marker; treat it as no-label. */
const NONE = "{}";

export function parseSappelliCsv(text: string): SappelliRow[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  const headerLine = lines[0];
  if (headerLine === undefined) throw new Error("sappelli csv: empty file");
  const header = headerLine.split(";");
  const col = (name: string): number => {
    const i = header.indexOf(name);
    if (i < 0) throw new Error(`sappelli csv: missing column ${name}`);
    return i;
  };
  const iId = col("Id1");
  const iRe1 = col("REA1");
  const iRe2 = col("REA2");
  const iAct1 = col("Act1A1");
  const iAct2 = col("Act1A2");
  const iNt1 = col("NumTA1");
  const iNt2 = col("NumTA2");
  const rows: SappelliRow[] = [];
  for (const line of lines.slice(1)) {
    const f = line.split(";");
    const id = f[iId]?.trim();
    if (!id || !/^\d+$/.test(id)) continue;
    rows.push({
      mid: Number(id),
      responseExpectationA1: f[iRe1]?.trim() ?? "",
      responseExpectationA2: f[iRe2]?.trim() ?? "",
      act1A1: f[iAct1]?.trim() ?? "",
      act1A2: f[iAct2]?.trim() ?? "",
      numTasksA1: f[iNt1]?.trim() ?? "",
      numTasksA2: f[iNt2]?.trim() ?? ""
    });
  }
  return rows;
}

/** The gold policy: a label exists only where both annotators agree on a real value. */
export function agreedResponseExpectation(row: SappelliRow): string | null {
  const a = row.responseExpectationA1;
  const b = row.responseExpectationA2;
  if (a.length === 0 || a === NONE || a !== b) return null;
  return a;
}

export interface DumpMessage {
  mid: number;
  /** The `sender` column: one bare address, or "" where the dump holds SQL NULL. */
  sender: string;
  /** The `date` column, `YYYY-MM-DD HH:MM:SS` local to the dump, or "" for SQL NULL. */
  date: string;
  subject: string;
  body: string;
}

/** One `recipientinfo` row for a wanted mid: the header line it belongs on, and the address. */
export interface DumpRecipient {
  rtype: string;
  rvalue: string;
}

/**
 * The two tables this projection joins, keyed by the name between the backticks. `keyField` is
 * the column holding the mid — field 0 for `message`, field 1 for `recipientinfo` — and `arity`
 * is the tuple width the dump writes, checked by the scanner before a row is handed over so a
 * shape change can never mis-join.
 */
const TABLES: Record<string, SqlTableSpec> = {
  // (`mid`, `sender`, `date`, `message_id`, `subject`, `body`, `folder`)
  message: { keyField: 0, arity: 7 },
  // (`rid`, `mid`, `rtype`, `rvalue`, `dater`)
  recipientinfo: { keyField: 1, arity: 5 }
};

/**
 * The `message` + `recipientinfo` projection for the annotated mids. push() decompressed text in
 * any chunking; results accumulate in `found` (messages) and `recipients` (mid → the row's
 * TO/CC/BCC lines, in dump order). Only mids in `wanted` are retained, so memory stays bounded
 * by the annotation set; every other tuple is traversed and discarded by `SqlDumpScanner`.
 *
 * A tuple's fields arrive as SQL literals: a quoted string is unescaped, and a BARE token is
 * kept verbatim — so an SQL `NULL` arrives as the four characters `NULL` and each column that
 * can be NULL reads it through `nullableField`.
 */
export class MessageDumpScanner implements SqlDumpSink {
  readonly found = new Map<number, DumpMessage>();
  readonly recipients = new Map<number, DumpRecipient[]>();
  readonly tables = TABLES;
  private readonly scanner = new SqlDumpScanner(this);

  constructor(private readonly wanted: ReadonlySet<number>) {}

  push(chunk: string): void {
    this.scanner.push(chunk);
  }

  keep(_table: string, key: string): boolean {
    const mid = Number(key);
    return Number.isInteger(mid) && this.wanted.has(mid);
  }

  row(table: string, fields: readonly string[]): void {
    if (table === "message") {
      const mid = Number(fields[0]);
      this.found.set(mid, {
        mid,
        sender: nullableField(fields[1]),
        date: nullableField(fields[2]),
        subject: fields[4] ?? "",
        body: fields[5] ?? ""
      });
      return;
    }
    const mid = Number(fields[1]);
    const list = this.recipients.get(mid) ?? [];
    list.push({ rtype: nullableField(fields[2]), rvalue: nullableField(fields[3]) });
    this.recipients.set(mid, list);
  }
}

export interface SappelliJoinedProbe {
  mid: number;
  subject: string;
  body: string;
  responseExpectationA1: string;
  responseExpectationA2: string;
  /** The `message` row's sender address ("" where the dump holds NULL). */
  from: string;
  /** The `message` row's date, as the dump writes it ("" where NULL). */
  date: string;
  /** `recipientinfo` rtype TO, in dump order. */
  to: string[];
  /** `recipientinfo` rtype CC, in dump order. */
  cc: string[];
}

export interface SappelliJoined {
  probes: SappelliJoinedProbe[];
  counts: { annotated: number; joined: number; missingMessage: number };
}

/**
 * Join every annotation row to its dump message — the gold policy stays in the generator.
 *
 * BCC is read from the dump and deliberately DROPPED: the annotators judged the message as the
 * recipient saw it, and a blind-copied address is not on that message. TO and CC are, which is
 * why they ride.
 */
export function joinSappelli(
  rows: SappelliRow[],
  messages: ReadonlyMap<number, DumpMessage>,
  recipients: ReadonlyMap<number, readonly DumpRecipient[]> = new Map()
): SappelliJoined {
  const probes: SappelliJoined["probes"] = [];
  let missing = 0;
  for (const row of rows) {
    const msg = messages.get(row.mid);
    if (!msg) {
      missing++;
      continue;
    }
    const rcpts = recipients.get(row.mid) ?? [];
    const byType = (t: string): string[] =>
      rcpts.filter((r) => r.rtype.toUpperCase() === t && r.rvalue.length > 0).map((r) => r.rvalue);
    probes.push({
      mid: row.mid,
      subject: msg.subject,
      body: msg.body,
      responseExpectationA1: row.responseExpectationA1,
      responseExpectationA2: row.responseExpectationA2,
      from: msg.sender,
      date: msg.date,
      to: byType("TO"),
      cc: byType("CC")
    });
  }
  return { probes, counts: { annotated: rows.length, joined: probes.length, missingMessage: missing } };
}

/**
 * The two joined inputs one dump scan produces: version 1 (subject and body, no envelope) and
 * version 2 (the whole join). Version 1 is projected WITHOUT the envelope and with `counts`
 * first, so a file built from it regenerates byte-identically. Both the corpus build and the
 * published data build read them through this one projection.
 */
export function probesInputFiles(joined: SappelliJoined): {
  v1: {
    counts: SappelliJoined["counts"];
    probes: Array<Pick<SappelliJoinedProbe, "mid" | "subject" | "body" | "responseExpectationA1" | "responseExpectationA2">>;
  };
  v2: SappelliJoined;
} {
  return {
    v1: {
      counts: joined.counts,
      probes: joined.probes.map((p) => ({
        mid: p.mid,
        subject: p.subject,
        body: p.body,
        responseExpectationA1: p.responseExpectationA1,
        responseExpectationA2: p.responseExpectationA2
      }))
    },
    v2: joined
  };
}
