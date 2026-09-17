# Data licence

A40 Labs' derived data is licensed under
[Creative Commons Attribution 4.0 International (CC BY 4.0)](https://creativecommons.org/licenses/by/4.0/legalcode).
Credit "A40 Labs, pingbo-bench" and link to this repository.

## What it covers

- `data/labels.csv`: the two-way label derived from the annotators' agreed four-way label.
- `results/`: per-email results, metrics and headers for every step; the adjudication key, verdicts
  and score; the per-email reply-behaviour rows and scorer outputs; the chart data.
- `claims/claims.json`: the article's numbers and how each is recomputed.

## What it does not cover

- **Third-party sources.** The Sappelli et al. (2016) annotation file and the Enron corpus are
  referenced, not redistributed or relicensed. They keep their own terms. `data/build` downloads
  them from their original locations, and what it builds stays on your machine.
- **Model output.** Step 0's raw answers were written by the models named in
  `results/*/manifest.json`. Their use is also subject to those providers' terms.

The code is licensed separately, under the [Apache License 2.0](LICENSE).
