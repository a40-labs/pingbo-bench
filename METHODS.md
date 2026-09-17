# Methods

How the numbers in [How Pingbo Decides What Matters](https://pingbo.ai/blog/measuring-which-emails-need-you) were measured, release
**v1**. [CLAIMS.md](CLAIMS.md) lists each number and the command that recomputes it.

## The task

One question per email: does it need a reply from the person who received it?

The annotators labelled each email four ways. Every score here uses the two-way reading.

| Four-way label (annotators) | Two-way label | A pipeline answer that counts as right |
| --- | --- | --- |
| immediate reply | needs a reply | `needs you` |
| postponed reply | needs a reply | `needs you` |
| accountable non-answer | no reply | `waiting` |
| ignore | no reply | `waiting` |

An answer that is none of these words is wrong on either side. That is the only failure policy
here: at every step, an answer the scorer cannot read as one of the labels is wrong, and a row
whose run failed is wrong too. Nothing is credited to a non-answer.

## The data

- **Labels.** Sappelli et al. (2016) had two annotators label Enron emails for the sender's
  response expectation. 1,145 emails were annotated. The benchmark keeps the
  508 on which both gave the same four-way label
  (44% of the annotated set).
- **Text.** Each email is joined by message id to the Enron MySQL dump
  (`enron-mysqldump_v5.sql.gz`). `data/build` does this join; the text is never stored here.
- **Label counts.** 112 immediate reply, 67
  postponed reply, 285 accountable non-answer, 44
  ignore. So 179 need a reply and 329 do not.
- **Duplicates.** Seven message ids repeat in the agreed set: six appear three times and one
  twice, so 508 rows carry 495 distinct ids. Every file pairs rows by `position` (0 to 507), never
  by id — an id-keyed join drops 13 rows without saying so.
- **Two renderings.** `probes.v2.json` carries sender, recipients, cc and date as the annotators
  saw them (Bcc is dropped); Steps 0 to 3 and the adjudication sheets use it. `probes.json` has
  subject and body only; the appendix's four-way reading, which chose the adjudicated emails,
  used it.

## The four steps

Every step ran all 32 models over the same 508 emails.

| Step | What it measures |
| --- | --- |
| 0 | The model alone: the bare question, one system prompt (`harness/step0/prompt.rev2.txt`), decoding as each result header records it, answer must be exactly one label. |
| 1 | Pingbo's first pipeline: the model fills a structured form (whose move it is, then one of To Respond, To Act, Waiting, Done). |
| 2 | Step 1, plus: a claim that you owe a reply must quote the words that ask for it, and code checks the quote is in the email. |
| 3 | Step 2, plus: the quote must come from the sender's own words in this message, not from quoted earlier mail. This is what Pingbo ships. |

Pinned instruments. For Steps 1 to 3, Prompt is the prompt that reads the message and Sorting
prompt decides where a thread belongs. Digests are the first 16 hex digits of the prompt's sha256;
Step 0's full sha256 is in its result headers. Judge is the version of the product's judgment that
the run recorded.

| Step | Version | Prompt | Sorting prompt | Judge |
| --- | --- | --- | --- | ---: |
| 0 | `rev2-ctx` | `3335d03b0824407e` (`prompt.rev2.txt`) | none | none |
| 1 | `rev1` | `ea8ee98c90954233` | `2a60d3979ef0f6ae` | 15 |
| 2 | `rev3` | `38a611cd47bee678` | `002c99bd251c70c9` | 17 |
| 3 | `rev5` | `e0eb3c28b50cf84e` | `002c99bd251c70c9` | 18 |

**Why Steps 1 to 3 are outputs only.** Their prompts and code are Pingbo's product and are not
published. Each result header records the prompt digests and the judge version, which pin what ran
without publishing it, and anyone can score and compare the per-email outputs here. The outputs carry the form's fields (`home`, `judgment`, `whoseMove`,
`senderRelation`, `retries`) and an error code where a call failed; no model text.

## Models

