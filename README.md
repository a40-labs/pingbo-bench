# pingbo-bench

The benchmark behind the A40 Labs article [How Pingbo Decides What Matters](https://pingbo.ai/blog/measuring-which-emails-need-you). It
asks one question of an email: does it need a reply from you? 32 models answer it
for 508 annotated work emails from the Enron corpus, at four steps from a bare
prompt to the pipeline Pingbo ships. Every number the article states is in `claims/`, with the
code that recomputes it.

This is release **v1**, a frozen export. The benchmark is developed elsewhere; this
repository changes only by a new release.

## Headline results

Two-way accuracy on the 508 emails. Answering "no reply needed" to every email
scores 64.8%: that is the floor.

| Step | What runs | Median accuracy | Models above the floor | Against the model's own Step 0 |
| --- | --- | ---: | ---: | --- |
| 0 | The bare question, one prompt | 77.0% | 29 | |
| 1 | Pingbo's first pipeline | 65.0% | 17 | 28 worse |
| 2 | An obligation must quote the message | 81.3% | 24 | 23 at least as good |
| 3 | The ask must be the sender's own words (shipped) | 82.5% | 27 | 25 better, 7 worse |

The best model at Step 3, `gpt-5.5`, scores 85.0%. At the setting Pingbo ships
with, it catches 150 of the 179 emails that owe a reply
(84% recall) at 62% precision. Those are
two different readings: 85.0% is the accuracy of the reply verdict, while the list
Pingbo ships also carries the emails that ask you to act, which the labels have no way to mark.
[CLAIMS.md](CLAIMS.md) lists every number; [METHODS.md](METHODS.md) says how each was measured.

## Layout

```
claims/       claims.json (every number in the article) and verify.ts, which recomputes them
data/         labels.csv (labels only, no email text) and build/, which rebuilds the emails
harness/      step0/ (runnable with your key), scoring/, figures/
results/v1/   per-model, per-email results for each step, adjudication, reply behaviour, chart data
vendor/       benchmark modules the scripts import, copied with only import paths changed
METHODS.md    how it was measured, and its limits
CLAIMS.md     the claims as a table
```

## Quick start

Node 22 or later.

**1. Verify the article's numbers.** No download and no key. Every results file is checked against
`data/labels.csv` and the manifest first — row order, ids, labels, the pins each header carries,
correctness recomputed from the answers, and each metrics block's total, correct and accuracy — and
one problem fails the run before a single claim is read.

```sh
npm ci
npm run verify                      # exits non-zero if any reproducible claim fails
npm run verify -- --id step3.best   # one claim, or a prefix such as figure2
```

Claims that need the email text or the annotation file are reported as skipped until step 2.

**2. Rebuild the email set.** Downloads the Sappelli et al. annotation file (370 KB) and the
Enron MySQL dump (178 MB) from their original hosts and checks both by sha256. Then it rebuilds
the 508 emails and the 100 adjudication sheets and
checks those too. Output goes to `data/build/out/`, which git ignores.

```sh
npm run build:data
npm run verify                      # now runs every reproducible claim
```

**3. Run Step 0 on your own model.** Any OpenAI-compatible chat-completions endpoint. Needs step 2.
The key is read from the environment variable you name, never from a file.

```sh
export OPENAI_API_KEY=...
npm run step0 -- --model gpt-5.5 --endpoint https://api.openai.com/v1 \
  --auth-env OPENAI_API_KEY --out runs/step0/gpt-5.5.json
```

It prints four-way and two-way accuracy and writes a file shaped like
`results/v1/step0/<model>.json`. Each published header records the decode settings that
model ran with; pass them with `--body-overrides` to match.

## What is not included

| Not here | Why | Instead |
| --- | --- | --- |
| Email text, headers and addresses; the annotation file; the adjudication sheets | Third-party data, not ours to redistribute | `data/build` fetches the sources and rebuilds them, checked by sha256 |
| Prompts and code for Steps 1 to 3 | Pingbo product code | Per-email outputs, pinned commits and prompt digests ([METHODS.md](METHODS.md#the-four-steps)) |
| What a model said in its own words | Asked the bare question, a model often answers in prose and quotes the email back | The label parsed from its answer, and why the call stopped |

## How to cite

Cite the article and this repository ([CITATION.cff](CITATION.cff)). The labels come from:

> Sappelli, M., Pasi, G., Verberne, S., de Boer, M., & Kraaij, W. (2016). Assessing e-mail intent
> and tasks in e-mail messages. *Information Sciences*. ScienceDirect PII S0020025516301438.
> Data: <http://cs.ru.nl/~msappelli/data/>

## Licence

- Code: [Apache License 2.0](LICENSE).
- Data derived by A40 Labs (`data/labels.csv`, `results/`, `claims/claims.json`): [CC BY 4.0](LICENSE-DATA.md).
- Third-party sources are referenced, not relicensed. The annotations and the Enron corpus keep their own terms.
