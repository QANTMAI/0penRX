# Vendor source files (not committed)

## `teamcuban-medications.xlsx`

The Team Cuban Card medication list, used to build `assets/teamcuban.js`.

**This is a manual, human-performed download — on purpose.** teamcubancard.com's
Terms of Use prohibit "us[ing] robots or scripts with the Site", so 0penRX does
not crawl them and `data/build_teamcuban.py` contains no network code at all
(there is a test asserting that).

### Refreshing the list

1. Open <https://www.teamcubancard.com/medications/>
2. Click **“Download an Excel Version of the Current Medication List”**
3. Save it here as `teamcuban-medications.xlsx` (`.csv` also works)
4. Run `python data/build_teamcuban.py`
5. Commit the regenerated `assets/teamcuban.js` — **not** the spreadsheet
   (it is gitignored)

The capture date is taken from the file's modification time and is displayed in
the UI. Their prices change without notice and are set separately from
costplusdrugs.com mail order, so the site always shows the date and tells people
to confirm at the counter.

## Known limitations of this dataset

**No brand names.** The export's only name column is the generic name, so
`gf` (generic-for) is empty for all 2,411 rows. A visitor searching a *brand*
("Norvasc", "Lipitor") gets no Team Cuban block even when the generic is covered.
Catalog drug pages are unaffected — they pass `d.generic`. Fixing the free-text
case would need a brand→generic mapping (the catalog already has one for its own
drugs; RxNorm covers the rest). Not built: it is a real gap, not a defect, and
inventing brand names for their rows would be fabrication.

**No prices, and none are inferred.** Coverage only — see the note above.

**Combination names use hyphens.** `Amlodipine-Olmesartan`, not
`Amlodipine/Olmesartan`. The matcher canonicalises both, but be aware when
eyeballing the data. A brand whose *name* contains a slash (`Zovia 1/35`) parses
as two ingredients and will not match a one-word query — an accepted false
negative, which is far safer here than returning the wrong medicine.
