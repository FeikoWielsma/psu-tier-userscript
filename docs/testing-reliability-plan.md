# Testing and matching reliability plan

Status: implemented. See [testing results](testing-results.md) for validation,
remaining limitations and the review procedure.

## Agreed behavior

- Reject candidates that contradict an explicitly stated product generation.
  Rejected candidates must not reappear as alternate matches.
- When generation is unclear, allow a clearly marked likely match if the
  available evidence does not conflict. Missing information is not agreement.
- Release only reviewed, committed sheet snapshots. Fetching fresh sheet data
  belongs in an explicit update/review workflow, never in the publishing build.
- Prioritize correct product identity over raw match coverage. The wrong model
  on the right tier is still an identity error.

## Evidence behind this plan

The current committed fixture contains 1,412 entries. The existing suite has
124 matcher cases, including four no-match cases and 45 model-pinned cases.
The saved storefront corpus contains 957 products; 834 match, including 712
strong matches. These are coverage counts, not correctness measurements.

The matcher returns a strong match for `MSI MAG A850GL PCIE5 III` against the
older `MAG A-GL PCIE5` entry. Reversing the data order changes selected identity
for 65 saved products; one observed example changes the displayed tier.
Some differences represent genuine ambiguity rather than demonstrably wrong
matches, so order sensitivity must be assessed against identity evidence.

All existing JS tests, ESLint, TypeScript checks, and Python lint passed during
planning. The local npm launcher failed; invoking the installed JS tools
directly worked. This environment issue is separate from matcher correctness.

The release workflow currently runs fixture tests before fetching new sheet
data. CI also can build live data that its matcher tests did not exercise.
The reported 1,418 live entries and Lian Li rename need verification during the
explicit refresh; this plan does not treat the earlier live count as current.

## 1. Establish a trustworthy test interface

Primary files: `tests/test_matching.js`, `tests/corpus.json`, new shared test
helpers and synthetic matcher fixtures.

- Let tests accept an explicit dataset path, defaulting to the committed
  snapshot. Every result report identifies its dataset and content hash.
- Validate case and dataset schemas. Misspelled or unsupported expectations
  fail loudly rather than silently weakening assertions.
- Support expected identity or identity sets, forbidden candidates, required
  rejection, maximum/minimum band, ambiguity, and limited-rating status.
- Identify entries using reviewed identifying fields and provenance; do not
  use array position or tier alone as identity. Handle model renames through
  reviewed evidence, not loose string assertions added just to restore green.
- Use small synthetic datasets for behavior contracts and the full committed
  snapshot for real-data integration. Keep the matcher DOM-free and exercise
  its public interface rather than copying its scoring implementation.
- Review existing expectations before adopting them as correctness labels.
  In particular, assertions accepting a different efficiency/model family need
  evidence, even if they currently pass.

Acceptance: changing a selected entry to an incorrect same-tier sibling fails
the relevant identity test. Invalid expectations cannot produce a passing run.

## 2. Add rejection tests, then tighten matching

Primary files: `src/matcher.js`, `data/normalization_rules.json`, matcher tests.

- Add the MSI III regression and known-generation positive controls.
- Cover Roman numerals, V2/V3, release years, model suffixes, revisions,
  unknown future generations, and near-neighbor families.
- Distinguish product generations from standards and connector descriptors.
  Do not equate all numerals or interpret every ATX/PCIe standard as a model
  generation. Evidence-backed aliases can express legitimate naming mappings.
- Preserve identifying information before aggressive normalization. Audit rules
  stripping revisions, label descriptors, and variant qualifiers, including
  cases where revisions have materially different ratings.
- Apply explicit conflicts consistently across scoring paths and alternates.
  Lowering a score is insufficient if a contradicted model still gets a badge.
- Treat unresolved identities as likely even when competing entries share a
  tier. Cross-tier ambiguity must not present an arbitrary winner as settled.
