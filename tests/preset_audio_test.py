"""Real PCM acceptance for randomized presets and the low-end-first default."""
import json
import os
from pathlib import Path
from playwright.sync_api import sync_playwright

URL = os.environ.get('BOOMBOX_URL', 'http://127.0.0.1:8097/')
with sync_playwright() as p:
    options = {'headless': True}
    if os.environ.get('CHROMIUM_EXECUTABLE'):
        options['executable_path'] = os.environ['CHROMIUM_EXECUTABLE']
    browser = p.chromium.launch(**options)
    page = browser.new_page(service_workers='block')
    page.goto(URL)
    result = page.evaluate("""async()=>{
      const {Engine,defaultSettings,randomizePreset,STYLES}=await import('./js/engine.js');
      const rms=a=>Math.sqrt(a.reduce((n,x)=>n+x*x,0)/a.length);
      async function pcm(s,seconds=2){const blob=await new Engine(s).exportWav(seconds);const c=new OfflineAudioContext(1,44100,44100);return (await c.decodeAudioData(await blob.arrayBuffer())).getChannelData(0);}
      const styles={};
      for(const style of Object.keys(STYLES)){
        const renders=[];
        for(const seed of [101,202,303,404]){
          const s=defaultSettings();randomizePreset(s,style,seed);
          const d=await pcm(s),peak=d.reduce((p,x)=>Math.max(p,Math.abs(x)),0),energy=rms(d);
          if(!d.every(Number.isFinite)||energy<.0001||peak>=.999)throw Error(style+' invalid or clipped PCM '+seed+' '+peak);
          renders.push({seed,bpm:s.bpm,rms:energy,peak,cutoff:s.cutoff,delay:s.delay,kick:s.channels.kick.gain,lead:s.channels.lead.gain});
        }
        if(new Set(renders.map(r=>r.rms.toFixed(6))).size!==renders.length)throw Error(style+' repeated sound');
        styles[style]=renders;
      }
      const s=defaultSettings();
      if(s.style!=='techno'||s.channels.lead.gain>.1||s.channels.pad.gain>.1||s.channels.kick.gain<.7)throw Error('Default must be low-end-first minimal techno');
      for(const [name,ch] of Object.entries(s.channels))ch.mute=name!=='kick';
      for(const pattern of Object.values(s.patterns))pattern.fill(false);s.patterns.kick[0]=true;s.drive=0;s.delay=0;s.reverb=0;
      const kick=await pcm(s,1);
      // Direct spectral energy scan, after the pitch transient, using the real rendered PCM.
      let strongest={hz:0,power:0};
      for(let hz=25;hz<=200;hz++){
        let re=0,im=0;
        for(let i=5292;i<15435;i++){const window=Math.sin(Math.PI*(i-5292)/(15435-5292));re+=kick[i]*window*Math.cos(2*Math.PI*hz*i/44100);im+=kick[i]*window*Math.sin(2*Math.PI*hz*i/44100);}
        const power=re*re+im*im;if(power>strongest.power)strongest={hz,power};
      }
      if(strongest.hz>75||strongest.hz<30||strongest.power<.00001)throw Error('Kick fundamental is not deep: '+JSON.stringify(strongest));
      return {styles,defaultKickFundamental:strongest.hz};
    }""")
    out=Path(__file__).resolve().parents[1]/'artifacts'
    out.mkdir(exist_ok=True)
    (out/'randomized-pcm.json').write_text(json.dumps(result,indent=2))
    print(json.dumps(result,indent=2))
    browser.close()
