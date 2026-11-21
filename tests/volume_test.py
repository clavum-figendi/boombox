"""Real PCM regression for the louder default, full-volume headroom and mute."""
import json
import os
from pathlib import Path
from playwright.sync_api import sync_playwright

with sync_playwright() as p:
    name=os.environ.get('BROWSER','chromium')
    browser_type=getattr(p,name)
    executable=os.environ.get('WEBKIT_EXECUTABLE' if name=='webkit' else 'CHROMIUM_EXECUTABLE')
    browser=browser_type.launch(headless=True,executable_path=executable)
    page=browser.new_page(service_workers='block')
    page.goto(os.environ.get('BOOMBOX_URL','http://127.0.0.1:8097/'))
    report=page.evaluate("""async()=>{
      const {Engine,defaultSettings,randomizePreset,STYLES}=await import('./js/engine.js');
      const checks=[];
      for(const style of Object.keys(STYLES))for(const seed of [42,1103,98765]){
        for(const level of [.85,.25,0,1]){
          const settings=randomizePreset(defaultSettings(),style,seed);settings.master=level;
          const blob=await new Engine(settings).exportWav(3),decoder=new OfflineAudioContext(1,44100,44100);
          const pcm=(await decoder.decodeAudioData(await blob.arrayBuffer())).getChannelData(0);
          let sum=0,peak=0;for(const sample of pcm){if(!Number.isFinite(sample))throw Error('Invalid sample');sum+=sample*sample;peak=Math.max(peak,Math.abs(sample));}
          const rms=Math.sqrt(sum/pcm.length);
          if(level===0&&peak!==0)throw Error('Master mute leaked audio');
          if(level>0&&rms<.0001)throw Error('Silent preset '+style+'/'+seed);
          if(peak>=.98)throw Error('Insufficient headroom '+style+'/'+seed+'/'+level+': '+peak);
          if(style==='techno'&&seed===42&&level===.85&&rms<.11)throw Error('Default techno output regressed: '+rms);
          checks.push({style,seed,master:level,rms,peak});
        }
      }
      return {defaultMaster:defaultSettings().master,renders:checks.length,checks};
    }""")
    target=Path(__file__).resolve().parents[1]/'artifacts'/('volume-verification-'+name+'.json')
    target.parent.mkdir(exist_ok=True)
    target.write_text(json.dumps(report,indent=2)+'\n')
    print(json.dumps({'browser':name,'defaultMaster':report['defaultMaster'],'renders':report['renders'],'maxPeak':max(x['peak'] for x in report['checks']),'defaultTechno':next(x for x in report['checks'] if x['style']=='techno' and x['seed']==42 and x['master']==.85)},indent=2))
    browser.close()
