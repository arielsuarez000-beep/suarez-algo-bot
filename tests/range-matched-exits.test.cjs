const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const html = fs.readFileSync('index.html', 'utf8');
const start = html.indexOf('function rangeMatchedExit(');
const end = html.indexOf('\nfunction rangeMatchedExitStats', start);
assert(start >= 0 && end > start, 'rangeMatchedExit must exist in index.html');
const source = html.slice(start, end);
const run = vm.runInNewContext('(' + source + ')', {});
const settings = { fee: 0, slippage: 0, capital: 100 };
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
    candle(0,100,101,99,100), candle(1,100,110,99,105),
    candle(2,95,121,94,100)
  ];
  const result = run(trade({ date:2, exit:95, reason:'RANGE BREAK' }), rows, settings, 'partial');
  assert.equal(result.net, -5, 'terminal hourly range break must retain priority over intrabar SL/TP');
}
{
  const rows = [
    candle(0,100,101,99,100), candle(1,100,115,99,110),
    candle(2,110,112,89,100)
  ];
  const result = run(trade({date:2,exit:90,reason:'SL',pnl:-10}), rows, settings, 'original');
  assert.ok(result.maxDD > 21.7 && result.maxDD < 21.8,
    'drawdown must include the intratrade high-water mark before the adverse stop');
}
{
  const rows = [
    candle(0,100,101,99,100), candle(1,100,115,99,110),
    candle(2,110,112,89,100)
  ];
  const costs = {fee:0.055,slippage:0.03,capital:100};
  const result = run(trade({date:2,exit:89.973,reason:'SL',pnl:-10.131485}), rows, costs, 'original');
  assert.ok(result.maxDD > 21.7,
    'intratrade liquidation marks must include exit commission and slippage');
}
{
  const statsStart = html.indexOf('function rangeMatchedExitStats(');
  const statsEnd = html.indexOf('\\nasync function runRangeMatchedExitMulti', statsStart);
  assert(statsStart >= 0 && statsEnd > statsStart, 'rangeMatchedExitStats must exist');
  const statsSource = html.slice(statsStart, statsEnd);
  const stats = vm.runInNewContext('(' + statsSource + ')', {rangeMatchedExit: run});
  const rows = [
    candle(0,100,101,99,100), candle(1,100,115,99,110),
    candle(2,110,112,89,100), candle(3,100,101,99,100),
    candle(4,100,115,99,110), candle(5,110,121,109,115)
  ];
  const first = trade({date:2,exit:90,reason:'SL',pnl:-10});
  const second = trade({entryTime:3,date:5,exit:110,reason:'RANGE BREAK',pnl:10});
  const result = stats([first,second], rows, settings);
  assert.ok(result.original.maxDD > 21.7 && result.original.maxDD < 21.8,
    'portfolio drawdown must carry the intratrade high-water mark across sequential trades');
}
console.log('PASS: matched exits, stop-first ambiguity, range-break priority, and OHLC high-water drawdown');
