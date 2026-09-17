/**
 * What the recipients of the 508 Sappelli probes ACTUALLY DID — derived from the same Schulz
 * Enron dump the probes come out of, so the corpus can arbitrate its own gold without an
 * annotator.
 *
 * The gold is a *sender-side* label: two annotators read a message and said what response its
 * sender expected. They agreed 44.4% of the time, and eight frontier models agree with each
 * other far more than with what survived that agreement. Reply behaviour is a third, entirely
 * independent reading: it is the *recipient's* action, recorded by the corpus itself.
 *
 * ## What the dump can and cannot support
 *
 * The intended strict signal was the In-Reply-To/References header chain. **This dump does not
 * carry it.** `referenceinfo.reference` in `enron-mysqldump_v5.sql.gz` holds the QUOTED ORIGINAL
 * TEXT a message carried, not header message-ids: 54,778 rows, of which 5 mention `JavaMail` at
 * all (the string every Enron message-id contains). So the strict leg is re-founded on what the
 * table does hold — a message whose quoted block reproduces the probe's own body is a message
 * written in reply to (or forwarding) the probe, which is a stronger claim than a subject match
 * and is made on the same table.
 *
 * Two match kinds, always reported apart:
 *  - `quoted` — a `referenceinfo` row for message M reproduces the probe's body prefix
 *    (alphanumerics only, 64 chars, so the dump's whitespace mangling cannot break it);
 *  - `subject` — M's subject normalises equal to the probe's (repeated re:/fw:/fwd: stripped)
 *    and M's sender is one of the probe's TO/CC recipients.
 * Both require M to be a different mid, sent AFTER the probe and within the window (30 days).
 *
 * ## The dump's blind spot, stated rather than hidden
 *
 * The Enron corpus is the mail of ~150 custodians. A reply written by a recipient whose mail was
 * never captured is unobservable, so its absence is not evidence. A recipient counts as a
 * custodian when they are on the dump's own `employeelist` roster OR they send at least one
 * message anywhere in the dump — the roster carries 297 addresses for ~150 people while the mail
 * itself uses many more aliases, so the roster alone would call observable rows blind. Both
 * counts are on every row (`custodianRecipients` and the tighter `rosterRecipients`), and the
 * arbiter speaks only for rows where a reply COULD have been seen.
 */

import { SqlDumpScanner, nullableField, type SqlDumpSink, type SqlTableSpec } from "./sql_dump_scanner.js";

/** Probe row as `probes.v2.json` writes it, plus the mid parsed out of the id. */
export interface ReplyProbe {
  id: string;
  mid: number;
  gold: string;
  subject: string;
  body: string;
  from: string;
  date: string;
  to: readonly string[];
  cc: readonly string[];
}

export interface ReplyThresholds {
  /** Replies later than this many days after the probe are outside the window. */
  windowDays: number;
  /** Alphanumeric characters of the probe body that a quoted block must reproduce. */
  quoteWindow: number;
}

export const DEFAULT_THRESHOLDS: ReplyThresholds = { windowDays: 30, quoteWindow: 64 };

export type ReplyBucket = "fast" | "slow" | "none" | "unobservable";

export interface ReplyRow {
  id: string;
  mid: number;
  gold: string;
  /** TO ∪ CC, lowercased and de-duplicated. */
  recipients: number;
  /** How many of those are custodians: on the `employeelist` roster, OR the sender of at least
   *  one message in the dump — the test the derivation actually uses. */
  custodianRecipients: number;
  /** How many are on the `employeelist` roster alone — the tighter test, kept so the write-up
   *  can show what the observability rule costs. */
  rosterRecipients: number;
  /** The probe's OWN sender is on the `employeelist` roster, so a reply addressed back to them
   *  would land in a captured mailbox. Roster-only ON PURPOSE: under the union test every probe
   *  sender qualifies by construction (the probe is itself a message in the dump), which would
   *  make the field say nothing. Reported, not used — a reply can be addressed anywhere. */
  senderOnRoster: boolean;
  /** A reply BY a recipient was observed — the measure the response-expectation gold is about. */
  repliedByRecipient: boolean;
  /** Hours from the probe to the first such reply, or null. */
  firstReplyLatencyHours: number | null;
  /** Distinct recipient addresses that replied. */
  replierCount: number;
  /** How that reply was found; `quoted` wins when both fired. */
  matchKind: "quoted" | "subject" | null;
  matchedByQuote: boolean;
  matchedBySubject: boolean;
  /** A reply from anyone who is not the probe's own sender — third parties included. */
  anyReply: boolean;
  anyReplyLatencyHours: number | null;
  /** A reply was seen, or a custodian recipient could have been seen replying. */
  observable: boolean;
  /** The same question under the roster-only custodian test. */
  observableStrict: boolean;
  bucket: ReplyBucket;
}

