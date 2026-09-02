# Mecademic `.mxprog` for VS Code

Language support for Mecademic robot programs: syntax highlighting, hovers,
completion, signature help and validation.

The instruction set is generated from the
[Meca500 programming manual](https://resources.mecademic.com/en/doc/MC-PM-MECA500/latest/manual/index.html),
firmware **11.3** — 164 commands across the manual's eight categories.

## Features

| Feature | Behaviour |
| --- | --- |
| Highlighting | Instruction names, numbers, comments |
| Hover | Description, parameters with units and ranges, remarks, example, link to the manual |
| Completion | Every instruction in the bundled set, with its signature |
| Signature help | Parameter-by-parameter, as you type inside the parentheses |
| Diagnostics | See the table below |

## Diagnostics

| Code | Severity | Raised when |
| --- | --- | --- |
| `unknown-instruction` | warning | The name is absent from the bundled set. Never an error: the set is firmware-versioned and always lags behind the newest release. When the name differs only by case, the message says so — instruction names are case-sensitive on the robot. |
| `malformed-line` | error | The line is not a single `Name(arg, arg, ...)` call |
| `arg-count` | error | Too few or too many arguments |
| `not-a-number` | error | A numeric parameter received something that is not a number |
| `scientific-notation` | error | A number was written as `1e3`; the robot only accepts plain decimals |
| `expected-int` | error | An integer parameter received a fractional value |
| `expected-bool` | error | A boolean parameter received something other than `0` or `1` |
| `empty-argument` | error | An argument slot is empty |
| `out-of-range` | warning | A value falls outside the range documented for that parameter |
| `invalid-value` | warning | A value is outside the discrete set documented for that parameter |

Range and value-set checks are warnings on purpose: the bundled set may be
missing bounds the manual does not state, and it trails the newest firmware.

## Settings

| Setting | Default | Effect |
| --- | --- | --- |
| `mecademic.diagnostics.enable` | `true` | Report problems at all |
| `mecademic.diagnostics.unknownInstruction` | `"warning"` | `"off"` silences unknown instructions, useful on a firmware newer than the bundled set |
| `mecademic.diagnostics.rangeChecks` | `true` | Turn off the `out-of-range` and `invalid-value` warnings |

## Instruction schema

`data/instructions.json` is the single source of truth. Everything else derives
from it.

| Field | Required | Notes |
| --- | --- | --- |
| `name` | yes | Case-sensitive, exactly as the manual spells it |
| `category` | yes | The manual's category, e.g. `Motion` |
| `description` | yes | One imperative sentence |
| `params` | yes | May be empty |
| `params[].name` | yes | As printed in the manual's Syntax block, Greek letters included (`θ1`, `α`, `ẋ`) |
| `params[].type` | yes | `number`, `int`, `bool` or `string` |
| `params[].description` | yes | |
| `params[].unit` | no | `mm`, `deg`, `mm/s`, `deg/s`, `%`, `s`, `kg` |
| `params[].min` / `max` | no | Omitted when the manual states no bound |
| `params[].values` | no | Discrete allowed values, e.g. `[-1, 1]`. Never combined with `min`/`max` |
| `params[].optional` | no | Optional parameters come last |
| `params[].variadic` | no | The parameter may repeat; only the last one may be variadic |
| `remarks` | no | Rendered as a blockquote in the hover |
| `example` | no | |
| `docUrl` | no | Link to the command's page in the manual |

## Working on the extension

```bash
npm test              # node --test, no dependencies required
npm run build:grammar # regenerate the TextMate grammar after editing the JSON
npm run check:grammar # verify the committed grammar matches (this is what CI runs)
```

Press <kbd>F5</kbd> to open the Extension Development Host, then open
`samples/demo.mxprog`. The first half of that file must produce no diagnostics;
every line in the second half must produce exactly one.

### Regenerating the instruction set

```bash
npm run import:manual          # dry run, prints what still needs review
npm run import:manual -- --write
npm run build:grammar
```

The pipeline has three files:

- `data/manual-extract.json` — a verbatim scrape of the manual, committed so the
  import is reproducible offline.
- `data/manual-overrides.json` — hand-verified corrections, merged over whatever
  the importer infers. **The manual is not machine-clean**: `SetCartAngVel`
  documents its syntax as `SetCartAngAcc(ω)`, `GetCollisionStatus` is printed
  without parentheses, `ActivateRobot` has no syntax block at all, and
  `SetJointVel`'s upper bound depends on whether the robot is an R3 or an R4.
  Anything the importer cannot read confidently is listed in its review report
  and belongs here, checked by a human, before it is committed.
- `scripts/import-manual.js` — the interpretation, which is the part worth
  testing.

Refreshing `data/manual-extract.json` needs a real browser: the documentation
site rejects `curl` and Node with HTTP 403.
