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