export interface ReplyBehaviourCounts {
  probes: number;
  /** Probes whose body is too short to carry a `quoteWindow`-char needle. */
  probesWithoutQuoteNeedle: number;
  probesWithoutDate: number;
  observable: number;
  unobservable: number;
  observableStrict: number;
  withCustodianRecipient: number;
  withRosterRecipient: number;
  withSenderOnRoster: number;
  repliedByRecipient: number;
  repliedByQuote: number;
  repliedBySubject: number;
  anyReply: number;
  /** Candidate matches dropped for falling outside (probe.date, probe.date + windowDays]. */
  matchesOutsideWindow: number;
  dumpMessages: number;
  dumpCustodianAddresses: number;
  dumpReferenceRows: number;
  dumpReferenceRowsMatched: number;
}

// ---------------------------------------------------------------------------------------------
// Normalisation
// ---------------------------------------------------------------------------------------------

const REPLY_PREFIX = /^(?:re|fw|fwd|aw|antw|tr|sv|vs)\s*(?:\[\d+\])?\s*:\s*/i;

/** Subject with every leading re:/fw:/fwd: (and their common non-English spellings) stripped,
 *  whitespace collapsed, lowercased — so `RE: RE: Fwd: Budget` and `Budget` are one subject. */
export function normalizeSubject(subject: string): string {
  let t = subject.replace(/\s+/g, " ").trim().toLowerCase();
  for (;;) {
    const m = REPLY_PREFIX.exec(t);
    if (!m) break;
    t = t.slice(m[0].length).trim();
  }
  return t;
}

/** Alphanumerics only. The dump's quoted blocks lose newlines, gain `>` markers and re-wrap, so
 *  anything that survives punctuation and whitespace is the only thing worth comparing. */
export function normalizeQuoted(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

/** `YYYY-MM-DD HH:MM:SS` as the dump writes it, read as UTC so the derivation cannot drift with
 *  the machine's zone. Returns null for "" (SQL NULL) or anything else. */
export function parseDumpDate(date: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/.exec(date);
  if (!m) return null;
  const [, y, mo, d, h, mi, s] = m;
  const ms = Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s));
  return Number.isFinite(ms) ? ms : null;
}

export function normalizeAddress(address: string): string {
  return address.trim().toLowerCase();
}

// ---------------------------------------------------------------------------------------------
// The quote index
// ---------------------------------------------------------------------------------------------

const HASH_BASE = 31;

/**
 * Fixed-window substring index: 508 needles against 54,778 quoted blocks is 27M naive
 * `indexOf`s over multi-kilobyte strings, so the scan carries a rolling hash instead — O(1) per
 * character of quoted text, with the full string compared only on a hash hit.
 */
export class QuoteIndex {
  private readonly byHash = new Map<number, Array<{ needle: string; ids: number[] }>>();
  private readonly basePow: number;

  constructor(readonly window: number) {
    let p = 1;
    for (let i = 1; i < window; i += 1) p = Math.imul(p, HASH_BASE);
    this.basePow = p;
  }

  get size(): number {
    let n = 0;
    for (const bucket of this.byHash.values()) n += bucket.length;
    return n;
  }

