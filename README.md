# Mecademic `.mxprog` for VS Code

Language support for Mecademic robot programs: syntax highlighting, hovers,
completion, signature help and validation.

The instruction set is generated from the
[Meca500 programming manual](https://resources.mecademic.com/en/doc/MC-PM-MECA500/latest/manual/index.html),
firmware **11.3** — 164 commands across the manual's eight categories.

## Features

| Feature | Behaviour |
| --- | --- |
| Highlighting | Instruction names, numbers, quoted strings, bare names, comments, the silent `-` prefix |
| Hover | Description, parameters with units and ranges, remarks, example, link to the manual |
| Completion | Every instruction in the bundled set, with its signature |
| Signature help | Parameter-by-parameter, as you type inside the parentheses |
| Diagnostics | See the table below |

## Diagnostics

| Code | Severity | Raised when |
| --- | --- | --- |
| `unknown-instruction` | warning | The name is absent from the bundled set. Never an error: the set is firmware-versioned and always lags behind the newest release. A name that differs only by case is **not** reported — the robot resolves instruction names in any case, so `SetWRF` and `SetWrf` both reach `SetWrf`. |
| `malformed-line` | error | The line is not a single `Name(arg, arg, ...)` call |
| `arg-count` | error | Too few or too many arguments |
| `not-a-number` | error | A numeric parameter received something that is not a number |
| `scientific-notation` | error | A number was written as `1e3`; the robot only accepts plain decimals |
| `expected-int` | error | An integer parameter received a fractional value |
| `expected-bool` | error | A boolean parameter received something other than `0` or `1` |
| `not-a-value` | error | An argument is neither a number, a bare word nor a quoted string — typically a bare word carrying punctuation, which must be quoted |
| `unterminated-string` | error | A quoted argument is never closed |
| `mixed-argument-kinds` | error | A repeatable code-or-name parameter received both numeric codes and names in one call |
| `empty-argument` | error | An argument slot is empty |
| `out-of-range` | warning | A value falls outside the range documented for that parameter |
| `invalid-value` | warning | A value is outside the discrete set documented for that parameter |

Range and value-set checks are warnings on purpose: the bundled set may be
missing bounds the manual does not state, and it trails the newest firmware.

## Value kinds and highlighting

The robot accepts three kinds of argument, and each gets its own scope so they
are told apart at a glance:

| Kind | Written as | Scope |
| --- | --- | --- |
| Number | `180`, `-101.740000` | `constant.numeric.mxprog` |
| Quoted string | `"my-robot"`, `'my-robot'` | `string.quoted.double.mxprog` / `.single.` |
| Bare name | `TargetCartPos`, `All`, `my.variable` | `support.constant.mxprog` |
| Instruction | `MoveLin` | `support.function.instruction.mxprog` |
| Silent prefix | the `-` in `-MoveLin(…)` | `keyword.operator.silent.mxprog` |

An instruction that is *not* in the bundled set stays unscoped, which makes an
unrecognised name visible before you even read the warning.

Quoting is optional. The manual documents no quoting rule and real MecaPortal
files use bare words — `StartProgram(1)` — so a bare word is accepted wherever a
string is expected. It only *has* to be quoted when it carries punctuation,
a space or a comma, which would otherwise be unparsable.

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
| `name` | yes | Exactly as the manual spells it. Lookup ignores case, so this is the canonical spelling shown in hovers and completion, not a constraint on what users may type |
| `category` | yes | The manual's category, e.g. `Motion` |
| `description` | yes | One imperative sentence |
| `params` | yes | May be empty |
| `params[].name` | yes | As printed in the manual's Syntax block, Greek letters included (`θ1`, `α`, `ẋ`) |
| `params[].type` | yes | `number`, `int`, `bool`, `string`, or `code-or-name` for a data set given either as a numeric code or by name |
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