- Test wattage ranges/lists, form factor, modularity, certification schemes,
  dual certifications, absent signals, and conflicting structured/name signals.
  Specify which conflicts justify rejection; do not make every uncertain spec
  into an unconditional hard filter.
- Add deterministic permutation tests. Unique matches retain their identity;
  ambiguous matches retain their uncertainty and full eligible candidate set.
  Use stable ordering for displayed alternates after preserving ambiguity.
- Add seeded harmless formatting variations and negative near-neighbor cases.
  Do not assume color, revision, or special-edition changes preserve identity.
- Demonstrate that disabling generation rejection or ambiguity handling makes
  focused tests fail. Avoid broad mutation tooling unless it adds useful signal.

Acceptance: explicit unknown/conflicting generations cannot select older
models, including through constraint fallback. Valid known generations still
match. Missing-generation cases follow the agreed likely-match policy.

## 3. Measure correctness independently

Primary artifacts: reviewed labels, evidence records, evaluation runner and
machine-readable baseline report under `tests/` and/or `docs/`.

- Capture a reproducible sampling frame for both sites with product URLs,
  extraction date, raw names, and structured signals. Deduplicate and account
  for repeated wattages/variants so a large family cannot dominate results.
- Initially label about 300 sampled products, including unmatched products,
  plus a separate deliberately difficult regression set. Determine site and
  band allocation before inspecting errors; record sampling probabilities.
- Label from storefront/manufacturer evidence and the selected sheet snapshot
  before looking at matcher predictions. Record source references, identifying
  specifications, expected identities or ambiguity, rationale, reviewer, and
  unresolved questions. Model-generated predictions are not ground truth.
- Reserve a holdout by model family before tuning. Use development labels for
  fixes; do not repeatedly tune against holdout failures without recording
  that the holdout has become development data and obtaining a new holdout.
- Report identity precision, tier correctness, recall on known rated products,
  rejection behavior, raw coverage, and unresolved-label counts separately.
  Break out strong/likely matches and each site. Keep curated difficult-case
  performance separate from representative estimates; weight stratified
  estimates appropriately rather than pooling unlike samples.
- Define denominators explicitly: incorrect returned matches / all assessed
  returned matches measures false discovery, whereas false-positive rate needs
  a ground-truth negative denominator. Never label coverage as accuracy.
- Report sample sizes and uncertainty. Do not infer perfect precision from a
  small error-free sample. Exclude unresolved labels from resolved-case metrics
  transparently and report their possible effect on conclusions.
- Set numerical release targets after establishing the reviewed baseline and
  its uncertainty. Require zero failures of explicit identity/conflict contract
  cases immediately; document intentional recall changes and prevent hiding
  errors by simply suppressing all matches.

Acceptance: expected results have independently inspectable evidence; the
evaluation exposes both false matches and missed valid matches. Precision
claims are limited to the actual reviewed sample and sampling design.

## 4. Make data updates and releases reproducible

Primary files: `fetch_sheet.py`, `parse_tier_list.py`,
`generate_userscript.py`, `build_extension.py`, `test_suite.py`, both workflows.

- Add standard-library Python tests for CSV headers/column layout, continuation
  rows, series/brand changes, variant resets, missing cells, tier syntax, limited
  ratings, model qualifiers, malformed responses, and empty or partial updates.
  Resolve discrepancies between parser comments and actual forward-fill logic.
- Fetch both sheet tabs into staging, validate them, and update the snapshot
  atomically. Preserve source references, retrieval metadata, and hashes.
  Failed refreshes must leave the previous reviewed snapshot intact.
- Produce a reviewable semantic diff: additions, removals, renames, tiers,
  limited-rating status, identifying specs, duplicate/conflicting identities,
  and suspicious changes in counts or field completeness.
- Verify the current live sheet and Lian Li rename during this refresh. Commit
  refreshed data and reviewed label adjustments together; do not automatically
  rewrite expected identities or tiers from new matcher output.
- Make default local builds and deterministic CI use the reviewed snapshot.
  Keep optional live source-health checks separate from publishing inputs.
