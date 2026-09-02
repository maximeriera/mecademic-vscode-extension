'use strict';

// CLAUDE.md: the pure modules must stay loadable without an editor. If this
// fails, the new logic belongs in extension.js — extract the decision-making
// part back into a pure function rather than relaxing this test.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const PURE = ['src/instructions.js', 'src/analyze.js', 'scripts/generate-grammar.js'];
const ROOT = path.join(__dirname, '..');

/** Strip comments so that prose about `require('vscode')` is not mistaken for a call. */
function code(file) {
  return fs
    .readFileSync(path.join(ROOT, file), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

for (const file of PURE) {
  test(`${file} does not reference the vscode API`, () => {
    assert.doesNotMatch(code(file), /require\(\s*['"]vscode['"]\s*\)/);
  });
}

test('the pure modules load in plain node', () => {
  for (const file of PURE) {
    assert.doesNotThrow(() => require(path.join(ROOT, file)), file);
  }
});

test('extension.js is the only module that requires vscode', () => {
  assert.match(code('src/extension.js'), /require\('vscode'\)/);
});
