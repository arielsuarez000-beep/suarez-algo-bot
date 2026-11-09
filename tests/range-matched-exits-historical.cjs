const fs=require('node:fs'),vm=require('node:vm');
const html=fs.readFileSync('index.html','utf8');
function fn(name){
 const start=html.indexOf('function '+name+'('); if(start<0) throw Error('Missing '+name); if(name==='rangeMatchedExit'){const end=html.indexOf('function rangeMatchedExitStats',start);if(end<0)throw Error('Missing boundary');return html.slice(start,end);}
 let i=html.indexOf('{',start),depth=0,quote='',esc=false;
 for(;i<html.length;i++){const c=html[i];if(quote){if(esc)esc=false;else if(c==='\\')esc=true;else if(c===quote)quote='';continue;}
 if(c==="'"||c==='"'||c==='`'){quote=c;continue;}if(c==='{')depth++;else if(c==='}'&&--depth===0)return html.slice(start,i+1);}
 throw Error('Unclosed '+name);
}
const names=['rangeAggregate1h','rangeFindZone1h','backtestRangeHourly','rangeMatchedExit','rangeMatchedExitStats'];
const ctx={console,Error,Math,Number,Array,Map,Object,$:()=>({value:'5'})};vm.createContext(ctx);
vm.runInContext(names.map(fn).join('\n'),ctx);
const pairs=['BTCUSDT','ETHUSDT','SOLUSDT','PEPEUSDT','TAOUSDT','NEARUSDT','AVAXUSDT','DOGEUSDT','LINKUSDT','ARBUSDT'];
const settings={capital:100,margin:10,leverage:10,riskPct:1,fee:0.055,slippage:0.03};
const hosts=['https://api.bybit.com','https://api.bytick.com'],step=300000,days=30;
async function page(pair,end){let error;for(const host of hosts){const ac=new AbortController(),timer=setTimeout(()=>ac.abort(),20000);try{
 const u=host+'/v5/market/kline?category=linear&symbol='+pair+'&interval=5&limit=1000&end='+Math.floor(end);
 const r=await fetch(u,{signal:ac.signal});if(!r.ok)throw Error('HTTP '+r.status);const j=await r.json();if(j.retCode!==0)throw Error(j.retMsg);
 const rows=j.result.list.map(x=>({t:+x[0],o:+x[1],h:+x[2],l:+x[3],c:+x[4],v:+x[5]})).filter(x=>[x.t,x.o,x.h,x.l,x.c,x.v].every(Number.isFinite));
 if(rows.length)return rows;throw Error('No candles');
 }catch(e){error=e;}finally{clearTimeout(timer);}}throw error||Error('API failed');}
async function history(pair){const now=Date.now(),start=now-days*86400000,buf=new Map();let cursor=now,n=0;
 while(cursor>=start&&n++<15){const a=await page(pair,cursor);let oldest=Infinity;for(const x of a){oldest=Math.min(oldest,x.t);if(x.t>=start&&x.t+step<=now)buf.set(x.t,x);}
 if(!Number.isFinite(oldest)||oldest>=cursor)throw Error('Pagination stalled');cursor=oldest-1;if(oldest<=start)break;if(a.length<200)throw Error('Short page');await new Promise(r=>setTimeout(r,150));}
 const rows=[...buf.values()].sort((a,b)=>a.t-b.t);if(rows.length<7000)throw Error('Incomplete history '+rows.length);return rows;}
function summarize(trades,rows,from){const chosen=trades.filter(t=>t.entryTime>=from),s=ctx.rangeMatchedExitStats(chosen,rows,settings),o={};
 for(const k of ['original','breakEven','partial']){const x=s[k];o[k]={trades:x.n,net:+x.net.toFixed(5),winRate:+x.winRate.toFixed(2),PF:x.profitFactor===null?null:+x.profitFactor.toFixed(3),realizedDD:+x.maxDD.toFixed(3)};}return o;}
(async()=>{const out=[],failed=[];for(let i=0;i<pairs.length;i++){const pair=pairs[i];process.stdout.write((i+1)+'/10 '+pair+' ... ');try{
 const rows=await history(pair),cut=Math.floor(rows.length*.7),split=rows[cut].t,warm=240;
 const a=ctx.backtestRangeHourly(rows.slice(0,cut),settings,.06,false,false,false,false);
 const b=ctx.backtestRangeHourly(rows.slice(Math.max(0,cut-warm)),settings,.06,false,false,false,false);
 out.push({pair,candles:rows.length,train:summarize(a.trades,rows.slice(0,cut),rows[0].t),oos:summarize(b.trades,rows.slice(Math.max(0,cut-warm)),split)});
 console.log('OK');
 }catch(e){failed.push({pair,error:String(e.message||e)});console.log('ERROR '+(e.message||e));}}
 const report={createdAt:new Date().toISOString(),lookbackDays:30,interval:'5m',pairs,settings,results:out,failures:failed,
 limitations:['Matched exits replay identical baseline entries; not a full portfolio simulation.','No funding, order-book depth, liquidation, or actual slippage.','Out-of-sample is chronological final 30%; no parameter tuning.']};
 fs.mkdirSync('artifacts',{recursive:true});fs.writeFileSync('artifacts/range-matched-exits-report.json',JSON.stringify(report,null,2));
 console.log('DONE '+out.length+'/10 pairs; '+failed.length+' failures');if(out.length<8)process.exitCode=1;
})().catch(e=>{console.error(e);process.exitCode=1;});