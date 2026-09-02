'use strict';

// Loading, lookup and presentation of the instruction set.
// This module must never require('vscode') — see CLAUDE.md.

const fs = require('fs');
const path = require('path');

const DEFAULT_PATH = path.join(__dirname, '..', 'data', 'instructions.json');

/**
 * Build an instruction set from an already-parsed object. Kept separate from
 * loadInstructionSet so tests can work without touching the filesystem.
 */
function createInstructionSet(data) {
  const instructions = Array.isArray(data && data.instructions) ? data.instructions : [];
  const byName = new Map();
  const byLowerName = new Map();

  for (const instruction of instructions) {
    byName.set(instruction.name, instruction);
    // Instruction names are case-sensitive on the robot, so this second index
    // is only ever used to suggest the correct spelling, never to resolve.
    const lower = instruction.name.toLowerCase();
    if (!byLowerName.has(lower)) {
      byLowerName.set(lower, instruction);
    }
  }

  return {
    firmware: (data && data.firmware) || 'unknown',
    instructions,
    byName,
    byLowerName
  };
}

function loadInstructionSet(filePath) {
  const target = filePath || DEFAULT_PATH;
  return createInstructionSet(JSON.parse(fs.readFileSync(target, 'utf8')));
}

/** Exact, case-sensitive lookup. This is the only way to resolve an instruction. */
function findInstruction(set, name) {
  return set.byName.get(name) || null;
}

/**
 * Find an instruction that differs from `name` only by case. Used to turn
 * "unknown instruction" into an actionable message; never used to accept the
 * misspelling.
 */
function findCasingMatch(set, name) {
  const match = set.byLowerName.get(String(name).toLowerCase());
  return match && match.name !== name ? match : null;
}

function formatParameter(param) {
  const bits = [param.name, param.optional ? '?' : '', ': ', param.type];
  if (param.unit) {
    bits.push(' ', param.unit);
  }
  if (param.variadic) {
    bits.push('...');
  }
  return bits.join('');
}

/**
 * How many arguments a call may carry. A variadic parameter may repeat, so it
 * lifts the upper bound; it still counts once towards the lower bound unless
 * it is also optional.
 */
function arity(instruction) {
  const required = instruction.params.filter((p) => !p.optional).length;
  const variadic = instruction.params.some((p) => p.variadic);
  return { min: required, max: variadic ? Infinity : instruction.params.length };
}

/** The parameter that governs argument `index`, following a variadic tail. */
function parameterAt(instruction, index) {
  if (index < instruction.params.length) {
    return instruction.params[index];
  }
  const last = instruction.params[instruction.params.length - 1];
  return last && last.variadic ? last : null;
}

/** e.g. "MoveLin(x: number mm, y: number mm, …)" */
function buildSignature(instruction) {
  return instruction.name + '(' + instruction.params.map(formatParameter).join(', ') + ')';
}

/** Parameter labels, in order, as they appear inside buildSignature's parentheses. */
function buildParameterLabels(instruction) {
  return instruction.params.map(formatParameter);
}

function formatRange(param) {
  const hasMin = typeof param.min === 'number';
  const hasMax = typeof param.max === 'number';
  if (hasMin && hasMax) return `${param.min} to ${param.max}`;
  if (hasMin) return `${param.min} or more`;
  if (hasMax) return `up to ${param.max}`;
  return null;
}

/** Markdown shown in hovers and completion details. */
function buildDocumentation(instruction) {
  const lines = [];
  lines.push('```mxprog');
  lines.push(buildSignature(instruction));
  lines.push('```');
  lines.push('');
  lines.push(instruction.description);

  if (instruction.params.length) {
    lines.push('');
    for (const param of instruction.params) {
      const range = formatRange(param);
      const suffix = range ? ` _(${range})_` : '';
      lines.push(`- \`${param.name}\` — ${param.description}${suffix}`);
    }
  }

  if (instruction.remarks) {
    lines.push('');
    lines.push('> ' + instruction.remarks.replace(/\n/g, '\n> '));
  }

  if (instruction.example) {
    lines.push('');
    lines.push('```mxprog');
    lines.push(instruction.example);
    lines.push('```');
  }

  if (instruction.docUrl) {
    lines.push('');
    lines.push(`[${instruction.name} in the programming manual](${instruction.docUrl})`);
  }

  return lines.join('\n');
}

module.exports = {
  DEFAULT_PATH,
  createInstructionSet,
  loadInstructionSet,
  findInstruction,
  findCasingMatch,
  buildSignature,
  buildParameterLabels,
  buildDocumentation,
  formatRange,
  arity,
  parameterAt
};
