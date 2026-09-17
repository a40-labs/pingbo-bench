/**
 * The two email files this repository rebuilds, composed over the rows `selectProbes` keeps.
 *
 * `probes.json` carries subject and body; `probes.v2.json` adds the sender, date, TO and CC the
 * annotators had in view. Both are written with `JSON.stringify(file, null, 1)`, and their sha256
 * is what `data/build/sources.json` pins and every result header records as `corpusSha256` — so a
 * rebuilt file either is the set the models answered, byte for byte, or the build stops.
 */

import type { ProbeSelection, SappelliProbe, Version } from "../../vendor/sappelli_probes.js";

export interface ProbeFile {
  header: Record<string, unknown>;
  probes: SappelliProbe[];
}

export interface ProbeFileBuild {
  file: ProbeFile;
  /** The file exactly as written; its sha256 is the corpus hash. */
  bytes: string;
}

/** The header of a rebuilt probe file. */
export function probeHeader(selection: ProbeSelection, version: Version): Record<string, unknown> {
  return {
    corpus: "Sappelli et al. (2016), Information Sciences — annotated Enron email joined to the Enron MySQL dump",
    construct: "response-expectation",
    goldPolicy: "both annotators agree; a disputed label is not ground truth",
    counts: selection.counts,
    labels: selection.labels,
    ...(version === 2
      ? {
          probesVersion: 2,
          probeFields: "id, subject, body, gold, from, date, to[], cc[] — the envelope the annotators saw",
          ...(selection.envelopeCounts ? { envelopeCounts: selection.envelopeCounts } : {})
        }
      : {})
  };
}

/** Compose one probe file and the bytes it is written as. */
export function probeFile(selection: ProbeSelection, version: Version): ProbeFileBuild {
  const file: ProbeFile = { header: probeHeader(selection, version), probes: selection.probes };
  return { file, bytes: JSON.stringify(file, null, 1) };
}
