# An Excel date in a Household answer reaches the prompt as "46265.83"

**Filed** 2026-09-28, from the backlog reconciliation.

**Status:** OPEN.

**Severity:** low-medium — the model reads a nonsense number where the
household wrote a date.

---

## The problem

[src/lib/templateParser.ts](../../src/lib/templateParser.ts) reads sheets with
`XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null })` (around line
131): raw cell values. A Household answer cell formatted as a date is stored
by Excel as a serial number, so it arrives as e.g. `46265.83`. The Household
loop (from line 339) accepts strings and numbers as answers and coerces the
number to text, and that text goes into the plan prompt.

## The fix

For the Household answer column, read the cell's formatted text (`cell.w`)
rather than its raw value, so a date reads as the household typed it. Keep
the raw read for every numeric column, where the number is the point.
