import test from 'node:test';
import assert from 'node:assert/strict';
import * as engine from '../web/js/engine.js';

const channels=['kick','snare','hat','bass','lead','pad'];
const bounds={techno:[122,130],house:[118,128],dnb:[166,178],psytrance:[140,150],breakbeat:[128,142],hardcore:[170,194],acid:[130,144],dub:[66,80]};
const active=pattern=>pattern.flatMap((on,i)=>on?[i]:[]);
const inside=(value,min,max)=>assert(Number.isFinite(value)&&value>=min&&value<=max,`${value} outside ${min}..${max}`);

test('default techno is deterministic, deep and barely melodic',()=>{
 const s=engine.defaultSettings();assert.deepEqual(s,engine.defaultSettings());
 assert.equal(s.bpm,engine.STYLES.techno.bpm);inside(s.bpm,124,128);
 inside(s.cutoff,500,1800);inside(s.drive,0,.09);
 assert(['sine','triangle'].includes(s.channels.bass.wave));
 assert.equal(s.channels.kick.wave,'sine');inside(s.channels.kick.decay,.32,.55);
 for(const name of ['lead','pad'])inside(s.channels[name].gain,0,.09);
 assert(active(s.patterns.lead).length<=2);
});

test('many seeds vary every mixer, effect and musical control inside genre constraints',()=>{
 for(const [style,[min,max]] of Object.entries(bounds)){
  const seen=new Map(),capture=(key,value)=>{if(!seen.has(key))seen.set(key,new Set());seen.get(key).add(JSON.stringify(value));};
  for(let seed=1;seed<=96;seed++){
   const s=engine.randomizePreset(engine.defaultSettings(),style,seed);
   const replay=engine.defaultSettings();engine.randomizePreset(replay,'dub',2147483647-seed);
   engine.randomizePreset(replay,style,seed);assert.deepEqual(s,replay);
   inside(s.bpm,min,max);inside(s.root,0,11);assert(Number.isInteger(s.root));inside(s.swing,0,.25);inside(s.density,.15,.95);
   inside(s.cutoff,400,7000);inside(s.resonance,.1,16);inside(s.drive,0,.85);inside(s.delay,0,.65);inside(s.reverb,0,.5);
   for(const key of ['bpm','root','scale','swing','density','cutoff','resonance','drive','delay','reverb'])capture(key,s[key]);
   capture('patterns',s.patterns);
   for(const name of channels){
    const c=s.channels[name];inside(c.gain,0,.95);inside(c.decay,.025,1.8);
    assert(['sine','triangle','square','sawtooth'].includes(c.wave));assert.equal(c.mute,false);assert.equal(c.solo,false);
    assert.equal(s.patterns[name].length,16);assert(s.patterns[name].every(x=>typeof x==='boolean'));
    capture(name+'.gain',c.gain);capture(name+'.decay',c.decay);
   }
   capture('bass.wave',s.channels.bass.wave);capture('lead.wave',s.channels.lead.wave);
   const kick=active(s.patterns.kick),snare=active(s.patterns.snare);
   if(['techno','house','psytrance','hardcore','acid'].includes(style))for(const beat of [0,4,8,12])assert(kick.includes(beat));
   if(['dnb','breakbeat'].includes(style)){assert(kick.includes(0));assert(kick.some(x=>x%4!==0));assert(!kick.includes(4));}
   if(style==='dub'){assert(kick.includes(8));assert(!kick.includes(0));}
   if(style==='psytrance')assert.deepEqual(active(s.patterns.bass),[1,2,3,5,6,7,9,10,11,13,14,15]);
   for(const beat of style==='dub'?[8]:[4,12])assert(snare.includes(beat));
   if(style==='techno'){
    assert(['sine','triangle'].includes(s.channels.bass.wave));
    assert(active(s.patterns.lead).length<=2);
    for(const name of ['lead','pad'])inside(s.channels[name].gain,0,.09);
   }
   const events=engine.patternEvents(s);assert(events.some(e=>e.instrument==='kick'));assert(events.every(e=>Number.isFinite(e.note)&&Number.isFinite(e.duration)));
  }
  for(const [key,values] of seen)assert(values.size>=2,style+' does not vary '+key);
 }
});

test('genre distributions retain their timbral identities across seeds',()=>{
 const families={};
 for(const style of Object.keys(engine.STYLES)){
  const samples=Array.from({length:96},(_,i)=>engine.randomizePreset(engine.defaultSettings(),style,i+1));
  families[style]=Object.fromEntries(['cutoff','resonance','drive','delay','density','swing'].map(key=>[key,samples.reduce((sum,s)=>sum+s[key],0)/samples.length]));
 }
 assert.equal(new Set(Object.values(families).map(x=>JSON.stringify(x))).size,Object.keys(engine.STYLES).length);
 assert(families.techno.cutoff<families.house.cutoff/2);
 assert(families.techno.density<families.house.density);
 for(const [style,mean] of Object.entries(families)){
  if(style!=='acid')assert(families.acid.resonance>mean.resonance*2);
  if(style!=='hardcore')assert(families.hardcore.drive>mean.drive*2);
  if(style!=='dub')assert(families.dub.delay>mean.delay);
 }
 assert(families.house.swing>families.psytrance.swing*4);
});

test('invalid seeds and styles fail atomically, master gain stays safe',()=>{
 const s=engine.defaultSettings(),before=structuredClone(s);
 for(const seed of [0,-1,2147483648,NaN,Infinity,1.2,'42',undefined])assert.throws(()=>engine.randomizePreset(s,'house',seed),/seed/i);
 for(const style of ['missing','constructor','__proto__','toString']){
  assert.throws(()=>engine.randomizePreset(s,style,5),/Unknown style/i);assert.deepEqual(s,before);
 }
 for(const [master,expected] of [[NaN,0],[Infinity,0],[-2,0],[2,1],[0,0],[.7,.7]]){
  s.master=master;engine.randomizePreset(s,'dub',2147483647);assert.equal(s.master,expected);
 }
});
test('seeded presets reset the whole sound independently of previous mixer state',()=>{
 assert.equal(typeof engine.randomizePreset,'function');
 for(const style of Object.keys(engine.STYLES)){
  const fresh=engine.defaultSettings(),dirty=engine.defaultSettings();
  engine.applyStyle(dirty,'hardcore');
  Object.assign(dirty,{master:.42,root:11,scale:'major',density:0,seed:9});
  for(const channel of Object.values(dirty.channels))Object.assign(channel,{gain:1,mute:true,solo:true,wave:'square',decay:2});
  fresh.master=.42;
  assert.equal(engine.randomizePreset(fresh,style,12345),fresh);
  engine.randomizePreset(dirty,style,12345);
  assert.deepEqual(dirty,fresh,style+' must not inherit the previous genre');
  assert.equal(fresh.master,.42);
  assert.equal(fresh.seed,12345);
  assert.equal(fresh.style,style);
  for(const name of channels){assert.equal(fresh.channels[name].mute,false);assert.equal(fresh.channels[name].solo,false);}
 }
});
