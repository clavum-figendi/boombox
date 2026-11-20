import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {defaultSettings,applyStyle,patternEvents,STYLES,Engine} from '../web/js/engine.js';

test('styles generate distinct deterministic musical patterns without shared state',()=>{
 const settings=defaultSettings(), other=defaultSettings();
 assert.equal(settings.bpm,STYLES.techno.bpm); assert.equal(settings.style,'techno');
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

test('pad decay controls generated voice duration',()=>{
 const settings=defaultSettings();settings.density=1;settings.channels.pad.decay=.45;
 assert.equal(patternEvents(settings).find(e=>e.instrument==='pad').duration,.45);
 settings.channels.pad.decay=2;
 assert.equal(patternEvents(settings).find(e=>e.instrument==='pad').duration,2);
});

test('playhead follows scheduled playback across tempo changes, not lookahead',()=>{
 const settings=defaultSettings();for(const pattern of Object.values(settings.patterns))pattern.fill(false);
 settings.bpm=120;
 const engine=new Engine(settings);engine.context={currentTime:1};engine._playing=true;
 engine.origin=0;engine.tickIndex=8;engine.nextStep=1;
 engine._schedule();assert.equal(engine.step,8);
 settings.bpm=60;assert.equal(engine.step,8);
 engine.context.currentTime=1.13;engine._schedule();assert.equal(engine.step,9);
 engine.context.currentTime=1.2;engine._schedule();assert.equal(engine.step,9);
 engine.pause();assert.equal(engine.step,9);
 engine._playing=true;
 for(let i=0;i<1000;i++){engine.context.currentTime+=.1;engine._schedule();}
 assert(engine.stepTimeline.length<=2,'scheduler must prune elapsed playhead entries even without a UI reader');
 engine.pause();
});

test('groove scheduler skips missed beats after a long throttled-tab gap',()=>{
 const settings=defaultSettings();settings.bpm=120;for(const p of Object.values(settings.patterns))p.fill(false);
 const engine=new Engine(settings);engine.context={currentTime:600};engine._playing=true;
 engine.nextStep=0;engine._schedule();
 assert(engine.stepTimeline.length<=2,'missed beats must not be scheduled in a burst');
 assert(engine.stepTimeline.every(e=>e.time>=600));
 assert(engine.tickIndex>=4800);engine.pause();
});

test('code scheduler skips missed cycles instead of replaying stale notes',()=>{
 const engine=new Engine(defaultSettings()),triggered=[];engine.context={currentTime:600};
 const loop={beats:1,events:[{beat:0,instrument:'kick'}]};
 engine.code={compiled:{bpm:120},loops:[{loop,cycle:0,index:0}],start:0};
 engine.trigger=(event,time)=>triggered.push(time);engine._scheduleCode();
 assert(triggered.length<=1,'missed code cycles must not burst');
 assert(triggered.every(time=>time>=599.95));engine.stopCode();
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

// Opt in against the project's static server with Python Playwright installed.
test('real Chromium PCM: drum timbre, envelopes, isolated FX and silence', {skip:!process.env.BOOMBOX_AUDIO_TEST_URL},()=>{
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
 const {Engine,defaultSettings,applyStyle,randomizePreset,STYLES}=await import('./js/engine.js');
 const {compile}=await import('./js/code.js');
 const rms=(a,start=0,end=a.length)=>{let sum=0;for(let i=start;i<end;i++)sum+=a[i]*a[i];return Math.sqrt(sum/(end-start));};
 const diff=(a,b)=>rms(a.map((x,i)=>x-b[i]));
 const check=(ok,message)=>{if(!ok)throw Error(message);};
 async function voice(event){const ctx=new OfflineAudioContext(1,88200,44100),engine=new Engine();engine.context=ctx;engine.graph={channels:{[event.instrument]:ctx.destination}};engine.trigger(event,0);return (await ctx.startRendering()).getChannelData(0);}
 const out={drums:{},styles:{},effects:{},presets:{}};
 const kick=await voice({instrument:'kick',wave:'sine',duration:.42,amp:.8}),crossings=[];
 for(let i=1;i<kick.length;i++)if(kick[i-1]<0&&kick[i]>=0)crossings.push(i/44100);
 const early=1/(crossings[1]-crossings[0]),late=crossings.filter(t=>t>.15&&t<.3);
 out.kick={earlyHz:early,settledHz:(late.length-1)/(late[late.length-1]-late[0]),rms:rms(kick,441,13230)};
 check(out.kick.earlyHz<115,'kick attack must be rounded, not a bright 150 Hz transient');
 check(out.kick.settledHz>41&&out.kick.settledHz<42.7,'kick must settle to a deep 42 Hz sub');
 check(out.kick.rms>.005,'deep kick must be audible');
 for(const instrument of ['kick','snare']){
  const base={instrument,duration:.3,amp:.8,note:48};
  out.drums[instrument]=diff(await voice({...base,wave:'sine'}),await voice({...base,wave:'square'}));
  check(out.drums[instrument]>1e-4,instrument+' waveform has no audible effect');
 }
 const event=compile('use_bpm 60\\nplay 60, attack: 0.5, sustain: 0.2, release: 0.2\\nsleep 1').loops[0].events[0];
 const env=await voice(event);
 out.attack={early:rms(env,1323,2646),late:rms(env,15435,17640),tail:rms(env,44100,88200)};
 check(out.attack.late>out.attack.early*3,'attack must rise rather than immediately decay');
 check(out.attack.tail<1e-7,'envelope must finish');
 async function render(settings,seconds=2){const wav=await new Engine(settings).exportWav(seconds),ctx=new OfflineAudioContext(1,44100,44100);return (await ctx.decodeAudioData(await wav.arrayBuffer())).getChannelData(0);}
 for(const style of Object.keys(STYLES)){
  const s=defaultSettings();applyStyle(s,style);out.styles[style]=rms(await render(s));check(out.styles[style]>1e-4,style+' silent');
  out.presets[style]=[];
  for(const seed of [1,42,98765]){
   randomizePreset(s,style,seed);const pcm=await render(s),level=rms(pcm);let peak=0;
   for(const sample of pcm){check(Number.isFinite(sample),'non-finite PCM');peak=Math.max(peak,Math.abs(sample));}
   out.presets[style].push({seed,rms:level,peak});check(level>.001&&peak<1,style+' randomized audio must be audible without clipping');
  }
 }
 const s=defaultSettings();s.bpm=30;s.delay=0;s.reverb=0;s.drive=0;s.cutoff=18000;s.resonance=.1;
 for(const [name,pattern] of Object.entries(s.patterns)){pattern.fill(false);if(name==='kick')pattern[0]=true;}
 const dry=await render(s,6);
 for(const [name,value] of [['delay',.7],['reverb',.7],['drive',.8],['cutoff',100]]){const wet=await render({...s,[name]:value},6);out.effects[name]={difference:diff(dry,wet),tail:rms(wet,220500,264600)};check(out.effects[name].difference>1e-4,name+' must change PCM');check(out.effects[name].tail<1e-4,name+' tail must decay');}
 for(const c of Object.values(s.channels))c.mute=true;
 out.muted=rms(await render(s));check(out.muted===0,'muted render must be silent');
 return out;
}''')
 page.evaluate('''()=>{
 const button=document.createElement('button');button.id='audio-stop-probe';button.textContent='Audio stop probe';document.body.prepend(button);
 window.stopProbe=new Promise((resolve,reject)=>{button.onclick=async()=>{try{
 const {Engine,defaultSettings}=await import('./js/engine.js');const s=defaultSettings();s.delay=.7;s.reverb=.7;
 const engine=new Engine(s);await engine.play();await new Promise(r=>setTimeout(r,600));
 const rms=()=>{const data=new Float32Array(1024);engine.analyser.getFloatTimeDomainData(data);return Math.sqrt(data.reduce((sum,x)=>sum+x*x,0)/data.length);};
 const before=rms();engine.stop();const active=engine.active.size;
 await new Promise(r=>setTimeout(r,5000));const after=rms();await engine.dispose();resolve({before,after,active});
 }catch(error){reject(error);}};});
 }''')
 page.click('#audio-stop-probe')
 result['stop']=page.evaluate('window.stopProbe')
 assert result['stop']['before']>1e-4,result
 assert result['stop']['active']==0,result
 assert result['stop']['after']<1e-4,result
 print(json.dumps(result))
 browser.close()
`;
 const result=spawnSync('python',['-c',program],{encoding:'utf8',timeout:120000,env:process.env});
 assert.equal(result.status,0,result.stderr||result.error?.message);
 console.log(result.stdout.trim());
});
