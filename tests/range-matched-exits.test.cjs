const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const html = fs.readFileSync('index.html', 'utf8');
const start = html.indexOf('function rangeMatchedExit(');
const end = html.indexOf('\nfunction rangeMatchedExitStats', start);
assert(start >= 0 && end > start, 'rangeMatchedExit must exist in index.html');
const source = html.slice(start, end);
const run = vm.runInNewContext('(' + source + ')', {});
const settings = { fee: 0, slippage: 0 };
const candle = (t, o, h, l, c) => ({ t, o, h, l, c });
const trade = (overrides = {}) => ({
  side: 'LONG', qty: 1, entry: 100, stop: 90, take: 120,
  entryTime: 0, date: 3, exit: 120, pnl: 20, reason: 'TP',
  ...overrides
});

{
  const rows = [
    candle(0,100,101,99,100), candle(1,100,112,99,110),
    candle(2,105,111,104,109), candle(3,108,121,107,120)
  ];
  const result = run(trade(), rows, settings, 'partial');
  assert.equal(result.net, 12.5, 'partial exit should sell half at next open and half at TP');
  assert.equal(result.protected, true);
}
{
  const rows = [
    candle(0,100,101,99,100), candle(1,100,112,99,110),
    candle(2,100,105,99,102), candle(3,100,101,99,100)
  ];
  const result = run(trade({ date:3, exit:100, reason:'SL' }), rows, settings, 'breakEven');
  assert.equal(result.net, 0, 'confirmed +1R should move stop to break-even from next candle');
  assert.equal(result.protected, true);
}
{
  const rows = [
    candle(0,100,101,99,100), candle(1,125,126,89,100),
    candle(2,100,101,99,100)
  ];
  const result = run(trade({ date:2, exit:90, reason:'SL' }), rows, settings, 'breakEven');
  assert.equal(result.net, -10, 'when SL and TP touch in one candle, conservative priority is SL');
}
{
  const rows = [
    candle(0,100,101,99,100), candle(1,100,125,89,100),
    candle(2,95,121,94,100)
  ];
  const result = run(trade({ date:2, exit:95, reason:'RANGE BREAK' }), rows, settings, 'partial');
  assert.equal(result.net, -5, 'terminal hourly range break must retain priority over intrabar SL/TP');
}
console.log('PASS: partial next-open execution, confirmed break-even, stop-first ambiguity, range-break priority');