  /** Index the first `window` characters of `normalized` under `id`. False when it is shorter. */
  add(id: number, normalized: string): boolean {
    if (normalized.length < this.window) return false;
    const needle = normalized.slice(0, this.window);
    const h = this.hash(needle);
    const bucket = this.byHash.get(h);
    if (!bucket) {
      this.byHash.set(h, [{ needle, ids: [id] }]);
      return true;
    }
    const hit = bucket.find((e) => e.needle === needle);
    if (hit) {
      if (!hit.ids.includes(id)) hit.ids.push(id);
    } else {
      bucket.push({ needle, ids: [id] });
    }
    return true;
  }

  /** Every indexed id whose needle occurs in `normalized`, without duplicates. */
  matches(normalized: string): number[] {
    if (normalized.length < this.window || this.byHash.size === 0) return [];
    const out = new Set<number>();
    let h = this.hash(normalized.slice(0, this.window));
    for (let i = this.window; ; i += 1) {
      const bucket = this.byHash.get(h);
      if (bucket) {
        const start = i - this.window;
        for (const entry of bucket) {
          if (normalized.startsWith(entry.needle, start)) for (const id of entry.ids) out.add(id);
        }
      }
      if (i >= normalized.length) break;
      h =
        (Math.imul(h - Math.imul(normalized.charCodeAt(i - this.window), this.basePow), HASH_BASE) +
          normalized.charCodeAt(i)) |
        0;
    }
    return [...out];
  }

  private hash(s: string): number {
    let h = 0;
    for (let i = 0; i < s.length; i += 1) h = (Math.imul(h, HASH_BASE) + s.charCodeAt(i)) | 0;
    return h;
  }
}

// ---------------------------------------------------------------------------------------------
// The dump scan
// ---------------------------------------------------------------------------------------------

/** One `message` row, reduced to what a reply test needs — never the body. */
export interface ScannedMessage {
  mid: number;
  sender: string;
  dateMs: number | null;
  normSubject: string;
}

const TABLES: Record<string, SqlTableSpec> = {
  // (`eid`, `firstName`, `lastName`, `Email_id`, `Email2`, `Email3`, `EMail4`, `folder`, `status`)
  employeelist: { keyField: 0, arity: 9 },
  // (`mid`, `sender`, `date`, `message_id`, `subject`, `body`, `folder`) — the body is skipped,
  // so 252,759 rows stream without ever being materialised.
  message: { keyField: 0, arity: 7, skipFields: [3, 5, 6] },
  // (`rfid`, `mid`, `reference`)
  referenceinfo: { keyField: 1, arity: 3 }
};

/**
 * Reads the WHOLE dump (not a wanted set): every message reduced to sender/date/subject, the
 * custodian roster, and — per `referenceinfo` row — which probes that row's quoted text
 * reproduces. The probe needles are supplied up front, so a reference row is tested as it
 * streams and its multi-kilobyte text is never retained.
 */
export class ReplyDumpScanner implements SqlDumpSink {
  readonly tables = TABLES;
  readonly messages: ScannedMessage[] = [];
  /** Every `employeelist` address — the dump's own statement of whose mail it holds. */
  readonly custodians = new Set<string>();
  /** Every address that sends at least one message in the dump. */
  readonly senders = new Set<string>();
  /** Replying mid → the probe mids its quoted block reproduces. */
  readonly quoteHits = new Map<number, number[]>();
  referenceRows = 0;
  referenceRowsMatched = 0;
  private readonly scanner = new SqlDumpScanner(this);

  constructor(private readonly quotes: QuoteIndex) {}

  push(chunk: string): void {
    this.scanner.push(chunk);
  }

  keep(): boolean {
    return true;
  }

  row(table: string, fields: readonly string[]): void {
    if (table === "message") {
      const sender = normalizeAddress(nullableField(fields[1]));
      if (sender.length > 0) this.senders.add(sender);
      this.messages.push({
        mid: Number(fields[0]),
        sender,
        dateMs: parseDumpDate(nullableField(fields[2])),
        normSubject: normalizeSubject(fields[4] ?? "")
      });
      return;
    }
    if (table === "employeelist") {
      for (const i of [3, 4, 5, 6]) {
        const address = normalizeAddress(nullableField(fields[i]));
        if (address.length > 0) this.custodians.add(address);
      }
      return;
    }
    this.referenceRows += 1;
    const hits = this.quotes.matches(normalizeQuoted(fields[2] ?? ""));
    if (hits.length === 0) return;
    this.referenceRowsMatched += 1;
    const mid = Number(fields[1]);
    const existing = this.quoteHits.get(mid);
    if (existing) for (const h of hits) {
      if (!existing.includes(h)) existing.push(h);
    }
    else this.quoteHits.set(mid, hits);
  }
}

