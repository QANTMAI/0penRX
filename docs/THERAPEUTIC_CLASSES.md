# Therapeutic classes — how `category` is sourced

Every drug in `assets/catalog.js` carries a `category` (the filter chips on the
home page) and a `pharmClass`. This file records where those come from, so any
category can be re-derived from scratch rather than taken on trust.

**Rule: a category is never an opinion.** It is read off the drug's FDA class.
If the class alone doesn't settle it, the FDA label's own
`indications_and_usage` settles it. Nothing here is inferred from a drug's
reputation.

## Source of truth

`pharmClass` is the drug's **Established Pharmacologic Class (EPC)** — the FDA's
own classification, published in the Structured Product Label and exposed by
**openFDA**, which is already one of this site's documented runtime sources
(`api.fda.gov`, listed in `API_SOURCES` and on `/data-sources/`).

Reproduce any entry:

```bash
# EPC via the NDC directory (primary)
curl -s 'https://api.fda.gov/drug/ndc.json?limit=5&search=brand_name:"Januvia"' \
  | python3 -c 'import json,sys; print([p for r in json.load(sys.stdin)["results"] for p in (r.get("pharm_class") or []) if p.endswith("[EPC]")])'
# -> ['Dipeptidyl Peptidase 4 Inhibitor [EPC]']

# EPC + indication via the label endpoint (fallback / tie-break)
curl -s 'https://api.fda.gov/drug/label.json?limit=1&search=openfda.brand_name:"Mayzent"' \
  | python3 -c 'import json,sys; r=json.load(sys.stdin)["results"][0]; print(r["openfda"].get("pharm_class_epc"), r["indications_and_usage"][0][:120])'
```

**84 of 90** entries resolved directly from openFDA.

## Entries not resolvable from openFDA

Two had no EPC in either openFDA endpoint and were sourced from **DailyMed**
(NLM), the same FDA label data under a different front door:

| Drug | `pharmClass` | Source |
|---|---|---|
| Cetrotide (cetrorelix acetate) | Gonadotropin Releasing Hormone Antagonist | [DailyMed setid `aca7768e-…`](https://dailymed.nlm.nih.gov/dailymed/drugInfo.cfm?setid=aca7768e-28a7-4027-b1d8-e66247665f79) |
| Toviaz (fesoterodine fumarate) | Muscarinic Antagonist | [DailyMed setid `fead426f-…`](https://dailymed.nlm.nih.gov/dailymed/drugInfo.cfm?setid=fead426f-b955-4b41-8553-f102d17afa3a) |

Four more (`abrilada`, `aimovig`, `emgality`, `foundayo`) return **no EPC from any
openFDA endpoint** — verified 2026-07-21 against the NDC directory, which returns
records for each (4/3/6 respectively) but with an empty `pharm_class`. Controls
confirm the query is sound: `ZAVZPRET` returns `Calcitonin Gene-related Peptide
Receptor Antagonist [EPC]` and `OZEMPIC` returns `GLP-1 Receptor Agonist [EPC]`.
Biologics and very new molecules frequently ship an SPL with no EPC.

They are **not** left blank and are **not** invented. Each is sourced from a named
standard classification, exactly as Cetrotide/Toviaz were sourced from DailyMed:

| Drug | `pharmClass` | Source (not an FDA EPC) |
|---|---|---|
| Abrilada (adalimumab-afzb) | Tumor Necrosis Factor Blocker | The **adalimumab** EPC via RxClass/DailyMed; identical to its siblings `humira-pen` and `amjevita` |
| Aimovig (erenumab-aooe) | Calcitonin Gene-related Peptide Receptor Antagonist | **SNOMED CT 771677008** (*CGRP receptor antagonist*) + **ATC N02CD**. Erenumab blocks the receptor, so it takes the same string as `zavzpret` |
| Emgality (galcanezumab-gnlm) | Calcitonin Gene-related Peptide Antagonist | **ATC N02CD** (*CGRP antagonists*). Deliberately **not** "Receptor" — galcanezumab binds the CGRP ligand, not the receptor |
| Foundayo (orforglipron) | GLP-1 Receptor Agonist | **MED-RT MoA N0000020057** (*GLP-1 Receptor Interaction*); same string as the `ozempic` EPC |

**The rule, in order:** FDA EPC (openFDA NDC directory) → the label endpoint →
DailyMed → a **named standard** (ATC / SNOMED CT / MED-RT), recorded in the table
above with its identifier. A class is **never** invented, and anything sourced
below the EPC tier must be documented here so the provenance is auditable.

## Where the class alone didn't decide it

The EPC gives pharmacology, not the therapeutic area a patient searches by.
Where those diverge, the label's indication decided — and in one case it
contradicted the obvious guess:

- **Azulfidine / Azulfidine EN-tabs** (Aminosalicylate) → **Digestive**. The
  label leads with *"mild to moderate ulcerative colitis"*; arthritis is listed
  second. Filing it under Autoimmune on the drug's reputation would have been
  wrong.
- **Sotyktu** (TYK2 Inhibitor) → **Autoimmune / Biologic** — *"moderate-to-severe
  plaque psoriasis"*.
- **Eucrisa** (PDE4 Inhibitor) → **Skin** — *"topical treatment of … atopic
  dermatitis"*. Same EPC as Otezla, different area, because the indications
  differ.
- **Cortef / Medrol** (Corticosteroid) → **Corticosteroid**. Their labels span
  endocrine, rheumatic, dermatologic and allergic conditions; no single
  therapeutic area is truthful, so the class itself is the category.

## Corrections this sourcing surfaced

Cross-checking the *already-categorised* entries against their FDA class caught
two that were wrong:

| Drug | Was | Now | Evidence |
|---|---|---|---|
| Mayzent (siponimod) | Oncology / Specialty | **Multiple Sclerosis** | S1P Receptor Modulator; label: *"relapsing forms of multiple sclerosis"* |
| Zeposia (ozanimod) | Oncology / Specialty | **Multiple Sclerosis** | S1P Receptor Modulator; label: *"relapsing forms of multiple sclerosis"* |

`Oncology / Specialty` was left holding only Rydapt and Tabrecta — both of which
were subsequently **removed from the catalog entirely** (2026-07-16) because no
verifiable cash-pay price exists for them: the Novartis co-pay programme is $25 and
commercial-insurance only, NPAF supplies them free to income-qualified uninsured
patients, and the real uninsured cash price is roughly list (~$13,108 per 56
capsules for Rydapt). The catalog's listed $2,908.64 / $2,649.92 matched none of
those routes and could not be sourced, so it could not stay published. The category
is therefore currently unused.

## The invariant

`assets/catalog-validator.js` **errors** on any catch-all category (`Other
Brand`, `Other`, `Misc`, `Uncategorized`, …) and **warns** when `pharmClass` is
missing. Before this pass, 36 of 92 drugs (39%) sat in `Other Brand` — the
largest chip on the page was the one that told you nothing. Adding a drug now
means sourcing its class first.
