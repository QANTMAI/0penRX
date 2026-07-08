# Plan — SOTA comparison-table redesign (from the 3-critic hyper-critical review)

Status: PLANNED (review run 2026-07-07; 3 independent design critics — decision-flow,
visual-hierarchy, truth/labels — 22 evidence-cited findings, all against real file:line
and the user's target framework, nothing assumed).
Owner: Tabitha Rudd, Qantm AI.

## The verdicts (verbatim, condensed)

- **Decision flow:** "accurate and well-sourced but built as vendor-column question-grids
  that make a stressed reader hunt across four dense cells instead of routing them from
  their situation → route group → a normalized best-next-action; the two comparison pages
  use incompatible schemas that break cross-page continuity."
- **Visual hierarchy:** "the recent CSS (dividers, teal headers, spine, zebra) makes them
  *look* like grids but does nothing for in-cell hierarchy — the load-bearing answer
  (Yes/No, '$19/visit') is buried mid-sentence, and on a phone a 4-column table is just a
  horizontal-scroll strip."
- **Truth/labels:** "largely truthful, but leans on dense prose instead of evidence-mapped
  decision labels, and several cells still blend distinct entities (GoodRx Care vs
  Companion vs Gold; Amazon Pharmacy vs RxPass) or state restrictions inconsistently
  across pages."

## The model (the user's framework, adopted site-wide)

Every comparison surface follows three layers, top to bottom:

1. **User state** (the entry router — 5 tappable cards):
   Have Rx · Need Rx · Need ongoing care · Cannot afford brand · Low-income / public help.
2. **Route group** (the table heading the router jumps to):
   Cash pharmacy · Coupon cards · Memberships · Telehealth · Manufacturer / PAP · FQHC.
3. **Normalized-field comparison** (options as rows, fields as columns) — one schema everywhere.

This gives continuity across the whole platform while preserving category truth
(see docs/PRICING_MODEL.md).

## 1 — One normalized column schema (all option tables, every page)

Replace today's incompatible schemes (compare-platforms = vendor-columns/question-rows;
uninsured-guide = Platform·Cost·Best-for·Limitations; visits table has a non-parallel 5th
column) with a single set:

| Option | Cost model | Membership | Works with insurance | Mode | Eligibility | Best next action |
|--------|-----------|-----------|----------------------|------|-------------|------------------|

- **Options are rows**, fields are columns, and the **table's heading is the route group**.
- The three uninsured-guide tables become strictly parallel (same columns, same order).
- The existing 4-way vendor grid is **demoted to an optional "full side-by-side" appendix**
  below the router — kept for reference, no longer the primary pattern.

## 2 — Answer-first cell + status pills (kills "looks all the same")

Every cell leads with the answer, not prose:

```
<td data-col="GoodRx card + Companion">
  <span class="ans">$19/visit</span>
  <span class="ans-sub">with Companion or Gold membership; $39–$70 without</span>
</td>
```

- `.ans` — bold, ~1.05rem, `--text` (the figure, or Yes / No / Discounts only).
- `.ans-sub` — one muted `--t-xs` detail line. Multi-provider price lists
  (Wheel / Doctor on Demand / Curai) move to the detail line or a footnote so the
  headline answer stands alone.
- **Status pills** encode valence so a row scans as a colour pattern, not four grey words:
  `.pill-yes` (teal/--good), `.pill-no` (muted grey), `.pill-part` (amber, for
  "Discounts only" / "Only if eligible"). Reuse the catalog's existing badge/mono/
  tabular-nums primitives so the whole site teaches one scanning model.

## 3 — Evidence-mapped decision labels (the "Best next action" column)

Every option table ends on an **action**, not a limitation. The rightmost column renders
chips drawn only from the user's vocabulary, **each justified by that row's own data**:

| Label | Attaches to (evidence) |
|-------|------------------------|
| No card needed / Free coupon card | $0-cost universal cards (GoodRx free, SingleCare) |
| Membership required | subscription-gated prices (Companion, Gold, RxPass+Prime, One Medical, Costco member Rx) |
| Prescription visit available | GoodRx Care, Sesame, Teladoc, Amazon On-Demand Care |
| Delivery / mail order vs Pickup today | fill / delivery rows |
| Only if eligible | FQHC + any income-qualified route (PAP) |
| Not insurance · Cannot combine with insurance (incl. Medicare/Medicaid) | every discount card and Companion |
| Verify before filling | any unpublished/unverified cell (Costco member Rx, locally-set exam prices) |