- Run the correctness suites against the explicitly selected release dataset;
  build userscript and extension from that same frozen input.
- Verify embedded dataset/rules/source hashes, artifact syntax, manifest and
  version consistency, required package files, and equality of userscript and
  extension content. Exercise the built artifacts, not just source modules.
- Publish only artifacts that passed validation. Do not refetch or rebuild
  from different inputs between validation and publishing. Preserve validation
  reports and provenance alongside build artifacts.
- Add failure-path tests proving invalid data and failed validation prevent
  reaching publishing. Offline release tests must never contact store APIs.

Acceptance: a clean checkout can build and validate the chosen release data
without network access. Changing the data after validation invalidates the
release check. No publisher runs on unvalidated content or fallback live data.

## 5. Verify adapters and browser behavior

Primary files: `tests/test_adapters.js`, real HTML fixtures, new Playwright
integration tests, `tools/live_capture.mjs`.

- Pin exact extraction results for representative rows and layouts on each
  site; add real Tweakers fixtures alongside synthetic edge cases. Include
  absent columns, dual certification, unrelated list items, and name cleanup.
- Run generated userscript tests in Playwright against locally served saved
  pages. Block external requests and fail on relevant runtime errors.
- Assert per-product badge identity, band, tier, limited flag, unrated behavior,
  popup details, and alternates. Badge counts alone are insufficient.
- Exercise dynamic insertion/replacement, reused rows whose product changes,
  duplicate prevention, filter mounting/remounting, preference persistence, and
  tier/limited/unrated filtering. Check accessible and narrow-screen behavior
  where badge placement and popup controls are affected.
- Add a packaged Chromium-extension loading check where supported; verify
  manifest/content injection rather than claiming userscript injection proves
  the packaged extension works. Record browser/platform coverage explicitly.
- Keep live checks on demand or scheduled separately from deterministic CI.
  Use normal limited page loads. Report access blocks as inconclusive and
  accessible pages with broken extraction or expected badges as failures.
  Save enough evidence to distinguish site drift from matching mistakes.

Acceptance: selected products receive the correct visible behavior through
the actual built script, including after page updates. Live verification must
be reported separately as passed, failed, or inconclusive with evidence.

## 6. Explain scores honestly and maintain the suite

Primary files: `src/userscript.template.js`, `README.md`, test/release docs.

- Replace probability-like confidence percentages with qualitative matching
  language. If a numeric value remains in details, label it as a similarity
  score and explicitly avoid interpreting it as probability of correctness.
- Keep sheet limited-confidence ratings distinct from uncertain identity.
- Make unlabeled match coverage informational rather than a minimum-match gate.
  Use reviewed identity/conflict cases and justified precision/recall checks as
  correctness gates. Retain no-throw and dataset integrity checks.
- Document dataset selection, offline checks, browser prerequisites, fixture
  capture, evidence labeling, snapshot review, and release validation commands.
- Add every confirmed error as a focused regression with positive controls.
  Refresh sampling/evidence when storefronts or sheet identities change.

Acceptance: UI, documentation, and reports do not describe similarity as
measured confidence. A release reviewer can reproduce the evidence and checks.

## Delivery order and completion evidence

Implement as reviewable increments: test harness; rejection tests and matcher
fixes; reviewed benchmark and refresh; immutable release pipeline; browser
integration and presentation/documentation. Establish the benchmark before
making broad threshold changes. Preserve unrelated existing worktree edits.

For each increment, record changed behavior, the relevant passing checks,
known tradeoffs, and any unresolved evidence. Final verification must include
the complete offline JS/Python suite, lint/type checks, dataset-specific
evaluation, artifact validation, browser integration, and separately reported
live-site results. No publication or release tagging is part of this plan.

Implementation is complete only when the agreed behavior and all acceptance
criteria above are demonstrated. Planning completion does not claim that
matching accuracy is measured or that any implementation change has shipped.
