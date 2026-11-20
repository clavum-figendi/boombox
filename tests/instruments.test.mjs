import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {INSTRUMENTS,SCALES,instrumentFor,defaultSettings,patternEvents,applyStyle,randomizePreset,STYLES} from '../web/js/engine.js';

const lanes=['kick','snare','hat','bass','lead','pad'];
test('catalogs describe accurate scale spellings and safe lane-compatible patches',()=>{
 const expected={minor:[0,2,3,5,7,8,10],major:[0,2,4,5,7,9,11],dorian:[0,2,3,5,7,9,10],phrygian:[0,1,3,5,7,8,10],pentatonic:[0,3,5,7,10],minor_pentatonic:[0,3,5,7,10],lydian:[0,2,4,6,7,9,11],mixolydian:[0,2,4,5,7,9,10],locrian:[0,1,3,5,6,8,10],harmonic_minor:[0,2,3,5,7,8,11],melodic_minor:[0,2,3,5,7,9,11],major_pentatonic:[0,2,4,7,9],blues:[0,3,5,6,7,10],whole_tone:[0,2,4,6,8,10],diminished:[0,2,3,5,6,8,9,11],hungarian_minor:[0,2,3,6,7,8,11],phrygian_dominant:[0,1,4,5,7,8,10]};
 for(const [id,intervals] of Object.entries(expected)){assert(SCALES[id].name);assert.deepEqual(SCALES[id].intervals,intervals);}
 for(const [id,patch] of Object.entries(INSTRUMENTS)){
  assert(patch.name&&patch.description&&patch.lanes.length);assert.equal(new Set(patch.lanes).size,patch.lanes.length);
  for(const lane of lanes)assert.equal(instrumentFor(lane,id),patch.lanes.includes(lane)?id:'classic');
 }
 assert.deepEqual(INSTRUMENTS.classic.lanes,lanes);
 for(const lane of lanes)for(const invalid of [undefined,null,'missing','constructor','__proto__','toString',{},3])assert.equal(instrumentFor(lane,invalid),'classic');
});

test('every catalog scale remains in key through all roots and progression bars',()=>{
 const s=defaultSettings();s.density=1;for(const pattern of Object.values(s.patterns))pattern.fill(true);
 for(const [id,{intervals}] of Object.entries(SCALES)){
  s.scale=id;
  for(let bar=0;bar<16;bar++){
   s.root=0;const original=patternEvents(s,bar);
   for(let root=0;root<12;root++){
    s.root=root;const events=patternEvents(s,bar);
    assert.deepEqual(events.map(e=>e.note),original.map(e=>e.note+root));
    for(const e of events.filter(e=>['bass','lead','pad'].includes(e.instrument)))assert(intervals.includes((e.note-root)%12),`${id} ${root} ${bar}`);
   }
  }
 }
});

test('legacy channels fall back to classic, genre selection and randomization serialize valid voices',()=>{
 const s=defaultSettings();assert(Object.values(s.channels).every(c=>c.instrument==='classic'));
 for(const lane of lanes)delete s.channels[lane].instrument;
 assert(patternEvents(s).every(e=>e.voice==='classic'));
 for(const lane of lanes)s.channels[lane].instrument='__proto__';
 assert(patternEvents(s).every(e=>e.voice==='classic'));
 for(const style of Object.keys(STYLES)){
  applyStyle(s,style);assert(Object.values(s.channels).some(c=>c.instrument!=='classic'));
  const voices=new Set();
  for(let seed=1;seed<=96;seed++){
   s.master=.47;randomizePreset(s,style,seed);
   const copy=JSON.parse(JSON.stringify(s));assert.deepEqual(copy,s);assert.equal(s.master,.47);
   assert.deepEqual(patternEvents(s,3),patternEvents(copy,3));
   for(const [lane,c] of Object.entries(s.channels)){assert.equal(instrumentFor(lane,c.instrument),c.instrument);assert(!c.mute&&!c.solo);assert(c.decay>=.03&&c.decay<=1.8);}
   voices.add(JSON.stringify(lanes.map(lane=>s.channels[lane].instrument)));
  }
  assert(voices.size>1,style+' must vary voice combinations');
 }
});

