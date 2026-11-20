const CHANNELS=['kick','snare','hat','bass','lead','pad'];
const clamp=(n,min,max)=>Math.max(min,Math.min(max,Number.isFinite(Number(n))?Number(n):min));
const rng=seed=>()=>{seed=(Math.imul(1664525,seed)+1013904223)>>>0;return seed/4294967296;};
export const STYLES={
 techno:{name:'Techno',bpm:132,description:'Driving four-on-the-floor, metallic hats and minor stabs.'},
 house:{name:'House',bpm:124,description:'Offbeat hats, warm chords and a rolling syncopated bass.'},
 dnb:{name:'Drum & bass',bpm:174,description:'Broken kicks, snapping backbeats and heavy sub bass.'},
 psytrance:{name:'Psytrance',bpm:145,description:'Relentless rolling sixteenths and hypnotic arpeggios.'},
 breakbeat:{name:'Breakbeat',bpm:136,description:'Syncopated drums and angular bass movement.'},
 hardcore:{name:'Hardcore',bpm:180,description:'Distorted kicks, rapid hats and sharp rave leads.'},
 acid:{name:'Acid',bpm:138,description:'Resonant squelch over a stripped machine rhythm.'},
 dub:{name:'Dub',bpm:72,description:'Spacious one-drop drums, deep bass and echo chords.'}
};
const RHYTHMS={
 techno:['0,4,8,12','4,12','2,6,10,14','0,3,6,8,11,14','2,7,10,15','0'],
 house:['0,4,8,12','4,12','2,6,10,14','0,3,7,8,10,14','0,6,10','0,8'],
 dnb:['0,6,10','4,12','0,2,4,6,8,10,12,14','0,6,8,11','3,10,14','0'],
 psytrance:['0,4,8,12','4,12','2,6,10,14','1,2,3,5,6,7,9,10,11,13,14,15','0,3,6,9,12,15','0'],
 breakbeat:['0,3,8,10','4,12','0,2,5,6,8,10,13,14','0,3,6,10,13','2,5,11,14','0,10'],
 hardcore:['0,4,8,12','4,12','0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15','0,2,4,6,8,10,12,14','0,3,6,8,11,14','0,8'],
 acid:['0,4,8,12','4,12','2,6,10,14','0,1,3,4,6,7,8,10,12,13,15','3,11','0'],
 dub:['8','8','2,6,10,14','0,6,10','6,14','4,12']
};
export function defaultSettings(){
 const channels=Object.fromEntries(CHANNELS.map((name,i)=>[name,{gain:[.8,.55,.32,.55,.3,.2][i],mute:false,solo:false,wave:i<3?'sine':i===5?'triangle':'sawtooth',decay:[.3,.18,.055,.18,.22,1.1][i]}]));
 const settings={style:'techno',bpm:132,seed:42,root:0,scale:'minor',swing:0,density:.65,master:.65,cutoff:3000,resonance:3,drive:.2,delay:.2,reverb:.15,channels,patterns:{}};
 applyStyle(settings,'techno');return settings;
}
export function applyStyle(settings,key){
 if(!STYLES[key]) throw new RangeError(`Unknown style: ${key}`);
 settings.style=key;settings.bpm=STYLES[key].bpm;
 settings.patterns=Object.fromEntries(CHANNELS.map((name,i)=>[name,Array.from({length:16},(_,step)=>RHYTHMS[key][i].split(',').map(Number).includes(step))]));
 Object.assign(settings,{swing:key==='house'?.16:key==='breakbeat'?.1:0,cutoff:key==='dub'?1400:key==='acid'?1700:3000,resonance:key==='acid'?12:3,drive:key==='hardcore'?.7:.2,delay:key==='dub'?.5:.2,reverb:key==='dub'?.35:.15});
 if(settings.channels){settings.channels.bass.wave=key==='dub'||key==='dnb'?'sine':'sawtooth';settings.channels.kick.decay=key==='hardcore'?.45:.3;}
 return settings;
}
export function patternEvents(settings,bar=0){
 const random=rng((settings.seed>>>0)^Math.imul(bar+1,2654435761)), events=[];
 const scale=({minor:[0,2,3,5,7,8,10],major:[0,2,4,5,7,9,11],pentatonic:[0,3,5,7,10],dorian:[0,2,3,5,7,9,10],phrygian:[0,1,3,5,7,8,10]})[settings.scale]||[0,2,3,5,7,8,10];
 const degree=[0,5,3,4][Math.floor(bar/2)%4];
 for(const instrument of CHANNELS) for(let step=0;step<16;step++){
  const chance=random();if(!settings.patterns[instrument]?.[step])continue;
  if(['lead','pad'].includes(instrument)&&chance>clamp(settings.density,0,1))continue;
  const index=(degree+(instrument==='lead'?Math.floor(random()*scale.length):step%3===0?0:2))%scale.length;
  const note=(instrument==='bass'?36:instrument==='pad'?48:60)+Number(settings.root||0)+scale[index];
  events.push({instrument,step,beat:step/4+(step%2?clamp(settings.swing,0,.45)/4:0),note,amp:instrument==='hat'?.4+chance*.25:.65+chance*.2,duration:instrument==='pad'?1.4:settings.channels[instrument].decay,wave:settings.channels[instrument].wave});
 }
 return events.sort((a,b)=>a.beat-b.beat);
}

