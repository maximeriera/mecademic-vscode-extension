'use strict';

// Line parsing and validation for .mxprog files.
// Returns plain objects with offsets; the caller turns them into editor ranges.
// This module must never require('vscode') — see CLAUDE.md.

const { resolveInstruction, buildSignature, arity, parameterAt } = require('./instructions');

const COMMENT_TOKEN = '//';

// A call is the whole line: one instruction, its arguments, nothing else.
const CALL_RE = /^(\s*)([A-Za-z_][A-Za-z0-9_]*)\s*\(([^()]*)\)\s*$/;

// Plain decimals only. MecaPortal writes numbers like "4.300000" and
// "-101.740000"; scientific notation is not accepted by the robot.
const NUMBER_RE = /^[+-]?(?:\d+(?:\.\d+)?|\.\d+)$/;
const SCIENTIFIC_RE = /^[+-]?(?:\d+(?:\.\d+)?|\.\d+)[eE][+-]?\d+$/;

const ERROR = 'error';
const WARNING = 'warning';

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
  const commentStart = text.indexOf(COMMENT_TOKEN);
  if (commentStart === -1) {
    return { code: text, commentStart: -1 };
  }
  return { code: text.slice(0, commentStart), commentStart };
}

function splitArguments(inner, innerStart) {
  if (!inner.trim()) {
    return [];
  }

  const args = [];
  let cursor = 0;

  for (const piece of inner.split(',')) {
    const leading = piece.length - piece.trimStart().length;
    const value = piece.trim();
    const start = innerStart + cursor + leading;
    args.push({ text: value, start, end: start + value.length });
    cursor += piece.length + 1; // + 1 for the comma that was consumed
  }

  return args;
}

/**
 * Classify a single line.
 * kind is one of: 'empty', 'comment', 'call', 'malformed'.
 */
function parseLine(text) {
  const { code, commentStart } = splitComment(text);

  if (!code.trim()) {
    return { kind: commentStart === -1 ? 'empty' : 'comment' };
  }

  const match = CALL_RE.exec(code);
  if (!match) {
    const start = code.length - code.trimStart().length;
    const end = code.trimEnd().length;
    return { kind: 'malformed', start, end };
  }

  const [, indent, name, inner] = match;
  const nameStart = indent.length;
  const innerStart = code.indexOf('(', nameStart) + 1;

  return {
    kind: 'call',
    name,
    nameStart,
    nameEnd: nameStart + name.length,
    args: splitArguments(inner, innerStart),
    start: nameStart,
    end: code.trimEnd().length
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

  // A string argument is free text; the manual documents length and character
  // limits in prose only, so we deliberately check nothing beyond emptiness.
  if (param.type === 'string') {
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
  analyzeLine,
  analyzeDocument,
  NUMBER_RE,
  COMMENT_TOKEN
};
