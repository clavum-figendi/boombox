import test from 'node:test';
import assert from 'node:assert/strict';
import {compile, EXAMPLES} from '../web/js/code.js';

test('compiles timed loops, notes and bounded repeats', () => {
  const result = compile('use_bpm 125\nuse_synth :saw\nlive_loop :riff do\n  2.times do\n    play :e3, amp: 0.4, release: 0.2\n    sleep 0.5\n  end\nend');
  assert.equal(result.bpm,125);
  assert.equal(result.loops[0].beats,1);
  assert.deepEqual(result.loops[0].events.map(e=>[e.beat,e.note,e.wave]),[[0,52,'sawtooth'],[.5,52,'sawtooth']]);
});

test('all built-in examples compile to bounded finite event streams',()=>{
 for(const source of Object.values(EXAMPLES)) {
  const result=compile(source);
  assert(result.bpm>=30 && result.bpm<=300);
  for(const loop of result.loops){assert(loop.beats>0);assert(loop.events.length>0);assert(loop.events.every(e=>e.beat>=0&&e.beat<loop.beats&&e.amp>=0&&e.duration>0));}
 }
});

test('rejects unsupported code, missing ends and expansion attacks with source lines',()=>{
 // These hostile strings are parser input only; no JavaScript or Ruby is executed.
 for(const source of ['eval("alert(1)")','live_loop :x do\nplay :c4\nend','live_loop :x do\nsleep 1','live_loop :x do\nsleep 1\nend','65.times do\nsleep 1\nend','play :c4, pan: 1\nsleep 1','use_synth :unknown\nplay 60\nsleep 1','play 128\nsleep 1','sleep 0','live_loop :x do\n64.times do\n64.times do\n64.times do\nplay 60\nsleep 1\nend\nend\nend\nend']) assert.throws(()=>compile(source),/Line \d+:/,source);
});

test('missing ends retain syntax diagnostics without Array.at (Chromium 90)',()=>{
 const at=Array.prototype.at;
 try { Array.prototype.at=undefined; assert.throws(()=>compile('live_loop :x do\nplay 60'),/Line 2: Missing end/); }
 finally { Array.prototype.at=at; }
});

test('envelope options are order independent',()=>{
 const a=compile('play 60, release: 0.2, sustain: 1, attack: 0.1\nsleep 2').loops[0].events[0];
 const b=compile('play 60, attack: 0.1, sustain: 1, release: 0.2\nsleep 2').loops[0].events[0];
 assert.equal(a.duration,b.duration);assert(Math.abs(a.duration-1.3*60/132)<1e-9);
 assert(Math.abs(a.attack-.1*60/132)<1e-9);assert(Math.abs(a.sustain-60/132)<1e-9);
 const slow=compile('use_bpm 60\nplay 60, attack: 1, sustain: 2, release: 3\nsleep 1').loops[0].events[0];
 const fast=compile('use_bpm 120\nplay 60, attack: 1, sustain: 2, release: 3\nsleep 1').loops[0].events[0];
 assert.equal(slow.duration,6);assert.equal(fast.duration,3);assert.equal(fast.attack,.5);assert.equal(fast.sustain,1);assert.equal(fast.release,1.5);
});

test('sample mappings, flats and sharp notes preserve timing',()=>{
 const {loops}=compile('sample :bd_haus\nsleep 0.25\nsample :sn_dub\nsleep 0.25\nsample :drum_cymbal_closed\nplay :cs4\nplay :ef3\nsleep 1');
 assert.deepEqual(loops[0].events.map(e=>e.instrument),['kick','snare','hat','lead','lead']);
 assert.deepEqual(loops[0].events.slice(3).map(e=>e.note),[61,51]);
 assert.equal(loops[0].beats,1.5);
});