| Group | Where it ran | Models |
| --- | --- | --- |
| OpenAI (16) | OpenAI API | `gpt-5.6-luna`, `gpt-5.6-sol`, `gpt-5.6-terra`, `gpt-5.5`, `gpt-5.4`, `gpt-5.4-mini`, `gpt-5.4-nano`, `gpt-5.2`, `gpt-5.1`, `gpt-5`, `gpt-5-mini`, `gpt-5-nano`, `gpt-4.1`, `gpt-4.1-mini`, `gpt-4.1-nano`, `gpt-4o-mini` |
| Anthropic (11) | Anthropic API | `claude-opus-5`, `claude-opus-4-8`, `claude-opus-4-7`, `claude-opus-4-6`, `claude-opus-4-5-20251101`, `claude-fable-5-1`, `claude-fable-5`, `claude-sonnet-5`, `claude-sonnet-4-6`, `claude-sonnet-4-5-20250929`, `claude-haiku-4-5-20251001` |
| Self-hosted (5) | A40 Labs' own machines | `qwen3.6-35b-a3b-mxfp4`, `ornith-1.5-9b-mlx-full`, `ornith-1.5-9b-mlx-6bit`, `gemma-4-E4B-it-qat-4bit`, `apple-fm-on-device` |

Names are the ids the article shows. Hosted models were called through their providers' public
APIs. The self-hosted models ran on A40 Labs' machines; `apple-fm-on-device` is Apple's on-device
foundation model.

**Decoding is not one setting.** Eight models ran at temperature 0 and top_p 1. Twenty-three
headers delete `temperature` and `top_p`, because their providers reject them, so those runs used
the provider's own default; `apple-fm-on-device` records no such body at all. Each result header
carries the settings its own run used, and `harness/step0` takes them back as `--body-overrides`.
A header's `seed` is this benchmark's analysis seed, used for the bootstrap and the sampling; it is
never sent to a provider.

## Metrics and statistics

- **Accuracy**: share of the 508 emails answered right on the two-way question.
- **The floor**: answering "no reply" to everything scores 64.8%. A model "clears the
  floor" when it gets more emails right than that.
- **Recall** (catch rate): of the 179 emails that need a reply, the share shown
  in Needs you. **Precision**: of what Needs you shows, the share that needed a reply.
- **Needs you settings** (Table 1, Figure 3): `cards` is To Respond only; `ships` adds To Act, the
  shipped setting; `both` also adds every email the same model's Step 0 answer says needs a reply.
- **Medians** are over the 32 models. "Against its own Step 0" compares each
  model's correct count at a step with its Step 0 count.
- **Paired comparisons** of two runs on the same emails use the exact two-sided McNemar test over
  discordant emails and a 95% percentile bootstrap of the per-email difference (10,000 resamples,
  seed 1610).

## Reply behaviour

A check of the two-way labels against what recipients did.

- A **reply** is a later message *sent by* one of the original's TO or CC recipients, within
  30 days, whose subject normalises equal to the original's (repeated
  `re:`/`fw:`/`fwd:` stripped) or that reproduces the original's first 64 alphanumeric characters
  inside a quoted block. This dump carries no `In-Reply-To`/`References` chain, and the test does
  not read the candidate message's own recipients, so it cannot establish that the message went
  back to the sender: a forward by a recipient, or another message by a recipient under the same
  subject, counts too. Of the 115 matches, 43 carry quote support and 72 match on subject alone. It
  is a heuristic, and every number below is only as good as it is.
- The archive holds about 150 mailboxes, so a missing reply is evidence only where it could have
  been seen. **Roster**: at least one recipient is on the dump's own `employeelist`
  (209 emails). **Loose**: at least one recipient is on that roster or sends any
  message anywhere in the dump (491 emails). A third rule, **strict**, adds to
  the roster set every email where a reply was seen (257 in all); it conditions
  the set on the outcome being measured, which is why the roster rule is reported first.
- The score is the reply rate for emails labelled as needing a reply minus the rate for the rest,
  with a 95% percentile bootstrap interval (10,000 resamples, seed 1610). It is computed for the
  dataset's labels and for the majority answer of the eight models used in the adjudication. With
  the dataset's labels it is 26.9 points
  (12.3 to 42.1) on the roster set,
  33.6 (21.0 to 45.6) on the strict set,
  and 14.3 (6.2 to
  22.4) on the loose set.
- Per-email rows (counts, latencies, buckets; no addresses or text) are in
  `results/v1/reply-behaviour/`.

## Blind re-judging

- **Selection.** The eight models whose subject-and-body Step 0 answers matched the four-way labels
  best. 57 emails where all eight gave the same answer and it
  contradicted the label; 43 controls where the models agreed with
  the label.