// No browser or Python dependency for ordinary npm test. Opt in with the static server URL.
test('real PCM: every patch/lane, pairwise timbre, waveform, mute and complete node cleanup',{skip:!process.env.BOOMBOX_AUDIO_TEST_URL},()=>{
 const program=String.raw`
import os,json
from playwright.sync_api import sync_playwright
with sync_playwright() as p:
 options={'headless':True,'args':['--no-sandbox']}
 if os.environ.get('CHROMIUM_EXECUTABLE'): options['executable_path']=os.environ['CHROMIUM_EXECUTABLE']
 browser=p.chromium.launch(**options)
 page=browser.new_page()
 page.goto(os.environ['BOOMBOX_AUDIO_TEST_URL'])
 result=page.evaluate('''async()=>{
 const {Engine,INSTRUMENTS,defaultSettings}=await import('./js/engine.js');
 const check=(ok,message)=>{if(!ok)throw Error(message);};
 const rms=a=>Math.sqrt(a.reduce((sum,x)=>sum+x*x,0)/a.length);
 const diff=(a,b)=>rms(a.map((x,i)=>x-b[i]));
 const stats=a=>{let peak=0;for(const x of a){check(Number.isFinite(x),'nonfinite PCM');peak=Math.max(peak,Math.abs(x));}return {rms:rms(a),peak};};
 const output={patches:{},waveforms:{},pairs:0,cleanup:0,muted:0};
 async function render(lane,id,wave='sawtooth',stop=false){
  const ctx=new OfflineAudioContext(1,44100,44100),engine=new Engine();engine.context=ctx;engine.graph={channels:{[lane]:ctx.destination}};
  engine.trigger({instrument:lane,voice:id,wave,note:48,duration:.65,amp:.8},stop ? .2 : 0);
  const entries=Array.from(engine.active),checks=[];
  for(const entry of entries){
   if(id==='fm_bell'&&INSTRUMENTS[id].lanes.includes(lane))check(entry.sources.length===2,'FM modulator missing');
   if(id==='glass_pad'&&INSTRUMENTS[id].lanes.includes(lane))check(entry.sources.length===4,'pad modulators missing');
   for(const node of [...entry.sources,...entry.nodes]){const disconnect=node.disconnect.bind(node),record={count:0};checks.push(record);node.disconnect=(...args)=>{record.count++;return disconnect(...args);};}
  }
  if(stop){engine.stop();check(engine.active.size===0,'stop leaked active voice');for(const entry of entries)for(const source of entry.sources)check(source.onended===null,'stop retained source handler');}
  const pcm=(await ctx.startRendering()).getChannelData(0);
  await new Promise(resolve=>setTimeout(resolve,0));
  check(engine.active.size===0,'onended leaked '+id);check(checks.every(c=>c.count>0),'disconnected nodes missing '+id);output.cleanup++;
  return pcm;
 }
 const families={};
 for(const [id,patch] of Object.entries(INSTRUMENTS)){
  output.patches[id]={};
  for(const lane of patch.lanes){
   const pcm=await render(lane,id),s=stats(pcm);check(s.rms>1e-4&&s.peak<1,id+'/'+lane+' silent or clipped '+JSON.stringify(s));output.patches[id][lane]=s;
   (families[lane]??=[]).push({id,pcm});
   const stopped=await render(lane,id,'sawtooth',true);check(rms(stopped)===0,'stopped source leaked audio');
  }
  if(patch.wave!==false&&patch.lanes.includes('lead')){
   const difference=diff(await render('lead',id,'sine'),await render('lead',id,'square'));check(difference>1e-4,id+' wave ignored');output.waveforms[id]=difference;
  }
  const s=defaultSettings();for(const [lane,c] of Object.entries(s.channels)){c.mute=true;if(patch.lanes.includes(lane))c.instrument=id;}
  const blob=await new Engine(s).exportWav(1),decode=new OfflineAudioContext(1,44100,44100),pcm=(await decode.decodeAudioData(await blob.arrayBuffer())).getChannelData(0);check(rms(pcm)===0,id+' muted audio leak');output.muted++;
 }
 for(const [lane,patches] of Object.entries(families))for(let i=0;i<patches.length;i++)for(let j=i+1;j<patches.length;j++){
  check(diff(patches[i].pcm,patches[j].pcm)>1e-4,'identical patches '+lane+' '+patches[i].id+' '+patches[j].id);output.pairs++;
 }
 for(const lane of ['kick','snare','hat','bass','lead','pad']){
  const classic=await render(lane,'classic');for(const id of [undefined,'missing','constructor','__proto__',lane==='kick'?'fm_bell':'kick_808'])check(diff(classic,await render(lane,id))===0,'legacy fallback changed '+lane);
 }
 return output;
}''')
 print(json.dumps(result))
 browser.close()
`;
 const result=spawnSync('python',['-c',program],{encoding:'utf8',timeout:120000,env:process.env});
 assert.equal(result.status,0,result.stderr||result.error?.message);console.log(result.stdout.trim());
});
