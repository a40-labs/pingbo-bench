# data

`labels.csv` has one row per email, in the order every results file uses:

| Column | Meaning |
| --- | --- |
| `position` | 0 to 507; results pair on this. |
| `id` | `sappelli:<mid>`, the message id in the Enron MySQL dump. Seven ids repeat — six appear three times, one twice — so 508 rows carry 495 distinct ids. Pair rows by `position`, never by id. |
| `label_4way` | The label both annotators gave: `immediate reply`, `postponed reply`, `accountable non-answer` or `ignore`. |
| `label_2way` | `needs_reply` (immediate or postponed reply) or `no_reply`. |

`build/` rebuilds the email text locally:

```sh
npx tsx data/build/build.ts          # writes data/build/out/, caches downloads in data/build/cache/
```

| Output | sha256 |
| --- | --- |
| `probes.v2.json`: the 508 emails with sender, recipients and date (Steps 0–3) | `d8e205c5a66a60d8cbe0126d79b0a2b0712cc149bf1edbc3c00feeaad4346a53` |
| `probes.json`: subject and body only (the appendix's four-way reading) | `ef51dae101dcd3e8bbd500b2e2d3d69644bfd9b22832f88d5c4b4e736a69b3aa` |
| `adjudication/SHEETS.md`: the 100 blind sheets | `8dcee2a474383e2e0b03a06a6d66decd3f386438123c09aea78f8d38edba0dba` |

The inputs and their hashes are in `build/sources.json`. A source that has changed stops the build.

The sheets name the sealed key as `KEY.sealed.json`, the name it had when it was sealed and hashed
before any verdict was recorded; it is published here as `results/v1/adjudication/key.json`. The
sheets are rendered byte for byte as the judge read them, so that name is not rewritten.
