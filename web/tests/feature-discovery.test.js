const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../dist/orbital-customer.js'),'utf8');
function harness(){
 const requests=[],classes=new Set();let user='u',server='a',credential='one';
 const api={getCurrentUserId:()=>user,serverId:()=>server,accessToken:()=>credential,getUrl:p=>p,getJSON:url=>new Promise((resolve,reject)=>requests.push({url,resolve,reject}))};
 const window={ApiClient:api,OrbitalEdition:{features:{}},dispatchEvent:()=>{}};
 const context={window,document:{documentElement:{classList:{add:c=>classes.add(c),toggle:(c,on)=>on?classes.add(c):classes.delete(c)}}},Event:class{},setInterval:()=>{}};
 const start=source.indexOf('  var root = document.documentElement, owner'),end=source.indexOf('  // Stock Jellyfin does not track',start);
 vm.createContext(context);vm.runInContext(source.slice(start,end),context);
 return {context,window,requests,change:(u,s,t)=>{user=u;server=s;credential=t},check:()=>vm.runInContext('checks()',context)};
}
const flush=()=>new Promise(r=>setImmediate(r));
test('late feature reply from a previous server cannot enable current account features',async()=>{
 const h=harness();h.check();const first=h.requests.find(r=>r.url==='sports/api/status');
 h.change('u','b','two');h.check();first.resolve({sports:true,services:true,personal_library:true});await flush();
 assert.equal(h.window.OrbitalEdition.features.services,false);
 h.requests.filter(r=>r.url==='sports/api/status').at(-1).resolve({sports:true});await flush();assert.equal(h.window.OrbitalEdition.features.sports,true);
 h.change(null,'b','');h.check();assert.equal(h.window.OrbitalEdition.features.sports,false);
});
test('transient discovery failure retries but missing plugin does not poll forever',async()=>{
 const h=harness();h.check();h.requests.find(r=>r.url==='sports/api/status').reject({status:503});await flush();h.check();
 assert.equal(h.requests.filter(r=>r.url==='sports/api/status').length,2);
 h.requests.filter(r=>r.url==='sports/api/status').at(-1).reject({status:404});await flush();h.check();
 assert.equal(h.requests.filter(r=>r.url==='sports/api/status').length,2);
});
