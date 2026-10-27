const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync(require('node:path').join(__dirname,'../dist/orbital-customer.js'),'utf8');
const begin=source.indexOf('  function installNativeRetirement('),end=source.indexOf('  var nativeTimer',begin);
const install=vm.runInNewContext(source.slice(begin,end)+';installNativeRetirement');
test('stock native repeat play awaits the previous exact retirement',async()=>{
 const events=[];const p={_lifecycle:{detached:false},stop:async function(destroy){assert.equal(destroy,true);events.push('closed');this._lifecycle.detached=true;},play:async()=>events.push('play')};
 assert.equal(install(p),true);await p.play({ids:['next']});assert.deepEqual(events,['closed','play']);assert.equal(install(p),false);
});
test('uncertain retirement cannot start another native stream',async()=>{
 let starts=0;const p={_lifecycle:{detached:false},stop:async()=>{throw Error('close unacknowledged');},play:async()=>starts++};install(p);
 await assert.rejects(p.play({}),/unacknowledged/);assert.equal(starts,0);
});
test('concurrent tap cannot admit another start',async()=>{
 let release,starts=0;const p={play:()=>{starts++;return new Promise(r=>release=r)},stop:async()=>{}};install(p);
 const first=p.play({});await assert.rejects(p.play({}),/in progress/);release();await first;assert.equal(starts,1);
});
