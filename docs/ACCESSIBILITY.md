# 0penRX — Accessibility Standard & Plan (WCAG 2.2 AA)

Researched 2026-07-06 against primary sources (ADA.gov, Federal Register, W3C/WAI,
Section508.gov, WebAIM). This document records the standard the site targets, why,
and the working checklist. The audit findings and their fixes are tracked in the
PR(s) that reference this file.

## The standard: WCAG 2.2 Level AA

- **ADA Title III** (private sites — applies to 0penrx.org): no codified technical
  standard, but DOJ guidance, settlements, and case law make **WCAG 2.1 AA the
  de facto litigation standard** (ada.gov/resources/web-guidance/).
- **DOJ Title II rule (2024)**: WCAG 2.1 AA for state/local government sites —
  the clearest signal of what DOJ considers "accessible" (compliance 2027/2028
  after the 2026 extension).
- **HHS Section 504 rule (2024)**: WCAG 2.1 AA for HHS-funded health entities —
  the health-sector regulatory floor (does not bind 0penRX unless HHS-funded).
- **WCAG 2.2** (Oct 2023) is the current W3C recommendation and is
  backwards-compatible: a 2.2 AA site satisfies 2.1 AA and therefore every
  current US legal benchmark. **Target: WCAG 2.2 AA.**

New-in-2.2 criteria that apply here: 2.4.11 Focus Not Obscured (AA),
2.5.8 Target Size ≥24px (AA), 3.2.6 Consistent Help (A). (4.1.1 Parsing removed.)

## Deafness reading (this site)

0penRX has **no audio or video content**, so the captions/transcript criteria
(1.2.x) are satisfied by default per W3C conformance ("if there is no content to
which a success criterion applies, the success criterion is satisfied").
Standing obligations: never convey information by sound alone; if media is ever
added, it ships with captions/transcripts; contact channel is email (non-phone).

## Working checklist (the criteria that do the work on this site)

| Criterion | Plain-English action |
|---|---|
| 1.1.1 Alt text | Every informative image has alt; decorative → `alt=""` / `aria-hidden` |
| 1.3.1 Structure | Real headings/lists/tables/labels in markup, not styled divs |
| 1.4.3 Contrast | Text ≥4.5:1 (≥3:1 large); check muted tokens in BOTH themes |
| 1.4.10 Reflow | No horizontal scroll at 320px (data tables exempt, scroll in their own container) |
| 1.4.11 Non-text contrast | Input borders, icons, focus rings ≥3:1 |
| 2.1.1 Keyboard | Cards, filters, suggestions, dialog — all keyboard-operable |
| 2.4.1 Bypass blocks | Skip-to-content link, first focusable element |
| 2.4.7 Focus visible | Global :focus-visible ring, never suppressed |
| 2.4.11 Focus not obscured | Sticky header must not fully cover focused elements (scroll-padding) |
| 2.5.8 Target size | Interactive targets ≥24×24 px (inline prose links exempt) |
| 3.1.1 Language | `<html lang="en">` everywhere |
| 3.2.3/3.2.4/3.2.6 Consistency | Same nav order, same names, help (contact) in same place site-wide |
| 4.1.2 Name/role/value | Combobox pattern complete (aria-expanded, aria-activedescendant, arrow keys); dialog focus trap + return-focus |
| 4.1.3 Status messages | aria-live/role=status for results count, "Copied!", async loads |

## WebAIM Million top failures (what plaintiff scans flag first)

Low-contrast text (83.9% of home pages) · missing alt (53.1%) · missing form
labels (51%) · empty links (46.3%) · empty buttons (30.6%) · missing lang
(13.5%). Fixing these six categories plus keyboard/focus behavior removes the
bulk of real barriers and litigation exposure.

## Primary sources

- https://www.ada.gov/resources/web-guidance/
- https://www.ada.gov/resources/2024-03-08-web-rule/
- https://www.w3.org/WAI/standards-guidelines/wcag/new-in-22/
- https://www.w3.org/WAI/WCAG22/Understanding/conformance
- https://www.w3.org/WAI/ARIA/apg/patterns/combobox/
- https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/
- https://www.section508.gov/manage/laws-and-policies/
- https://webaim.org/projects/million/