Hard rule: **no chip without a fact behind it in the same cell.** No "best overall."

## 4 — Responsive: card-per-row below 600px (kills horizontal scroll)

There is currently **no `@media` rule for `table.t`** — on a phone the 4-column table just
`overflow-x:auto` scrolls. Below 600px, stack each row into a bordered card: the row's
question becomes the card title, each `td` shows its `data-col` label above the answer, and
column dividers/zebra collapse. Plus `table-layout:fixed` with per-data-column min-width
(~150px) on desktop so a column never crushes below readability.

## 5 — Per-page work

- **compare-platforms:** add the user-state router on top; split the conflated cells into
  route-group sub-rows (Amazon Pharmacy ≠ RxPass; One Medical/Prime/RxPass no longer share
  one box); demote the vendor grid to the appendix.
- **uninsured-guide:** recast the "Start here" prose bullets (currently product-shaped:
  "All-in-one", "Heavy prescriber") into the **five canonical user states** incl. the
  missing "Low-income / public help" → FQHC + PAP; make the three tables parallel on the
  normalized schema.
- **index.html methodology table:** add a "Can I buy from this?" column (Yes / No / Baseline)
  so "buy here" sources (Cost Plus, Amazon, GoodRx) are visually separated from
  reference-only baselines (NADAC, WAC, 0penRX estimate); add "Not insurance — universal
  cash-discount card" to the GoodRx row.

## 6 — Truth fixes surfaced by the review (do these regardless)

- **GoodRx Care vs Companion vs Gold** (compare :108): split so the $19 visit is labeled
  GoodRx **Care** with "Membership required (Companion/Gold)" separate from the visit fee;
  "$39–$70" as the no-membership price. Never let "Companion" sit in a visit-price cell
  without saying the membership is separate.
- **Amazon Pharmacy vs RxPass** (compare :107): tag RxPass "Membership required (Prime)" +
  "Delivery/mail order" + "common generics only"; keep Amazon Pharmacy as the parent route.
- **Cross-page consistency:** the free GoodRx card must state the identical restriction on
  both pages — add "Cannot combine with insurance (incl. Medicare/Medicaid)" to
  compare-platforms (uninsured-guide has it, compare doesn't).
- **Kill optimistic "from $X" floors:** Walmart Better Care "from $39" and Sesame "from
  ~$37" hide a marketplace — show a range ($39–$99) + "price depends on which provider you
  pick."
- **FQHC:** soften "up to 200% of the poverty line" (not universal) to "typically up to
  ~200%; some centers extend higher — verify at the center" + an "Only if eligible" chip.
- **Provenance:** every price cell carries the verified date + "(vendor's own price)";
  unverified cells (Costco member Rx) get the distinct "Verify before filling" state.

## Sequencing

- **P1 — CSS + cell pattern (no data risk):** `.ans`/`.ans-sub`, the three status pills, the
  card-per-row `@media`, `table-layout:fixed` + min-width. Ships the scannability win first.
- **P2 — normalized schema + user-state router:** restructure compare-platforms and
  uninsured-guide to the shared column set + the 5-state router; demote the vendor grid.
- **P3 — truth fixes + decision-label chips:** the entity splits, cross-page consistency,
  the "from $X" ranges, and the evidence-mapped chips (each justified per cell).
- Each phase is one verified PR with the fact-preservation net over every moved/reworded
  price, browser verification light+dark at 1280 and 375, and no invented pricing.

## Acceptance criteria

1. **Decision-first:** a reader picks a user state and lands on the route group's table; a
   binary answer (Yes/No/Discounts-only/price) is legible per cell in under 2 seconds.
2. **Consistency:** one column schema across compare-platforms, uninsured-guide, and the
   methodology table; identical restrictions for the same product on every page.
3. **Truth:** no cell blends two price classes or two entities (Care≠Companion,
   Amazon Pharmacy≠RxPass); every chip is backed by that cell's data; no "from $X" floor
   without a range.
4. **Mobile:** no horizontal-scroll table on a phone — each row is a self-contained card.
5. **Gates:** node --test, all drift gates, browser light+dark 1280+375.
