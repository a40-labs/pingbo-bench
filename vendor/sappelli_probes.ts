/**
 * The gold policy for the Sappelli response-expectation set, pure. A probe exists only where BOTH
 * annotators recorded the same real value; every row that fails that test is counted rather than
 * dropped quietly. Measured on the annotation CSV, the two agree on 508 of 1,145 rows.
 *
 * Version 1 carries subject and body. Version 2 adds the envelope the ANNOTATORS had in view
 * (sender, date, TO and CC) and must pair with version 1 BY POSITION: the corpus has 7 ids that
 * appear twice, so an id-keyed comparison would silently drop rows, and a re-roll that changed
 * the order would stop being a paired test.
 *
 * Selection lives here alone, so the benchmark's own generator and the published data build put
 * the same rows in the same order, and each composes the file header it needs around them.
 */

import { agreedResponseExpectation, type SappelliRow } from "./sappelli.js";

export interface JoinedInput {
  counts: { annotated: number; joined: number; missingMessage: number };
  probes: Array<{
    mid: number;
    subject: string;
    body: string;
    responseExpectationA1: string;
    responseExpectationA2: string;
    from?: string;
    date?: string;
    to?: string[];
    cc?: string[];
  }>;
}

/** 1 is subject and body; 2 adds the envelope. */
export type Version = 1 | 2;

export interface SappelliProbe {
  id: string;
  subject: string;
  body: string;
  gold: string;
  from?: string;
  date?: string;
  to?: string[];
  cc?: string[];
}

export interface ProbeSelection {
  probes: SappelliProbe[];
  /** How many rows the annotators labelled, how many joined to a message, and what was dropped. */
  counts: {
    annotated: number;
    joined: number;
    missingFromDump: number;
    droppedDisagreement: number;
    droppedNoExpectation: number;
    probes: number;
  };
  /** Rows per agreed four-way label. */
  labels: Record<string, number>;
  /** Version 2 only: how many probes carry each envelope field. */
  envelopeCounts?: Record<string, number>;
}

/** Both arms must score the SAME probes in the SAME order: the paired test is by position, and
 *  7 ids repeat in this corpus — six three times, one twice, 13 surplus rows — so an id-keyed
 *  comparison would silently drop rows. Refuse a version 2 whose id sequence has drifted. */
export function assertSameIdOrder(next: readonly string[], reference: readonly string[]): void {
  if (next.length !== reference.length) {
    throw new Error(
      `probe count changed: ${next.length} vs the reference file's ${reference.length} — a ` +
        `paired re-roll needs the same rows in the same order`
    );
  }
  for (let i = 0; i < next.length; i += 1) {
    if (next[i] !== reference[i]) {
      throw new Error(
        `probe order changed at position ${i}: "${next[i]}" vs the reference file's ` +
          `"${reference[i]}" — a paired re-roll needs the same rows in the same order`
      );
    }
  }
}

/**
 * Apply the gold policy to one joined-input file. A version 2 selection needs the version 1 probe
 * ids (`referenceIds`) and refuses to build unless they match by position.
 */
export function selectProbes(
  input: JoinedInput,
  version: Version,
  referenceIds?: readonly string[]
): ProbeSelection {
  const labels: Record<string, number> = {};
  let disagreed = 0;
  let none = 0;
  const probes: SappelliProbe[] = [];
  for (const p of input.probes) {
    const row = {
      responseExpectationA1: p.responseExpectationA1,
      responseExpectationA2: p.responseExpectationA2
    } as SappelliRow;
    const gold = agreedResponseExpectation(row);
    if (gold === null) {
      if (p.responseExpectationA1 === p.responseExpectationA2) none++;
      else disagreed++;
      continue;
    }
    labels[gold] = (labels[gold] ?? 0) + 1;
    probes.push({
      id: `sappelli:${p.mid}`,
      subject: p.subject,
      body: p.body,
      gold,
      ...(version === 2
        ? { from: p.from ?? "", date: p.date ?? "", to: p.to ?? [], cc: p.cc ?? [] }
        : {})
    });
  }

  let envelopeCounts: Record<string, number> | undefined;
  if (version === 2) {
    if (referenceIds === undefined) throw new Error("a version 2 probe file needs the version 1 probe ids to pair with");
    assertSameIdOrder(
      probes.map((p) => p.id),
      referenceIds
    );
    envelopeCounts = {
      withFrom: probes.filter((p) => (p.from ?? "").length > 0).length,
      withDate: probes.filter((p) => (p.date ?? "").length > 0).length,
      withTo: probes.filter((p) => (p.to ?? []).length > 0).length,
      withCc: probes.filter((p) => (p.cc ?? []).length > 0).length
    };
  }

  return {
    probes,
    counts: {
      annotated: input.counts.annotated,
      joined: input.counts.joined,
      missingFromDump: input.counts.missingMessage,
      droppedDisagreement: disagreed,
      droppedNoExpectation: none,
      probes: probes.length
    },
    labels,
    ...(envelopeCounts ? { envelopeCounts } : {})
  };
}
