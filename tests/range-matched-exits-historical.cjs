const fs=require('node:fs'),vm=require('node:vm');
const html=fs.readFileSync('index.html','utf8');
function fn(name){
 const start=html.indexOf('function '+name+'('); if(start<0) throw Error('Missing '+name); if(name==='rangeMatchedExit'){const end=html.indexOf('function rangeMatchedExitStats',start);if(end<0)throw Error('Missing boundary');return html.slice(start,end);}
 let i=html.indexOf('{',start),depth=0,quote='',esc=false;
 for(;i<html.length;i++){const c=html[i];if(quote){if(esc)esc=false;else if(c==='\\')esc=true;else if(c===quote)quote='';continue;}
 if(c==="'"||c==='"'||c==='`'){quote=c;continue;}if(c==='{')depth++;else if(c==='}'&&--depth===0)return html.slice(start,i+1);}
 throw Error('Unclosed '+name);
}
const names=['rangeAggregate1h','rangeFindZone1h','backtestRangeHourly','rangeMatchedExit','rangeMatchedExitStats','rangeMatchedCostTrades','rangeWalkForwardWindows'];
const ctx={console,Error,Math,Number,Array,Map,Object,$:()=>({value:'5'})};vm.createContext(ctx);
vm.runInContext(names.map(fn).join('\n'),ctx);
const pairs=['BTCUSDT','ETHUSDT','SOLUSDT','1000PEPEUSDT','TAOUSDT','NEARUSDT','AVAXUSDT','DOGEUSDT','LINKUSDT','ARBUSDT'];
const settings={capital:100,margin:10,leverage:10,riskPct:1,fee:0.055,slippage:0.03};
const hosts=['https://api.bybit.com','https://api.bytick.com'],step=300000,days=180;
function validateHistoryCoverage(rows,start,now,step){
 const firstExpected=Math.ceil(start/step)*step;
 const lastExpected=Math.floor((now-step)/step)*step;
 const expected=Math.max(0,Math.floor((lastExpected-firstExpected)/step)+1);
 if(rows.length!==expected)throw Error('Incomplete history: '+rows.length+' of '+expected+' expected candles');
 if(rows[0]?.t!==firstExpected||rows.at(-1)?.t!==lastExpected)throw Error('History start/end does not match the expected 5m grid');
 for(let i=0;i<rows.length;i++){
  const x=rows[i];
  if(![x.t,x.o,x.h,x.l,x.c,x.v].every(Number.isFinite)||x.o<=0||x.h<=0||x.l<=0||x.c<=0||x.v<0||
    x.h<Math.max(x.o,x.c,x.l)||x.l>Math.min(x.o,x.c,x.h))throw Error('Invalid OHLCV candle at index '+i);
  if(i>0&&x.t-rows[i-1].t!==step)throw Error('Gap or irregular timestamp in 5m history at index '+i);
 }
 return {firstExpected,lastExpected,expected};
}
async function page(pair,end){let error;for(const host of hosts){const ac=new AbortController(),timer=setTimeout(()=>ac.abort(),20000);try{
 const u=host+'/v5/market/kline?category=linear&symbol='+pair+'&interval=5&limit=1000&end='+Math.floor(end);
 const r=await fetch(u,{signal:ac.signal});if(!r.ok)throw Error('HTTP '+r.status);const j=await r.json();if(j.retCode!==0)throw Error(j.retMsg);
 const rows=j.result.list.map(x=>({t:+x[0],o:+x[1],h:+x[2],l:+x[3],c:+x[4],v:+x[5]})).filter(x=>[x.t,x.o,x.h,x.l,x.c,x.v].every(Number.isFinite));
 if(rows.length)return rows;throw Error('No candles');
 }catch(e){error=e;}finally{clearTimeout(timer);}}throw error||Error('API failed');}
async function history(pair){const now=Date.now(),start=now-days*86400000,buf=new Map();let cursor=now,n=0;
 while(cursor>=start&&n++<70){const a=await page(pair,cursor);let oldest=Infinity;for(const x of a){oldest=Math.min(oldest,x.t);if(x.t>=start&&x.t+step<=now)buf.set(x.t,x);}
 if(!Number.isFinite(oldest)||oldest>=cursor)throw Error('Pagination stalled');cursor=oldest-1;if(oldest<=start)break;if(a.length<200)throw Error('Short page');await new Promise(r=>setTimeout(r,150));}
 const rows=[...buf.values()].sort((a,b)=>a.t-b.t);validateHistoryCoverage(rows,start,now,step);return rows;}
