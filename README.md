# Shiurim

Calculator and reference tables for halachic measurements (volume, length, coins), built from the
"מחשבון שיעורים" Google Sheet (`יחידות` tab).

```
python app.py        # http://127.0.0.1:5005  (also started by ..\dashboard\start-all.bat)
```

## Focus

The app is about the units of the Torah and Chazal and how they relate to each other. Modern
sizes (ר' חיים נאה / חזון איש) are an optional extra behind the **שיעור מודרני** switch in the
header (off by default).

## Tabs

| Tab | What it does |
|---|---|
| מחשבון | Category, then **סולם היחידות** (the main chain, e.g. כור = 30 סאה, סאה = 6 קב, קב = 4 לוג, לוג = 6 ביצים; tap a step to load it). Amount (decimals or fractions like `1 1/2`, `½`), from unit, to unit. Shows the result, the exact fraction, **בפירוט** (split into whole chain units, e.g. 7 קב = 1 סאה + 1 קב), the base-unit equivalent and the sheet's notes, plus the amount in every unit of the category. |
| טבלת שיעורים | Every unit per category: value in the base unit (and in ביצים for volume), note, log-scale size bar, "לחשב" jumps into the calculator. Searchable. |
| הגדרות שיעור מודרני | Only visible with the switch on. Edit the modern reference values (ביצה in ml, טפח in cm, דינר in g) per shita. Saved to `data/modern.json`; "חזרה לערכי הגיליון" deletes it. |

With the switch on, the calculator and tables also show modern sizes under both shitot, and
ml/L, cm/m/km and g/kg become selectable units.

## Data

- `data/units.json`: unit table copied from the sheet (units, base values as exact fractions, notes,
  default modern values, the main `chain` used for the ladder and breakdown, calculator shortcuts). Edit this to add units.
- `data/modern.json`: only your overrides of the modern values (created on first save).

Math is done with exact BigInt fractions, so e.g. 1 רביעית = 1 1/2 ביצה exactly.
The sheet's `Sheet1`/`Sheet2` tabs were earlier drafts and were not carried over.

Same safety setup as DocTracker: listens on 127.0.0.1 only, rejects unknown Host headers and
cross-site writes, debug off.
