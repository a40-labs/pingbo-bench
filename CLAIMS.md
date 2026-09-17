# Claims

Every number in [How Pingbo Decides What Matters](https://pingbo.ai/blog/measuring-which-emails-need-you), release v1: 579 claims, 571 reproducible, 2 not reproducible, 6 context.
Generated from `claims/claims.json`; `npm run verify` checks them all.

| Status | Meaning |
| --- | --- |
| reproducible | Recomputed from `results/` and compared. A mismatch fails `verify`. |
| reproducible, needs `build:data` | Same, once `npm run build:data` has rebuilt the emails or downloaded the annotation file. |
| not-reproducible | No stored data recomputes it. The reason is given. |
| context | A number the article uses that this benchmark does not measure. |

| Claim | Article says | Value | Section | Status | Recompute |
| --- | --- | ---: | --- | --- | --- |
| `corpus.emails` | 508 real work emails | 508 | The bar we hold it to | reproducible | `npm run verify -- --id corpus.emails` |
| `corpus.annotated` | Two annotators had read 1,145 of them | 1,145 | The bar we hold it to | reproducible, needs `build:data` | `npm run verify -- --id corpus.annotated` |
| `labels.immediate` | 112 needed an immediate reply | 112 | The bar we hold it to | reproducible | `npm run verify -- --id labels.immediate` |
| `labels.postponed` | 67 needed a postponed reply | 67 | The bar we hold it to | reproducible | `npm run verify -- --id labels.postponed` |
| `labels.accountable` | 285 were something you are accountable for | 285 | The bar we hold it to | reproducible | `npm run verify -- --id labels.accountable` |
| `labels.ignore` | 44 you could ignore | 44 | The bar we hold it to | reproducible | `npm run verify -- --id labels.ignore` |
| `labels.owe` | 112 + 67 = 179 that owe a reply | 179 | The bar we hold it to | reproducible | `npm run verify -- --id labels.owe` |
| `labels.notOwe` | 285 + 44 = 329 that do not | 329 | The bar we hold it to | reproducible | `npm run verify -- --id labels.notOwe` |
| `floor` | 329 ÷ 508 = 64.8% | 64.8 | The bar we hold it to; Figures 2 and 3 | reproducible | `npm run verify -- --id floor` |
| `example.accuracy` | 80%, which is 406 of 508 | 406 | The bar we hold it to | reproducible | `npm run verify -- --id example.accuracy` |
| `example.firstCaught` | One catches 77 of the 179 and flags nothing extra | 77 | The bar we hold it to | reproducible | `npm run verify -- --id example.firstCaught` |
| `example.secondCaught` | The other catches 160 | 160 | The bar we hold it to | context | A chosen input to the worked example; 83 and 19 follow from it. |
| `example.secondFlagged` | and flags 83 you did not need | 83 | The bar we hold it to | reproducible | `npm run verify -- --id example.secondFlagged` |
| `example.firstMissed` | The first leaves 102 emails you owed unread | 102 | The bar we hold it to | reproducible | `npm run verify -- --id example.firstMissed` |
| `example.secondMissed` | The second leaves 19 | 19 | The bar we hold it to | reproducible | `npm run verify -- --id example.secondMissed` |
| `models.total` | We hold 32 models to that bar | 32 | The bar we hold it to | reproducible | `npm run verify -- --id models.total` |
| `models.openai` | 16 from OpenAI | 16 | The bar we hold it to | reproducible | `npm run verify -- --id models.openai` |
| `models.anthropic` | 11 from Anthropic | 11 | The bar we hold it to | reproducible | `npm run verify -- --id models.anthropic` |
| `models.small` | four small models | 4 | The bar we hold it to | reproducible | `npm run verify -- --id models.small` |
| `models.selfHosted` | We ran all five of those on our own machines | 5 | The bar we hold it to | reproducible | `npm run verify -- --id models.selfHosted` |
| `models.everyStep` | every one of the 32 ran over the same 508 emails | 32 | The bar we hold it to; Figure 2 | reproducible | `npm run verify -- --id models.everyStep` |
| `doubt.intro` | about 24 of the 508 emails are in doubt | 24 | The bar we hold it to | reproducible | `npm run verify -- --id doubt.intro` |
| `step0.median` | half of the 32 models score above 77.0% | 77.0 | TL;DR; From a simple prompt… (Step 0) | reproducible | `npm run verify -- --id step0.median` |
| `step0.beatFloor` | 29 of them clear the floor | 29 | Step 0 | reproducible | `npm run verify -- --id step0.beatFloor` |
| `step1.median` | The median drops to 65.0% | 65.0 | Step 1 | reproducible | `npm run verify -- --id step1.median` |
| `step1.beatFloor` | Only 17 models still clear it | 17 | Step 1 | reproducible | `npm run verify -- --id step1.beatFloor` |
| `step1.worse` | our harness made 28 of the 32 worse | 28 | Step 1 | reproducible | `npm run verify -- --id step1.worse` |
| `step2.median` | The median rose to 81.3% | 81.3 | Step 2 | reproducible | `npm run verify -- --id step2.median` |
| `step2.beatFloor` | 24 models cleared the floor | 24 | Step 2 | reproducible | `npm run verify -- --id step2.beatFloor` |
| `step2.better` | more of them did at least as well inside the harness as outside it, 23 of the 32 | 23 | Step 2 | reproducible | `npm run verify -- --id step2.better` |
| `step3.quotesBeneathSeparator` | A fifth of them were not from the email at all |  | Step 3 | not-reproducible | Read from the quotes Step 2 accepted during development; those replies were not stored, and no result file holds them. |
| `step3.median` | The median moved to 82.5% | 82.5 | Step 3 | reproducible | `npm run verify -- --id step3.median` |
| `step3.beatFloor` | 27 models clear the floor | 27 | Step 3 | reproducible | `npm run verify -- --id step3.beatFloor` |
| `step3.best` | the best of them scores 85.0% | 85.0 | TL;DR; Step 3 | reproducible | `npm run verify -- --id step3.best` |
| `step3.bestModel` | gpt-5.5 at 85.0% | 85.0 | Table 1 caption; Figure 2 | reproducible | `npm run verify -- --id step3.bestModel` |
| `step3.better` | 25 of the 32 now do better inside the harness than outside it | 25 | Step 3 | reproducible | `npm run verify -- --id step3.better` |
| `step3.bareBetter` | Seven of the 32 still do better with the bare question | 7 | Step 3 | reproducible | `npm run verify -- --id step3.bareBetter` |
| `figure.struckThrough` | The five struck through cannot beat the 64.8% | 5 | Figures 2 and 3 captions | reproducible | `npm run verify -- --id figure.struckThrough` |
| `qwen.step1` | accuracy goes from 65.0 | 65.0 | Figure 2 | reproducible | `npm run verify -- --id qwen.step1` |
| `qwen.step2` | to 73.4 percent | 73.4 | Figure 2 | reproducible | `npm run verify -- --id qwen.step2` |
| `qwen.step3` | and to 79.7 | 79.7 | Figure 2 | reproducible | `npm run verify -- --id qwen.step3` |
| `qwen.step2Gain` | was worth 8.5 points | 8.5 | Figure 2 caption | reproducible | `npm run verify -- --id qwen.step2Gain` |
| `qwen.step3Gain` | it was worth 6.3 points | 6.3 | Step 3; Figure 2 caption | reproducible | `npm run verify -- --id qwen.step3Gain` |
| `qwen.gapBefore` | closing the gap to the rest of the field from 7.9 points | 7.9 | Step 3 | reproducible | `npm run verify -- --id qwen.gapBefore` |
| `qwen.gapAfter` | to 2.8 | 2.8 | Step 3 | reproducible | `npm run verify -- --id qwen.gapAfter` |
| `qwen.recallBefore` | dropped the catch rate from 68.2% | 68.2 | Step 3 | reproducible | `npm run verify -- --id qwen.recallBefore` |
| `qwen.recallAfter` | to 62.0% | 62.0 | Step 3 | reproducible | `npm run verify -- --id qwen.recallAfter` |
| `apple.step0` | Asked the bare question it scores 70.1% | 70.1 | Step 3 | reproducible | `npm run verify -- --id apple.step0` |
| `apple.step1.belowFloor` | inside the harness it falls below the floor at every step | 0 | Step 3 | reproducible | `npm run verify -- --id apple.step1.belowFloor` |
| `apple.step2.belowFloor` | inside the harness it falls below the floor at every step | 0 | Step 3 | reproducible | `npm run verify -- --id apple.step2.belowFloor` |
| `apple.step3.belowFloor` | inside the harness it falls below the floor at every step | 0 | Step 3 | reproducible | `npm run verify -- --id apple.step3.belowFloor` |
| `apple.tooLong` | 153 of the 508 emails do not fit in the 4,096 tokens | 153 | Step 3 | reproducible | `npm run verify -- --id apple.tooLong` |
| `apple.fit` | the other 355 | 355 | Step 3 | reproducible | `npm run verify -- --id apple.fit` |
| `apple.rejected` | for 306 of the other 355 its first decision … is one the rules reject | 306 | Step 3 | reproducible | `npm run verify -- --id apple.rejected` |
| `apple.matters` | Not one email becomes a Matter | 0 | Step 3 | reproducible | `npm run verify -- --id apple.matters` |
| `apple.drafts` | so it drafts no reply at all | 0 | Step 3 | reproducible | `npm run verify -- --id apple.drafts` |
| `apple.contextWindow` | the 4,096 tokens, about 3,000 words, it can read at once | 4,096 | Step 3 | context | The on-device model's documented context window, not a measurement of this benchmark. |
| `table1.cards.caught` | To Respond cards only: caught 119 | 119 | Table 1 | reproducible | `npm run verify -- --id table1.cards.caught` |
| `table1.cards.recall` | To Respond cards only: recall 66% | 66 | Table 1 | reproducible | `npm run verify -- --id table1.cards.recall` |
| `table1.cards.precision` | To Respond cards only: precision 89% | 89 | Table 1 | reproducible | `npm run verify -- --id table1.cards.precision` |
| `table1.cards.shown` | To Respond cards only: shown 133 | 133 | Table 1 | reproducible | `npm run verify -- --id table1.cards.shown` |
| `table1.ships.caught` | Plus To Act cards (the shipped setting): caught 150 | 150 | Table 1 | reproducible | `npm run verify -- --id table1.ships.caught` |
| `table1.ships.recall` | Plus To Act cards (the shipped setting): recall 84% | 84 | Table 1; TL;DR (84%) | reproducible | `npm run verify -- --id table1.ships.recall` |
| `table1.ships.precision` | Plus To Act cards (the shipped setting): precision 62% | 62 | Table 1 | reproducible | `npm run verify -- --id table1.ships.precision` |
| `table1.ships.shown` | Plus To Act cards (the shipped setting): shown 241 | 241 | Table 1 | reproducible | `npm run verify -- --id table1.ships.shown` |
| `table1.both.caught` | Plus a second, independent read: caught 159 | 159 | Table 1 | reproducible | `npm run verify -- --id table1.both.caught` |
| `table1.both.recall` | Plus a second, independent read: recall 89% | 89 | Table 1 | reproducible | `npm run verify -- --id table1.both.recall` |
| `table1.both.precision` | Plus a second, independent read: precision 60% | 60 | Table 1 | reproducible | `npm run verify -- --id table1.both.precision` |
| `table1.both.shown` | Plus a second, independent read: shown 265 | 265 | Table 1 | reproducible | `npm run verify -- --id table1.both.shown` |
| `table1.addedShown` | The second row shows 241 emails where the first shows 133, so 108 more | 108 | Missing emails, or fewer interruptions | reproducible | `npm run verify -- --id table1.addedShown` |
| `table1.addedOwed` | The annotators agree that 31 of them owed a reply | 31 | Missing emails, or fewer interruptions | reproducible | `npm run verify -- --id table1.addedOwed` |
| `table1.addedNotOwed` | The remaining 77 count as wrong | 77 | Missing emails, or fewer interruptions | reproducible | `npm run verify -- --id table1.addedNotOwed` |
| `waiting.size` | the other 267 stay off the Needs you list | 267 | Missing emails, or fewer interruptions | reproducible | `npm run verify -- --id waiting.size` |
| `waiting.missed` | 29 owed a reply and were left off anyway | 29 | Missing emails, or fewer interruptions | reproducible | `npm run verify -- --id waiting.missed` |
| `waiting.quiet` | the other 238 were labelled as owing no reply | 238 | Missing emails, or fewer interruptions | reproducible | `npm run verify -- --id waiting.quiet` |
| `waiting.lanes` | 46 sit in Waiting, 124 in Done | 46 | Missing emails, or fewer interruptions | reproducible | `npm run verify -- --id waiting.lanes` |
| `waiting.done` | 124 in Done | 124 | Missing emails, or fewer interruptions | reproducible | `npm run verify -- --id waiting.done` |
| `waiting.screened` | 95 never became Matters at all | 95 | Missing emails, or fewer interruptions | reproducible | `npm run verify -- --id waiting.screened` |
| `annotators.fourWayAgreed` | they had agreed on only 508 of the 1,145 | 508 | Appendix | reproducible, needs `build:data` | `npm run verify -- --id annotators.fourWayAgreed` |
| `annotators.fourWayShare` | 44% of the time | 44 | Appendix | reproducible, needs `build:data` | `npm run verify -- --id annotators.fourWayShare` |
| `fourway.pairwise` | any two of the eight … gave the same answer 78% of the time | 78 | Appendix | reproducible | `npm run verify -- --id fourway.pairwise` |
| `fourway.gold` | each of them matched the dataset's answer only 63% of the time | 63 | Appendix | reproducible | `npm run verify -- --id fourway.gold` |
| `adjudication.contested` | the 57 emails where all eight models contradicted the dataset | 57 | Appendix; Figure A1 | reproducible | `npm run verify -- --id adjudication.contested` |
| `adjudication.contestedSheets` | 57 disputed sheets | 57 | Appendix; Figure A1 | reproducible | `npm run verify -- --id adjudication.contestedSheets` |
| `adjudication.controls` | mixed in 43 emails where the models and the dataset already agreed | 43 | Appendix; Figure A1 | reproducible | `npm run verify -- --id adjudication.controls` |
| `adjudication.sheets` | how the 100 came back | 100 | Appendix | reproducible | `npm run verify -- --id adjudication.sheets` |
| `adjudication.models` | the judge sided with the models 45 times | 45 | Appendix; Figure A1 | reproducible | `npm run verify -- --id adjudication.models` |
| `adjudication.gold` | and with the dataset 5 | 5 | Appendix; Figure A1 | reproducible | `npm run verify -- --id adjudication.gold` |
| `adjudication.neither` | with neither 7 | 7 | Figure A1 | reproducible | `npm run verify -- --id adjudication.neither` |
| `adjudication.decided` | the 50 the judge decided | 50 | Figure A1 | reproducible | `npm run verify -- --id adjudication.decided` |
| `adjudication.chance` | would have split about 25 and 25 | 25 | Figure A1 | context | Half of the 50 decided sheets: the expectation under no preference, not a measurement. |
| `adjudication.controlsAgree` | it agreed with the dataset every time (43 out of 43) | 43 | Appendix; Figure A1 | reproducible | `npm run verify -- --id adjudication.controlsAgree` |
| `adjudication.oneIn` | about once in 240 million runs | 240 | Appendix; Figure A1 | reproducible | `npm run verify -- --id adjudication.oneIn` |
| `adjudication.p` | is 0.0000000042 | 4.2e-9 | Appendix | reproducible | `npm run verify -- --id adjudication.p` |
| `adjudication.alpha` | against the usual bar of 0.05 | 0.05 | Appendix | context | A convention, not a measurement. |
| `annotators.bothLabelled` | Both of them labelled 1,115 of the 1,145 emails | 1,115 | Appendix | reproducible, needs `build:data` | `npm run verify -- --id annotators.bothLabelled` |
| `annotators.disagreed` | and they disagreed on 607 | 607 | Appendix | reproducible, needs `build:data` | `npm run verify -- --id annotators.disagreed` |
| `annotators.timingOnly` | In 138 of those, both said a reply was owed | 138 | Appendix | reproducible, needs `build:data` | `npm run verify -- --id annotators.timingOnly` |
| `annotators.kindOnly` | In 134, both said none was owed | 134 | Appendix | reproducible, needs `build:data` | `npm run verify -- --id annotators.kindOnly` |
| `annotators.whichKind` | Those 272 arguments are about which kind | 272 | Appendix | reproducible, needs `build:data` | `npm run verify -- --id annotators.whichKind` |
| `annotators.twoWayAgreed` | the same two people agree on 780 of the 1,115 | 780 | Appendix | reproducible, needs `build:data` | `npm run verify -- --id annotators.twoWayAgreed` |
| `annotators.twoWayShare` | 70% of the time | 70 | Appendix; What Pingbo delivers | reproducible, needs `build:data` | `npm run verify -- --id annotators.twoWayShare` |
| `reply.window` | within 30 days | 30 | Appendix | reproducible | `npm run verify -- --id reply.window` |
| `reply.roster` | the 209 emails with a recipient on the archive's roster | 209 | Appendix | reproducible | `npm run verify -- --id reply.roster` |
| `reply.gold.rosterGap` | a gap of 26.9 points | 26.9 | Appendix | reproducible | `npm run verify -- --id reply.gold.rosterGap` |
| `reply.gold.rosterLo` | here 12.3 | 12.3 | Appendix | reproducible | `npm run verify -- --id reply.gold.rosterLo` |
| `reply.gold.rosterHi` | to 42.1 points | 42.1 | Appendix | reproducible | `npm run verify -- --id reply.gold.rosterHi` |
| `reply.gold.rosterExpects` | got one 51.8% of the time | 51.8 | Appendix | reproducible | `npm run verify -- --id reply.gold.rosterExpects` |
| `reply.gold.rosterNone` | against 24.8% for the rest | 24.8 | Appendix | reproducible | `npm run verify -- --id reply.gold.rosterNone` |
| `reply.strict` | counting the 48 more where a reply was seen, 257 in all | 257 | METHODS (the published strict rule) | reproducible | `npm run verify -- --id reply.strict` |
| `reply.gold.expects` | got one 67.5% of the time | 67.5 | Appendix | reproducible | `npm run verify -- --id reply.gold.expects` |
| `reply.gold.none` | against 33.9% for the rest | 33.9 | Appendix | reproducible | `npm run verify -- --id reply.gold.none` |
| `reply.gold.gap` | a gap of 33.6 points | 33.6 | Appendix | reproducible | `npm run verify -- --id reply.gold.gap` |
| `reply.gold.lo` | here 21.0 | 21.0 | Appendix | reproducible | `npm run verify -- --id reply.gold.lo` |
| `reply.gold.hi` | to 45.6 points | 45.6 | Appendix | reproducible | `npm run verify -- --id reply.gold.hi` |
| `reply.loose` | 491 emails in all | 491 | Appendix | reproducible | `npm run verify -- --id reply.loose` |
| `reply.gold.looseGap` | the gap narrows to 14.3 points | 14.3 | Appendix | reproducible | `npm run verify -- --id reply.gold.looseGap` |
| `reply.gold.looseLo` | with an interval of 6.2 | 6.2 | Appendix | reproducible | `npm run verify -- --id reply.gold.looseLo` |
| `reply.gold.looseHi` | to 22.4 | 22.4 | Appendix | reproducible | `npm run verify -- --id reply.gold.looseHi` |
| `reply.consensus.gap` | The eight models' majority answers showed smaller gaps, 23.0 | 23.0 | Appendix | reproducible | `npm run verify -- --id reply.consensus.gap` |
| `reply.consensus.looseGap` | and 5.5 points | 5.5 | Appendix | reproducible | `npm run verify -- --id reply.consensus.looseGap` |
| `reply.sameEmails` | compared on the same emails, the dataset's larger gap holds up only when all 491 are counted |  | Appendix | not-reproducible | No stored paired test of the dataset's gap against the models' gap exists, and the article gives no number for it; the two gaps and their intervals above are reproducible. |
| `doubt.flips` | On 24 of the 100 adjudicated emails the judge's answer flips whether a reply is owed | 24 | Appendix | reproducible | `npm run verify -- --id doubt.flips` |
| `doubt.rows` | those 24 cover 26 of the 508 rows we score | 26 | Appendix | reproducible | `npm run verify -- --id doubt.rows` |
| `doubt.share` | 5.1% of them | 5.1 | Appendix | reproducible | `npm run verify -- --id doubt.share` |
| `doubt.unread` | the other 395 emails were never read again | 395 | Appendix; METHODS | reproducible | `npm run verify -- --id doubt.unread` |
| `files.probesV2` | the 508-email test set (probes.v2.json) | d8e205c5a66a60d8cbe0126d79b0a2b0712cc149bf1edbc3c00feeaad4346a53 | Every Step 0 to 3 result | reproducible, needs `build:data` | `npm run verify -- --id files.probesV2` |
| `files.probesV1` | the subject-and-body test set (probes.json) | ef51dae101dcd3e8bbd500b2e2d3d69644bfd9b22832f88d5c4b4e736a69b3aa | Appendix (four-way reading) | reproducible, needs `build:data` | `npm run verify -- --id files.probesV1` |
| `files.sheets` | the 100 blind adjudication sheets | 8dcee2a474383e2e0b03a06a6d66decd3f386438123c09aea78f8d38edba0dba | Appendix | reproducible, needs `build:data` | `npm run verify -- --id files.sheets` |
| `context.gmailSpam` | Gmail keeps more than 99.9% of spam out | 99.9 | Sorting mail is an old problem | context | Google's published figure. |
| `context.goal` | right for its owner 99.99% of the time | 99.99 | What Pingbo delivers | context | A goal, not a measurement. |
| `figure2.*` | Figure 2, every point (128 claims) | | Figure 2 | reproducible | `npm run verify -- --id figure2` |
| `figure3.*` | Figure 3, every reading (320 claims) | | Figure 3 | reproducible | `npm run verify -- --id figure3` |
