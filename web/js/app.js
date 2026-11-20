import { STYLES, defaultSettings, applyStyle, randomizePreset, Engine } from './engine.js';
import { compile, EXAMPLES } from './code.js';

const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];
const LANES = ['kick', 'snare', 'hat', 'bass', 'lead', 'pad'];
const STORE = 'boombox.project.v1', LOOK = 'boombox.look.v1';
const VISITS = 'boombox.freshVisits.v1', WELCOME = 'boombox.welcome.v1';
let freshVisits = true;
function freshSound(key = settings.style) {
  const words = new Uint32Array(1);
  let seed;
  do { crypto.getRandomValues(words); seed = words[0] & 0x7fffffff; } while (!seed || seed === settings.seed);
  const master = settings.master;
  randomizePreset(settings,key,seed);
  settings.master = master;
}
const LIMITS = { bpm:[40,240], seed:[1,2147483647], root:[0,11], swing:[0,.45], density:[0,1], master:[0,1], cutoff:[40,20000], resonance:[0,18], drive:[0,1], delay:[0,.8], reverb:[0,1] };
const SCALES = ['minor','major','dorian','phrygian','pentatonic'];
const WAVES = ['sine','triangle','sawtooth','square'];
const clamp = (n,min,max) => Math.min(max,Math.max(min,n));
let settings = defaultSettings();
let code = Object.values(EXAMPLES)[0] || '';
function safeCode(value) {
  if (typeof value !== 'string' || value.length > 64000) throw new Error('Invalid project code: expected a string of at most 64000 characters.');
  return value;
}
let look = { theme:'amber', textSize:'normal', motion:true };
let elapsed = 0, timer = 0, lastTick = performance.now(), recording = false, registration;
let raf = 0, lastStep = -1, started = false;
const reduced = matchMedia('(prefers-reduced-motion: reduce)');
const decks = [{loaded:false,playing:false,duration:0,peaks:[]},{loaded:false,playing:false,duration:0,peaks:[]}];
function announce(message, target = '#status') { $(target).textContent = message; }
function errorMessage(error) { return error instanceof Error ? error.message : String(error); }
function guarded(fn, target='#status') { return async event => { try { await fn(event); } catch(error) { announce(errorMessage(error),target); } }; }
function safeSettings(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Invalid project: expected a settings object.');
  const result = defaultSettings();
  if (typeof input.style === 'string' && Object.prototype.hasOwnProperty.call(STYLES,input.style)) applyStyle(result,input.style);
  for (const [key,[min,max]] of Object.entries(LIMITS)) {
    if (typeof input[key] === 'number' && Number.isFinite(input[key])) result[key] = clamp(input[key],min,max);
  }
  result.seed = Math.round(result.seed); result.root = Math.round(result.root); result.bpm = Math.round(result.bpm);
  if (SCALES.includes(input.scale)) result.scale = input.scale;
  for (const lane of LANES) {
    const ch = input.channels?.[lane];
    if (ch && typeof ch === 'object') {
      if (typeof ch.gain === 'number' && Number.isFinite(ch.gain)) result.channels[lane].gain = clamp(ch.gain,0,1);
      if (typeof ch.decay === 'number' && Number.isFinite(ch.decay)) result.channels[lane].decay = clamp(ch.decay,.03,4);
      if (typeof ch.mute === 'boolean') result.channels[lane].mute = ch.mute;
      if (typeof ch.solo === 'boolean') result.channels[lane].solo = ch.solo;
      if (WAVES.includes(ch.wave)) result.channels[lane].wave = ch.wave;
    }
    const pattern = input.patterns?.[lane];
    if (Array.isArray(pattern) && pattern.length === 16 && pattern.every(x=>typeof x === 'boolean')) result.patterns[lane] = pattern.slice();
  }
  return result;
}
try {
  const saved = localStorage.getItem(STORE);
  if(saved) {
    const parsed = JSON.parse(saved);
    if(parsed?.version === 1 && parsed.settings) {
      const restored = safeSettings(parsed.settings);
      const restoredCode = Object.prototype.hasOwnProperty.call(parsed,'code') ? safeCode(parsed.code) : code;
      settings = restored; code = restoredCode;
    } else settings = safeSettings(parsed);
  }
  const savedLook = JSON.parse(localStorage.getItem(LOOK) || 'null');
  if(savedLook) {
    if(['amber','mint','light','system'].includes(savedLook.theme)) look.theme=savedLook.theme;
    if(['normal','large'].includes(savedLook.textSize)) look.textSize=savedLook.textSize;
    if(typeof savedLook.motion==='boolean') look.motion=savedLook.motion;
  }
} catch { announce('Stored project could not be read. Starting fresh; export JSON to keep a backup.'); }
try { freshVisits = localStorage.getItem(VISITS) !== 'false'; } catch { /* Local preferences are optional. */ }
if (freshVisits) freshSound();
const engine = new Engine(settings);
window.boombox = { engine, get settings() { return settings; } };
function persist() {
  try { localStorage.setItem(STORE,JSON.stringify({version:1,settings,code})); }
  catch { announce('Changes work for this visit, but browser storage is unavailable. Export JSON for a backup.'); }
}
function updateSound() { engine.update(settings); persist(); syncReadouts(); drawScore(); }
function saveLook() {
  document.documentElement.dataset.theme = look.theme;
  document.documentElement.dataset.text = look.textSize;
  $('#theme').value=look.theme; $('#textSize').value=look.textSize; $('#motion').checked=look.motion;
  try { localStorage.setItem(LOOK,JSON.stringify(look)); }
  catch { announce('Appearance applied for this visit; browser storage is unavailable.','#settingsStatus'); }
  drawScore(); scheduleVisuals();
}
function make(tag,className,text) { const el=document.createElement(tag); if(className)el.className=className; if(text!==undefined)el.textContent=text; return el; }
function rangeControl(title,value,min,max,step,onInput,format=n=>`${Math.round(n*100)}%`) {
  const label=make('label','control',title), output=make('output','',format(value)), input=make('input');
  input.type='range'; input.min=min; input.max=max; input.step=step; input.value=value; input.setAttribute('aria-label',title);
  label.append(output,input); input.addEventListener('input',()=>{output.textContent=format(Number(input.value));onInput(Number(input.value));}); return label;
}
const genreMarks = {techno:'╎╎╎╎',house:'⌁⌁',dnb:'╱╲╱',psytrance:'⋰⋱',breakbeat:'╎╎·╎',hardcore:'╱╱╱',acid:'∿∿',dub:'◦◯'};
const voiceHints = {
  kick:'The low drum thump marks the pulse; gain balances its punch.',
  bass:'Pitched low notes add movement beneath the kick. Leave room for both.',
  snare:'The crisp backbeat gives the rhythm its snap.',
  hat:'Bright noise ticks subdivide the beat and add pace.',
  lead:'The foreground melody. Gain brings it forward; steps place notes and Density adds activity.',
  pad:'A sustained chord bed behind the melody. Longer decay lets chords overlap.'
};
const toneHints = {wave:'Wave changes tone: sine is round, triangle soft, saw bright, square hollow. Percussion has its own voice shaping.',decay:'Decay is how long a voice rings after each hit, in seconds.'};
const effectHints = {cutoff:'Cutoff removes brightness above this frequency. Lower it for a darker mix.',resonance:'Resonance emphasizes the filter edge. High values can become piercing; start gently.',drive:'Drive adds grit and harmonics to the mix.',delay:'Delay adds rhythmic echoes.',reverb:'Reverb adds a room-like tail and space.'};
for(const [key,style] of Object.entries(STYLES)) {
  const b=make('button','genre'); b.type='button'; b.dataset.genre=key; b.setAttribute('aria-pressed',String(key===settings.style));
  b.append(make('span','genre-mark',genreMarks[key]||'∿'),make('span','genre-name',style.name),make('small','',String(style.bpm)));
  b.title=style.description; b.addEventListener('click',()=>{freshSound(key);updateSound();renderSettings();announce(`${style.name} variation loaded. Make it yours.`);}); $('#genres').append(b);
}
['C','C♯','D','D♯','E','F','F♯','G','G♯','A','A♯','B'].forEach((note,i)=>{const o=make('option','',note);o.value=i;$('#root').append(o);});
function renderSequencer() {
  const grid=$('#sequencer');grid.replaceChildren(make('span'));
  for(let i=0;i<16;i++)grid.append(make('span',`step-number${i%4===0?' beat':''}`,String(i+1).padStart(2,'0')));
  LANES.forEach((lane,row)=>{
    const label=make('div','lane-label');label.append(make('small','',String(row+1).padStart(2,'0')),document.createTextNode(lane.toUpperCase()));grid.append(label);
    for(let i=0;i<16;i++) {
      const b=make('button',`step${row>=3?' synth':''}${i%4===0?' quarter':''}`);b.type='button';b.dataset.lane=lane;b.dataset.step=i;
      b.setAttribute('aria-label',`${lane} step ${i+1}`);b.setAttribute('aria-pressed',String(settings.patterns[lane][i]));
      b.addEventListener('click',()=>{settings.patterns[lane][i]=!settings.patterns[lane][i];b.setAttribute('aria-pressed',String(settings.patterns[lane][i]));updateSound();});grid.append(b);
    }
  });lastStep=-1;
}
function renderMixer() {
  $('#mixer').replaceChildren();
  LANES.forEach(lane=>{
    const ch=settings.channels[lane], strip=make('section','channel');strip.dataset.channel=lane;strip.append(make('h3','',lane),make('p','fine',voiceHints[lane]));strip.title=voiceHints[lane];
    const switches=make('div','mute-solo');
    for(const key of ['mute','solo']) { const b=make('button','',key==='mute'?'M':'S');b.title=key==='mute'?'Mute silences this voice.':'Solo isolates this voice; multiple solos can play together.';b.setAttribute('aria-label',`${key} ${lane}`);b.setAttribute('aria-pressed',String(ch[key]));b.addEventListener('click',()=>{ch[key]=!ch[key];b.setAttribute('aria-pressed',String(ch[key]));updateSound();});switches.append(b); }
    strip.append(switches,rangeControl(`${lane} gain`,ch.gain,0,1,.01,value=>{ch.gain=value;updateSound();}));
    const label=make('label','control','Wave'), select=make('select');select.setAttribute('aria-label',`${lane} waveform`);
    WAVES.forEach(w=>{const o=make('option','',w.replace('sawtooth','saw'));o.value=w;select.append(o);});select.value=ch.wave;select.title=toneHints.wave;select.addEventListener('change',()=>{ch.wave=select.value;updateSound();});label.append(select);
    if(lane!=='hat')strip.append(label);
    else strip.append(make('p','fine','Noise percussion'));
    const decay=rangeControl(`${lane} decay`,ch.decay,.03,4,.01,value=>{ch.decay=value;updateSound();},n=>`${n.toFixed(2)}s`);decay.title=toneHints.decay;
    strip.append(decay,make('p','fine','Wave = tone · Decay = ring length'));$('#mixer').append(strip);
  });
  $('#effects').replaceChildren();
  const fx=[['cutoff','Cutoff',40,20000,10,n=>`${Math.round(n)} Hz`],['resonance','Resonance',0,18,.1,n=>n.toFixed(1)],['drive','Drive',0,1,.01],['reverb','Reverb',0,1,.01],['delay','Delay',0,.8,.01]];
  fx.forEach(([key,title,min,max,step,format])=>{const control=rangeControl(title,settings[key],min,max,step,value=>{settings[key]=value;updateSound();},format);control.dataset.effect=key;control.title=effectHints[key];control.append(make('span','fine',effectHints[key]));$('#effects').append(control);});
}
function syncReadouts() {
  const style=STYLES[settings.style]; $('#styleTitle').replaceChildren(document.createTextNode(style.name),make('span','','.'));
  $('#styleDescription').textContent=style.description;$('#transportStyle').textContent=style.name.toUpperCase();$('#transportBpm').textContent=`${settings.bpm} BPM`;
  $('#swingValue').textContent=`${Math.round(settings.swing*100)}%`;$('#densityValue').textContent=`${Math.round(settings.density*100)}%`;
  $$('[data-genre]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.genre===settings.style)));
}
function renderSettings() { $$('[data-setting]').forEach(input=>input.value=settings[input.dataset.setting]);syncReadouts();renderSequencer();renderMixer();drawScore(); }
$$('[data-setting]').forEach(input=>input.addEventListener('input',()=>{
  const key=input.dataset.setting;
  if(key==='scale')settings.scale=input.value;
  else {const n=Number(input.value),limits=LIMITS[key];if(!Number.isFinite(n)||input.value==='')return;settings[key]=clamp(n,...limits);if(['seed','root','bpm'].includes(key))settings[key]=Math.round(settings[key]);}
  updateSound();
}));
$('#variation').addEventListener('click',()=>{
  freshSound();
  updateSound();renderSettings();announce(`New genre variation · seed ${settings.seed}. Master volume preserved.`);
});
$$('[data-view]').forEach(b=>b.addEventListener('click',()=>{
  $$('[data-view]').forEach(x=>x.setAttribute('aria-pressed',String(x===b)));
  ['groove','remix','code'].forEach(v=>$(`#${v}View`).hidden=v!==b.dataset.view);
  if(b.dataset.view==='remix')decks.forEach((d,i)=>drawWave(i));
}));
let opener;
$$('[data-open]').forEach(b=>b.addEventListener('click',()=>{opener=b;$('#'+b.dataset.open).showModal();}));
$$('dialog').forEach(dialog=>{
  dialog.querySelector('[data-close]').addEventListener('click',()=>dialog.close());
  dialog.addEventListener('click',e=>{if(e.target===dialog){const r=dialog.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)dialog.close();}});
  dialog.addEventListener('close',()=>{if(dialog.id!=='tourSheet')opener?.focus();});
  dialog.addEventListener('keydown',e=>{
    if(e.key!=='Tab')return;
    const controls=[...dialog.querySelectorAll('button,input,select,textarea,a[href],[tabindex]')].filter(el=>!el.disabled&&el.tabIndex>=0&&el.getClientRects().length);
    const first=controls[0],last=controls[controls.length-1];
    if(!first)return;
    if(e.shiftKey&&(document.activeElement===first||document.activeElement===dialog)){e.preventDefault();last.focus();}
    else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus();}
  });
});
const tourSteps = [
  {title:'Kick vs bass',text:'Kick is a short drum thump; bass plays pitched low notes. Try lowering kick gain a little, then compare the bass level. Keep master low when you listen.',voices:['kick','bass']},
  {title:'Hats & snare',text:'Hats are bright timekeeping ticks; snare adds the backbeat. Short hat decay is tight, longer decay adds a wash. Try muting one voice to hear what it contributes.',voices:['hat','snare']},
  {title:'Lead: your melody',text:'Lead carries the tune. Gain brings it forward, lit steps decide when notes play, and Density controls generated activity. Try toggling a lead step or lowering Density for more space.',voices:['lead'],melody:true},
  {title:'Pad, wave & decay',text:'Pad fills the space behind the lead with chords. Wave chooses the tone: sine is round, saw is bright, square is hollow. Decay chooses how long a note rings. Try a softer wave or shorter decay.',voices:['pad']},
  {title:'Filter & resonance',text:'Cutoff darkens or opens the shared mix. Resonance accents the filter edge. Try lowering cutoff, then gently adding resonance; high resonance can be sharp.',effects:['cutoff','resonance']},
  {title:'Drive, delay & reverb',text:'Drive adds grit, delay repeats echoes, reverb adds space. Try reducing one effect to hear a drier, clearer groove. These affect every voice together.',effects:['drive','delay','reverb']},
  {title:'Mute, solo & master',text:'M mutes a voice; S solos it. Multiple soloed voices play together. Master controls overall listening level, not the balance between instruments. Nothing here starts audio: finish, then press Play when ready.',voices:['lead'],master:true}
];
let tourIndex=0, tourOpener;
function dismissWelcome() {
  $('#welcome').hidden=true;
  try { localStorage.setItem(WELCOME,'seen'); } catch { /* Dismissal still works for this visit. */ }
}
try { $('#welcome').hidden=localStorage.getItem(WELCOME)==='seen'; } catch { $('#welcome').hidden=false; }
$('#dismissWelcome').addEventListener('click',()=>{dismissWelcome();$('#play').focus();});
function renderTour() {
  const step=tourSteps[tourIndex], controls=$('#tourControls');
  renderMixer();controls.replaceChildren();
  $('#tourTitle').textContent=step.title;$('#tourText').textContent=step.text;
  $('#tourProgress').textContent=`INSTRUMENT TOUR / ${tourIndex+1} OF ${tourSteps.length}`;
  for(const lane of step.voices||[])controls.append($(`#mixer [data-channel="${lane}"]`));
  for(const effect of step.effects||[])controls.append($(`#effects [data-effect="${effect}"]`));
  if(step.melody) {
    controls.append(rangeControl('Melody density',settings.density,0,1,.01,value=>{settings.density=value;$('#density').value=value;updateSound();}));
    const steps=make('div','tour-steps');steps.setAttribute('aria-label','Lead melody steps');
    for(let i=0;i<16;i++) {
      const b=make('button','',String(i+1));b.setAttribute('aria-label',`Tour lead step ${i+1}`);b.setAttribute('aria-pressed',String(settings.patterns.lead[i]));
      b.addEventListener('click',()=>{settings.patterns.lead[i]=!settings.patterns.lead[i];b.setAttribute('aria-pressed',String(settings.patterns.lead[i]));updateSound();renderSequencer();});steps.append(b);
    }
    controls.append(steps);
  }
  if(step.master)controls.append(rangeControl('Tour master volume',settings.master,0,1,.01,value=>{settings.master=value;$('#master').value=value;updateSound();}));
  $('#tourBack').disabled=tourIndex===0;$('#tourNext').textContent=tourIndex===tourSteps.length-1?'Done':'Next';
  $('#tourSheet').scrollTop=0;$('#tourTitle').focus();
}
function openTour(button,index=0) {
  tourOpener=button;tourIndex=index;
  // Keep the inline welcome until closing so focus can return to its launch button.
  try { localStorage.setItem(WELCOME,'seen'); } catch { /* The tour also works without storage. */ }
  $('#tourSheet').showModal();renderTour();
}
$$('[data-tour]').forEach(button=>button.addEventListener('click',()=>openTour(button)));
$('#melodyQuick').addEventListener('click',e=>openTour(e.currentTarget,2));
$('#tourNext').addEventListener('click',()=>{if(tourIndex===tourSteps.length-1)$('#tourSheet').close();else {tourIndex++;renderTour();}});
$('#tourBack').addEventListener('click',()=>{if(tourIndex>0){tourIndex--;renderTour();}});
$('#tourSkip').addEventListener('click',()=>$('#tourSheet').close());
$('#tourSheet').addEventListener('close',()=>{renderSettings();tourOpener?.focus();});
$('#theme').addEventListener('change',e=>{look.theme=e.target.value;saveLook();});
$('#textSize').addEventListener('change',e=>{look.textSize=e.target.value;saveLook();});
$('#motion').addEventListener('change',e=>{look.motion=e.target.checked;saveLook();});
$('#freshVisits').checked=freshVisits;
$('#freshVisits').addEventListener('change',e=>{
  freshVisits=e.target.checked;
  try { localStorage.setItem(VISITS,String(freshVisits)); }
  catch { announce('Visit preference applies now, but browser storage is unavailable.','#settingsStatus'); }
});
function syncPlay() {
  document.body.classList.toggle('is-playing',!!engine.playing);$('#play').replaceChildren(document.createTextNode(engine.playing?'Ⅱ ':'▶ '),make('span','',engine.playing?'Pause':'Play'));
  $('#play').setAttribute('aria-label',engine.playing?'Pause groovebox':'Play groovebox');$('#playState').textContent=engine.playing?'PLAYING':'STANDBY';scheduleVisuals();drawScore();
}
async function initAudio() { await engine.init();started=true; }
async function togglePlay() { if(engine.playing)engine.pause();else {await initAudio();await engine.play();}syncPlay();announce(engine.playing?'Groovebox playing.':'Groovebox paused.'); }
function stopAll() {
  engine.stop();engine.stopCode();decks.forEach((d,i)=>{if(d.loaded)engine.deck(i,{playing:false});d.playing=false;const b=$(`#deckPlay${i}`);if(b){b.textContent='▶ Play';b.setAttribute('aria-pressed','false');}});
  elapsed=0;syncPlay();updateClock();announce('All audio stopped.');
}
$('#play').addEventListener('click',guarded(togglePlay));$('#stop').addEventListener('click',guarded(stopAll));
document.addEventListener('keydown',e=>{
  if(e.code==='Space'&&!e.repeat&&!e.ctrlKey&&!e.altKey&&!e.metaKey&&!$('dialog[open]')&&!e.target.closest('input,textarea,select,button,a,summary,[contenteditable]')) {e.preventDefault();guarded(togglePlay)();}
});
function updateClock() {const seconds=Math.floor(elapsed);$('#elapsed').textContent=`${String(Math.floor(seconds/60)).padStart(2,'0')}:${String(seconds%60).padStart(2,'0')}`;}
setInterval(()=>{const now=performance.now(),delta=(now-lastTick)/1000;lastTick=now;if(engine.playing){elapsed+=delta;updateClock();if(timer&&elapsed>=timer*60){stopAll();announce('Session complete. All audio stopped.');}}updateStep();},70);
$('#timer').addEventListener('change',e=>{timer=Number(e.target.value);elapsed=0;updateClock();$('#timerLabel').textContent=timer?`${timer} min`:'No timer';announce(timer?`Timer set for ${timer} minutes of playback.`:'Session timer off.');});
function updateStep() {
  const step=engine.playing?((Number(engine.step)||0)%16+16)%16:-1;if(step===lastStep)return;lastStep=step;
  $$('.step[aria-current]').forEach(b=>b.removeAttribute('aria-current'));if(step>=0)$$(`.step[data-step="${step}"]`).forEach(b=>b.setAttribute('aria-current','true'));
  $('#beatReadout').textContent=step>=0?`${String(Math.floor(step/4)+1).padStart(2,'0')} : ${String(step%4+1).padStart(2,'0')}`:'01 : 01';
  if(!look.motion||reduced.matches)drawScore();
}
function canvasContext(canvas) {
  const r=canvas.getBoundingClientRect();if(!r.width||!r.height)return null;const dpr=Math.min(devicePixelRatio||1,2);
  if(canvas.width!==Math.round(r.width*dpr)||canvas.height!==Math.round(r.height*dpr)){canvas.width=Math.round(r.width*dpr);canvas.height=Math.round(r.height*dpr);}
  const ctx=canvas.getContext('2d');ctx.setTransform(dpr,0,0,dpr,0,0);return {ctx,w:r.width,h:r.height};
}
function drawScore() {
  const data=canvasContext($('#score'));if(!data)return;const {ctx,w,h}=data,css=getComputedStyle(document.documentElement);
  ctx.clearRect(0,0,w,h);const accent=css.getPropertyValue('--accent').trim(),lime=css.getPropertyValue('--lime').trim(),line=css.getPropertyValue('--line').trim();
  const left=20,right=w-5,top=65,bottom=h-45,cw=(right-left)/16,rh=(bottom-top)/6;
  const activeMotion=engine.playing&&look.motion&&!reduced.matches&&!document.hidden;
  LANES.forEach((lane,row)=>{ctx.strokeStyle=line;ctx.lineWidth=.6;ctx.beginPath();ctx.moveTo(left,top+row*rh+rh/2);ctx.lineTo(right,top+row*rh+rh/2);ctx.stroke();for(let i=0;i<16;i++){if(!settings.patterns[lane][i])continue;const x=left+i*cw,y=top+row*rh;ctx.globalAlpha=activeMotion&&i===lastStep?1:.6;ctx.fillStyle=row<3?accent:lime;ctx.fillRect(x+3,y+rh*.25,Math.max(2,cw-9),rh*.5);}});
  ctx.globalAlpha=1;if(activeMotion&&lastStep>=0){ctx.fillStyle=lime;ctx.globalAlpha=.12;ctx.fillRect(left+lastStep*cw,top-8,cw,bottom-top+15);ctx.globalAlpha=1;}
}
function scheduleVisuals() {
  cancelAnimationFrame(raf);raf=0;if(!engine.playing||document.hidden||!look.motion||reduced.matches)return;
  raf=requestAnimationFrame(()=>{drawScore();scheduleVisuals();});
}
document.addEventListener('visibilitychange',scheduleVisuals);reduced.addEventListener?.('change',()=>{scheduleVisuals();drawScore();});
window.addEventListener('resize',()=>{drawScore();decks.forEach((d,i)=>drawWave(i));});
function buildDeck(index) {
  const deck=make('section','deck'),heading=make('div','deck-heading'),name=make('p','deck-name','No audio loaded'),wave=make('canvas','waveform');name.id=`deckName${index}`;wave.id=`wave${index}`;wave.setAttribute('aria-label',`Deck ${index?'B':'A'} uploaded waveform`);
  const upload=make('label','file-button','Load local audio ↑'),file=make('input');file.type='file';file.accept='audio/*';file.setAttribute('aria-label',`Load deck ${index?'B':'A'}`);upload.append(file);heading.append(make('h3','',index?'B /':'A /'),upload);deck.append(heading,name,wave);
  const controls=make('div','inline'),play=make('button','','▶ Play'),stop=make('button','','■ Stop'),reverse=make('button','','Reverse');play.id=`deckPlay${index}`;play.setAttribute('aria-pressed','false');reverse.setAttribute('aria-pressed','false');controls.append(play,stop,reverse);deck.append(controls);
  const sliders=make('div','deck-controls');
  const specs=[['gain','Gain',.8,0,1,.01,n=>`${Math.round(n*100)}%`],['rate','Rate',1,.5,2,.01,n=>`${n.toFixed(2)}×`],['cutoff','Cutoff',20000,40,20000,10,n=>`${Math.round(n)} Hz`],['low','Low EQ',0,-24,12,.5,n=>`${n>0?'+':''}${n} dB`],['mid','Mid EQ',0,-24,12,.5,n=>`${n>0?'+':''}${n} dB`],['high','High EQ',0,-24,12,.5,n=>`${n>0?'+':''}${n} dB`]];
  specs.forEach(([key,title,v,min,max,step,format])=>sliders.append(rangeControl(title,v,min,max,step,value=>{decks[index][key]=value;if(decks[index].loaded)engine.deck(index,{[key]:value});},format)));deck.append(sliders);
  const loops=make('div','loop-inputs');['start','end'].forEach(key=>{const label=make('label','',key==='start'?'LOOP IN / seconds':'LOOP OUT / seconds'),input=make('input');input.type='number';input.min=0;input.max=0;input.step=.01;input.value=0;input.id=`deck${index}${key}`;input.setAttribute('aria-label',`Deck ${index?'B':'A'} loop ${key}`);input.addEventListener('change',guarded(()=>{
    if(!decks[index].loaded)return;const a=Number($(`#deck${index}start`).value),b=Number($(`#deck${index}end`).value);
    if(!Number.isFinite(a)||!Number.isFinite(b)||a<0||b>decks[index].duration||b-a<.05)throw new Error('Loop out must be later than loop in, within the track duration.');
    engine.deck(index,{start:a/decks[index].duration,end:b/decks[index].duration});announce('Loop points updated.');
  }));label.append(input);loops.append(label);});deck.append(loops);$('#decks').append(deck);
  file.addEventListener('change',guarded(async()=>{
    const selected=file.files[0];if(!selected)return;if(selected.size>40*1024*1024)throw new Error('Choose a track smaller than 40 MB.');
    name.textContent=`Decoding ${selected.name}…`;file.disabled=true;
    try {await initAudio();const track=await engine.loadTrack(index,selected);const d=decks[index];d.loaded=true;d.playing=false;d.duration=track.duration;d.peaks=track.peaks;name.textContent=`${track.name} · ${track.duration.toFixed(1)}s`;play.textContent='▶ Play';play.setAttribute('aria-pressed','false');reverse.setAttribute('aria-pressed','false');
      for(const key of ['start','end']){const input=$(`#deck${index}${key}`);input.max=track.duration;input.value=key==='start'?0:track.duration.toFixed(2);}
      const patch={playing:false,start:0,end:1,reverse:false};for(const key of ['gain','rate','low','mid','high','cutoff'])if(typeof d[key]==='number')patch[key]=d[key];engine.deck(index,patch);drawWave(index);announce(`Deck ${index?'B':'A'} ready. ${track.name}`);
    } catch(error) {name.textContent=decks[index].loaded?'Previous audio remains loaded.':'Could not decode this audio file.';throw error;} finally {file.disabled=false;file.value='';}
  }));
  play.addEventListener('click',guarded(async()=>{if(!decks[index].loaded)throw new Error('Load a local audio file first.');await initAudio();const playing=!decks[index].playing;engine.deck(index,{playing});decks[index].playing=playing;play.textContent=playing?'Ⅱ Pause':'▶ Play';play.setAttribute('aria-pressed',String(playing));announce(`Deck ${index?'B':'A'} ${playing?'playing':'paused'}.`);}));
  stop.addEventListener('click',guarded(()=>{if(decks[index].loaded)engine.deck(index,{playing:false});decks[index].playing=false;play.textContent='▶ Play';play.setAttribute('aria-pressed','false');}));
  reverse.addEventListener('click',guarded(()=>{if(!decks[index].loaded)throw new Error('Load audio before reversing it.');const reversed=reverse.getAttribute('aria-pressed')!=='true';engine.deck(index,{reverse:reversed});reverse.setAttribute('aria-pressed',String(reversed));}));
}
function drawWave(index) {
  const data=canvasContext($(`#wave${index}`));if(!data)return;const {ctx,w,h}=data;ctx.clearRect(0,0,w,h);ctx.strokeStyle=getComputedStyle(document.documentElement).getPropertyValue('--accent').trim();ctx.lineWidth=1.5;
  const peaks=decks[index].peaks||[];if(!peaks.length){ctx.globalAlpha=.3;ctx.beginPath();ctx.moveTo(10,h/2);ctx.lineTo(w-10,h/2);ctx.stroke();ctx.globalAlpha=1;return;}
  ctx.beginPath();for(let i=0;i<peaks.length;i++){const entry=peaks[i],peak=Array.isArray(entry)?Math.max(...entry.map(Math.abs)):Math.abs(Number(entry)||0);const x=i/peaks.length*w,a=clamp(peak,0,1)*(h*.43);ctx.moveTo(x,h/2-a);ctx.lineTo(x,h/2+a);}ctx.stroke();
}
buildDeck(0);buildDeck(1);
$('#crossfader').addEventListener('input',guarded(e=>engine.crossfade(Number(e.target.value))));
for(const name of Object.keys(EXAMPLES)){const o=make('option','',name);o.value=name;$('#codeExample').append(o);}
$('#codeEditor').value=code;
$('#codeEditor').maxLength=64000;
$('#codeHint').append(make('p','','One global code tempo: the final use_bpm applies to every code loop, independently of the groovebox. Sleep and attack/sustain/release values are in beats. Synths: sine, saw, square, tri, bass, prophet, beep. Samples: bd_haus, bd_tek, sn_dub, drum_snare_hard, drum_cymbal_closed, drum_cymbal_open. Repeat a phrase with 4.times do … end. Use the commands listed here and the included examples to build your loops.'));
$('#codeEditor').addEventListener('input',()=>{code=$('#codeEditor').value;persist();});
$('#codeExample').addEventListener('change',e=>{code=EXAMPLES[e.target.value];$('#codeEditor').value=code;persist();announce('Example loaded. Run it to hear the changes.','#codeStatus');});
$('#runCode').addEventListener('click',guarded(async()=>{const program=compile($('#codeEditor').value);await initAudio();await engine.runCode(program);announce('Code running locally. Stop code silences this part only.','#codeStatus');},'#codeStatus'));
$('#stopCode').addEventListener('click',guarded(()=>{engine.stopCode();announce('Code stopped.','#codeStatus');},'#codeStatus'));
async function download(blob,name) {
  if(window.BoomboxAndroid?.saveFile) {
    const data=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result).split(',')[1]);reader.onerror=()=>reject(new Error('Could not prepare file for Android.'));reader.readAsDataURL(blob);});
    window.BoomboxAndroid.saveFile(name,blob.type||'application/octet-stream',data);return;
  }
  const url=URL.createObjectURL(blob),a=make('a');a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);
}
$('#exportCode').addEventListener('click',guarded(()=>download(new Blob([$('#codeEditor').value],{type:'text/plain'}),'boombox-live.rb'),'#codeStatus'));
$('#exportProject').addEventListener('click',guarded(async()=>{await download(new Blob([JSON.stringify({version:1,settings,code},null,2)],{type:'application/json'}),'boombox-project.json');announce('Project export opened. Choose a location to save.','#settingsStatus');},'#settingsStatus'));
$('#importProject').addEventListener('change',guarded(async e=>{
  const file=e.target.files[0];if(!file)return;
  try {if(file.size>256000)throw new Error('Project JSON must be smaller than 256 KB.');const parsed=JSON.parse(await file.text());if(parsed.version!==1||!parsed.settings)throw new Error('Unsupported project. Expected Boombox project version 1.');const imported=safeSettings(parsed.settings);const importedCode=Object.prototype.hasOwnProperty.call(parsed,'code')?safeCode(parsed.code):code;stopAll();settings=imported;code=importedCode;$('#codeEditor').value=code;updateSound();renderSettings();announce('Project imported. Audio files are not part of JSON projects.','#settingsStatus');}finally{e.target.value='';}
},'#settingsStatus'));
$('#exportWav').addEventListener('click',guarded(async()=>{const button=$('#exportWav');button.disabled=true;announce('Rendering the groovebox…','#exportStatus');try{await initAudio();const seconds=Number($('#exportLength').value),blob=await engine.exportWav(seconds);await download(blob,`boombox-${seconds}s.wav`);announce('WAV export opened. Choose a location to save.','#exportStatus');}finally{button.disabled=false;}},'#exportStatus'));
if(typeof engine.startRecording==='function'&&typeof engine.stopRecording==='function') {
  $('#recordMix').hidden=false;$('#recordMix').addEventListener('click',guarded(async()=>{await initAudio();if(recording){const blob=await engine.stopRecording();recording=false;await download(blob,`boombox-live.${blob.type?.includes('ogg')?'ogg':blob.type?.includes('wav')?'wav':'webm'}`);$('#recordMix').textContent='● Record live mix';announce('Recording export opened.','#exportStatus');}else{await engine.startRecording();recording=true;$('#recordMix').textContent='■ Finish recording';announce('Recording live output. Keep the app in the foreground.','#exportStatus');}},'#exportStatus'));
}
$('#resetProject').addEventListener('click',()=>{if(!confirm('Reset sound and pattern? Your appearance preferences will stay.'))return;stopAll();settings=defaultSettings();updateSound();renderSettings();announce('Sound reset.','#settingsStatus');});
async function offlineRequest(type) {
  if(!('serviceWorker' in navigator))throw new Error('Offline caching requires a supported browser and HTTPS or localhost.');
  let deadline;
  try {
    registration=await Promise.race([
      (async()=>{const r=await navigator.serviceWorker.register('./sw.js');await navigator.serviceWorker.ready;return r;})(),
      new Promise((_,reject)=>{deadline=setTimeout(()=>reject(new Error('Offline installation did not finish. Check your connection, then Save offline to retry.')),10000);})
    ]);
  } finally {clearTimeout(deadline);}
  const worker=registration.active||navigator.serviceWorker.controller;if(!worker)throw new Error('Offline worker is installing. Try again in a moment.');
  return new Promise((resolve,reject)=>{const channel=new MessageChannel(),timeout=setTimeout(()=>{channel.port1.close();reject(new Error('Offline check timed out. Reload and try again.'));},20000);channel.port1.onmessage=e=>{clearTimeout(timeout);channel.port1.close();resolve(e.data);};worker.postMessage({type},[channel.port2]);});
}
function showOffline(result) { if(result.error)throw new Error(result.error);$('#offlineStatus').textContent=result.ready?`Ready offline · ${result.total} assets`:`Not ready · ${Array.isArray(result.missing)?result.missing.length:result.missing} missing of ${result.total}`; }
$('#saveOffline').addEventListener('click',guarded(async()=>{const b=$('#saveOffline');b.disabled=true;$('#offlineStatus').textContent='Saving local assets…';try{showOffline(await offlineRequest('SAVE_OFFLINE'));}finally{b.disabled=false;}},'#offlineStatus'));
if(window.BoomboxAndroid&&location.origin==='https://boombox.local') {
  $('#offlineStatus').textContent='Bundled offline · no download needed';$('#saveOffline').disabled=true;
} else if('serviceWorker' in navigator)offlineRequest('CHECK_OFFLINE').then(showOffline).catch(error=>{$('#offlineStatus').textContent=errorMessage(error);});
// Keep the focused control clear of the fixed transport without scrolling the whole page sideways.
document.addEventListener('focusin',e=>{if(e.target.closest('dialog,.transport')||!e.target.getBoundingClientRect)return;requestAnimationFrame(()=>{const bottom=e.target.getBoundingClientRect().bottom,top=$('.transport').getBoundingClientRect().top;if(bottom>top-12)window.scrollBy(0,bottom-top+20);});});
renderSettings();persist();saveLook();syncPlay();decks.forEach((d,i)=>drawWave(i));
const chromium=/Chrom(?:e|ium)\/(\d+)/.exec(navigator.userAgent);
if(chromium&&Number(chromium[1])<90)announce('Please update Android System WebView / Chrome to Chromium 90 or newer. This instrument requires a modern browser.');
$('#helpSheet').append(make('p','fine','Browser and Android playback are foreground-only; the OS may suspend audio in the background. Android requires an updated System WebView (Chromium 90 or newer).'));
document.documentElement.dataset.ready='true';
