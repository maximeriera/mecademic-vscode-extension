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
  const patterns = [{ include: '#comment' }, { include: '#silent' }];
  const repository = {
    comment: {
      patterns: [
        { name: 'comment.line.double-slash.mxprog', match: '//.*$' },
        // begin/end rather than match: a block comment spans lines.
        { name: 'comment.block.mxprog', begin: '/\\*', end: '\\*/' }
      ]
    },
    // "-MoveLin(…)" asks the robot to run the command without logging it.
    silent: {
      name: 'keyword.operator.silent.mxprog',
      match: '^\\s*-(?=\\s*[A-Za-z_])'
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

  patterns.push(
    { include: '#variable' },
    { include: '#string' },
    { include: '#number' },
    { include: '#boolean' },
    { include: '#name' },
    { include: '#punctuation' }
  );

  // One scope per kind of value the robot accepts, so they are told apart at
  // a glance: quoted text, numbers, and bare names such as TargetCartPos.
  // A robot variable used as an argument: vars.myGroup.myVar, or
  // *vars.myGroup.myArray, where the asterisk unrolls the array into
  // individual arguments. Listed before #name so the whole dotted path is
  // scoped as one variable rather than a bare value.
  repository.variable = {
    match: '(\\*)?\\b(vars(?:\\.[A-Za-z_][A-Za-z0-9_]*)+)\\b',
    captures: {
      1: { name: 'keyword.operator.unroll.mxprog' },
      2: { name: 'variable.other.mxprog' }
    }
  };
  repository.boolean = {
    name: 'constant.language.boolean.mxprog',
    match: '\\b(?:true|false)\\b'
  };
  repository.string = {
    patterns: [
      {
        name: 'string.quoted.double.mxprog',
        begin: '"',
        end: '"',
        patterns: [{ name: 'constant.character.escape.mxprog', match: '\\\\.' }]
      },
      {
        name: 'string.quoted.single.mxprog',
        begin: "'",
        end: "'",
        patterns: [{ name: 'constant.character.escape.mxprog', match: '\\\\.' }]
      }
    ]
  };
  repository.number = {
    name: 'constant.numeric.mxprog',
    match: '[-+]?(?:\\d+(?:\\.\\d+)?|\\.\\d+)'
  };
  // A bare word used as a value. The negative lookahead keeps an unrecognised
  // instruction unscoped, which is a useful hint that it is not in the set.
  repository.name = {
    name: 'support.constant.mxprog',
    match: '\\b[A-Za-z_][A-Za-z0-9_]*(?:\\.[A-Za-z_][A-Za-z0-9_]*)*\\b(?!\\s*\\()'
  };
  repository.punctuation = {
    patterns: [
      { name: 'punctuation.section.parens.mxprog', match: '[()]' },
      { name: 'punctuation.section.brackets.mxprog', match: '[\\[\\]]' },
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
