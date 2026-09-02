'use strict';

// Schema-only checks on the instruction set we actually ship. Deliberately
// makes no assertion about which instructions exist or what their limits are —
// that content is reconciled against the programming manual, not against tests.

const test = require('node:test');
const assert = require('node:assert');

const { loadInstructionSet } = require('../src/instructions');
const { buildSignature, buildDocumentation } = require('../src/instructions');

const set = loadInstructionSet();
const TYPES = new Set(['number', 'int', 'bool', 'string']);

test('declares the firmware version it was written for', () => {
  assert.match(set.firmware, /^\d+\.\d+/);
});

test('instruction names are unique', () => {
  const names = set.instructions.map((i) => i.name);
  assert.equal(new Set(names).size, names.length);
});

test('every instruction has the required fields', () => {
  for (const instruction of set.instructions) {
    assert.match(instruction.name, /^[A-Za-z][A-Za-z0-9_]*$/, `${instruction.name}: name`);
    assert.ok(instruction.category, `${instruction.name}: category`);
    assert.ok(instruction.description, `${instruction.name}: description`);
    assert.ok(Array.isArray(instruction.params), `${instruction.name}: params`);
  }
});

test('every parameter has a known type and a description', () => {
  for (const instruction of set.instructions) {
    for (const param of instruction.params) {
      assert.ok(param.name, `${instruction.name}: parameter without a name`);
      assert.ok(TYPES.has(param.type), `${instruction.name}.${param.name}: unknown type ${param.type}`);
      assert.ok(param.description, `${instruction.name}.${param.name}: description`);
    }
  }
});

test('a parameter uses either a range or a value set, never both', () => {
  for (const instruction of set.instructions) {
    for (const param of instruction.params) {
      if (Array.isArray(param.values)) {
        assert.ok(param.values.length > 1, `${instruction.name}.${param.name}: values`);
        assert.equal(param.min, undefined, `${instruction.name}.${param.name}: values with min`);
        assert.equal(param.max, undefined, `${instruction.name}.${param.name}: values with max`);
      }
      if (param.type === 'string') {
        assert.equal(param.unit, undefined, `${instruction.name}.${param.name}: string with a unit`);
      }
    }
  }
});

test('optional parameters come last', () => {
  for (const instruction of set.instructions) {
    const firstOptional = instruction.params.findIndex((p) => p.optional);
    if (firstOptional === -1) continue;
    for (const param of instruction.params.slice(firstOptional)) {
      assert.ok(param.optional, `${instruction.name}: ${param.name} follows an optional parameter`);
    }
  }
});

test('documented bounds are coherent', () => {
  for (const instruction of set.instructions) {
    for (const param of instruction.params) {
      for (const bound of ['min', 'max']) {
        if (param[bound] !== undefined) {
          assert.equal(typeof param[bound], 'number', `${instruction.name}.${param.name}: ${bound}`);
        }
      }
      if (typeof param.min === 'number' && typeof param.max === 'number') {
        assert.ok(param.min <= param.max, `${instruction.name}.${param.name}: min above max`);
      }
    }
  }
});

test('every instruction renders a signature and documentation', () => {
  for (const instruction of set.instructions) {
    assert.ok(buildSignature(instruction).startsWith(instruction.name + '('));
    assert.ok(buildDocumentation(instruction).includes(instruction.description));
  }
});
