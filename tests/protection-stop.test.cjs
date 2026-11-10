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

function makeHourlyBacktest() {
  const helper = html.match(/function updateRangeProtectionStop\(position,mode\)\s*\{[\s\S]*?\n\}/);
  const engine = html.match(/function backtestRangeHourly\([\s\S]*?\n\}/);
  assert.ok(helper, 'No se encontró helper de protección');
  assert.ok(engine, 'No se encontró el motor horario');
  const aggregate = () => Array.from({ length: 20 }, (_, i) => ({
    t: i * 3600000, end: (i + 1) * 3600000, o: 105, h: 110, l: 100, c: 105, v: 1
  }));
  const findZone = (closed) => closed.length < 12 ? null : ({
    low: 100, high: 110, width: 10, mid: 105, end: closed.at(-1).end
  });
  return new Function('rangeAggregate1h', 'rangeFindZone1h',
    helper[0] + '\n' + engine[0] + '\nreturn backtestRangeHourly;'
  )(aggregate, findZone);
}

function syntheticRangeRows() {
  const rows = Array.from({ length: 240 }, (_, i) => ({
    t: i * 300000, o: 105, h: 105.2, l: 104.8, c: 105, v: 1
  }));
  rows[150] = { t: 150 * 300000, o: 100.9, h: 103, l: 100.5, c: 102.8, v: 1 };
  rows[151] = { t: 151 * 300000, o: 102.8, h: 103.2, l: 102.7, c: 103, v: 1 };
  rows[152] = { t: 152 * 300000, o: 103, h: 104.6, l: 102.6, c: 104, v: 1 };
  rows[153] = { t: 153 * 300000, o: 103.5, h: 103.8, l: 102.7, c: 103.2, v: 1 };
  rows[154] = { t: 154 * 300000, o: 103.2, h: 105.5, l: 103, c: 105, v: 1 };
  rows[155] = { t: 155 * 300000, o: 105, h: 106.4, l: 102.7, c: 106, v: 1 };
  rows[156] = { t: 156 * 300000, o: 106, h: 106.2, l: 103.8, c: 104, v: 1 };
  return rows;
}

test('integración: cada protección se activa al cierre y ejecuta el stop en la vela siguiente', () => {
  const backtest = makeHourlyBacktest();
  const rows = syntheticRangeRows();
  const options = { capital: 1000, margin: 100, leverage: 1, riskPct: 1, fee: 0, slippage: 0 };
  const run = mode => backtest(rows, options, .06, false, false, false, false, mode);

  const original = run('none');
  const be05 = run('be05');
  const be075 = run('be075');
  const trail = run('trail');

  assert.equal(original.count, 0);
  assert.equal(original.open, true);
  assert.equal(be05.count, 1);
  assert.equal(be05.trades[0].reason, 'SL');
  assert.ok(Math.abs(be05.trades[0].exit - be05.trades[0].entry) < 1e-9);
  assert.equal(be075.count, 1);
  assert.ok(Math.abs(be075.trades[0].exit - be075.trades[0].entry) < 1e-9);
  assert.equal(trail.count, 1);
  assert.ok(trail.trades[0].pnl > 0, 'trailing debe cerrar por encima del punto de entrada');
});
