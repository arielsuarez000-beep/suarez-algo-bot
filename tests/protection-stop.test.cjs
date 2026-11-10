// Isolated regression checks for the R-protection helper.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const html = fs.readFileSync(require('node:path').join(__dirname, '..', 'index.html'), 'utf8');
const match = html.match(/function updateRangeProtectionStop\(position,mode\)\s*\{[\s\S]*?\n\}/);
assert.ok(match, 'No se encontró updateRangeProtectionStop en index.html');
const updateRangeProtectionStop = new Function('return (' + match[0] + ')')();

function position(side, maxFav, stop, initialStop, entry = 100) {
  return { side, entry, stop, initialStop, initialStopDistance: Math.abs(entry - initialStop), maxFav };
}

test('original: no modifica el stop', () => {
  const p = position('LONG', 8, 98, 98);
  assert.equal(updateRangeProtectionStop(p, 'none'), 98);
});

test('break-even +0,5R: espera el umbral y mueve al precio de entrada', () => {
  assert.equal(updateRangeProtectionStop(position('LONG', 0.99, 98, 98), 'be05'), 98);
  assert.equal(updateRangeProtectionStop(position('LONG', 1.00, 98, 98), 'be05'), 100);
});

test('break-even +0,75R: no se activa antes del umbral', () => {
  assert.equal(updateRangeProtectionStop(position('LONG', 1.49, 98, 98), 'be075'), 98);
  assert.equal(updateRangeProtectionStop(position('LONG', 1.50, 98, 98), 'be075'), 100);
});

test('trailing LONG: activa en +1R y sube sin retroceder', () => {
  assert.equal(updateRangeProtectionStop(position('LONG', 1.99, 98, 98), 'trail'), 98);
  assert.equal(updateRangeProtectionStop(position('LONG', 2.00, 98, 98), 'trail'), 100.5);
  assert.equal(updateRangeProtectionStop(position('LONG', 3.20, 100.8, 98), 'trail'), 101.7);
  assert.equal(updateRangeProtectionStop(position('LONG', 2.50, 101.8, 98), 'trail'), 101.8);
});

test('break-even y trailing SHORT: el stop baja, nunca sube', () => {
  assert.equal(updateRangeProtectionStop(position('SHORT', 1.00, 102, 102), 'be05'), 100);
  assert.equal(updateRangeProtectionStop(position('SHORT', 2.00, 102, 102), 'trail'), 99.5);
  assert.equal(updateRangeProtectionStop(position('SHORT', 3.00, 99, 102), 'trail'), 98.5);
});

test('riesgo inicial inválido: conserva el stop sin dividir por cero', () => {
  const p = { side: 'LONG', entry: 100, stop: 98, initialStop: 100, initialStopDistance: 0, maxFav: 10 };
  assert.equal(updateRangeProtectionStop(p, 'trail'), 98);
});
