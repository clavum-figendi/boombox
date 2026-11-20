import test from 'node:test';
import assert from 'node:assert/strict';
import {defaultSettings,applyStyle,patternEvents,STYLES,Engine} from '../web/js/engine.js';

test('styles generate distinct deterministic musical patterns without shared state',()=>{
 const settings=defaultSettings(), other=defaultSettings();
 assert.equal(settings.bpm,132); assert.equal(settings.style,'techno');
 const signatures=new Set();
 for(const style of Object.keys(STYLES)) {
  applyStyle(settings,style);
  assert.equal(settings.bpm,STYLES[style].bpm);
  for(const pattern of Object.values(settings.patterns)) assert.equal(pattern.length,16);
  const events=patternEvents(settings,0);
  assert.deepEqual(events,patternEvents(JSON.parse(JSON.stringify(settings)),0));
  assert(events.some(e=>e.instrument==='kick'));
  assert(events.every(e=>e.beat>=0 && e.beat<4 && Number.isFinite(e.amp)));
  signatures.add(JSON.stringify(settings.patterns));
 }
 assert.equal(signatures.size,8); assert.equal(other.style,'techno');
 assert.throws(()=>applyStyle(settings,'missing'),/style/i);
 const engine=new Engine(other); assert.equal(engine.playing,false); engine.stop();
});

test('root and scale transpose deterministic progressions; density never deletes the drum pulse',()=>{
 const settings=defaultSettings();settings.density=1;
 const before=JSON.stringify(settings),first=patternEvents(settings,0);
 assert.equal(JSON.stringify(settings),before);
 settings.root=5;
 assert.deepEqual(patternEvents(settings,0).map(e=>e.note),first.map(e=>e.note+5));
 settings.root=0;
 assert.notDeepEqual(patternEvents(settings,0),patternEvents(settings,2));
 settings.seed=100;
 assert.notDeepEqual(patternEvents(settings,0),first);
 settings.density=0;
 const sparse=patternEvents(settings,0);
 assert(sparse.some(e=>e.instrument==='kick'));assert(!sparse.some(e=>e.instrument==='lead'||e.instrument==='pad'));
 settings.density=1;settings.scale='major';
 for(const event of patternEvents(settings,0).filter(e=>['lead','bass','pad'].includes(e.instrument)))assert([0,2,4,5,7,9,11].includes(event.note%12));
});

test('invalid audio files and compiled programs fail before allocating an AudioContext',async()=>{
 const engine=new Engine(defaultSettings());
 await assert.rejects(engine.loadTrack(2,{size:100}),/Deck index/);
 await assert.rejects(engine.loadTrack(0,{size:50*1024*1024}),/40 MB/);
 await assert.rejects(engine.loadTrack(0,{size:0}),/40 MB/);
 await assert.rejects(engine.runCode({bpm:0,loops:[]}),/Invalid/);
 await assert.rejects(engine.runCode({bpm:120,loops:[{beats:0,events:[]}]}),/Invalid/);
 assert.throws(()=>engine.deck(-1,{}),/Deck index/);
 assert.throws(()=>engine.trigger({instrument:'kick'}),/Initialize/);
 engine.pause();engine.stopCode();await engine.dispose();assert.equal(engine.context,null);
});
