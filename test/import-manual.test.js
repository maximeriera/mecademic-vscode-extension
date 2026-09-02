'use strict';

// The importer is the only place that interprets the manual's prose, and the
// manual is not machine-clean. These tests pin the readings that matter.

const test = require('node:test');
const assert = require('node:assert');

const {
  convert,
  applyOverride,
  parseSyntax,
  proseByParameter,
  extractRange,
  extractValues,
  extractUnit,
  extractType,
  toImperative,
  toNumber
} = require('../scripts/import-manual');

test('numbers survive thousands separators and the manual\'s Unicode minus', () => {
  assert.equal(toNumber('8,000'), 8000);
  assert.equal(toNumber('−1'), -1);
  assert.equal(toNumber('0.001'), 0.001);
  assert.equal(toNumber('nope'), null);
});

test('a range is not swallowed by the comma that follows it', () => {
  assert.deepEqual(
    extractRange('an integer number, ranging from 1 to 8,000, representing the checkpoint number.'),
    { min: 1, max: 8000 }
  );
  assert.deepEqual(extractRange('ranging from 0.001 to 5,000.'), { min: 0.001, max: 5000 });
  assert.deepEqual(extractRange('an integer between −100 and 100.'), { min: -100, max: 100 });
  assert.equal(extractRange('no bounds stated here'), null);
});

test('"either -1 or 1" is a value set, not a range that would allow 0', () => {
  assert.deepEqual(extractValues('shoulder configuration parameter, either −1 or 1.'), [-1, 1]);
  assert.equal(extractValues('ranging from 0 to 100.'), null);
});

test('units are read longest-first so mm/s is not read as mm', () => {
  assert.equal(extractUnit('the linear velocity, in mm/s, ranging from 1 to 2'), 'mm/s');
  assert.equal(extractUnit('the angular velocity, in °/s'), 'deg/s');
  assert.equal(extractUnit('the target position, in mm;'), 'mm');
  assert.equal(extractUnit('Euler angles, in degrees.'), 'deg');
  assert.equal(extractUnit('duration in seconds.'), 's');
  assert.equal(extractUnit('the payload mass, in kilograms.'), 'kg');
  assert.equal(extractUnit('percentage of blending'), '%');
  assert.equal(extractUnit('a bare count'), null);
});

test('types are inferred from the wording the manual uses', () => {
  assert.equal(extractType('string containing the program name.'), 'string');
  assert.equal(extractType('recovery mode enabled (1) or disabled (0).'), 'bool');
  assert.equal(extractType('an integer number, ranging from 1 to 8,000'), 'int');
  assert.equal(extractType('the target position, in mm'), 'number');
});

test('parameter names come from the syntax block', () => {
  assert.deepEqual(parseSyntax('MoveLin(x,y,z,α,β,γ)'), ['x', 'y', 'z', 'α', 'β', 'γ']);
  assert.deepEqual(parseSyntax('ListVariables()'), []);
  assert.equal(parseSyntax('GetCollisionStatus'), null, 'no parentheses means no syntax we can read');
  assert.equal(parseSyntax(''), null);
});

test('a grouped bullet describes every parameter it names', () => {
  const prose = proseByParameter(
    ['x', 'y', 'z'],
    ['x, y, z: the target position for the TRF with respect to the WRF, in mm;']
  );
  assert.equal(prose.get('x'), 'the target position for the TRF with respect to the WRF, in mm;');
  assert.equal(prose.get('z'), prose.get('x'));
});

test('a bullet naming no parameter describes all of them', () => {
  const prose = proseByParameter(['θ1', 'θ2'], ['the target position of each joint, in degrees.']);
  assert.equal(prose.get('θ1'), 'the target position of each joint, in degrees.');
  assert.equal(prose.get('θ2'), prose.get('θ1'));
});

test('a parenthetical in the bullet head does not hide the parameter name', () => {
  const prose = proseByParameter(['cyclicId'], ['cyclicId (optional, 0 by default): the unique ID.']);
  assert.equal(prose.get('cyclicId'), 'the unique ID.');
});

test('descriptions become imperative sentences', () => {
  assert.equal(toImperative('This command sets the pose of the TRF.'), 'Set the pose of the TRF.');
  assert.equal(toImperative('This command returns the current status.'), 'Return the current status.');
  assert.equal(toImperative('This command specifies the velocities.'), 'Specify the velocities.');
  assert.equal(
    toImperative('This command enables or disables blending.'),
    'Enable or disable blending.'
  );
  assert.equal(
    toImperative('This command is used to add a time delay.'),
    'Add a time delay.'
  );
  assert.equal(toImperative('The gripper is homed automatically.'), null, 'no leading "This command"');
});

test('the command name comes from the page, never from the syntax block', () => {
  // SetCartAngVel documents its own syntax as SetCartAngAcc(w).
  const { instruction, review } = convert({
    name: 'SetCartAngVel',
    category: 'motion_commands',
    syntax: ['SetCartAngAcc(ω)'],
    args: ['ω: TRF angular velocity limit, in °/s, ranging from 0.001 to 1,000.'],
    paragraphs: ['This command sets the maximum angular velocity.'],
    warnings: ['syntax block names SetCartAngAcc']
  });

  assert.equal(instruction.name, 'SetCartAngVel');
  assert.deepEqual(instruction.params.map((p) => p.name), ['ω']);
  assert.equal(instruction.params[0].max, 1000);
  assert.ok(review.length, 'the mismatch is reported for review');
});

test('a trailing "..." in the syntax marks the last parameter repeatable', () => {
  const { instruction } = convert({
    name: 'SetRealTimeMonitoring',
    category: 'control_commands',
    syntax: ['SetRealTimeMonitoring(n1,n2,...)'],
    args: ['n1,n2: a list of number codes.'],
    paragraphs: ['This command selects the data sets.'],
    warnings: []
  });

  assert.deepEqual(instruction.params.map((p) => p.name), ['n1', 'n2']);
  assert.equal(instruction.params[1].variadic, true);
});

test('overrides replace generated fields', () => {
  const generated = { name: 'X', description: 'auto', params: [{ name: 'a' }] };
  const merged = applyOverride(generated, { description: 'hand written', remarks: 'careful' });
  assert.equal(merged.description, 'hand written');
  assert.equal(merged.remarks, 'careful');
  assert.deepEqual(merged.params, [{ name: 'a' }], 'untouched fields are kept');
  assert.deepEqual(applyOverride(generated, undefined), generated);
});

test('a parenthetical between the bounds does not hide the range', () => {
  assert.deepEqual(
    extractRange('percentage of blending, ranging from 0 (blending disabled) to 100.'),
    { min: 0, max: 100 }
  );
});