- **Blind protocol.** The 100 sheets were put in a seeded random order
  and numbered. Each shows the email (sender, recipients, date, subject, body) under the four label
  definitions from the Step 0 prompt, and no answer from anyone. The key mapping sheets to emails,
  groups and answers was sealed and its sha256 recorded before any verdict; it was opened only
  after all verdicts were in.
- **Judge.** `claude-fable-5-1`, one of the 32 models, in one session. No
  transcript of the session was kept; the verdicts, key and score are in
  `results/v1/adjudication/`.
- **What the controls can show, and what they cannot.** On all
  43 controls the models and the label agree, so siding with the
  models and siding with the label are the same answer there. They show the judge read the sheets
  rather than answering at random. They **cannot** detect a judge that simply prefers a model's
  answer to a person's, which is the bias that matters here. Read this section as a model-assisted
  review of disputed labels, not as proof that the labels are wrong.
- **What the judge was shown.** A sheet cuts the email body at 4,000 characters. Six of the
  100 are cut, all of them disputed, and two of those six are among the
  5 where the judge sided with the label.
- **Result.** On the contested emails the judge sided with the models
  45 times, with the label 5, and with
  neither 7. It agreed with the label on all
  43 controls. A two-sided binomial test on the
  50 decided sheets gives p = 4.2e-9.

## Limitations

- **Label noise.** The annotators agreed on the four-way label 44%
  of the time and on the two-way question 70%. The judge disagreed
  with 24 of the 100 two-way labels it re-read. A few
  emails appear more than once in the graded set, so those 24 emails cover
  26 of the 508 rows scored here,
  5.1% of them. That is a count of what was found in doubt, not an error rate:
  the 100 were chosen for disagreement, the judge is another model, and
  the remaining 395 emails were never read again. Nothing here says how many
  labels are wrong, in either direction. No score near the top should be read as exact.
- **The re-judging says who disagreed, not who was right.** The re-read emails are the sharpest
  disagreements in the set, not a sample of it, and the judge is a model of the same kind as the
  ones whose answers it was weighing. It records that a third reader sided with the models on most
  contested emails. It does not establish that those labels are wrong, that the models are right,
  or how often either holds away from the contested set.
- **Runs are not repeatable.** Models are not deterministic, even with decoding pinned as far as
  each provider allows, and 23 of the 32 ran at their provider's own default. Measured during
  development on identical inputs: two pipeline runs of `claude-sonnet-5` differed on 34 of 508
  answers (6.7%), two of `qwen3.6-35b-a3b-mxfp4` on 14 (2.8%). Those repeats are not published
  results. Every result here is a single run.
- **Not reproducible from stored data.** "A fifth of the quotes came from beneath the separator"
  (Step 3) rests on replies that were not stored. "Compared on the same emails, the larger gap
  holds up only when all 491 are counted" (appendix) has no stored paired test. Both are listed in
  CLAIMS.md with their reasons.
- **Reply behaviour is a heuristic, and one of its rules reads the outcome.** The matcher cannot
  show a message went back to the sender, and 72 of its 115 matches rest on a subject alone. The
  strict observability set adds 257 − 209 = 48 emails that
  qualify only because a reply was seen; on the roster set alone the separation is
  26.9 points rather than 33.6.
- **One run each, on the set the pipeline was developed against.** Every step was re-run over the
  same 508 emails, so a movement is not a different corpus — but each step is a single run of a
  non-deterministic model, and the steps were designed while reading these same emails. There is no
  held-out set here, and the leaders sit within a few emails of each other: the best Step 3 model
  and the runner-up differ by 2 of 508, a paired test on them gives p = 0.85. "Highest score
  measured" is what the table says; "better model" is not.
- **Three different things, and only two of them are yours to check.** The scores here are
  recomputable from the stored results (`npm run verify`), and the email set is reconstructible from
  its public sources (`npm run build:data`). The experiments are only partly rerunnable: Step 0 runs
  against any compatible endpoint with your own key, and Steps 1 to 3 cannot be rerun here.
- **Steps 1 to 3 cannot be rerun here.** Their product code is not published. The digests in each
  header pin what ran; they are not an instrument you can run.
- **One dataset.** Every email comes from one company, two decades ago. Threads today are longer,
  have more people on them, and bury asks in forwards.
