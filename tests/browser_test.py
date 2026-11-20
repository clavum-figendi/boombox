"""Real Chromium integration gates. Run against local server or BOOMBOX_URL."""
import json
import os
import pathlib
import wave
from playwright.sync_api import sync_playwright, expect

URL = os.environ.get('BOOMBOX_URL', 'http://127.0.0.1:8097/')
OUT = pathlib.Path(__file__).resolve().parent.parent / 'artifacts'
OUT.mkdir(exist_ok=True)
with sync_playwright() as p:
    launch = {'headless': True, 'args': ['--autoplay-policy=no-user-gesture-required']}
    if os.environ.get('CHROMIUM_EXECUTABLE'):
        launch['executable_path'] = os.environ['CHROMIUM_EXECUTABLE']
    browser = p.chromium.launch(**launch)
    context = browser.new_context(accept_downloads=True, viewport={'width':1280,'height':900})
    page = context.new_page()
    errors = []
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.goto(URL)
    page.wait_for_function("document.documentElement.dataset.ready === 'true' && !!window.boombox")
    result = page.evaluate("""async () => {
      const {Engine,defaultSettings,applyStyle,STYLES}=await import('./js/engine.js');
      const {compile,EXAMPLES}=await import('./js/code.js');
      const results={styles:[],code:[]};
      for(const name of Object.keys(STYLES)) {
        const s=defaultSettings();applyStyle(s,name); const e=new Engine(s);
        const blob=await e.exportWav(1);
        const buffer=await blob.arrayBuffer();const view=new DataView(buffer);
        let peak=0,energy=0;for(let i=44;i+1<view.byteLength;i+=2){let x=view.getInt16(i,true)/32768;peak=Math.max(peak,Math.abs(x));energy+=x*x;}
        if(!(peak>.001 && peak<=1 && energy>0))throw Error('Silent/invalid WAV '+name);
        results.styles.push({name,bytes:blob.size,peak,energy});
      }
      for(const [name,source] of Object.entries(EXAMPLES)) {const c=compile(source);results.code.push({name,loops:c.loops.length});}
      return results;
    }""")
    page.evaluate('window.boombox.engine.play()')
    page.wait_for_timeout(1100)
    assert page.evaluate('window.boombox.engine.playing')
    signal = page.evaluate("""()=>{let a=window.boombox.engine.analyser;let d=new Float32Array(a.fftSize);a.getFloatTimeDomainData(d);return Math.max(...d.map(Math.abs));}""")
    assert signal > .0001, signal
    page.evaluate('window.boombox.engine.stop()')
    page.screenshot(path=str(OUT/'boombox-desktop.png'), full_page=True)
    for width in [320,390,768]:
        page.set_viewport_size({'width':width,'height':844})
        assert page.evaluate('document.documentElement.scrollWidth <= innerWidth'), f'Overflow at {width}'
    page.set_viewport_size({'width':390,'height':844})
    page.screenshot(path=str(OUT/'boombox-mobile.png'), full_page=True)
    page.evaluate('navigator.serviceWorker.ready.then(()=>true)')
    page.reload()
    page.wait_for_function('navigator.serviceWorker.controller !== null')
    def sw(typ):
        return page.evaluate("""type=>new Promise((resolve,reject)=>{const c=new MessageChannel();c.port1.onmessage=e=>resolve(e.data);navigator.serviceWorker.controller.postMessage({type},[c.port2]);setTimeout(()=>reject(Error('SW timeout')),15000);})""", typ)
    assert sw('SAVE_OFFLINE')['ready']
    page.evaluate("""async()=>{for(const n of await caches.keys())if(n.startsWith('boombox-')){let c=await caches.open(n);await c.delete(new URL('./js/code.js',location.href).href);}}""")
    assert not sw('CHECK_OFFLINE')['ready'], 'Missing asset not detected'
    assert sw('SAVE_OFFLINE')['ready'], 'Repair failed'
    context.set_offline(True)
    page.reload()
    page.wait_for_function("document.documentElement.dataset.ready === 'true'")
    page.evaluate('window.boombox.engine.play()')
    page.wait_for_timeout(700)
    assert page.evaluate('window.boombox.engine.playing')
    page.evaluate('window.boombox.engine.stop()')
    context.set_offline(False)
    assert not errors, errors
    result.update(signal=signal,offline=True,mobileOverflow=False,errors=errors)
    (OUT/'browser-verification.json').write_text(json.dumps(result,indent=2))
    print(json.dumps(result,indent=2))
    # A failed first install must produce a bounded error and be repairable.
    interrupted = browser.new_context()
    interrupted.route('**/LICENSE.txt', lambda route: route.abort())
    failed = interrupted.new_page()
    failed.goto(URL)
    failed.wait_for_function("document.documentElement.dataset.ready === 'true'")
    expect(failed.locator('#offlineStatus')).to_contain_text('did not finish', timeout=20000)
    interrupted.unroute('**/LICENSE.txt')
    failed.locator('[data-open="settingsSheet"]').click()
    failed.locator('#saveOffline').click()
    expect(failed.locator('#offlineStatus')).to_contain_text('Ready offline', timeout=20000)
    interrupted.close()
    print('Interrupted first cache installation and retry: PASS')
    browser.close()
