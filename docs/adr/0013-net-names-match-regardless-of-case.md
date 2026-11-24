# Net names match regardless of case; the spelling is kept

Net labels, Global labels and Power symbols join by name. ElectroCAD compares those names **without regard to case**: `+3v3` and `+3V3`, or `nRESET` and `NRESET`, are the same Net. Two names that differ only by case are almost always a typo. If they counted as two Nets, the schematic would look connected while the board's ratsnest showed the supply split, so you would find out late or on a dead prototype. No real design wants two Nets told apart only by case.

What the user typed is never rewritten behind their back:

- **Labels keep their spelling.** Each label shows the name as typed.
- **The Net takes one canonical spelling.** The normal order still decides first: a Power symbol beats a Global label, which beats a Net label. Within the winning kind, the spelling used by the most labels wins, then the alphabetically first. Exports and the Board use that name.
- **Spellings are corrected as you type.** When a name typed for a new or renamed label matches an existing Net apart from case, the name box (and the inspector) uses the existing spelling and says so in a short message. Mixed spellings therefore only arise from imports or hand-edited files.
- **Mixed spellings are an ERC warning (#11),** not an error: "+3v3 and +3V3 are the same net; use one spelling". The netlist reports them on each Net (`spellings`).
- **Same-name local Nets on different Sheets** stay separate as before. They are qualified with the Sheet name (`Sheet 1/EN`) when names collide regardless of case.
- **Importers warn** when a foreign design (KiCad is case-sensitive) has Nets whose names differ only by case, because they merge here.

Matching uses `toLowerCase()` on the trimmed name. It is locale-independent, so `İ`/`ı` are not special-cased; net names are almost always ASCII.

## Considered Options

- **Case-sensitive, like KiCad:** rejected. A one-letter typo silently splits a Net, and nothing on the schematic shows it.
- **Upper-case every name, like Eagle:** rejected. It rewrites what the user typed, and lower-case letters carry meaning in names like `nRESET` or `+3V3_mcu`.
- **Case-sensitive plus an ERC warning only:** rejected. Warnings are easy to miss, and the safe behaviour should be the default rather than something the user has to check for.
