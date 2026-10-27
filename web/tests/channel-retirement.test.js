const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync(require('node:path').join(__dirname,'../dist/orbital.js'),'utf8');
const start=source.indexOf('function retire(a){'),end=source.indexOf('async function switchTo(a,item,status)',start);
const retire=vm.runInNewContext(source.slice(start,end)+';retire',{setTimeout,clearTimeout});
test('channel retirement waits for exact server acknowledgement after player stop',async()=>{
 let acknowledge,finished=false;const original=()=>new Promise(r=>acknowledge=r);
 const api={reportPlaybackStopped:original},a={api,item:{Id:'old'},session:'session',p:{},pm:{stop:async()=>{}}};
 const waiting=retire(a).then(()=>finished=true);await Promise.resolve();
 api.reportPlaybackStopped({ItemId:'other',PlaySessionId:'session'});await Promise.resolve();assert.equal(finished,false);
 api.reportPlaybackStopped({ItemId:'old',PlaySessionId:'session'});await Promise.resolve();assert.equal(finished,false);
 acknowledge();await waiting;assert.equal(api.reportPlaybackStopped,original);
});
test('rejected stop report remains a failed channel switch and restores API',async()=>{
 const original=()=>Promise.reject(Error('unacknowledged'));const api={reportPlaybackStopped:original};
 const a={api,item:{Id:'old'},session:'session',p:{},pm:{stop:async()=>{}}};
 const waiting=retire(a);api.reportPlaybackStopped({ItemId:'old',PlaySessionId:'session'}).catch(()=>{});
 await assert.rejects(waiting,/unacknowledged/);assert.equal(api.reportPlaybackStopped,original);
});
