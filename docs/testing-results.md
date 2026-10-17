# Reliability validation

Implementation date: 17 October 2026. The original findings and agreed behavior
are recorded in [the plan](testing-reliability-plan.md).

## Changes

Explicit generations, model years, revisions and named editions are checked
before normalization can discard them. Contradictory candidates are excluded
from both the winning match and alternates. Missing generation information and
multiple plausible identities produce likely matches, including same-tier
ambiguity. Candidate ordering is deterministic. Wattage ranges and discrete
lists are distinct; conflicting known certification/form-factor signals reject
candidates. Cybenetics grades are not translated into invented 80 PLUS grades.

The displayed 0–1 score is similarity, not measured probability. Badges support
keyboard activation; popup and row updates are covered by browser tests.

The reviewed snapshot contains 1,418 entries (1,099 proper and 319 limited),
reproduced from two frozen CSV exports. Each entry references its source tab and
logical CSV row. The dataset SHA-256 is
`46f25d75bd1fac9e22544c4d791e3f5aeefe59eec4c2e25d3e24be7855d76727`.
The Lian Li Edge Gold rename is included.

Releases use this committed snapshot. They do not download replacement data.
The full gate builds and tests the actual userscript and packaged extension,
then records their hashes and validation inputs. Publishing steps verify that
the artifacts and inputs still match that successful run. Optional signed XPI
application files must match too; cryptographic signature validation remains
the browser/store's responsibility.

## Evaluation evidence

| Dataset | Resolved | Correct returned identities | Rated identities found | Unresolved |
| --- | ---: | ---: | ---: | ---: |
| Development sample | 283 / 300 | 203 / 203 | 203 / 203 | 17 |
| Family-disjoint remainder | 42 / 50 | 26 / 26 | 26 / 27 | 8 |

All resolved negative cases were rejected: 80 in development and 15 in the
separate remainder. No returned resolved case exceeded its reviewed match band.
The conservative miss is GAMDIAS KRATOS M1 B: the unaccounted B suffix prevents
a match to the sheet's Kratos M1 entry. No matcher/rule tuning followed the
separate evaluation. Its initial Vida Lite absent-brand label was wrong and
was corrected against proper sheet row 1063 after inspecting the first report.
This correction is recorded in the review file.

Reviews were source comparisons performed by Codex, **not independent human or
manufacturer verification**. Review records include source references and
rationales. Ambiguous evidence, conflicting saved specifications and uncertain
model codes stay unresolved. Reports show their returned-match counts and
weighted precision bounds rather than silently assuming they are correct.

The original 300 records informed implementation and are all development
evidence; their historical partition names do not imply untouched validation.
The additional 50 exclude their families and the curated regression families,
using a reproducible seed and documented inclusion probabilities. Family
grouping is a conservative naming heuristic, not verified product genealogy.
Its conditional remainder population is narrower than the full saved frames.
Further tuning informed by this sample would turn it into development evidence.

Neither dataset is a probability sample of current live storefronts. Original
capture dates and PCPartPicker URLs were not preserved. Repeated families,
unresolved labels and convenience-frame selection limit statistical inference.
Wilson intervals are descriptive and assume independence; they do not establish
a real-world accuracy guarantee. Independent human review remains useful.

The full 957-product saved PCPartPicker frame returns 814 matches, including
548 strong matches. These coverage counts are informational. The reduction from
the original 834 matches reflects stricter identity checks, not a correctness
regression by itself.

## Checks and reproduction

```bash
npm ci
node node_modules/playwright/cli.js install chromium
python test_suite.py --release
python verify_artifacts.py
```

The gate includes 54 Node contract/evaluation tests, 128 curated matcher cases,
real saved adapter fixtures, both reviewed benchmarks, three targeted mutation
checks, 21 Python parser/snapshot/build tests, six Chromium tests, lint and type
checking. Browser tests use intercepted pages and the generated artifacts;
external trackers and storefront availability cannot decide their verdict.

Reports are written under ignored `reports/`, including `benchmark.json`,
`holdout.json` and `release-validation.json`. A quick run cannot attest a
release. Changing the snapshot intentionally requires review of benchmark
evidence and dataset policies; do not update labels from matcher predictions.

Live smoke evidence is recorded separately in [live-verification.json](live-verification.json).
It covers one page per site and one exact-model popup, not every match, Firefox
installation, userscript-manager compatibility, or store publication. CI/browser
checks and live checks answer different questions. No release was published as
part of this implementation.
