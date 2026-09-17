/**
 * Render the blind adjudication sheets (`SHEETS.md`) from the rebuilt probes and the sealed key
 * in `results/<version>/adjudication/key.json`. The key fixes which 100 emails were judged and in
 * what order, so no random draw is repeated here; the output is byte-identical to the sheets the
 * judge read, which `build.ts` checks against their sha256.
 */

export interface SheetKey {
  seed: number;
  top_models: string[];
  source: string;
  sheets: Record<string, { id: string; group: "agree" | "disagree"; gold: string; models: string }>;
}

export interface SheetProbe {
  id: string;
  subject?: string;
  body: string;
  from?: string;
  to?: string[];
  cc?: string[];
  date?: string;
}

/** Python's str.isspace() set, which the original generator's strip() used. */
const PY_SPACE = /[\t\n\x0b\x0c\r\x1c-\x1f \x85\xa0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]/u;

export function pyStrip(text: string): string {
  const chars = Array.from(text);
  let start = 0;
  let end = chars.length;
  while (start < end && PY_SPACE.test(chars[start] as string)) start += 1;
  while (end > start && PY_SPACE.test(chars[end - 1] as string)) end -= 1;
  return chars.slice(start, end).join("");
}

/** The four label definitions the judge applied: the Step 0 instruction up to its decision rule. */
export function labelDefinitions(instruction: string): string {
  const cut = instruction.indexOf("Decision rule:");
  if (cut < 0) throw new Error("the Step 0 instruction has no decision rule to cut at");
  return pyStrip(instruction.slice(0, cut));
}

export function renderSheets(key: SheetKey, probes: readonly SheetProbe[], definitions: string): string {
  const byId = new Map(probes.map((p) => [p.id, p] as const));
  const sheets = Object.entries(key.sheets);
  const disagree = sheets.filter(([, s]) => s.group === "disagree").length;
  const md: string[] = [
    "# Sappelli response-expectation — blind adjudication sheets\n",
    `Source probes: \`${key.source}\` · sheets: ${sheets.length} (${disagree} + ${sheets.length - disagree} controls) · seed ${key.seed} · key sealed in \`KEY.sealed.json\` — do not open before all verdicts are recorded in \`verdicts.json\`.\n`,
    'Record ONE label per sheet in `verdicts.json` as `{"S001": "immediate reply", ...}`. Labels: `immediate reply` · `postponed reply` · `accountable non-answer` · `ignore`. Apply the definitions below exactly as the models were given them (rev-2 instruction, verbatim):\n',
    "```\n" + pyStrip(definitions) + "\n```\n",
    "---\n"
  ];
  for (const [sid, sheet] of sheets) {
    const p = byId.get(sheet.id);
    if (!p) throw new Error(`sheet ${sid}: ${sheet.id} is not in the probes`);
    md.push(`## ${sid}\n`);
    for (const [value, label] of [
      [p.from, "From"],
      [p.to, "To"],
      [p.cc, "Cc"],
      [p.date, "Date"]
    ] as const) {
      const text = Array.isArray(value) ? value.join(", ") : value;
      if (text) md.push(`${label}: ${text}  `);
    }
    md.push(`Subject: ${pyStrip(p.subject ?? "") || "(no subject)"}\n`);
    const body = Array.from(pyStrip(p.body.replace(/\r/g, "")) || "(empty body)");
    md.push("```\n" + body.slice(0, 4000).join("") + (body.length > 4000 ? "\n… [truncated]" : "") + "\n```\n");
    md.push("Verdict: ____\n\n---\n");
  }
  return md.join("\n");
}
