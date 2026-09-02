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
  const re = new RegExp(repository.instruction.match);
  assert.ok(re.test('MoveLin(0,0)'));
  assert.ok(re.test('MoveLinRelTrf(0,0)'));
  assert.ok(!re.test('MoveLin 0,0'));
  assert.ok(!re.test('// MoveLin is mentioned in prose'));
});

test('an empty instruction set still produces a usable grammar', () => {
  const grammar = buildGrammar({ firmware: '11.3', instructions: [] });
  assert.equal(grammar.scopeName, 'source.mxprog');
  assert.ok(grammar.repository.comment);
  assert.ok(!grammar.repository.instruction);
});
