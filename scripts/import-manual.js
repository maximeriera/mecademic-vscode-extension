'use strict';

// Turns data/manual-extract.json into a draft data/instructions.json.
//
// The extract is a verbatim scrape of the online programming manual; refreshing
// it needs a real browser, because the site rejects curl and Node (see README).
// This script does the interpretation, which is the part worth versioning and
// testing: signatures into parameters, prose into units, ranges and types.
//
// Its output is a DRAFT. The manual contains mistakes — SetCartAngVel documents
// its syntax as "SetCartAngAcc(ω)" — so every entry it cannot infer with
// confidence is listed in the review report and must be checked by a human
// before being committed. See CLAUDE.md: a wrong hover is worse than a missing
// one. Run with --write to overwrite data/instructions.json.

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const EXTRACT = path.join(ROOT, 'data', 'manual-extract.json');
const OVERRIDES = path.join(ROOT, 'data', 'manual-overrides.json');
const TARGET = path.join(ROOT, 'data', 'instructions.json');

const CATEGORIES = {
  motion_commands: 'Motion',
  configuration_commands: 'Configuration',
  control_commands: 'Robot control',
  data_request_commands: 'Data request',
  'rt-data_commands': 'Real-time data request',
  workzone_commands: 'Work zone',
  accessories_commands: 'Accessory',
  variables_management_commands: 'Variable management'
};

// Longest first: "in mm/s" must not be read as "in mm".
const UNITS = [
  [/\bin mm\/s\b|\bin millimeters per second\b/i, 'mm/s'],
  [/\bin °\/s\b|\bin degrees per second\b/i, 'deg/s'],
  [/\bin mm\b|\bin millimeters\b/i, 'mm'],
  [/\bin degrees\b|\bin °\b/i, 'deg'],
  [/\bin seconds\b/i, 's'],
  [/\bin kilograms\b|\bin kg\b/i, 'kg'],
  [/\bpercentage\b|\bpercent\b/i, '%']
];

/** The manual writes minus as U+2212 and groups thousands with commas. */
function toNumber(raw) {
  const cleaned = String(raw).replace(/−/g, '-').replace(/,(?=\d{3}\b)/g, '');
  const value = Number(cleaned);
  return Number.isFinite(value) ? value : null;
}

// Note the thousands group: "8,000," must not swallow its trailing comma.
const N = '[\\u2212+-]?(?:\\d{1,3}(?:,\\d{3})+|\\d+)(?:\\.\\d+)?';

function extractRange(rawProse) {
  // "from 0 (blending disabled) to 100" — a parenthetical must not break the
  // bounds apart. Stripped only for matching; the description keeps it.
  const prose = rawProse.replace(/\([^)]*\)/g, ' ');
  const patterns = [
    new RegExp(`ranging\\s+from\\s+(${N})\\s+to\\s+(${N})`, 'i'),
    new RegExp(`between\\s+(${N})\\s+and\\s+(${N})`, 'i'),
    new RegExp(`from\\s+(${N})\\s+to\\s+(${N})`, 'i')
  ];

  for (const pattern of patterns) {
    const match = pattern.exec(prose);
    if (!match) continue;
    const min = toNumber(match[1]);
    const max = toNumber(match[2]);
    if (min === null || max === null) continue;
    return { min: Math.min(min, max), max: Math.max(min, max) };
  }
  return null;
}

function extractUnit(prose) {
  for (const [pattern, unit] of UNITS) {
    if (pattern.test(prose)) return unit;
  }
  return null;
}

/** "either -1 or 1" documents two allowed values, not a range that permits 0. */
function extractValues(prose) {
  const match = new RegExp(`either\\s+(${N})\\s+or\\s+(${N})`, 'i').exec(prose);
  if (!match) return null;
  const values = [toNumber(match[1]), toNumber(match[2])];
  return values.every((v) => v !== null) ? values.sort((a, b) => a - b) : null;
}

