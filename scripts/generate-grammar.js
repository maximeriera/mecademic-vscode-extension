'use strict';

// Generates syntaxes/mxprog.tmLanguage.json from data/instructions.json.
// Never edit the grammar by hand — run `npm run build:grammar` and commit
// the result. `--check` verifies the committed file is up to date, which is
// what CI runs. See CLAUDE.md.

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SOURCE = path.join(ROOT, 'data', 'instructions.json');
const TARGET = path.join(ROOT, 'syntaxes', 'mxprog.tmLanguage.json');

/**
 * Longest name first, then alphabetical. Longest-first keeps the alternation
 * from matching "MoveLin" inside "MoveLinRelTrf"; the alphabetical tiebreak
 * makes the output stable so the CI drift check is meaningful.
 */
function orderForAlternation(names) {
  return [...names].sort((a, b) => b.length - a.length || a.localeCompare(b, 'en'));
}

function buildGrammar(data) {
  const names = orderForAlternation(data.instructions.map((i) => i.name));
  const patterns = [{ include: '#comment' }];
  const repository = {
    comment: {
      name: 'comment.line.double-slash.mxprog',
      match: '//.*$'
    }
  };

  if (names.length) {
    patterns.push({ include: '#instruction' });
    repository.instruction = {
      name: 'support.function.instruction.mxprog',
      // (?i:…): the robot accepts any casing, so highlighting must too.
      match: `\\b(?i:${names.join('|')})\\b(?=\\s*\\()`
    };
  }

  patterns.push({ include: '#number' }, { include: '#punctuation' });

  repository.number = {
    name: 'constant.numeric.mxprog',
    match: '[-+]?(?:\\d+(?:\\.\\d+)?|\\.\\d+)'
  };
  repository.punctuation = {
    patterns: [
      { name: 'punctuation.section.parens.mxprog', match: '[()]' },
      { name: 'punctuation.separator.comma.mxprog', match: ',' }
    ]
  };

  return {
    $schema: 'https://raw.githubusercontent.com/martinring/tmlanguage/master/tmlanguage.json',
    name: 'Mecademic program',
    scopeName: 'source.mxprog',
    fileTypes: ['mxprog'],
    // Recorded so a stale grammar is obvious at a glance in review.
    firmware: data.firmware,
    patterns,
    repository
  };
}

function render(data) {
  return JSON.stringify(buildGrammar(data), null, 2) + '\n';
}

function main() {
  const data = JSON.parse(fs.readFileSync(SOURCE, 'utf8'));
  const generated = render(data);
  const check = process.argv.includes('--check');

  if (!check) {
    fs.writeFileSync(TARGET, generated);
    console.log(`Wrote ${path.relative(ROOT, TARGET)} (${data.instructions.length} instructions, firmware ${data.firmware}).`);
    return;
  }

  const committed = fs.existsSync(TARGET) ? fs.readFileSync(TARGET, 'utf8') : null;
  if (committed === generated) {
    console.log('Grammar is up to date.');
    return;
  }

  console.error(
    `${path.relative(ROOT, TARGET)} does not match data/instructions.json.\n` +
    'Run `npm run build:grammar` and commit the result. Do not edit the grammar by hand.'
  );
  process.exitCode = 1;
}

if (require.main === module) {
  main();
}

module.exports = { buildGrammar, render, orderForAlternation };
