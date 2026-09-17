# results

Each release has its own directory. Every per-model file is `{ header, metrics, verdicts }`, and
`verdicts[i]` is the email at `position` i of `data/labels.csv`.

| Path | Contents |
| --- | --- |
| `manifest.json` | Models, steps, prompt digests, judge versions, corpus hashes, seed. |
| `step0/<model>.json` | The bare question: the label parsed from the model's answer per email, and why the call stopped. The model's own words are not published — asked this question a model often answers in prose and quotes the email, and the email text is not ours to redistribute. |
| `step0-subject-body/<model>.json` | The same prompt on subject and body only, used by the appendix's four-way reading and the adjudication. |
| `step1/`, `step2/`, `step3/` `<model>.json` | Pipeline outputs per email: `answer` (`needs you` / `waiting`), `home` (`matter`, `reading`, `screened`), `judgment` (`compose` = To Respond, `external` = To Act, `waiting`, `done`, `quiet`), `whoseMove` (`user` / `counterparty`), `senderRelation` (`colleague` / `external` / `self`), `retries`, and an error code when the run failed for that email. No model text: every value is one of a fixed set. |
| `adjudication/` | The sealed key (sheet → email id, group, label, the eight models' answer), the judge's verdicts, and the score. |
| `reply-behaviour/rows.json` | Per email: whether a recipient replied within 30 days, how fast, and whether that recipient's mailbox is observable. Counts and latencies only. |
| `reply-behaviour/scorer/<step>.<rule>.json` | The reply-behaviour scorer's output, for both Step 0 runs under both observability rules (`strict`, `loose`). |
| `figures/` | The data Figures 2 and 3 were drawn from, as published. `harness/figures` rebuilds every value exactly; only the order differs, since the published files list models alphabetically and the rebuild lists them in manifest order. |

Header fields: `model` (as named in the article), `step`, `pipelineVersion`, `corpusSha256` (the
probe file `data/build` rebuilds, so the emails a row was answered on can be checked),
`promptSha256` (Step 0: sha256 of `harness/step0/prompt.rev2.txt`; Steps 1–3: the first 16 hex
digits of the prompt's sha256), `sortingPromptSha256`, `judgeVersion`, `seed`, `sample`,
`probes`, `probesVersion`, `construct`, `promptRev` (Step 0), `decode`, `generatedAt`, `run`. `seed` is this benchmark's analysis seed, used by the bootstrap and
the sampling; no seed is sent to a provider. `decode` is what that run used: 23 of the 32 headers
delete `temperature` and `top_p`, so those runs took their provider's default.

A pipeline row makes two model calls, named here by what they do rather than by what this
benchmark calls them internally. The **verdict** call reads the message; the **sorting** call
decides where the thread belongs. So `promptSha256` and `sortingPromptSha256` are their prompt
digests, `decode.maxTokens` carries `verdict` and `sorting`, `retries` carries `verdictJson`,
`sortingJson` and `sortingCorrection`, and an `error.code` is `verdict_…`, `sorting_…`, or
`abandoned_after_retries` when the row was given up on after its retries. `error.refusal` repeats a
provider's own refusal code (`context_length_exceeded`, `content_filter`, `unsupported_language`)
when there was one, and `metrics.refusals` counts them.
