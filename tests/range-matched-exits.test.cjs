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
    candle(0,100,101,99,100), candle(1,110,112,110,110),
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
    candle(0,100,101,99,100), candle(1,100,125,89,100)
  ];
  const result = run(trade({date:1,exit:90,reason:'SL'}), rows, settings, 'breakEven');
  assert.equal(result.net, -10, 'dual-touch realized P&L must still use stop-first execution');
  assert.ok(result.maxDD > 27.9 && result.maxDD < 28.1,
    'terminal dual-touch DD must include the favorable extreme before the stop as a conservative bound');
}
{
  const rows = [
    candle(0,100,111,99,110), candle(1,101,121,99,105),
    candle(2,105,110,104,108)
  ];
  const result = run(trade({date:2,exit:105,reason:'RANGE BREAK',pnl:5}), rows, settings, 'breakEven');
  assert.equal(result.net, 0, 'an armed break-even stop must retain its realized stop-first fill');
  assert.ok(result.maxDD > 17.3 && result.maxDD < 17.4,
    'non-terminal dual-touch DD must include the favorable extreme before the break-even stop');
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
  const rows = Array.from({length:288}, (_, i) => ({t:start + i * step,o:100,h:101,l:99,c:100,v:0}));
  assert.equal(validate(rows, start, now, step).expected, 288,
    'a complete aligned 5m day should be accepted');
  assert.throws(() => validate(rows.slice(1), start, now, step), /Incomplete history/,
    'missing candles must be rejected');
  const irregular = rows.map((row, i) => i === 120 ? {...row,t:row.t + 1} : row);
  assert.throws(() => validate(irregular, start, now, step), /Gap or irregular timestamp/,
    'irregular 5m timestamps must be rejected');
  const invalidHigh = rows.map((row, i) => i === 120 ? {...row,h:99} : row);
  assert.throws(() => validate(invalidHigh, start, now, step), /Invalid OHLCV/,
    'inconsistent OHLC values must be rejected');
  const invalidVolume = rows.map((row, i) => i === 120 ? {...row,v:-1} : row);
  assert.throws(() => validate(invalidVolume, start, now, step), /Invalid OHLCV/,
    'negative volume must be rejected');
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
  assert.equal(stressed.stop,trade.stop);
  assert.equal(stressed.take,trade.take);
  assert.ok(stressed.pnl<trade.pnl, 'higher fees/slippage should reduce net P&L for this long trade');
}
{
  const statsStart = html.indexOf('function rangeMatchedExitStats(');
  const statsEnd = html.indexOf('\nasync function runRangeMatchedExitMulti', statsStart);
  assert(statsStart >= 0 && statsEnd > statsStart, 'rangeMatchedExitStats must exist for cost stress');
  const stats = vm.runInNewContext('(' + html.slice(statsStart, statsEnd) + ')', {rangeMatchedExit:run});
  const base = {fee:0.055,slippage:0.03,capital:100};
  const rawEntry=100,rawExit=120,qty=1,sign=1;
  const entry=rawEntry*(1+sign*base.slippage/100),exit=rawExit*(1-sign*base.slippage/100);
  const matched=trade({entry,exit,rawEntry,rawExit,stop:90,take:120,date:3,reason:'TP',
    pnl:(exit-entry)*qty-(entry+exit)*qty*base.fee/100});
  const rows=[
    candle(0,100,101,99,100),candle(1,100,112,99,111),
    candle(2,105,111,104,109),candle(3,108,121,107,120)
  ];
  const baseStats=stats([matched],rows,base);
  const stressedSettings={...base,fee:base.fee*2,slippage:base.slippage*2};
  const stressedTrades=reprice([matched],base,2);
  const stressedStats=stats(stressedTrades,rows,stressedSettings);
  for(const mode of ['original','breakEven','partial']){
    assert.equal(stressedStats[mode].n,baseStats[mode].n,
      'cost stress must preserve the matched trade count for '+mode);
    assert.ok(stressedStats[mode].net<baseStats[mode].net,
      'doubling costs should reduce net P&L for '+mode);
  }
}
{
  const wfStart = html.indexOf('function rangeWalkForwardWindows(');
  const wfEnd = html.indexOf('\nfunction rangePairedBlockBootstrap', wfStart);
  assert(wfStart >= 0 && wfEnd > wfStart, 'walk-forward window helper must exist');
  const windows = vm.runInNewContext('(' + html.slice(wfStart, wfEnd) + ')', {})(
    Array.from({length:180*288}, (_, i) => ({t:i*300000})), 30, 30, 300000
  );
  assert.equal(windows.length, 5, '180 days after a 30-day initial block should produce five 30-day folds');
  assert.equal(windows[0].startIndex, 30*288);
  assert.equal(windows[0].endIndex, 60*288);
  assert.equal(windows[4].endIndex, 180*288);
}
{
  const historical = fs.readFileSync('tests/range-matched-exits-historical.cjs','utf8');
  const runStart = html.indexOf('async function runRangeMatchedExitMulti()');
  const runEnd = html.indexOf("\n$('btCompareExits').onclick",runStart);
  assert(runStart>=0&&runEnd>runStart,'matched-exit UI runner must exist');
  const runner=html.slice(runStart,runEnd);
  assert.match(runner,/rangeMatchedCostTrades\(lastTrades,settings,multiple\)/,
    'UI must execute frozen-entry 1.5x/2x cost sensitivity');
  assert.match(runner,/WALK-FORWARD/,
    'UI must display the walk-forward folds it computes');
  assert.match(historical,/ctx\.rangeWalkForwardWindows/,
    'standalone historical report must include walk-forward folds');
  assert.match(historical,/ctx\.rangeMatchedCostTrades/,
    'standalone historical report must include cost stress');
  assert.match(historical,/errors\.push\(host\+/,
    'historical audit must preserve host-specific Bybit HTTP errors');
  assert.match(historical,/false,false,false,false,split/,
    'standalone OOS backtest must prohibit entries before the cutoff while warming up');
}

{
  const helperStart=html.indexOf('function rangePairedBlockBootstrap(');
  const helperEnd=html.indexOf('\nfunction rangeMatchedExitStats',helperStart);
  assert(helperStart>=0&&helperEnd>helperStart,'paired block bootstrap helper must exist');
  const bootstrap=vm.runInNewContext('('+html.slice(helperStart,helperEnd)+')',{Math,Number,Array,Map,Object});
  const samples=Array.from({length:70},(_,i)=>({time:i*86400000,r:(i%5-2)*0.03}));
  const pairStats=[{
    pair:'TESTUSDT',
    original:{samples},
    breakEven:{samples:samples.map(x=>({...x,r:x.r-0.2}))},
    partial:{samples:samples.map(x=>({...x,r:x.r-0.05}))}
  }];
  const a=bootstrap(pairStats,7,500,12345),b=bootstrap(pairStats,7,500,12345);
  assert.deepEqual(JSON.parse(JSON.stringify(a)),JSON.parse(JSON.stringify(b)),
    'bootstrap output must be deterministic for a fixed seed');
  assert.ok(Math.abs(a.metrics.breakEvenMinusOriginal.mean+0.2)<1e-12,
    'paired break-even minus original expectancy must preserve the exact -0.2R effect');
  assert.ok(Math.abs(a.metrics.partialMinusOriginal.mean+0.05)<1e-12,
    'paired partial minus original expectancy must preserve the exact -0.05R effect');
  assert.ok(Math.abs(a.metrics.breakEvenMinusOriginal.lower95+0.2)<1e-12&&
    Math.abs(a.metrics.breakEvenMinusOriginal.upper95+0.2)<1e-12,
    'block bootstrap must retain a constant paired treatment effect');
  assert.equal(a.trades,70);
  assert.equal(a.effectiveBlocks,10);
  assert.equal(a.activeDays,70);
  assert.equal(bootstrap(pairStats,7,500,12345,10).available,true);
  const fiftyFour=samples.slice(0,54);
  const fiftyFourPairs=[{pair:'OOS54',original:{samples:fiftyFour},breakEven:{samples:fiftyFour},partial:{samples:fiftyFour}}];
  assert.equal(bootstrap(fiftyFourPairs,3,500,7,10).available,true,
    '54 calendar days should support the exploratory 3-day block bootstrap');
  assert.equal(bootstrap(fiftyFourPairs,7,500,7,10).available,false,
    '54 calendar days should not claim ten independent 7-day blocks');
  assert.equal(bootstrap(fiftyFourPairs,14,500,7,10).available,false,
    '54 calendar days should not claim ten independent 14-day blocks');
  const shortSamples=samples.slice(0,28);
  assert.equal(bootstrap([{pair:'SHORT',original:{samples:shortSamples},breakEven:{samples:shortSamples},partial:{samples:shortSamples}}],7,500,1,10).available,false,
    'short calendar histories must not emit apparently precise bootstrap intervals');
  const sparseDays=[0,1,2,51,52,53].flatMap(day=>Array.from({length:2},(_,i)=>({time:(day*86400000)+i*3600000,r:0.01})));
  const sparsePair=[{pair:'SPARSE',original:{samples:sparseDays},breakEven:{samples:sparseDays},partial:{samples:sparseDays}}];
  const sparseResult=bootstrap(sparsePair,3,500,1,10);
  assert.equal(sparseResult.available,false,
    '54 calendar days with trades clustered into only two 3-day blocks must be rejected');
  assert.equal(sparseResult.effectiveBlocks,2,
    'effective bootstrap blocks must count non-empty non-overlapping calendar blocks, not elapsed days');
  assert.throws(()=>bootstrap([{pair:'BAD',original:{samples},breakEven:{samples:samples.slice(1)},partial:{samples}}],7,500,1),
    /Matched sample counts differ/,'unmatched exit samples must be rejected');
}

{
  const hourlyStart=html.indexOf('async function runRangeHourlyMulti()');
  const hourlyEnd=html.indexOf("\n$('btHourlyMulti').onclick",hourlyStart);
  const matchedStart=html.indexOf('async function runRangeMatchedExitMulti()');
  const matchedEnd=html.indexOf("\n$('btCompareExits').onclick",matchedStart);
  assert(hourlyStart>=0&&hourlyEnd>hourlyStart&&matchedStart>=0&&matchedEnd>matchedStart,
    'diagnostic runner boundaries must exist');
  const hourlyRunner=html.slice(hourlyStart,hourlyEnd);
  const matchedRunner=html.slice(matchedStart,matchedEnd);
  assert.doesNotMatch(hourlyRunner,/rangePairedBlockBootstrap|INFERENCIA EMPAREJADA|\bok\.map\(/,
    'the 30-day hourly diagnostic must not contain matched-exit reporting or undefined ok references');
  assert.match(matchedRunner,/rangePairedBlockBootstrap\(ok\.map/,
    'bootstrap inference must be inside the 180-day matched-exit runner');
}

console.log('PASS: matched exits, stop-first ambiguity, range-break priority, and OHLC high-water drawdown');
