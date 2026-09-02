'use strict';

const test = require('node:test');
const assert = require('node:assert');

const { buildGrammar, render, orderForAlternation } = require('../scripts/generate-grammar');

const data = {
  firmware: '0.0-fixture',
  instructions: [
    { name: 'MoveLin', params: [] },
    { name: 'MoveLinRelTrf', params: [] },
    { name: 'Delay', params: [] }
  ]
};

test('longer names come first so prefixes do not shadow them', () => {
  assert.deepEqual(orderForAlternation(['MoveLin', 'MoveLinRelTrf', 'Delay']), [
    'MoveLinRelTrf',
    'MoveLin',
    'Delay'
  ]);
});

test('names of equal length are ordered alphabetically for stable output', () => {
  assert.deepEqual(orderForAlternation(['SetWrf', 'SetTrf']), ['SetTrf', 'SetWrf']);
});

test('output is deterministic', () => {
  assert.equal(render(data), render(data));
  assert.equal(render(data), render(JSON.parse(JSON.stringify(data))));
});

test('the instruction pattern only matches a name followed by a parenthesis', () => {
  const { repository } = buildGrammar(data);
  // Oniguruma's inline (?i:…) is not valid in JavaScript; check the JS form.
  const re = new RegExp(repository.instruction.match.replace('(?i:', '(?:'), 'i');
  assert.ok(re.test('MoveLin(0,0)'));
  assert.ok(re.test('MoveLinRelTrf(0,0)'));
  assert.ok(!re.test('MoveLin 0,0'));
  assert.ok(!re.test('// MoveLin is mentioned in prose'));
});

test('highlighting is case-insensitive, matching how the robot resolves names', () => {
  const { repository } = buildGrammar(data);
  assert.match(repository.instruction.match, /\(\?i:/);
});

test('an empty instruction set still produces a usable grammar', () => {
  const grammar = buildGrammar({ firmware: '11.3', instructions: [] });
  assert.equal(grammar.scopeName, 'source.mxprog');
  assert.ok(grammar.repository.comment);
  assert.ok(!grammar.repository.instruction);
});

test('each kind of value gets its own scope', () => {
  const { repository } = buildGrammar(data);
  assert.ok(repository.string, 'quoted strings');
  assert.ok(repository.number, 'numbers');
  assert.ok(repository.name, 'bare names such as TargetCartPos');
  assert.ok(repository.silent, 'the silent-mode dash');

  const scopes = [
    repository.string.patterns[0].name,
    repository.string.patterns[1].name,
    repository.number.name,
    repository.name.name,
    repository.silent.name,
    repository.instruction.name
  ];
  assert.equal(new Set(scopes).size, scopes.length, 'scopes must be distinguishable');
});

test('a bare name is not scoped when it is really a call', () => {
  const { repository } = buildGrammar(data);
  const re = new RegExp(repository.name.match);
  assert.ok(re.test('TargetCartPos'));
  assert.ok(re.test('my.variable'));
  assert.ok(!re.test('Unknown('), 'a name followed by "(" is a call, not a value');
});

test('the silent dash is only recognised at the start of a line', () => {
  const { repository } = buildGrammar(data);
  const re = new RegExp(repository.silent.match);
  assert.ok(re.test('-MoveLin(0,0,0,0,0,0)'));
  assert.ok(re.test('  -Home()'));
  assert.ok(!re.test('MoveLin(-1,0,0,0,0,0)'), 'a negative number is not a silent prefix');
});
