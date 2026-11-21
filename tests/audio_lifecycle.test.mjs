import test from 'node:test';
import assert from 'node:assert/strict';
import {Engine,defaultSettings,randomizePreset} from '../web/js/engine.js';

test('new sessions use a stronger master level without overriding saved or muted levels',()=>{
 assert.equal(defaultSettings().master,.85);
 const saved=defaultSettings();saved.master=.23;
 randomizePreset(saved,'techno',42);assert.equal(saved.master,.23);
 saved.master=0;randomizePreset(saved,'house',123);assert.equal(saved.master,0);
});

test('an interrupted Safari context is resumed synchronously within the Play gesture',async()=>{
 const engine=new Engine(defaultSettings());let calls=0,gesture=true,resumedInGesture=false;
 engine.context={state:'interrupted',resume(){calls++;resumedInGesture=gesture;this.state='running';return Promise.resolve();}};
 engine.graph={};
 const ready=engine.init();gesture=false;await ready;
 assert.equal(calls,1);assert.equal(resumedInGesture,true);assert.equal(engine.context.state,'running');
});

test('a running audio context is not unnecessarily resumed',async()=>{
 const engine=new Engine(defaultSettings());let calls=0;
 engine.context={state:'running',resume(){calls++;return Promise.resolve();}};engine.graph={};
 await engine.init();assert.equal(calls,0);
});

test('music playback category is requested when AudioSession exists, but remains optional',async()=>{
 const descriptor=Object.getOwnPropertyDescriptor(globalThis,'navigator');
 try {
  const session={type:'auto'};
  Object.defineProperty(globalThis,'navigator',{value:{audioSession:session},configurable:true});
  const engine=new Engine(defaultSettings());engine.context={state:'running'};engine.graph={};
  await engine.init();assert.equal(session.type,'playback');
  Object.defineProperty(globalThis,'navigator',{value:{get audioSession(){throw new Error('Unavailable platform feature');}},configurable:true});
  await engine.init();assert.equal(engine.context.state,'running');
 } finally {
  if(descriptor)Object.defineProperty(globalThis,'navigator',descriptor);else delete globalThis.navigator;
 }
});