/** Build the needle index the scanner needs, and say how many probes are too short to index. */
export function buildQuoteIndex(
  probes: readonly ReplyProbe[],
  thresholds: ReplyThresholds = DEFAULT_THRESHOLDS
): { index: QuoteIndex; withoutNeedle: number } {
  const index = new QuoteIndex(thresholds.quoteWindow);
  const seen = new Set<number>();
  let withoutNeedle = 0;
  for (const p of probes) {
    if (seen.has(p.mid)) continue;
    seen.add(p.mid);
    if (!index.add(p.mid, normalizeQuoted(p.body))) withoutNeedle += 1;
  }
  return { index, withoutNeedle };
}

// ---------------------------------------------------------------------------------------------
// The derivation
// ---------------------------------------------------------------------------------------------

const HOUR_MS = 3_600_000;

export interface ReplyBehaviour {
  rows: ReplyRow[];
  counts: ReplyBehaviourCounts;
}

interface Accumulator {
  byRecipient: Map<string, number>;
  quote: boolean;
  subject: boolean;
  anyLatency: number | null;
}

/**
 * Join the probes to the scan. Rows come back in PROBE ORDER — the corpus has 7 ids more than
 * once, and every consumer of these reports pairs by position, never by id.
 */
export function deriveReplyBehaviour(
  probes: readonly ReplyProbe[],
  scan: {
    messages: readonly ScannedMessage[];
    custodians: ReadonlySet<string>;
    senders: ReadonlySet<string>;
    quoteHits: ReadonlyMap<number, number[]>;
    referenceRows?: number;
    referenceRowsMatched?: number;
  },
  thresholds: ReplyThresholds = DEFAULT_THRESHOLDS,
  probesWithoutQuoteNeedle = 0
): ReplyBehaviour {
  const windowMs = thresholds.windowDays * 24 * HOUR_MS;
  const bySubject = new Map<string, number[]>();
  const byMid = new Map<number, number[]>();
  const acc: Accumulator[] = probes.map(() => ({
    byRecipient: new Map(),
    quote: false,
    subject: false,
    anyLatency: null
  }));
  const recipientSets = probes.map((p) =>
    new Set([...p.to, ...p.cc].map(normalizeAddress).filter((a) => a.length > 0))
  );
  const probeDates = probes.map((p) => parseDumpDate(p.date));

  probes.forEach((p, i) => {
    const key = normalizeSubject(p.subject);
    if (key.length > 0) push(bySubject, key, i);
    push(byMid, p.mid, i);
  });

  let matchesOutsideWindow = 0;

  const consider = (msg: ScannedMessage, i: number, kind: "quoted" | "subject"): void => {
    const probe = probes[i] as ReplyProbe;
    if (msg.mid === probe.mid) return;
    const probeMs = probeDates[i];
    if (probeMs === null || probeMs === undefined || msg.dateMs === null) return;
    const delta = msg.dateMs - probeMs;
    if (delta <= 0 || delta > windowMs) {
      if (delta > windowMs) matchesOutsideWindow += 1;
      return;
    }
    if (msg.sender.length === 0) return;
    const a = acc[i] as Accumulator;
    if ((recipientSets[i] as Set<string>).has(msg.sender)) {
      const prior = a.byRecipient.get(msg.sender);
      if (prior === undefined || delta < prior) a.byRecipient.set(msg.sender, delta);
      if (kind === "quoted") a.quote = true;
      else a.subject = true;
    }
    if (msg.sender !== normalizeAddress(probe.from)) {
      if (a.anyLatency === null || delta < a.anyLatency) a.anyLatency = delta;
    }
  };

  for (const msg of scan.messages) {
    const quoted = scan.quoteHits.get(msg.mid);
    if (quoted) {
      for (const probeMid of quoted) {
        for (const i of byMid.get(probeMid) ?? []) consider(msg, i, "quoted");
      }
    }
    if (msg.normSubject.length > 0) {
      for (const i of bySubject.get(msg.normSubject) ?? []) consider(msg, i, "subject");
    }
  }

  const rows: ReplyRow[] = probes.map((p, i) => {
    const a = acc[i] as Accumulator;
    const recipients = recipientSets[i] as Set<string>;
    let custodianRecipients = 0;
    let rosterRecipients = 0;
    for (const r of recipients) {
      const onRoster = scan.custodians.has(r);
      if (onRoster) rosterRecipients += 1;
      if (onRoster || scan.senders.has(r)) custodianRecipients += 1;
    }
    const senderOnRoster = scan.custodians.has(normalizeAddress(p.from));
    let first: number | null = null;
    for (const d of a.byRecipient.values()) if (first === null || d < first) first = d;
    const replied = a.byRecipient.size > 0;
    // A reply that WAS seen proves observability by itself; otherwise the custodian test is
    // what says a reply could have been seen at all.
    const observable = replied || custodianRecipients > 0;
    const latencyHours = first === null ? null : first / HOUR_MS;
    const bucket: ReplyBucket = !observable
      ? "unobservable"
      : latencyHours === null
        ? "none"
        : latencyHours <= 24
          ? "fast"
          : "slow";
    return {
      id: p.id,
      mid: p.mid,
      gold: p.gold,
      recipients: recipients.size,
      custodianRecipients,
      rosterRecipients,
      senderOnRoster,
      repliedByRecipient: replied,
      firstReplyLatencyHours: latencyHours,
      replierCount: a.byRecipient.size,
      matchKind: a.quote ? "quoted" : a.subject ? "subject" : null,
      matchedByQuote: a.quote,
      matchedBySubject: a.subject,
      anyReply: a.anyLatency !== null,
      anyReplyLatencyHours: a.anyLatency === null ? null : a.anyLatency / HOUR_MS,
      observable,
      observableStrict: replied || rosterRecipients > 0,
      bucket
    };
  });

  const counts: ReplyBehaviourCounts = {
    probes: rows.length,
    probesWithoutQuoteNeedle,
    probesWithoutDate: probeDates.filter((d) => d === null).length,
    observable: rows.filter((r) => r.observable).length,
    unobservable: rows.filter((r) => !r.observable).length,
    observableStrict: rows.filter((r) => r.observableStrict).length,
    withCustodianRecipient: rows.filter((r) => r.custodianRecipients > 0).length,
    withRosterRecipient: rows.filter((r) => r.rosterRecipients > 0).length,
    withSenderOnRoster: rows.filter((r) => r.senderOnRoster).length,
    repliedByRecipient: rows.filter((r) => r.repliedByRecipient).length,
    repliedByQuote: rows.filter((r) => r.matchedByQuote).length,
    repliedBySubject: rows.filter((r) => r.matchedBySubject).length,
    anyReply: rows.filter((r) => r.anyReply).length,
    matchesOutsideWindow,
    dumpMessages: scan.messages.length,
    dumpCustodianAddresses: scan.custodians.size,
    dumpReferenceRows: scan.referenceRows ?? 0,
    dumpReferenceRowsMatched: scan.referenceRowsMatched ?? 0
  };
  return { rows, counts };
}

/** Re-bucket a derived row at a different fast/slow cut. The 24 h line is a choice, so any
 *  result that rests on it should be shown at other cuts too. */
export function bucketAt(row: ReplyRow, fastCutHours: number): ReplyBucket {
  if (!row.observable) return "unobservable";
  if (row.firstReplyLatencyHours === null) return "none";
  return row.firstReplyLatencyHours <= fastCutHours ? "fast" : "slow";
}

function push<K>(map: Map<K, number[]>, key: K, value: number): void {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
}