function extractType(prose) {
  if (/\bstring\b|\ba text string\b/i.test(prose)) return 'string';
  if (/enabled \(1\)|disabled \(0\)|\(1\)\s*or\s*[^.]*\(0\)/i.test(prose)) return 'bool';
  if (/\binteger\b|\bwhole number\b/i.test(prose)) return 'int';
  return 'number';
}

/** Parameter names as written between the parentheses of the Syntax block. */
function parseSyntax(syntax) {
  const match = /^[A-Za-z]\w*\s*\(([^)]*)\)/.exec(syntax || '');
  if (!match) return null;
  const inner = match[1].trim();
  if (!inner) return [];
  return inner.split(',').map((s) => s.trim()).filter(Boolean);
}

/**
 * Attach each Arguments bullet to the parameters it describes. A bullet either
 * names them ("x, y, z: ... in mm") or names none, in which case it describes
 * every parameter ("the target position of each joint, in degrees").
 */
function proseByParameter(names, bullets) {
  const prose = new Map();
  const unnamed = [];

  for (const bullet of bullets) {
    const clean = bullet.replace(/^#\s*/, '').trim();
    const colon = clean.indexOf(':');
    const head = colon === -1 ? '' : clean.slice(0, colon);
    const body = colon === -1 ? clean : clean.slice(colon + 1).trim();
    const mentioned = head
      .replace(/\([^)]*\)/g, '')
      .split(/,|\band\b/)
      .map((s) => s.trim())
      .filter((s) => names.includes(s));

    if (mentioned.length) {
      for (const name of mentioned) {
        prose.set(name, body);
      }
    } else {
      unnamed.push(clean);
    }
  }

  if (unnamed.length) {
    for (const name of names) {
      if (!prose.has(name)) prose.set(name, unnamed.join(' '));
    }
  }

  return prose;
}

const VERBS = {
  is: null,
  are: null,
  has: null,
  have: null,
  can: null,
  will: null
};

/** "This command sets the ..." -> "Set the ...". Returns null when unsure. */
function toImperative(sentence) {
  const stripped = sentence.replace(/^This\s+(?:[\w-]+\s+){0,2}command\s+/i, '');
  if (stripped === sentence) return null;

  // "is/are used to <verb>" hides the real verb one clause further in.
  const used = /^(?:is|are)\s+used\s+to\s+([a-z]+)\s/.exec(stripped);
  if (used) {
    const rest = stripped.slice(used[0].length - 1).trimStart();
    return used[1].charAt(0).toUpperCase() + used[1].slice(1) + ' ' + rest;
  }

  const match = /^([A-Za-z]+)(?:(\/)|\s+or\s+)([A-Za-z]+)?\s|^([A-Za-z]+)\s/.exec(stripped);
  if (!match) return null;

  const singular = (verb) => {
    const lower = verb.toLowerCase();
    if (Object.prototype.hasOwnProperty.call(VERBS, lower)) return VERBS[lower];
    if (/ies$/.test(lower)) return lower.slice(0, -3) + 'y';
    if (/(ss|sh|ch|x|z|o)es$/.test(lower)) return lower.slice(0, -2);
    if (/s$/.test(lower)) return lower.slice(0, -1);
    return null;
  };

  const first = singular(match[1] || match[4]);
  if (!first) return null;

  let verb = first;
  if (match[3]) {
    const second = singular(match[3]);
    if (!second) return null;
    verb = `${first} or ${second}`;
  }

  const rest = stripped.slice(match[0].length - 1).trimStart();
  return verb.charAt(0).toUpperCase() + verb.slice(1) + ' ' + rest;
}

function firstSentence(paragraph) {
  if (!paragraph) return null;
  const probe = paragraph.replace(/(e\.g|i\.e|etc|vs|Fig|Sec|approx|No)\./g, '$1_');
  const cut = probe.search(/\.\s/);
  return cut > 0 ? paragraph.slice(0, cut + 1) : paragraph;
}