function connectGraph(context,settings,destination){
 const input=context.createGain(), filter=context.createBiquadFilter(), drive=context.createWaveShaper(), master=context.createGain(), limiter=context.createDynamicsCompressor(), analyser=context.createAnalyser();
 filter.type='lowpass';analyser.fftSize=1024;
 input.connect(filter);filter.connect(drive);drive.connect(master);
 const delay=context.createDelay(2),feedback=context.createGain(),delayMix=context.createGain();
 drive.connect(delay);delay.connect(feedback);feedback.connect(delay);delay.connect(delayMix);delayMix.connect(master);
 const reverb=context.createConvolver(),reverbMix=context.createGain(),random=rng(991);
 const impulse=context.createBuffer(2,Math.floor(context.sampleRate*1.8),context.sampleRate);
 for(let ch=0;ch<2;ch++){const data=impulse.getChannelData(ch);for(let i=0;i<data.length;i++)data[i]=(random()*2-1)*Math.pow(1-i/data.length,3);}
 reverb.buffer=impulse;drive.connect(reverb);reverb.connect(reverbMix);reverbMix.connect(master);
 limiter.threshold.value=-7;limiter.knee.value=4;limiter.ratio.value=16;limiter.attack.value=.003;limiter.release.value=.15;
 master.connect(limiter);limiter.connect(analyser);analyser.connect(destination);
 const channels=Object.fromEntries(CHANNELS.map(name=>{const gain=context.createGain();gain.connect(input);return [name,gain];}));
 const graph={input,filter,drive,master,limiter,analyser,delay,feedback,delayMix,reverb,reverbMix,channels};
 updateGraph(context,graph,settings,true);return graph;
}
function updateGraph(context,g,s,initial=false){
 const set=(param,value)=>initial?param.setValueAtTime(value,context.currentTime):param.setTargetAtTime(value,context.currentTime,.015);
 set(g.filter.frequency,clamp(s.cutoff,40,context.sampleRate*.45));set(g.filter.Q,clamp(s.resonance,.1,18));set(g.master.gain,clamp(s.master,0,1)*.7);
 const amount=clamp(s.drive,0,1)*40, curve=new Float32Array(1024);
 for(let i=0;i<curve.length;i++){const x=i*2/(curve.length-1)-1;curve[i]=Math.tanh(x*(1+amount))/Math.tanh(1+amount);}
 g.drive.curve=curve;g.drive.oversample='2x';
 set(g.delay.delayTime,60/clamp(s.bpm,30,300)*.75);set(g.feedback.gain,.35);set(g.delayMix.gain,clamp(s.delay,0,.8));set(g.reverbMix.gain,clamp(s.reverb,0,1));
 const solo=CHANNELS.some(name=>s.channels[name].solo);
 for(const name of CHANNELS){const c=s.channels[name];set(g.channels[name].gain,c.mute||solo&&!c.solo?0:clamp(c.gain,0,1));}
}
function voice(context,graph,event,time,active,tag='groove'){
 if(!CHANNELS.includes(event.instrument))throw new RangeError('Unknown instrument');
 const start=Math.max(context.currentTime,time), duration=clamp(event.duration??.2,.02,8), end=start+duration+.03;
 // Count overlapping voices, not all future offline-render events.
 let overlapping=0;for(const entry of active)if(entry.end>start&&++overlapping>=128)return;
 const amp=context.createGain(),filter=context.createBiquadFilter();
 amp.gain.setValueAtTime(0,start);amp.gain.linearRampToValueAtTime(clamp(event.amp??.5,0,1)*.42,start+.004);amp.gain.exponentialRampToValueAtTime(.0001,end);
 filter.type='lowpass';filter.frequency.value=event.instrument==='bass'?1800:12000;
 filter.connect(amp);amp.connect(graph.channels[event.instrument]);
 const sources=[];
 if(event.instrument==='hat'||event.instrument==='snare'){
  const buffer=context.createBuffer(1,Math.ceil((duration+.04)*context.sampleRate),context.sampleRate),data=buffer.getChannelData(0),random=rng(321+Math.round(start*1000));
  for(let i=0;i<data.length;i++)data[i]=random()*2-1;
  const noise=context.createBufferSource();noise.buffer=buffer;filter.type='highpass';filter.frequency.value=event.instrument==='hat'?6500:1300;noise.connect(filter);sources.push(noise);
 }
 if(event.instrument!=='hat'){
  const osc=context.createOscillator();osc.type=['sine','triangle','square','sawtooth'].includes(event.wave)?event.wave:'sine';
  const freq=440*Math.pow(2,(clamp(event.note??48,0,127)-69)/12);
  osc.frequency.setValueAtTime(event.instrument==='kick'?150:event.instrument==='snare'?180:freq,start);
  if(event.instrument==='kick'){osc.type='sine';osc.frequency.exponentialRampToValueAtTime(43,start+.12);}
  if(event.instrument==='snare'){osc.type='triangle';osc.frequency.exponentialRampToValueAtTime(75,end);}
  osc.connect(filter);sources.push(osc);
 }
 const entry={sources,amp,filter,tag,end};active.add(entry);let remaining=sources.length;
 for(const source of sources){source.onended=()=>{source.disconnect();if(--remaining===0){filter.disconnect();amp.disconnect();active.delete(entry);}};source.start(start);source.stop(end+.01);}
}
function kill(active,tag){for(const entry of active)if(!tag||entry.tag===tag){for(const source of entry.sources){try{source.stop();}catch{}source.disconnect();}entry.amp.disconnect();entry.filter.disconnect();active.delete(entry);}}
export class Engine {
 constructor(settings=defaultSettings()) {this.settings=settings;this.context=null;this.graph=null;this.active=new Set();this._playing=false;this._step=0;this.nextStep=0;this.tickIndex=0;this.timer=null;this.codeTimer=null;this.code=null;this.decks=[{playing:false,gain:.8,rate:1,low:0,mid:0,high:0,cutoff:20000,start:0,end:1,reverse:false},{playing:false,gain:.8,rate:1,low:0,mid:0,high:0,cutoff:20000,start:0,end:1,reverse:false}];this.fade=0;}
 get playing(){return this._playing;}
 get step(){if(this._playing&&this.context)return Math.max(0,Math.floor((this.context.currentTime-this.origin)/(60/clamp(this.settings.bpm,30,300)/4)))%16;return this._step;}
 get analyser(){return this.graph?.analyser||null;}
 async init(){if(!this.context){const Context=globalThis.AudioContext||globalThis.webkitAudioContext;if(!Context)throw new Error('Web Audio is not available in this browser');this.context=new Context();this.graph=connectGraph(this.context,this.settings,this.context.destination);}if(this.context.state==='suspended')await this.context.resume();return this;}
 async play(){await this.init();if(this._playing)return;this._playing=true;this.nextStep=this.context.currentTime+.04;this.origin=this.nextStep-this.tickIndex*60/clamp(this.settings.bpm,30,300)/4;this._schedule();this.timer=setInterval(()=>this._schedule(),25);}
 _schedule(){const beat=60/clamp(this.settings.bpm,30,300);while(this.nextStep<this.context.currentTime+.12){const step=this.tickIndex%16,bar=Math.floor(this.tickIndex/16);for(const event of patternEvents(this.settings,bar).filter(e=>e.step===step))voice(this.context,this.graph,event,this.nextStep+(event.beat-step/4)*beat,this.active);this._step=step;this.tickIndex++;this.nextStep+=beat/4;}}
 pause(){this._playing=false;clearInterval(this.timer);this.timer=null;kill(this.active,'groove');}
 stop(){this.pause();this.tickIndex=0;this._step=0;this.stopCode();for(let i=0;i<2;i++)this.deck(i,{playing:false});}
 update(settings){this.settings=settings;if(this.graph)updateGraph(this.context,this.graph,settings);}
 trigger(event,time){if(!this.context)throw new Error('Initialize audio first');voice(this.context,this.graph,event,time??this.context.currentTime,this.active,'code');}
 async runCode(compiled){if(!compiled?.loops?.length||!Number.isFinite(compiled.bpm)||compiled.bpm<30||compiled.bpm>300)throw new Error('Invalid compiled code');for(const loop of compiled.loops)if(!Number.isFinite(loop.beats)||loop.beats<=0||!loop.events?.length||loop.events.length>4096)throw new Error('Invalid code loop');await this.init();this.stopCode();const start=this.context.currentTime+.05;this.code={compiled,loops:compiled.loops.map(loop=>({loop,cycle:0,index:0})),start};this._scheduleCode();this.codeTimer=setInterval(()=>this._scheduleCode(),25);}
 _scheduleCode(){if(!this.code)return;const {compiled,loops,start}=this.code,beat=60/compiled.bpm;for(const state of loops){let count=0;while(count++<4096){const event=state.loop.events[state.index],time=start+(state.cycle*state.loop.beats+event.beat)*beat;if(time>this.context.currentTime+.12)break;this.trigger(event,time);if(++state.index===state.loop.events.length){state.index=0;state.cycle++;}}}}
 stopCode(){clearInterval(this.codeTimer);this.codeTimer=null;this.code=null;kill(this.active,'code');}
 async loadTrack(index,file){const d=this.decks[index];if(!d)throw new RangeError('Deck index must be 0 or 1');if(!file||file.size>40*1024*1024||file.size===0)throw new Error('Choose an audio file under 40 MB');await this.init();const decoded=await this.context.decodeAudioData(await file.arrayBuffer());if(decoded.duration>300||decoded.length*decoded.numberOfChannels>28000000)throw new Error('Track limit: 5 minutes / 28 million decoded samples');this.deck(index,{playing:false});d.buffer=decoded;d.reversed=null;d.start=0;d.end=1;const data=decoded.getChannelData(0),peaks=Array.from({length:160},(_,i)=>{const start=Math.floor(i*data.length/160),end=Math.floor((i+1)*data.length/160);let peak=0;for(let j=start;j<end;j++)peak=Math.max(peak,Math.abs(data[j]));return peak;});return {name:file.name||'Local audio',duration:decoded.duration,peaks};}
 deck(index,options={}){const d=this.decks[index];if(!d)throw new RangeError('Deck index must be 0 or 1');const restart=['start','end','reverse'].some(k=>k in options&&options[k]!==d[k]);Object.assign(d,options);if(!this.context)return;d.gain=clamp(d.gain,0,1);d.rate=clamp(d.rate,.25,2);d.start=clamp(d.start,0,.99);d.end=clamp(d.end,d.start+.01,1);
  if(d.source&&(!d.playing||restart)){d.source.onended=null;try{d.source.stop();}catch{}d.source.disconnect();d.source=null;for(const node of d.nodes||[])node.disconnect();d.nodes=[];}
  if(d.playing&&d.buffer&&!d.source){if(d.reverse&&!d.reversed){d.reversed=this.context.createBuffer(d.buffer.numberOfChannels,d.buffer.length,d.buffer.sampleRate);for(let ch=0;ch<d.buffer.numberOfChannels;ch++)d.reversed.getChannelData(ch).set(d.buffer.getChannelData(ch).slice().reverse());}
   const source=this.context.createBufferSource();source.buffer=d.reverse?d.reversed:d.buffer;source.loop=true;
   d.eq=['lowshelf','peaking','highshelf','lowpass'].map((type,i)=>{const node=this.context.createBiquadFilter();node.type=type;node.frequency.value=[200,1000,4000,18000][i];return node;});d.output=this.context.createGain();d.nodes=[...d.eq,d.output];source.connect(d.eq[0]);d.eq.forEach((node,i)=>node.connect(d.eq[i+1]||d.output));d.output.connect(this.graph.input);d.source=source;
   source.loopStart=(d.reverse?1-d.end:d.start)*d.buffer.duration;source.loopEnd=(d.reverse?1-d.start:d.end)*d.buffer.duration;source.start(0,source.loopStart);
  }
  if(d.source){d.source.playbackRate.setTargetAtTime(d.rate,this.context.currentTime,.02);for(let i=0;i<3;i++)d.eq[i].gain.setTargetAtTime(clamp(d[['low','mid','high'][i]],-24,12),this.context.currentTime,.02);d.eq[3].frequency.setTargetAtTime(clamp(d.cutoff,40,this.context.sampleRate*.45),this.context.currentTime,.02);this.crossfade(this.fade);}
 }
 crossfade(value){this.fade=clamp(value,-1,1);for(let i=0;i<2;i++){const d=this.decks[i];if(d.output)d.output.gain.setTargetAtTime(d.gain*(i?Math.sin((this.fade+1)*Math.PI/4):Math.cos((this.fade+1)*Math.PI/4)),this.context.currentTime,.02);}}
 async exportWav(seconds=8){seconds=clamp(seconds,1,60);const Offline=globalThis.OfflineAudioContext||globalThis.webkitOfflineAudioContext;if(!Offline)throw new Error('Offline rendering is unavailable');const context=new Offline(2,Math.ceil(seconds*44100),44100),graph=connectGraph(context,this.settings,context.destination),active=new Set(),beat=60/clamp(this.settings.bpm,30,300);for(let bar=0;bar*beat*4<seconds;bar++)for(const event of patternEvents(this.settings,bar)){const time=(bar*4+event.beat)*beat;if(time<seconds)voice(context,graph,event,time,active);}const rendered=await context.startRendering();return wavBlob(rendered);}
 async startRecording(){await this.init();if(this.recorder?.state==='recording')throw new Error('Already recording');if(!globalThis.MediaRecorder)throw new Error('Recording unavailable; use WAV export');if(!this.recordingDestination){this.recordingDestination=this.context.createMediaStreamDestination();this.graph.limiter.connect(this.recordingDestination);}this.chunks=[];this.recorder=new MediaRecorder(this.recordingDestination.stream);this.recorder.ondataavailable=e=>{if(e.data.size)this.chunks.push(e.data);};this.recorder.start(250);}
 stopRecording(){return new Promise((resolve,reject)=>{if(!this.recorder||this.recorder.state==='inactive'){reject(new Error('No recording in progress'));return;}this.recorder.onstop=()=>resolve(new Blob(this.chunks,{type:this.recorder.mimeType}));this.recorder.onerror=e=>reject(e.error||new Error('Recording failed'));this.recorder.stop();});}
 async dispose(){this.stop();if(this.recorder?.state==='recording')await this.stopRecording();if(this.recordingDestination){for(const track of this.recordingDestination.stream.getTracks())track.stop();this.recordingDestination.disconnect();this.recordingDestination=null;}if(this.context){await this.context.close();this.context=null;this.graph=null;}this.recorder=null;this.chunks=[];for(const d of this.decks){d.buffer=null;d.reversed=null;}}
}
function wavBlob(buffer){const length=buffer.length,channels=buffer.numberOfChannels,bytes=new ArrayBuffer(44+length*channels*2),view=new DataView(bytes);const text=(offset,s)=>{for(let i=0;i<s.length;i++)view.setUint8(offset+i,s.charCodeAt(i));};text(0,'RIFF');view.setUint32(4,bytes.byteLength-8,true);text(8,'WAVE');text(12,'fmt ');view.setUint32(16,16,true);view.setUint16(20,1,true);view.setUint16(22,channels,true);view.setUint32(24,buffer.sampleRate,true);view.setUint32(28,buffer.sampleRate*channels*2,true);view.setUint16(32,channels*2,true);view.setUint16(34,16,true);text(36,'data');view.setUint32(40,length*channels*2,true);const data=Array.from({length:channels},(_,i)=>buffer.getChannelData(i));for(let i=0;i<length;i++)for(let ch=0;ch<channels;ch++)view.setInt16(44+(i*channels+ch)*2,clamp(data[ch][i],-1,1)*32767,true);return new Blob([bytes],{type:'audio/wav'});}
