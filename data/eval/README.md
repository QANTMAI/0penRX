# 0penRX Lookup Golden Set — data-labeling methodology applied to entity resolution

This directory is a **human/API-verified ground-truth evaluation set** for the
live-lookup pipeline (search any drug → identity, price link, cash estimate).
It adapts the *quality + evaluation* half of the data-labeling discipline
(golden datasets, annotation schema, label accuracy, manual auditing —
[scale.com/guides/data-labeling-annotation-guide](https://scale.com/guides/data-labeling-annotation-guide))
to a **deterministic** pipeline. We are not training a model; we are locking in
correctness for an entity-resolution / record-linkage task with measurable
label accuracy — the same rigor, applied honestly to what 0penRX actually is.

## Why this exists

The live lookup resolves one drug across three independent sources:

```
RxTerms query ─┬─► openFDA  (identity: FDA established name, NDC, form)
"Albuterol/    ├─► CMS NADAC (acquisition cost → cash estimate)
 Ipratropium   └─► GoodRx    (price page slug)
 (Inhalant)"
```

Getting that resolution right is hard and was fixed one bug at a time
(combination-ingredient matching, inhalant-vs-syrup form, GoodRx slug **order**,
XR→ER naming). Those fixes lived only as ad-hoc unit tests. This golden set makes
the correctness **systematic, measured, and regression-proof**.

## The labeling task (mapped to the guide's concepts)

| Guide concept | Here |
|---|---|
| **Ground truth / golden dataset** | `lookup-goldens.jsonl` — one verified record per drug query |
| **Annotation schema** | the JSON fields below; every field is a *label* about a **stable** fact |
| **Entity resolution / NER-adjacent** | extract the ingredient set from a query; resolve it to the canonical entity in each source |
| **Manual auditing / benchmark** | `label-provenance` gate — no label without a verification date + sources |
| **Label accuracy / precision** | `test/lookup-eval.test.mjs` reports pass/total per field + overall |
| **Human-in-the-loop** | every label was verified against a *live* source (see Provenance) |

## Schema (`lookup-goldens.jsonl`, one JSON object per line)

| Field | Meaning |
|---|---|
| `id`, `query`, `clean` | pipeline input (RxTerms display) and its form-stripped name |
| `category` | failure-mode bucket (mono-oral, combo-inhalation, brand-no-nadac, …) |
| `ingredients[]` | **label** — canonical ingredient set (order-independent) |
| `isCombo`, `formClass` | **labels** — combo flag; route (oral / inhalation / injection / ophthalmic) |
| `fdaEstablishedName` | **captured** from openFDA `generic_name` (or `brand_name` for brands) |
| `goodRxSlug` | **label** — the slug the REAL GoodRx page resolves to (HTTP-verified) |
| `goodRxWrongOrder` | a sibling slug verified to **404** — proves ingredient order matters |
| `comboTrap` | an established name openFDA returns first that must be **rejected** |
| `nadacCorrect` / `nadacWrong` / `nadacPill` | observed real NADAC descriptions: one that must match, one that must be rejected, a solid-oral form |
| `brandResolved` | brand queries resolve via `brand_name`; ingredient-set matching is bypassed |
| `provenance` | `{verifiedOn, method, sources[]}` — the audit trail; **required** |

## Non-negotiable labeling rules (why this is trustworthy)

1. **Label stable facts, never volatile ones.** The ingredient set, the FDA
   established-name order, the GoodRx slug, and the dosage-form class are stable.
   Exact prices and per-unit NADAC values are **not** — they are never asserted
   as permanent ground truth.
2. **No circularity.** `goodRxSlug` is what the *real page* resolves to
   (HTTP 200/404 verified), **not** what `goodRxComboSlug()` outputs. A wrong
   algorithm fails against reality. `fdaEstablishedName` is captured from
   openFDA, independent of any 0penRX code.
3. **Provenance or it doesn't ship.** Every record carries `verifiedOn` + real
   sources; the harness fails if any label lacks them.
4. **Verification caught real errors — that's the point.** The `ozempic`
   `brandResolved` label and the exclusion of `aspirin-butalbital-caffeine`
   (verified 404 — GoodRx uses the brand slug there) both came from *verifying*,
   not assuming.

## What it measures (evaluation)

`node --test test/lookup-eval.test.mjs` runs the pure functions in
`assets/live.js` against every label and prints label accuracy per field:

```
┌─ 0penRX lookup golden-set eval — 11 goldens, 73 labeled assertions
│  entity-resolution     12/12  = 100.0%
│  form-class            16/16  = 100.0%
│  ingredient-set        11/11  = 100.0%
│  label-provenance      11/11  = 100.0%
│  nadac-matching         6/6   = 100.0%
│  slug-derivation       17/17  = 100.0%
└─ overall label accuracy: 73/73 = 100.0%
```

**Honest scope:** 11 goldens is a *coverage* set across the known failure modes,
not a statistical sample. It proves the pipeline reproduces every verified case
and guards against regressions of the exact bugs already fixed — it does not
claim population-level accuracy. Grow it (see below) to raise confidence.

## Known limitations (documented, not hidden)

- **NADAC abbreviations.** NADAC shortens some ingredients unpredictably
  (`trimethoprim` → `TMP`, e.g. `SULFAMETHOXAZOLE-TMP`), so 6-char prefix
  matching can't confirm those combos. `getNadac` correctly returns **null**
  (no wrong price) rather than guessing — captured on the SMZ/TMP golden.
- **Brand/biologic pricing.** NADAC surveys generics; brand queries (Ozempic)
  return no NADAC row by design — the lookup shows no price rather than a wrong
  one.

## How to add a golden (annotation SOP)

1. Pick a drug that exercises an **uncovered** category (data curation).
2. Capture `fdaEstablishedName` from
   `https://api.fda.gov/drug/ndc.json?search=generic_name:<x>&limit=1`.
3. Verify `goodRxSlug` by loading the real page (HTTP 200); verify the reversed
   order 404s.
4. If applicable, capture a real NADAC description from the CMS datastore query.
5. Add the line with a full `provenance` block (today's date + the URLs used).
6. `node --test test/lookup-eval.test.mjs` must stay green.
