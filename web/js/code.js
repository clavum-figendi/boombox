// Deliberately a parser, not a Ruby interpreter. No source is ever executed.
import {INSTRUMENTS} from './engine.js';
const SYNTHS = {sine:'sine', saw:'sawtooth', square:'square', tri:'triangle', triangle:'triangle', bass:'sawtooth', prophet:'sawtooth', beep:'sine'};
const SAMPLES = {bd_haus:'kick', bd_tek:'kick', sn_dub:'snare', drum_snare_hard:'snare', drum_cymbal_closed:'hat', drum_cymbal_open:'hat'};
// Synthesized analogues only: these names never fetch or decode a recording.
const SAMPLE_VOICES={...Object.fromEntries(Object.entries(INSTRUMENTS).filter(([id,p])=>id!=='classic'&&p.lanes.some(lane=>['kick','snare','hat'].includes(lane))).map(([id])=>[id,id])),bd_808:'kick_808',bd_909:'kick_909',bd_industrial:'kick_industrial',sn_909:'snare',drum_clap:'clap',perc_snap:'rim',rim:'rim',hat_closed:'hat_closed',hat_open:'hat_open',hat_metallic:'hat_metallic'};
const fail = (line, message) => { throw new SyntaxError(`Line ${line}: ${message}`); };
function number(text, line, min, max) {
  if (!/^-?(?:\d+(?:\.\d*)?|\.\d+)$/.test(text || '')) fail(line,'Expected a number');
  const value = Number(text);
  if (!Number.isFinite(value) || value < min || value > max) fail(line,`Number must be between ${min} and ${max}`);
  return value;
}
function note(text,line) {
  if (/^\d+$/.test(text)) return number(text,line,0,127);
  const m = /^:([a-g])(s|f|#|b)?(-?\d)$/.exec(text);
  if (!m) fail(line,'Expected MIDI number or note such as :e3');
  const n = (Number(m[3])+1)*12 + {c:0,d:2,e:4,f:5,g:7,a:9,b:11}[m[1]] + ({s:1,'#':1,f:-1,b:-1}[m[2]] || 0);
  if (n<0 || n>127) fail(line,'Note outside MIDI range');
  return n;
}
export function compile(source) {
  if (typeof source !== 'string' || source.length>64000) throw new SyntaxError('Line 1: Source must be text under 64 KB');
  const lines = source.split(/\r?\n/).map((text,i)=>({text:text.replace(/\s+#.*$|^#.*$/,'').trim(),line:i+1})).filter(x=>x.text);
  let cursor=0, bpm=132, wave='sine', voice='classic', expanded=0;
  const loops=[], names=new Set();
  function block(nested=false, depth=0) {
    if(depth>8) fail(lines[cursor]?.line || 1,'Nesting is limited to 8');
    const events=[]; let beats=0;
    while(cursor<lines.length) {
      const {text,line}=lines[cursor++]; let m;
      if(text==='end') { if(!nested) fail(line,'Unexpected end'); return {events,beats}; }
      if((m=/^use_bpm\s+(.+)$/.exec(text))) { bpm=number(m[1],line,30,300); continue; }
      if((m=/^use_synth\s+:(\w+)$/.exec(text))) {
        const id=m[1];
        if(Object.prototype.hasOwnProperty.call(SYNTHS,id)){wave=SYNTHS[id];voice='classic';}
        else if(Object.prototype.hasOwnProperty.call(INSTRUMENTS,id)&&INSTRUMENTS[id].lanes.includes('lead')){voice=id;wave=['sub','fm_bell','organ','glass_pad'].includes(id)?'sine':'sawtooth';}
        else fail(line,'Unsupported synth');
        continue;
      }
      if((m=/^live_loop\s+:(\w+)\s+do$/.exec(text))) {
        if(nested) fail(line,'live_loop must be top-level');
        if(names.has(m[1])) fail(line,'Duplicate loop name'); names.add(m[1]);
        const loop=block(true,depth+1);
        if(!loop.events.length) fail(line,'Loop must contain notes or samples');
        if(loop.beats<=0) fail(line,'Loop must sleep for a positive duration');
        loops.push({name:m[1],...loop}); continue;
      }
      if((m=/^(\d+)\.times\s+do$/.exec(text))) {
        const count=number(m[1],line,1,64), child=block(true,depth+1);
        if(expanded+child.events.length*count>4096) fail(line,'Too many expanded events');
        for(let i=0;i<count;i++) for(const e of child.events) events.push({...e,beat:beats+i*child.beats+e.beat});
        expanded+=child.events.length*count; beats+=count*child.beats; continue;
      }
      if((m=/^sleep\s+(.+)$/.exec(text))) { beats+=number(m[1],line,.001,64); if(beats>4096) fail(line,'Loop too long'); continue; }
      if((m=/^(play|sample)\s+([^,\s]+)(.*)$/.exec(text))) {
        const sample=m[2].replace(/^:/,''),sampleVoice=Object.prototype.hasOwnProperty.call(SAMPLE_VOICES,sample)?SAMPLE_VOICES[sample]:null;
        const lane=sampleVoice?INSTRUMENTS[sampleVoice].lanes[0]:Object.prototype.hasOwnProperty.call(SAMPLES,sample)?SAMPLES[sample]:null;
        const event={beat:beats,instrument:m[1]==='play'?'lead':lane,voice:m[1]==='play'?voice:sampleVoice||'classic',amp:.5,duration:.25,wave};
        if(!event.instrument) fail(line,'Unsupported sample');
        if(m[1]==='play') event.note=note(m[2],line);
        if(m[3]) {
          if(!m[3].startsWith(',')) fail(line,'Expected comma before options');
          const envelope={attack:0,sustain:0,release:.25};
          for(const option of m[3].slice(1).split(',')) {
            const opt=/^\s*(amp|release|sustain|attack)\s*:\s*(\S+)\s*$/.exec(option);
            if(!opt) fail(line,'Unsupported or malformed option');
            const value=number(opt[2],line,0,opt[1]==='amp'?2:16);
            if(opt[1]==='amp') event.amp=value; else envelope[opt[1]]=value;
          }
          Object.assign(event,envelope);
        }
        if(++expanded>4096) fail(line,'Too many events'); events.push(event); continue;
      }
      fail(line,`Unsupported syntax: ${text}`);
    }
    if(nested) fail(lines[lines.length-1]?.line || 1,'Missing end');
    return {events,beats};
  }
  const top=block();
  if(top.events.length) { if(!top.beats) fail(1,'Events need sleep'); loops.unshift({name:'main',...top}); }
  if(!loops.length) fail(1,'Add a live_loop with notes or samples');
  // This subset has one global BPM; envelopes use beats like sleep, then
  // become seconds at the compiler/engine boundary.
  for(const loop of loops) for(const event of loop.events) {
    event.attack=(event.attack??0)*60/bpm;
    event.sustain=(event.sustain??0)*60/bpm;
    event.release=(event.release??.25)*60/bpm;
    event.duration=Math.max(.01,event.attack+event.sustain+event.release);
  }
  return {bpm,loops};
}
export const EXAMPLES = {
  'Acid machine': `use_bpm 132\nuse_synth :saw\nlive_loop :kick do\n  sample :bd_haus, amp: 0.8\n  sleep 1\nend\nlive_loop :acid do\n  play :e2, release: 0.12, amp: 0.45\n  sleep 0.5\n  play :g2, release: 0.18\n  sleep 0.5\n  play :b2, release: 0.1\n  sleep 0.5\n  play :d3, release: 0.2\n  sleep 0.5\nend`,
  'Broken circuit': `use_bpm 170\nuse_synth :square\nlive_loop :break do\n  sample :bd_haus\n  sleep 1\n  sample :sn_dub\n  sleep 0.75\n  sample :bd_haus\n  sleep 1.25\n  sample :sn_dub\n  sleep 1\nend\nlive_loop :hats do\n  8.times do\n    sample :drum_cymbal_closed, amp: 0.2\n    sleep 0.5\n  end\nend`,
  'Dub space': `use_bpm 72\nuse_synth :sine\nlive_loop :sub do\n  play :c2, release: 0.8\n  sleep 2\n  play :g1, release: 0.6\n  sleep 2\nend\nlive_loop :rim do\n  sleep 2\n  sample :sn_dub, amp: 0.35\n  sleep 2\nend`
};