function summarize(trades,rows,from,activeSettings=settings){const chosen=trades.filter(t=>t.entryTime>=from),s=ctx.rangeMatchedExitStats(chosen,rows,activeSettings),o={};
 for(const k of ['original','breakEven','partial']){const x=s[k];o[k]={trades:x.n,net:+x.net.toFixed(5),winRate:+x.winRate.toFixed(2),expectancyR:+x.expectancyR.toFixed(4),stdR:+x.stdR.toFixed(4),seR:+x.seR.toFixed(4),PF:x.profitFactor===null?null:+x.profitFactor.toFixed(3),intratradeDD:+x.maxDD.toFixed(3),sampleSufficient:x.n>=100};}return o;}
(async()=>{const out=[],failed=[];for(let i=0;i<pairs.length;i++){const pair=pairs[i];process.stdout.write((i+1)+'/10 '+pair+' ... ');try{
 const rows=await history(pair),cut=Math.floor(rows.length*.7),split=rows[cut].t,warm=240;
 const trainRows=rows.slice(0,cut),oosRows=rows.slice(Math.max(0,cut-warm));
 const a=ctx.backtestRangeHourly(trainRows,settings,.06,false,false,false,false);
 // Warm up the detector with prior candles, but prohibit all entries before the OOS cutoff.
 const b=ctx.backtestRangeHourly(oosRows,settings,.06,false,false,false,false,split);
 const oosTrades=b.trades.filter(t=>t.entryTime>=split);
 const full=ctx.backtestRangeHourly(rows,settings,.06,false,false,false,false);
 const walkForward=ctx.rangeWalkForwardWindows(rows,30,30,step).map(w=>{
  const foldTrades=full.trades.filter(t=>t.entryTime>=w.startTime&&t.entryTime<w.endTime&&t.date<w.endTime);
  const carryIn=full.trades.filter(t=>t.entryTime<w.startTime&&t.date>=w.startTime).length;
  const cutCrossers=full.trades.filter(t=>t.entryTime>=w.startTime&&t.entryTime<w.endTime&&t.date>=w.endTime).length;
  const foldSettings={...settings,capital:settings.capital};
  return {fold:w.fold,startTime:w.startTime,endTime:w.endTime,n:foldTrades.length,carryIn,cutCrossers,
    drawdownBasis:'fold-local',stats:summarize(foldTrades,rows,w.startTime,foldSettings)};
 });
 const costStress=[1.5,2].map(multiple=>{
  const stressedSettings={...settings,fee:settings.fee*multiple,slippage:settings.slippage*multiple};
  const stressedTrades=ctx.rangeMatchedCostTrades(oosTrades,settings,multiple);
  return {multiple,stats:summarize(stressedTrades,oosRows,split,stressedSettings)};
 });
 out.push({pair,candles:rows.length,train:summarize(a.trades,trainRows,rows[0].t),
  oos:summarize(oosTrades,oosRows,split),trainOpen:!!a.open,oosOpen:!!b.open,fullOpen:!!full.open,
  walkForward,costStress});
 console.log('OK');
 }catch(e){failed.push({pair,error:String(e.message||e)});console.log('ERROR '+(e.message||e));}}
 const report={createdAt:new Date().toISOString(),lookbackDays:180,interval:'5m',pairs,settings,results:out,failures:failed,
 validationProtocol:{train:'Primer 70% cronológico',oos:'Último 30% cronológico; 240 velas previas solo para calentar, sin entradas antes del corte',walkForward:'30 días iniciales no puntuados + cinco pliegues cronológicos de 30 días; DD reiniciado por pliegue; entradas arrastradas y cruces de límite se informan y excluyen del conteo del pliegue',costStress:'1.5x y 2x comisión/slippage sobre las mismas operaciones OOS; señales, timestamps, qty y SL/TP congelados',minimumTrades:100},
 limitations:['Matched exits replay identical baseline entries; not a full portfolio simulation.','No funding, order-book depth, liquidation, market impact, or actual fills. Slippage is a scenario assumption, not measured execution.','Walk-forward folds are historical diagnostics and overlap the 70/30 split; they are not a future unseen test.','Fold drawdown is local to each fold; carry-in positions and boundary-crossing trades are counted separately, not included in fold trade statistics.','The final 30% has already been observable historically; a genuinely future paper/shadow test is still required.']};
 fs.mkdirSync('artifacts',{recursive:true});fs.writeFileSync('artifacts/range-matched-exits-report.json',JSON.stringify(report,null,2));
 console.log('DONE '+out.length+'/10 pairs; '+failed.length+' failures');if(out.length<8)process.exitCode=1;
})().catch(e=>{console.error(e);process.exitCode=1;});