function convert(command) {
  const review = [];
  const category = CATEGORIES[command.category] || command.category;

  for (const warning of command.warnings || []) {
    review.push(warning);
  }

  const names = parseSyntax(command.syntax && command.syntax[0]);
  if (names === null) {
    review.push('could not read the syntax block; parameters left empty');
  }

  const declared = names || [];
  const variadic = declared.some((n) => /^[.\u2026]+$/.test(n));
  const effective = declared.filter((n) => !/^[.\u2026]+$/.test(n));

  const prose = proseByParameter(effective, command.args || []);
  const params = effective.map((name, index) => {
    const description = prose.get(name);
    if (!description) {
      review.push(`parameter "${name}" has no description in the Arguments section`);
    }
    const text = description || '';
    const type = extractType(text);
    const tidy = description
      ? description.charAt(0).toUpperCase() + description.slice(1).replace(/;$/, '.')
      : '';
    const param = { name, type, description: tidy };

    if (type !== 'string') {
      const unit = extractUnit(text);
      if (unit) param.unit = unit;

      const values = extractValues(text);
      if (values) {
        param.values = values;
      } else {
        const range = extractRange(text);
        if (range) {
          param.min = range.min;
          param.max = range.max;
        }
      }
    }

    if (/optional/i.test(text)) param.optional = true;
    if (variadic && index === effective.length - 1) param.variadic = true;
    const bounded = param.min !== undefined || Array.isArray(param.values);
    if (bounded && /\bR3\b|\bR4\b|depends on|depending on/i.test(text)) {
      review.push(`parameter "${name}" has a model-dependent range; verify min/max`);
    }
    return param;
  });

  const paragraphs = (command.paragraphs || []).filter(Boolean);
  let sentence = null;
  let imperative = null;
  for (const paragraph of paragraphs) {
    const candidate = firstSentence(paragraph);
    if (!candidate) continue;
    if (!sentence) sentence = candidate;
    imperative = toImperative(candidate);
    if (imperative) break;
  }
  if (!imperative) {
    review.push('description could not be rewritten as an imperative sentence');
  }

  const instruction = {
    name: command.name,
    category,
    description: imperative || sentence || '',
    params
  };

  if (command.docUrl) instruction.docUrl = command.docUrl;

  return { instruction, review };
}

/** Hand-verified fields win over anything inferred from the manual's prose. */
function applyOverride(instruction, override) {
  if (!override) return instruction;
  return Object.assign({}, instruction, override);
}

function main() {
  const extract = JSON.parse(fs.readFileSync(EXTRACT, 'utf8'));
  const overrides = JSON.parse(fs.readFileSync(OVERRIDES, 'utf8'));
  const instructions = [];
  const report = [];
  const unused = new Set(Object.keys(overrides).filter((k) => !k.startsWith('$')));

  for (const command of extract.commands) {
    const { instruction, review } = convert(command);
    const override = overrides[command.name];
    unused.delete(command.name);
    instructions.push(applyOverride(instruction, override));
    if (review.length && !override) report.push({ name: command.name, review });
  }

  if (unused.size) {
    console.error(`Overrides that match no instruction: ${[...unused].join(', ')}`);
    process.exitCode = 1;
  }

  instructions.sort((a, b) => a.name.localeCompare(b.name, 'en'));

  const payload = {
    firmware: extract.firmware,
    source: extract.source,
    retrieved: extract.retrieved,
    instructions
  };

  const json = JSON.stringify(payload, null, 2) + '\n';

  if (process.argv.includes('--write')) {
    fs.writeFileSync(TARGET, json);
    console.log(`Wrote ${path.relative(ROOT, TARGET)} with ${instructions.length} instructions.`);
  } else {
    console.log(`Dry run: ${instructions.length} instructions (pass --write to save).`);
  }

  console.log(`\n${report.length} of ${instructions.length} entries still need review (${Object.keys(overrides).length - 1} covered by data/manual-overrides.json):`);
  for (const entry of report) {
    console.log(`  ${entry.name}: ${entry.review.join('; ')}`);
  }
}

if (require.main === module) {
  main();
}

module.exports = { convert, applyOverride, parseSyntax, proseByParameter, extractRange, extractValues, extractUnit, extractType, toImperative, toNumber };
