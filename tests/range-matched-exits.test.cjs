const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const html = fs.readFileSync('index.html', 'utf8');
const inlineScripts = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)]
  .map(match => match[1]).filter(source => source.trim());
assert(inlineScripts.length > 0, 'index.html must contain an inline script');
for (const source of inlineScripts) new vm.Script(source);
const start = html.indexOf('function rangeMatchedExit(');
const end = html.indexOf('\nfunction rangeMatchedCostTrades', start);
assert(start >= 0 && end > start, 'rangeMatchedExit must exist in index.html');
const source = html.slice(start, end);
const run = vm.runInNewContext('(' + source + ')', {});
const costStart = html.indexOf('function rangeMatchedCostTrades(');
const costEnd = html.indexOf('\nfunction rangeWalkForwardWindows', costStart);
assert(costStart >= 0 && costEnd > costStart, 'rangeMatchedCostTrades must exist');
const reprice = vm.runInNewContext('(' + html.slice(costStart, costEnd) + ')', {});
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
    candle(2,125,126,89,100)
  ];
  const result = run(trade({date:2,exit:90,reason:'SL',pnl:-10}), rows, settings, 'partial');
  assert.equal(result.net, 7.5,
    'partial half should fill at the next open while the remaining half keeps stop-first handling');
  assert.ok(result.maxDD > 4.4 && result.maxDD < 4.5,
    'realized partial profit must enter the drawdown high-water path before the remaining stop');
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
  const costs = {fee:0.055,slippage:0.03,capital:100};
  const rows = [
    candle(0,100,101,99,100), candle(1,100,112,99,110),
    candle(2,102,105,100,103), candle(3,100,101,99,100)
  ];
  const result = run(trade({date:3,exit:100,reason:'SL'}), rows, costs, 'breakEven');
  assert.ok(Math.abs(result.net) < 1e-8,
    'long break-even stop must net to zero after entry/exit fees and exit slippage');
  assert.equal(result.protected, true);
}
{
  const costs = {fee:0.055,slippage:0.03,capital:100};
  const rows = [
    candle(0,100,101,99,100), candle(1,100,112,99,110),
    candle(2,85,90,84,87), candle(3,87,88,86,87)
  ];
  const result = run(trade({date:3,exit:90,reason:'SL'}), rows, costs, 'breakEven');
  assert.equal(result.reason, 'SL/GAP',
    'an adverse opening gap must execute at the open before any scheduled protection logic');
  assert.ok(result.net < -10, 'the adverse gap should realize more than the original 10-point stop loss');
}
{
  const costs = {fee:0.055,slippage:0.03,capital:100};
  const rows = [
    candle(0,100,101,99,100), candle(1,100,101,88,90),
    candle(2,98,100,90,95), candle(3,95,96,94,95)
  ];
  const result = run(trade({side:'SHORT',entry:100,stop:110,take:80,date:3,exit:100,reason:'SL'}), rows, costs, 'breakEven');
  assert.ok(Math.abs(result.net) < 1e-8,
    'short break-even stop must net to zero after entry/exit fees and exit slippage');
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
  const statsEnd = html.indexOf('\nasync function runRangeMatchedExitMulti', statsStart);
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
  assert.ok(result.original.maxDD > 22.5 && result.original.maxDD < 22.7,
    'portfolio drawdown must carry the intratrade high-water mark across sequential trades');
  assert.equal(result.original.expectancyR, 0,
    'net expectancy in R must use the same initial stop risk for each matched trade');
}
{
  const historical = fs.readFileSync('tests/range-matched-exits-historical.cjs', 'utf8');
  const coverageStart = historical.indexOf('function validateHistoryCoverage(');
  const coverageEnd = historical.indexOf('\nasync function page', coverageStart);
  assert(coverageStart >= 0 && coverageEnd > coverageStart, 'historical coverage validator must exist');
  const validate = vm.runInNewContext('(' + historical.slice(coverageStart, coverageEnd) + ')', {});
  const step = 300000, now = 300 * step, start = now - 288 * step;
  const rows = Array.from({length:288}, (_, i) => ({t:start + i * step}));
  assert.equal(validate(rows, start, now, step).expected, 288,
    'a complete aligned 5m day should be accepted');
  assert.throws(() => validate(rows.slice(1), start, now, step), /Incomplete history/,
    'missing candles must be rejected');
  const irregular = rows.map((row, i) => i === 120 ? {t:row.t + 1} : row);
  assert.throws(() => validate(irregular, start, now, step), /Gap or irregular timestamp/,
    'irregular 5m timestamps must be rejected');
}
{
  const base = {fee:0.055,slippage:0.03};
  const rawEntry = 100, rawExit = 110, qty = 1, sign = 1;
  const trade = {
    side:'LONG',rawEntry,rawExit,entry:rawEntry*(1+sign*base.slippage/100),
    exit:rawExit*(1-sign*base.slippage/100),qty,entryTime:10
  };
  trade.pnl = (trade.exit-trade.entry)*qty
    - (trade.entry+trade.exit)*qty*base.fee/100;
  const baseRepriced = reprice([trade],base,1)[0];
  assert.ok(Math.abs(baseRepriced.pnl-trade.pnl)<1e-10,
    '1x cost repricing must reproduce the baseline net P&L');
  const stressed = reprice([trade],base,2)[0];
  assert.equal(stressed.entry,rawEntry*(1+sign*base.slippage*2/100),
    '2x stress must reprice the same raw entry with doubled slippage');
  assert.equal(stressed.exit,rawExit*(1-sign*base.slippage*2/100),
    '2x stress must reprice the same raw exit with doubled slippage');
  assert.equal(stressed.entryTime,trade.entryTime);
  assert.equal(stressed.qty,trade.qty);
  assert.ok(stressed.pnl<trade.pnl, 'higher fees/slippage should reduce net P&L for this long trade');
}
{
  const wfStart = html.indexOf('function rangeWalkForwardWindows(');
  const wfEnd = html.indexOf('\nfunction rangeMatchedExitStats', wfStart);
  assert(wfStart >= 0 && wfEnd > wfStart, 'walk-forward window helper must exist');
  const windows = vm.runInNewContext('(' + html.slice(wfStart, wfEnd) + ')', {})(
    Array.from({length:180*288}, (_, i) => ({t:i*300000})), 30, 30, 300000
  );
  assert.equal(windows.length, 5, '180 days after a 30-day initial block should produce five 30-day folds');
  assert.equal(windows[0].startIndex, 30*288);
  assert.equal(windows[0].endIndex, 60*288);
  assert.equal(windows[4].endIndex, 180*288);
}
console.log('PASS: matched exits, stop-first ambiguity, range-break priority, and OHLC high-water drawdown');
