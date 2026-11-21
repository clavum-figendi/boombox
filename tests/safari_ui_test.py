"""Real click/audio lifecycle checks; injected interruption is not an iPhone reproduction.
BROWSER=webkit WEBKIT_EXECUTABLE=/path/to/webkit-launch python tests/safari_ui_test.py
WebKit's Linux audio backend may need GST_PLUGIN_PATH, GST_AUDIO_SINK=fakesink,
LD_LIBRARY_PATH and __EGL_VENDOR_LIBRARY_FILENAMES from the local bundle setup.
"""
import os
import unittest
from playwright.sync_api import sync_playwright, expect

URL = os.environ.get('BOOMBOX_URL', 'http://127.0.0.1:8097')


class SafariUI(unittest.TestCase):
    def setUp(self):
        self.pw = sync_playwright().start()
        self.addCleanup(self.pw.stop)
        kind = os.environ.get('BROWSER', 'chromium')
        options = {'headless': True}
        if kind == 'webkit' and os.environ.get('WEBKIT_EXECUTABLE'):
            options['executable_path'] = os.environ['WEBKIT_EXECUTABLE']
        self.browser = getattr(self.pw, kind).launch(**options)
        self.addCleanup(self.browser.close)
        device=self.pw.devices['iPhone 13'] if kind=='webkit' else {}
        self.context = self.browser.new_context(service_workers='block',**device)
        self.page = self.context.new_page()
        self.errors = []
        self.page.on('pageerror', lambda error: self.errors.append(str(error)))
        self.page.goto(URL)
        expect(self.page.locator('html')).to_have_attribute('data-ready', 'true')

    def tearDown(self):
        self.assertEqual(self.errors, [])

    def interrupt(self, state='interrupted'):
        self.page.evaluate('''state => {
          const e=boombox.engine, c=e.context;
          const resume=Object.getPrototypeOf(c).resume.bind(c);
          window.resumeCalls=0;window.playCalls=0;
          const play=e.play.bind(e);e.play=()=>{playCalls++;return play();};
          Object.defineProperty(c,'state',{configurable:true,get:()=>state});
          c.resume=()=>{resumeCalls++;delete c.state;return resume();};
          c.dispatchEvent(new Event('statechange'));
        }''', state)

    def test_one_click_recovers_interruption(self):
        page = self.page
        self.assertIsNone(page.evaluate('boombox.engine.context'))
        page.locator('#play').click()
        expect(page.locator('#play')).to_have_attribute('aria-label', 'Pause groovebox')
        self.assertTrue(page.evaluate("boombox.engine.playing && boombox.engine.context.state==='running'"))
        self.interrupt()
        # This assertion separately catches the misleading Pause label.
        label = page.locator('#play').get_attribute('aria-label')
        page.locator('#play').click()
        page.wait_for_timeout(200)
        self.assertTrue(page.evaluate("boombox.engine.playing && boombox.engine.context.state==='running'"), 'First recovery click must resume and play, not merely pause the stale playing flag')
        self.assertEqual(label, 'Play groovebox')
        self.assertEqual(page.evaluate('[resumeCalls,playCalls]'), [1, 1])
        expect(page.locator('#play')).to_have_attribute('aria-label', 'Pause groovebox')
    def signal(self):
        # WebKit's polling utility can be blocked by CSP; keep the real signal assertion.
        for _ in range(200):
            if self.page.evaluate('''() => {
              const a=boombox.engine.analyser;if(!a)return false;
              const data=new Float32Array(a.fftSize);
              a.getFloatTimeDomainData(data);return data.some(x=>Math.abs(x)>.00001);
            }'''):
                return
            self.page.wait_for_timeout(50)
        self.fail('No synthesized PCM signal within ten seconds')

    def test_first_click_audio_manual_pause_and_no_visibility_autoplay(self):
        page = self.page
        page.locator('#play').click()
        self.signal()
        page.locator('#play').click()
        remaining = page.evaluate('boombox.variationClock.remaining')
        page.evaluate("document.dispatchEvent(new Event('visibilitychange'))")
        page.wait_for_timeout(300)
        self.assertFalse(page.evaluate('boombox.engine.playing'))
        self.assertEqual(page.evaluate('boombox.variationClock.remaining'), remaining)
        page.locator('#play').click()
        self.signal()
        page.reload()
        expect(page.locator('html')).to_have_attribute('data-ready', 'true')
        self.assertIsNone(page.evaluate('boombox.engine.context'))

    def test_code_and_deck_restart_after_interruption(self):
        page = self.page
        page.locator('[data-view="code"]').click()
        page.locator('#runCode').click()
        self.signal()
        self.interrupt()
        expect(page.locator('#status')).to_have_text('Audio interrupted/paused by device. Tap Play or Run code to resume.')
        page.locator('#runCode').click()
        self.signal()
        self.assertEqual(page.evaluate('resumeCalls'), 1)
        self.assertTrue(page.evaluate('!!boombox.engine.code'))
        page.locator('#stop').click()
        import io, math, struct, wave
        data = io.BytesIO()
        with wave.open(data, 'wb') as wav:
            wav.setparams((1, 2, 44100, 0, 'NONE', 'not compressed'))
            wav.writeframes(b''.join(struct.pack('<h', int(9000*math.sin(i*2*math.pi*220/44100))) for i in range(44100)))
        page.locator('[data-view="remix"]').click()
        page.get_by_label('Load deck A', exact=True).set_input_files({'name':'local-test.wav','mimeType':'audio/wav','buffer':data.getvalue()})
        expect(page.locator('#deckName0')).to_contain_text('local-test.wav ·')
        page.locator('#deckPlay0').click()
        self.signal()
        page.evaluate('window.previousSource=boombox.engine.decks[0].source')
        self.interrupt('suspended')
        page.locator('#deckPlay0').click()
        self.signal()
        self.assertTrue(page.evaluate('boombox.engine.decks[0].playing && boombox.engine.decks[0].source!==previousSource'))
        self.assertEqual(page.evaluate('resumeCalls'), 1)
        page.locator('#deckPlay0').click()
        self.assertFalse(page.evaluate('boombox.engine.decks[0].playing'))

    def test_native_suspension_and_guarded_error_diagnostics(self):
        page = self.page
        page.locator('#play').click()
        self.signal()
        page.evaluate('boombox.engine.context.suspend()')
        expect(page.locator('#play')).to_have_attribute('aria-label', 'Play groovebox')
        page.locator('#play').click()
        self.signal()
        self.assertTrue(page.evaluate("boombox.engine.playing && boombox.engine.context.state==='running'"))
        page.locator('#stop').click()
        page.evaluate("()=>{boombox.engine.init=async()=>{throw new Error('private-code-file-secret-token')};}")
        page.locator('#play').click()
        expect(page.locator('#status')).to_have_text('private-code-file-secret-token')
        page.get_by_role('button', name='Help', exact=True).click()
        expect(page.locator('#audioDiagnostics')).to_contain_text('Error: action failed')
        self.assertNotIn('private-code-file-secret-token', page.locator('#audioDiagnostics').text_content())
        expect(page.locator('#startupFailure')).to_be_hidden()

    def test_state_listener_is_once_per_context_and_resume_in_click(self):
        page = self.page
        page.add_init_script('''(() => {
          const add=EventTarget.prototype.addEventListener;
          window.contextListeners=0;
          EventTarget.prototype.addEventListener=function(type,...args){
            if(type==='statechange' && this instanceof AudioContext)contextListeners++;
            return add.call(this,type,...args);
          };
        })()''')
        page.reload()
        expect(page.locator('html')).to_have_attribute('data-ready', 'true')
        page.locator('#play').click()
        self.signal()
        page.locator('#play').click()
        page.locator('#play').click()
        self.signal()
        self.assertEqual(page.evaluate('contextListeners'), 1)
        self.interrupt()
        page.evaluate('''() => {
          window.inClick=false;window.resumeInClick=false;
          const c=boombox.engine.context, resume=c.resume.bind(c);
          c.resume=()=>{resumeInClick=inClick;return resume();};
          document.addEventListener('click',()=>{inClick=true;setTimeout(()=>{inClick=false;},0);},true);
        }''')
        page.locator('#play').click()
        self.assertTrue(page.evaluate('resumeInClick'))
        self.assertEqual(page.evaluate('contextListeners'), 1)

    def test_startup_import_failure_is_visible_and_retry_preserves_data(self):
        page = self.page
        page.evaluate("localStorage.setItem('diagnostic-sentinel','keep-me')")
        page.route('**/js/engine.js', lambda route: route.abort())
        page.reload()
        expect(page.locator('#startupFailure')).to_be_visible()
        self.assertTrue(page.evaluate('!!window.boomboxBootError'))
        self.assertEqual(page.evaluate("localStorage.getItem('diagnostic-sentinel')"), 'keep-me')
        page.unroute('**/js/engine.js')
        with page.expect_navigation():
            page.locator('#retryStartup').click()
        expect(page.locator('html')).to_have_attribute('data-ready', 'true')
        self.assertEqual(page.evaluate("localStorage.getItem('diagnostic-sentinel')"), 'keep-me')
        expect(page.locator('#startupFailure')).to_be_hidden()

    def test_diagnostics_copy_and_unavailable_fallback(self):
        page = self.page
        page.get_by_role('button', name='Help', exact=True).click()
        expect(page.locator('#audioDiagnostics')).to_contain_text('Audio context: not initialized')
        page.evaluate("Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async text=>{window.copiedDiagnostics=text;}}})")
        page.locator('#copyDiagnostics').click()
        expect(page.locator('#diagnosticsStatus')).to_contain_text('Diagnostics copied')
        self.assertEqual(page.evaluate('copiedDiagnostics'), page.locator('#audioDiagnostics').text_content())
        page.evaluate("Object.defineProperty(navigator,'clipboard',{configurable:true,value:undefined})")
        page.locator('#copyDiagnostics').click()
        expect(page.locator('#diagnosticsStatus')).to_contain_text('take a screenshot')
        self.assertEqual(page.evaluate('getSelection().toString()'), page.locator('#audioDiagnostics').text_content())


if __name__ == '__main__':
    unittest.main()
