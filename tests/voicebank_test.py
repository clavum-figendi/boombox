"""Render every compatible mixer patch through the real browser audio engine."""
import json
import os
from pathlib import Path
from playwright.sync_api import sync_playwright

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True, executable_path=os.environ.get('CHROMIUM_EXECUTABLE'))
    page = browser.new_page(service_workers='block')
    page.goto(os.environ.get('BOOMBOX_URL','http://127.0.0.1:8097/'))
    result = page.evaluate("""async()=>{
      const {Engine,INSTRUMENTS,defaultSettings}=await import('./js/engine.js');
      const rms=a=>Math.sqrt(a.reduce((s,x)=>s+x*x,0)/a.length), checks=[], baselines={};
      async function render(id,lane){
        const s=defaultSettings();s.cutoff=20000;s.resonance=.1;s.drive=0;s.delay=0;s.reverb=0;s.density=1;s.master=.6;
        for(const [key,ch] of Object.entries(s.channels)){ch.mute=key!==lane;ch.gain=.7;ch.decay=.65;s.patterns[key].fill(false);}
        s.channels[lane].instrument=id;s.patterns[lane][0]=true;
        const blob=await new Engine(s).exportWav(1),decoder=new OfflineAudioContext(1,44100,44100);
        return (await decoder.decodeAudioData(await blob.arrayBuffer())).getChannelData(0);
      }
      for(const lane of INSTRUMENTS.classic.lanes)baselines[lane]=await render('classic',lane);
      for(const [id,patch] of Object.entries(INSTRUMENTS))for(const lane of patch.lanes){
        const pcm=id==='classic'?baselines[lane]:await render(id,lane),energy=rms(pcm),peak=pcm.reduce((m,x)=>Math.max(m,Math.abs(x)),0);
        if(!pcm.every(Number.isFinite)||energy<.00001||peak>=.999)throw Error(id+'/'+lane+' inaudible/invalid/clipped: '+energy+' '+peak);
        let difference=0;
        if(id!=='classic'){
          difference=rms(pcm.map((x,i)=>x-baselines[lane][i]));
          if(difference<.00001)throw Error(id+'/'+lane+' duplicates classic PCM');
        }
        checks.push({id,lane,rms:energy,peak,differenceFromClassic:difference});
      }
      return {patches:Object.keys(INSTRUMENTS).length,renders:checks.length,checks};
    }""")
    target=Path(__file__).resolve().parents[1]/'artifacts'/'voicebank-verification.json'
    target.parent.mkdir(exist_ok=True)
    target.write_text(json.dumps(result,indent=2)+'\n')
    print(json.dumps(result,indent=2))
    browser.close()
