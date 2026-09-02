'use strict';

// Line parsing and validation for .mxprog files.
// Returns plain objects with offsets; the caller turns them into editor ranges.
// This module must never require('vscode') — see CLAUDE.md.

const { resolveInstruction, buildSignature, arity, parameterAt } = require('./instructions');

const COMMENT_TOKEN = '//';

// Plain decimals only. MecaPortal writes numbers like "4.300000" and
// "-101.740000"; scientific notation is not accepted by the robot.
const NUMBER_RE = /^[+-]?(?:\d+(?:\.\d+)?|\.\d+)$/;
const SCIENTIFIC_RE = /^[+-]?(?:\d+(?:\.\d+)?|\.\d+)[eE][+-]?\d+$/;

// A bare word used as a value: a data-set name such as TargetCartPos, or a
// variable name, which may carry dot-separated prefixes.
const NAME_RE = /^[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*$/;

const QUOTED_RE = /^(?:"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')$/;

// The head of a call: an optional silent-mode dash, then the instruction name.
// The manual documents "-MoveLin(208,50,40,0,0,90)" as a way to keep the
// command out of the robot's event log.
const HEAD_RE = /^(\s*)(-?)\s*([A-Za-z_][A-Za-z0-9_]*)\s*\(/;

const ERROR = 'error';
const WARNING = 'warning';

/**
 * Walk a line, reporting where a quoted string is open at each character.
 * Arguments can be quoted, so neither `//` nor `,` means anything inside one.
 */
function scanQuotes(text, from, to) {
  const states = [];
  let quote = null;
  for (let i = from; i < to; i += 1) {
    const ch = text[i];
    states[i] = quote;
    if (quote) {
      if (ch === '\\') {
        states[i + 1] = quote;
        i += 1;
      } else if (ch === quote) {
        quote = null;
      }
    } else if (ch === '"' || ch === "'") {
      quote = ch;
    }
  }
  return { states, open: quote };
}

/**
 * Split a line into the code part and its trailing comment.
 *
 * Comment support is deliberately confined to this one function. RoboDK writes
 * whole-line `//` comments into .mxprog files, which is how we know they are
 * accepted. Trailing comments after a call are NOT attested anywhere; if
 * MecaPortal turns out to reject them, delete the `commentStart` branch here
 * rather than softening the rule elsewhere — the extension must not accept
 * files the robot will refuse.
 */
function splitComment(text) {
  const { states } = scanQuotes(text, 0, text.length);
  for (let i = 0; i + 1 < text.length; i += 1) {
    if (text[i] === '/' && text[i + 1] === '/' && !states[i]) {
      return { code: text.slice(0, i), commentStart: i };
    }
  }
  return { code: text, commentStart: -1 };
}

/** Split the inside of the parentheses on commas that are not inside quotes. */
function splitArguments(code, innerStart, innerEnd) {
  const inner = code.slice(innerStart, innerEnd);
  if (!inner.trim()) {
    return [];
  }

  const { states } = scanQuotes(code, innerStart, innerEnd);
  const args = [];
  let pieceStart = innerStart;

  const push = (from, to) => {
    let start = from;
    let end = to;
    while (start < end && /\s/.test(code[start])) start += 1;
    while (end > start && /\s/.test(code[end - 1])) end -= 1;
    args.push({ text: code.slice(start, end), start, end });
  };

  for (let i = innerStart; i < innerEnd; i += 1) {
    if (code[i] === ',' && !states[i]) {
      push(pieceStart, i);
      pieceStart = i + 1;
    }
  }
  push(pieceStart, innerEnd);

  return args;
}

/** What flavour of value an argument is written as. */
function argumentKind(text) {
  if (QUOTED_RE.test(text)) return 'string';
  if (NUMBER_RE.test(text)) return 'number';
  if (NAME_RE.test(text)) return 'name';
  return 'invalid';
}

/**
 * Classify a single line.
 * kind is one of: 'empty', 'comment', 'call', 'malformed', 'unterminated-string'.
 */
function parseLine(text) {
  const { code, commentStart } = splitComment(text);

  if (!code.trim()) {
    return { kind: commentStart === -1 ? 'empty' : 'comment' };
  }

  const trimmedEnd = code.trimEnd().length;
  const head = HEAD_RE.exec(code);

  const malformed = () => ({
    kind: 'malformed',
    start: code.length - code.trimStart().length,
    end: trimmedEnd
  });

  if (!head) {
    return malformed();
  }

  const [, indent, dash, name] = head;
  const innerStart = head[0].length;
  const { states, open } = scanQuotes(code, innerStart, code.length);

  if (open) {
    return {
      kind: 'unterminated-string',
      start: code.length - code.trimStart().length,
      end: trimmedEnd
    };
  }

  let closing = -1;
  for (let i = innerStart; i < code.length; i += 1) {
    if (code[i] === ')' && !states[i]) {
      closing = i;
      break;
    }
  }

  // Nothing but whitespace may follow the closing parenthesis.
  if (closing === -1 || code.slice(closing + 1).trim()) {
    return malformed();
  }

  const nameStart = code.indexOf(name, indent.length);

  return {
    kind: 'call',
    name,
    silent: dash === '-',
    nameStart,
    nameEnd: nameStart + name.length,
    args: splitArguments(code, innerStart, closing),
    start: indent.length,
    end: trimmedEnd
  };
}

function checkArgument(arg, param, options) {
  const issues = [];

  if (arg.text === '') {
    issues.push({
      severity: ERROR,
      code: 'empty-argument',
      message: `Argument "${param.name}" is empty.`,
      start: arg.start,
      end: arg.end
    });
    return issues;
  }

  const kind = argumentKind(arg.text);

  // A string argument may be written bare or quoted: the manual documents no
  // quoting rule, and MecaPortal files in the wild use both. Length and
  // character limits are prose-only, so nothing else is checked here.
  if (param.type === 'string') {
    if (kind === 'invalid') {
      issues.push({
        severity: ERROR,
        code: 'not-a-value',
        message: `Argument "${param.name}" is not a valid value; quote it if it contains punctuation.`,
        start: arg.start,
        end: arg.end
      });
    }
    return issues;
  }

  // A data set given either by its numeric code or by its name.
  if (param.type === 'code-or-name') {
    if (kind === 'number' && !Number.isInteger(Number(arg.text))) {
      issues.push({
        severity: ERROR,
        code: 'expected-int',
        message: `Argument "${param.name}" must be a whole code, got "${arg.text}".`,
        start: arg.start,
        end: arg.end
      });
    } else if (kind === 'invalid') {
      issues.push({
        severity: ERROR,
        code: 'not-a-value',
        message: `Argument "${param.name}" must be a numeric code or a name, got "${arg.text}".`,
        start: arg.start,
        end: arg.end
      });
    }
    return issues;
  }

  if (kind === 'string') {
    issues.push({
      severity: ERROR,
      code: 'not-a-number',
      message: `Argument "${param.name}" must be a number, got a quoted string.`,
      start: arg.start,
      end: arg.end
    });
    return issues;
  }

  if (SCIENTIFIC_RE.test(arg.text)) {
    issues.push({
      severity: ERROR,
      code: 'scientific-notation',
      message: `Scientific notation is not accepted; write "${arg.text}" as a plain decimal.`,
      start: arg.start,
      end: arg.end
    });
    return issues;
  }

  if (!NUMBER_RE.test(arg.text)) {
    issues.push({
      severity: ERROR,
      code: 'not-a-number',
      message: `Argument "${param.name}" must be a number, got "${arg.text}".`,
      start: arg.start,
      end: arg.end
    });
    return issues;
  }

  const value = Number(arg.text);

  if (param.type === 'int' && !Number.isInteger(value)) {
    issues.push({
      severity: ERROR,
      code: 'expected-int',
      message: `Argument "${param.name}" must be an integer, got "${arg.text}".`,
      start: arg.start,
      end: arg.end
    });
    return issues;
  }

  if (param.type === 'bool' && value !== 0 && value !== 1) {
    issues.push({
      severity: ERROR,
      code: 'expected-bool',
      message: `Argument "${param.name}" must be 0 or 1, got "${arg.text}".`,
      start: arg.start,
      end: arg.end
    });
    return issues;
  }

  // Ranges and value sets are only warnings: the bundled set may be missing
  // bounds, and it always lags behind the newest firmware.
  if (options.rangeChecks && Array.isArray(param.values)) {
    if (!param.values.includes(value)) {
      issues.push({
        severity: WARNING,
        code: 'invalid-value',
        message: `Argument "${param.name}" should be ${param.values.join(' or ')}.`,
        start: arg.start,
        end: arg.end
      });
    }
    return issues;
  }

  if (options.rangeChecks) {
    const belowMin = typeof param.min === 'number' && value < param.min;
    const aboveMax = typeof param.max === 'number' && value > param.max;
    if (belowMin || aboveMax) {
      const bound = belowMin ? `minimum ${param.min}` : `maximum ${param.max}`;
      issues.push({
        severity: WARNING,
        code: 'out-of-range',
        message: `Argument "${param.name}" is outside its documented range (${bound}${param.unit ? ' ' + param.unit : ''}).`,
        start: arg.start,
        end: arg.end
      });
    }
  }

  return issues;
}

/**
 * A repeatable code-or-name parameter must receive one flavour or the other,
 * never both: SetRealTimeMonitoring(2200, 2201) and
 * SetRealTimeMonitoring(TargetJointPos, TargetCartPos) are both fine, but
 * mixing codes and names in one call is rejected by the robot.
 */
function checkArgumentUniformity(parsed, instruction) {
  const param = instruction.params[instruction.params.length - 1];
  if (!param || !param.variadic || param.type !== 'code-or-name') {
    return [];
  }

  const classify = (text) => (argumentKind(text) === 'number' ? 'code' : 'name');
  const first = parsed.args.length ? classify(parsed.args[0].text) : null;

  return parsed.args
    .filter((arg) => argumentKind(arg.text) !== 'invalid' && classify(arg.text) !== first)
    .map((arg) => ({
      severity: ERROR,
      code: 'mixed-argument-kinds',
      message: `${instruction.name} takes either numeric codes or names, not both in one call.`,
      start: arg.start,
      end: arg.end
    }));
}

function resolveOptions(options) {
  return {
    unknownInstruction: (options && options.unknownInstruction) || WARNING,
    rangeChecks: !options || options.rangeChecks !== false
  };
}

/** Validate one line. Offsets are relative to the start of the line. */
function analyzeLine(text, set, options) {
  const resolved = resolveOptions(options);
  const parsed = parseLine(text);

  if (parsed.kind === 'empty' || parsed.kind === 'comment') {
    return [];
  }

  if (parsed.kind === 'unterminated-string') {
    return [{
      severity: ERROR,
      code: 'unterminated-string',
      message: 'A quoted argument is never closed.',
      start: parsed.start,
      end: parsed.end
    }];
  }

  if (parsed.kind === 'malformed') {
    return [{
      severity: ERROR,
      code: 'malformed-line',
      message: 'Expected a single instruction call of the form Name(arg, arg, ...).',
      start: parsed.start,
      end: parsed.end
    }];
  }

  // The robot accepts any casing, so a name that differs only by case is a
  // valid call, not a mistake: SetWRF and SetWrf both reach SetWrf.
  const instruction = resolveInstruction(set, parsed.name);

  if (!instruction) {
    if (resolved.unknownInstruction === 'off') {
      return [];
    }
    return [{
      severity: WARNING,
      code: 'unknown-instruction',
      message: `Unknown instruction "${parsed.name}". It may belong to a firmware newer than ${set.firmware}.`,
      start: parsed.nameStart,
      end: parsed.nameEnd
    }];
  }

  const { min, max } = arity(instruction);
  if (parsed.args.length < min || parsed.args.length > max) {
    const expected = min === max
      ? `${min} argument${min === 1 ? '' : 's'}`
      : max === Infinity
        ? `at least ${min} argument${min === 1 ? '' : 's'}`
        : `${min} to ${max} arguments`;
    return [{
      severity: ERROR,
      code: 'arg-count',
      message: `${instruction.name} takes ${expected}, got ${parsed.args.length}. Expected ${buildSignature(instruction)}.`,
      start: parsed.start,
      end: parsed.end
    }];
  }

  const issues = [];
  for (let i = 0; i < parsed.args.length; i += 1) {
    issues.push(...checkArgument(parsed.args[i], parameterAt(instruction, i), resolved));
  }
  issues.push(...checkArgumentUniformity(parsed, instruction));
  return issues;
}

/** Validate a whole document. Each issue carries a zero-based `line`. */
function analyzeDocument(text, set, options) {
  const issues = [];
  const lines = text.split(/\r\n|\r|\n/);

  for (let line = 0; line < lines.length; line += 1) {
    for (const issue of analyzeLine(lines[line], set, options)) {
      issues.push(Object.assign({ line }, issue));
    }
  }

  return issues;
}

module.exports = {
  parseLine,
  argumentKind,
  analyzeLine,
  analyzeDocument,
  NUMBER_RE,
  COMMENT_TOKEN
};
