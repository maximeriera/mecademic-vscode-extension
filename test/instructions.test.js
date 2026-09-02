'use strict';

const test = require('node:test');
const assert = require('node:assert');
const path = require('path');

const {
  loadInstructionSet,
  createInstructionSet,
  findInstruction,
  resolveInstruction,
  buildSignature,
  buildParameterLabels,
  buildDocumentation
} = require('../src/instructions');

const set = loadInstructionSet(path.join(__dirname, 'fixtures', 'instructions.fixture.json'));

test('exposes the firmware version the set was written for', () => {
  assert.equal(set.firmware, '0.0-fixture');
});

test('lookup is exact and case-sensitive', () => {
  assert.equal(findInstruction(set, 'FixMove').name, 'FixMove');
  assert.equal(findInstruction(set, 'fixmove'), null);
  assert.equal(findInstruction(set, 'FIXMOVE'), null);
  assert.equal(findInstruction(set, 'Nope'), null);
});

test('resolveInstruction accepts any casing, the way the robot does', () => {
  assert.equal(resolveInstruction(set, 'FixMove').name, 'FixMove');
  assert.equal(resolveInstruction(set, 'fixmove').name, 'FixMove');
  assert.equal(resolveInstruction(set, 'FIXMOVE').name, 'FixMove');
  assert.equal(resolveInstruction(set, 'Nope'), null);
});

test('signatures list parameters with their type and unit', () => {
  assert.equal(buildSignature(findInstruction(set, 'FixMove')), 'FixMove(x: number mm, y: number mm)');
  assert.equal(buildSignature(findInstruction(set, 'FixCount')), 'FixCount(n: int)');
  assert.equal(buildSignature(findInstruction(set, 'FixStop')), 'FixStop()');
});

test('parameter labels match the substrings used in the signature', () => {
  const instruction = findInstruction(set, 'FixMove');
  const signature = buildSignature(instruction);
  for (const label of buildParameterLabels(instruction)) {
    assert.ok(signature.includes(label), `signature should contain ${label}`);
  }
});

test('documentation carries description, ranges, remarks, example and link', () => {
  const move = buildDocumentation(findInstruction(set, 'FixMove'));
  assert.match(move, /Move to a position\./);
  assert.match(move, /_\(-100 to 100\)_/);
  assert.match(move, /FixMove\(0,0\)/);
  assert.match(move, /https:\/\/example\.invalid\/FixMove/);

  const count = buildDocumentation(findInstruction(set, 'FixCount'));
  assert.match(count, /^> Only whole numbers are accepted\.$/m);
});

test('documentation omits sections that the instruction does not define', () => {
  const stop = buildDocumentation(findInstruction(set, 'FixStop'));
  assert.doesNotMatch(stop, /^>/m, 'no remarks blockquote');
  assert.doesNotMatch(stop, /\]\(http/, 'no doc link');
});

test('an empty set is usable', () => {
  const empty = createInstructionSet({ firmware: '11.3', instructions: [] });
  assert.equal(findInstruction(empty, 'MoveLin'), null);
  assert.equal(empty.instructions.length, 0);
});

test('optional parameters are marked in the signature and in the arity', () => {
  const { arity } = require('../src/instructions');
  const instruction = findInstruction(set, 'FixOptional');
  assert.equal(buildSignature(instruction), 'FixOptional(e?: bool)');
  assert.deepEqual(arity(instruction), { min: 0, max: 1 });
  assert.deepEqual(arity(findInstruction(set, 'FixMove')), { min: 2, max: 2 });
});
