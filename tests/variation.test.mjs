import test from 'node:test';
import assert from 'node:assert/strict';
import { VariationClock } from '../web/js/variation.js';

test('minute boundary, pause holds, stop/manual reset restart interval', () => {
  const clock = new VariationClock({minutes:1,enabled:true});
  assert.equal(clock.advance(59,true),false);
  assert.equal(clock.remaining,1);
  assert.equal(clock.advance(120,false),false);
  assert.equal(clock.remaining,1);
  assert.equal(clock.advance(1,true),true);
  assert.equal(clock.remaining,60);
  clock.advance(30,true);clock.reset();
  assert.equal(clock.remaining,60);
  assert.equal(clock.advance(59,true),false);
});
test('long gap emits once with a fresh full interval, never a catch-up burst', () => {
  const clock = new VariationClock({minutes:.1,enabled:true});
  assert.equal(clock.advance(12000,true),true);
  assert.equal(clock.remaining,6);
  assert.equal(clock.advance(0,true),false);
  assert.equal(clock.advance(5,true),false);
  assert.equal(clock.advance(1,true),true);
});
test('off by default, configuration is local and repeated configuration is idempotent', () => {
  const clock = new VariationClock();
  assert.equal(clock.enabled,false);
  assert.equal(clock.advance(1000,true),false);
  clock.configure({minutes:2.375,enabled:true});
  clock.advance(10,true);
  const remaining=clock.remaining;
  clock.configure({minutes:2.375,enabled:true});
  assert.equal(clock.remaining,remaining);
  clock.configure({enabled:false});
  assert.equal(clock.advance(1000,true),false);
  clock.configure({enabled:true});
  assert.equal(clock.remaining,142.5);
});
test('invalid and negative elapsed do not advance; invalid configuration rejected atomically', () => {
  const clock=new VariationClock({minutes:.1,enabled:true});
  for(const seconds of [-1,NaN,Infinity,undefined,'6']) assert.equal(clock.advance(seconds,true),false);
  assert.equal(clock.remaining,6);
  for(const minutes of [-1,0,.099,120.1,NaN,Infinity,'5',null]) assert.throws(()=>clock.configure({minutes}),RangeError);
  assert.throws(()=>clock.configure({enabled:'true'}),TypeError);
  assert.equal(clock.remaining,6);
  assert.equal(clock.enabled,true);
});
