# CLAUDE.md

VS Code extension providing language support for Mecademic `.mxprog` robot
programs: syntax highlighting, instruction documentation, completion,
signature help and validation.

## The rule that matters most

`data/instructions.json` is the **single source of truth** for the instruction
set. Everything else derives from it.

- Never hardcode an instruction name, parameter name, argument count, unit or
  range anywhere outside that file.
- Never hand-edit `syntaxes/mxprog.tmLanguage.json`. It is generated output —
  run `npm run build:grammar` and commit the result.
- Any new language feature must read the instruction set from that file.

If a task seems to require duplicating instruction data elsewhere, stop and
propose a schema change to `data/instructions.json` instead. Say so explicitly
rather than working around it.

## Architecture

```
online manual ─(browser)─> data/manual-extract.json ─┐
                           data/manual-overrides.json ┴> scripts/import-manual.js ─┐
                                                                                    v
data/instructions.json ──┬─> scripts/generate-grammar.js ─> syntaxes/mxprog.tmLanguage.json
                         └─> src/*.js ─> hover · completion · signature help · diagnostics
```

The import pipeline runs on demand, not on every build. `data/instructions.json`
stays the source of truth for everything downstream.

Target layout — keep the VS Code API at the edges so the core is testable
without an editor:

| File | Role | Imports `vscode`? |
| --- | --- | --- |
| `data/instructions.json` | Instruction set | — |
| `data/manual-extract.json` | Verbatim scrape of the manual, committed for reproducibility | — |
| `data/manual-overrides.json` | Hand-verified corrections merged over the import | — |
| `scripts/import-manual.js` | Manual prose → draft instruction set | No |
| `src/instructions.js` | Loading, lookup, signature/doc string building | No |
| `src/analyze.js` | Line parsing + validation, returns plain objects | No |
| `src/extension.js` | Providers, diagnostics wiring, activation | Yes |
| `scripts/generate-grammar.js` | Grammar generation | No |
| `test/*.test.js` | `node --test` over the pure modules | No |

Pure modules must never `require('vscode')`. If new logic needs it, that logic
belongs in `extension.js`; extract the decision-making part back into a pure
function.

## Instruction schema

```jsonc
{
  "name": "MoveLinRelTrf",
  "category": "Motion",
  "description": "One sentence, imperative, no trailing context.",
  "params": [
    {
      "name": "z",
      "type": "number",      // "number" | "int" | "bool"
      "unit": "mm",
      "min": 0, "max": 100,  // optional, drives range warnings
      "description": "…"
    }
  ],
  "remarks": "Optional gotcha, rendered as a blockquote in the hover.",
  "example": "MoveLinRelTrf(0,0,-50,0,0,0)",
  "docUrl": "https://…"
}
```

When adding fields, update the schema comment here and the README table in the
same commit.

## Commands

```bash
npm run build:grammar   # regenerate the TextMate grammar after editing the JSON
npm test                # node --test, no dependencies required
```

Manual check: open the repo in VS Code, press F5, open `samples/demo.mxprog` in
the Extension Development Host.

Packaging: `vsce package` produces the `.vsix`.

## Conventions

- Plain CommonJS JavaScript. **No runtime dependencies** — this must stay
  installable and runnable without `npm install`. Dev dependencies are fine.
- Node's built-in test runner (`node:test`, `node:assert`). Do not add Jest,
  Mocha or Vitest.
- Two-space indent, single quotes, semicolons.
- One concern per commit. Regenerated grammar goes in the same commit as the
  JSON change that caused it.
- User-facing strings (diagnostics, hovers, command titles) in English.

## Domain notes

- `.mxprog` is the file extension used by Mecademic's MecaPortal web interface
  when saving a program. The instruction set is essentially the robot's TCP/IP
  command set.
- The instruction set is **firmware-versioned**. `data/instructions.json`
  carries a `firmware` field. It will always lag behind the newest release, so
  unknown instructions default to a *warning*, never an error. Do not change
  that default.
- Units matter and are not interchangeable: mm, deg, mm/s, deg/s, %, s, kg.
  Never guess a unit or a range — if it is not in the manual, leave `min`/`max`
  out rather than inventing bounds.
- Reference frames: WRF (world), BRF (base), FRF (flange), TRF (tool). Use
  these acronyms as-is in documentation strings.

## Verified facts about the format

Checked on 2026-09-02 against a real RoboDK-generated `.mxprog` and firmware
11.3 of the programming manual:

- Each line is exactly one `Name(arg, arg, …)` call. **Confirmed.**
- There is **no header block**. A saved program starts straight into content;
  what looks like a header is RoboDK's own `//` comment lines.
- `//` starts a comment. **Confirmed** — RoboDK writes whole-line comments into
  `.mxprog`. Comment handling lives in one function, `splitComment` in
  `src/analyze.js`.
- Instruction names are **case-insensitive**. `SetWRF` and `SetWrf` both work on
  the robot, so a casing-only difference must never be reported as a problem.
  Resolve with `resolveInstruction`, not `findInstruction`. No two instructions
  in firmware 11.3 differ by case alone, so this is unambiguous.
  **Variable** names, by contrast, *are* case-sensitive per the manual.
- Arguments are plain decimals. **Scientific notation is not accepted.**
- A leading dash runs a command silently, without logging it:
  `-MoveLin(208,50,40,0,0,90)`. Documented in section 3.1.3 of the manual.
- Arguments come in three kinds: numbers, quoted strings and bare names such as
  `TargetCartPos`. **Quoting is optional** — the manual states no rule and
  RoboDK writes `StartProgram(1)` bare — so a bare word must be accepted
  wherever a string is expected. Quotes are only required when the value
  carries punctuation, a space or a comma.
- A parameter that takes a data set by numeric code *or* by name accepts one
  flavour or the other, never a mix in the same call.
- The instruction set **does** include variables and program calls:
  `StartProgram`, `SetOfflineProgramLoop`, and a beta
  `CreateVariable` / `SetVariable` / `GetVariable` / `DeleteVariable` /
  `ListVariables` family.

Still unvalidated, flag it if a task depends on it:

- **Trailing comments after a call.** Supported today, but no sample file
  attests to them — RoboDK only ever emits whole-line comments. If MecaPortal
  rejects them, delete the branch in `splitComment` rather than softening the
  rule, so the extension does not accept files the robot will refuse.
- Whether the `Get*` request commands (62 of the 164) are meaningful inside a
  saved program at all, as opposed to over a live TCP/IP connection.

## Definition of done

A change is complete when:

1. `npm test` passes.
2. `npm run build:grammar` was run if `data/instructions.json` changed, and the
   regenerated grammar is committed.
3. The feature was exercised manually via F5 on `samples/demo.mxprog`, and
   `samples/` was extended if the feature needs a new construct to be visible.
4. README is updated if user-facing behaviour or configuration changed.
5. New settings are declared under `contributes.configuration` in
   `package.json` with a default that is safe for an out-of-date instruction set.

## Working style for this repo

- Propose a short plan before multi-file changes; wait for approval.
- Prefer extending `data/instructions.json` over adding code.
- Do not invent Mecademic instruction names, parameters, units or limits. If
  the manual is not available, ask — a wrong hover is worse than a missing one,
  because the user will trust it.
- Keep diffs small. This extension is meant to stay readable by one person.
