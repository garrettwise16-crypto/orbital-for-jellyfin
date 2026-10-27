const assert=require('node:assert/strict');
const vm=require('node:vm');const fs=require('node:fs');
const src=fs.readFileSync(require('node:path').join(__dirname,'../dist/orbital.js'),'utf8');
// Test the independently bounded public provider block, not the browser UI.
const end=src.indexOf('})(window);');assert.ok(end>0);
const window={};vm.runInNewContext(src.slice(0,end+11),{window});
const clock=window.OrbitalTrackerLifecycle.create({safe:30});
const sample=(now,paused=false,source='one')=>clock.sample({now,paused,source});
assert.equal(sample(100).cutoff,70);
assert.equal(sample(105,true).cutoff,70);
assert.equal(sample(115,true).cutoff,70);
assert.equal(sample(120).cutoff,75);
clock.setManual(10);assert.equal(sample(130).cutoff,120);
assert.equal(sample(140,false,'two').cutoff,110);
assert.equal(sample(NaN).display_ready,false);
clock.reset();assert.equal(sample(200).hold,30);
assert.equal(window.OrbitalFramePaint.attach().snapshot(),null);
assert.equal(window.OrbitalViewerAlignment.createExposureSchedule().compile(),false);
console.log('10 public clock and unavailable-provider assertions passed');
