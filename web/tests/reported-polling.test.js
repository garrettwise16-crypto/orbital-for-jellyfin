const fs=require('fs'),assert=require('node:assert/strict'),vm=require('node:vm');
const src=fs.readFileSync(__dirname+'/../dist/orbital.js','utf8');
const start=src.indexOf('function trackerPollingPolicy('),end=src.indexOf('\n',start);assert.ok(start>=0);
const ctx={};vm.runInNewContext(src.slice(start,end),ctx);
const cases=[['latest_page',4000,3500,1000,250],['latest_page',1500,1000,1000,250],['latest_page',12000,3500,1000,250],['latest_page',1000,250,1000,250],['viewer_source',200,0,200,0],['viewer_source',500,500,500,500],['viewer_source',4000,3500,4000,3500],['other',2000,1000,2000,1000]];
for(const [mode,i,a,ei,ea] of cases){const p=ctx.trackerPollingPolicy(mode,i,a);assert.equal(p.interval,ei);assert.equal(p.maxAgeMs,ea);}
console.log('8 cadence cases passed; watched-source cadence preserved');
