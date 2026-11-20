"""Durable real-click UI regression: python tests/ui_test.py [test_name]."""
import json
import math
import os
from pathlib import Path
import struct
import unittest
import wave
from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'artifacts'
URL = os.environ.get('BOOMBOX_URL', 'http://127.0.0.1:8097/')
CHROME = os.environ.get('CHROMIUM_EXECUTABLE')
SOURCE = 'use_bpm 87\nlive_loop :test do\n  sample :bd_haus\n  sleep 1\nend\n'


class UIHarness(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        OUT.mkdir(exist_ok=True)
        cls.pw = sync_playwright().start()
        options = {'headless':True,'args':['--autoplay-policy=no-user-gesture-required']}
        if CHROME:
            options['executable_path'] = CHROME
        cls.browser = cls.pw.chromium.launch(**options)

    @classmethod
    def tearDownClass(cls):
        cls.browser.close()
        cls.pw.stop()

    def setUp(self):
        self.context = self.browser.new_context(service_workers='block', accept_downloads=True,
            viewport={'width':1280,'height':900})
        self.page = self.context.new_page()
        self.errors = []
        self.page.on('pageerror', lambda e: self.errors.append(str(e)))
        self.load()

    def tearDown(self):
        self.context.close()
        self.assertEqual(self.errors, [])

    def load(self):
        self.page.goto(URL)
        self.page.wait_for_function("document.documentElement.dataset.ready === 'true'")

    def workspace(self, name):
        self.page.locator(f'[data-view="{name}"]').click()

    def settings(self):
        self.page.locator('[data-open="settingsSheet"]').click()

    def download(self, selector, name):
        with self.page.expect_download(timeout=60000) as pending:
            self.page.locator(selector).click()
        download = pending.value
        self.assertIsNone(download.failure())
        target = OUT / name
        download.save_as(target)
        self.assertGreater(target.stat().st_size, 0)
        return target

    def import_project(self, project):
        self.page.locator('#importProject').set_input_files({'name':'project.json',
            'mimeType':'application/json','buffer':json.dumps(project).encode()})

    def slider(self, locator, value):
        minimum = float(locator.get_attribute('min'))
        step = float(locator.get_attribute('step'))
        locator.focus()
        locator.press('Home')
        for _ in range(round((value - minimum) / step)):
            locator.press('ArrowRight')
        self.assertAlmostEqual(float(locator.input_value()), value, places=5)

class UIRegression(UIHarness):
    def test_live_remix_code_and_exports(self):
        page = self.page
        fixture = OUT / 'ui-tone.wav'
        with wave.open(str(fixture), 'wb') as wav:
            wav.setparams((1, 2, 22050, 0, 'NONE', 'not compressed'))
            wav.writeframes(b''.join(struct.pack('<h', round(10000 * math.sin(2 * math.pi * 220 * i / 22050))) for i in range(22050 * 3)))
        page.locator('[data-genre="house"]').click()
        self.assertEqual(page.evaluate('boombox.settings.style'), 'house')
        step = page.get_by_role('button', name='kick step 2', exact=True)
        original = step.get_attribute('aria-pressed')
        step.click()
        self.assertNotEqual(step.get_attribute('aria-pressed'), original)
        page.locator('#bpm').fill('139')
        page.locator('#play').click()
        page.wait_for_function('boombox.engine.playing')
        first_tick = page.evaluate('boombox.engine.tickIndex')
        self.workspace('remix')
        for index, letter in enumerate(['A', 'B']):
            page.get_by_label(f'Load deck {letter}', exact=True).set_input_files(str(fixture))
            expect(page.locator(f'#deckName{index}')).to_contain_text('ui-tone.wav · 3.0s')
            deck = page.locator('.deck').nth(index)
            page.get_by_label(f'Deck {letter} loop start', exact=True).fill('0.25')
            page.get_by_label(f'Deck {letter} loop start', exact=True).press('Tab')
            page.get_by_label(f'Deck {letter} loop end', exact=True).fill('2.5')
            page.get_by_label(f'Deck {letter} loop end', exact=True).press('Tab')
            deck.get_by_role('button', name='Reverse', exact=True).click()
            self.slider(deck.get_by_label('Gain', exact=True), .43)
            self.slider(deck.get_by_label('Rate', exact=True), .8 + index * .4)
            self.slider(deck.get_by_label('Low EQ', exact=True), -6)
            self.slider(deck.get_by_label('Mid EQ', exact=True), 2)
            self.slider(deck.get_by_label('High EQ', exact=True), -3)
            page.locator(f'#deckPlay{index}').click()
            expect(page.locator(f'#deckPlay{index}')).to_have_attribute('aria-pressed', 'true')
        self.slider(page.locator('#crossfader'), -.35)
        page.wait_for_timeout(200)
        readback = page.evaluate('''() => ({fade:boombox.engine.fade,decks:boombox.engine.decks.map(d=>({start:d.start,end:d.end,reverse:d.reverse,gain:d.gain,rate:d.rate,low:d.low,mid:d.mid,high:d.high,playing:d.playing,loopStart:d.source.loopStart,loopEnd:d.source.loopEnd,output:d.output.gain.value,eq:d.eq.slice(0,3).map(n=>n.gain.value)}))})''')
        self.assertAlmostEqual(readback['fade'], -.35)
        for d in readback['decks']:
            self.assertAlmostEqual(d['start'], .25 / 3)
            self.assertAlmostEqual(d['end'], 2.5 / 3)
            self.assertTrue(d['reverse'] and d['playing'])
            self.assertAlmostEqual(d['gain'], .43)
            self.assertAlmostEqual(d['loopStart'], .5)
            self.assertAlmostEqual(d['loopEnd'], 2.75)
            for actual, wanted in zip(d['eq'], [-6, 2, -3]):
                self.assertAlmostEqual(actual, wanted, places=2)
        self.assertGreater(readback['decks'][0]['output'], readback['decks'][1]['output'])
        self.workspace('code')
        page.locator('#codeEditor').fill(SOURCE)
        page.locator('#runCode').click()
        expect(page.locator('#codeStatus')).to_contain_text('Code running')
        self.assertEqual(page.evaluate('boombox.engine.code.compiled.bpm'), 87)
        self.assertEqual(page.evaluate('boombox.settings.bpm'), 139)
        self.assertTrue(page.evaluate('boombox.engine.playing'))
        self.assertGreater(page.evaluate('boombox.engine.tickIndex'), first_tick)
        rb = self.download('#exportCode', 'ui-live.rb')
        self.assertEqual(rb.read_text(), SOURCE)
        # Deliberate attack text is entered into the DSL, never evaluated as JavaScript.
        page.locator('#codeEditor').fill('document.body.innerHTML = "unsafe"')
        page.locator('#runCode').click()
        expect(page.locator('#codeStatus')).not_to_contain_text('Code running')
        self.assertTrue(page.evaluate('boombox.engine.playing && boombox.engine.code.compiled.bpm === 87'))
        page.locator('#codeEditor').fill(SOURCE)
        self.settings()
        page.locator('#recordMix').click()
        expect(page.locator('#recordMix')).to_contain_text('Finish recording')
        page.wait_for_timeout(1400)
        live = self.download('#recordMix', 'ui-live.webm')
        self.assertGreater(live.stat().st_size, 1000)
        recording_signal = page.evaluate('''async bytes=>{const b=await boombox.engine.context.decodeAudioData(new Uint8Array(bytes).buffer);const d=b.getChannelData(0);let peak=0,energy=0;for(const x of d){peak=Math.max(peak,Math.abs(x));energy+=x*x;}return {seconds:b.duration,peak,energy};}''', list(live.read_bytes()))
        self.assertGreater(recording_signal['peak'], .001)
        self.assertGreater(recording_signal['energy'], 0)
        readback['recording'] = recording_signal
        page.locator('#exportLength').select_option('15')
        rendered = self.download('#exportWav', 'ui-render.wav')
        with wave.open(str(rendered), 'rb') as wav:
            self.assertEqual(wav.getnchannels(), 2)
            self.assertAlmostEqual(wav.getnframes() / wav.getframerate(), 15)
            samples = struct.unpack('<' + 'h' * (wav.getnframes() * 2), wav.readframes(wav.getnframes()))
            self.assertGreater(max(map(abs, samples)), 100)
        page.keyboard.press('Escape')
        page.locator('#stopCode').click()
        self.assertIsNone(page.evaluate('boombox.engine.code'))
        self.assertTrue(page.evaluate('boombox.engine.playing'))
        page.locator('#stop').click()
        self.assertFalse(page.evaluate('boombox.engine.playing'))
        self.assertTrue(page.evaluate('boombox.engine.decks.every(d=>!d.playing)'))
        (OUT / 'ui-remix-readback.json').write_text(json.dumps(readback, indent=2))
        page.screenshot(path=str(OUT / 'ui-code-desktop.png'), full_page=True)

    def test_mobile_dialog_focus_and_targets(self):
        page = self.page
        measurements = []
        for width in [320, 390]:
            page.set_viewport_size({'width':width, 'height':844})
            for workspace in ['groove', 'remix', 'code']:
                self.workspace(workspace)
                overflow = page.evaluate('document.documentElement.scrollWidth > innerWidth')
                targets = page.locator('button:visible').evaluate_all('els=>els.map(e=>({name:e.getAttribute("aria-label")||e.textContent.trim(),width:e.getBoundingClientRect().width,height:e.getBoundingClientRect().height})).filter(r=>r.width<43.99||r.height<43.99)')
                measurements.append({'width':width,'workspace':workspace,'overflow':overflow,'smallButtons':targets})
                page.screenshot(path=str(OUT / f'ui-{workspace}-{width}.png'), full_page=True)
            opener = page.locator('[data-open="settingsSheet"]')
            opener.click()
            expect(page.locator('#settingsSheet')).to_be_visible()
            self.assertTrue(page.evaluate('document.activeElement.closest("#settingsSheet") !== null'))
            page.locator('#theme').select_option('mint')
            page.locator('#textSize').select_option('large')
            page.locator('#motion').uncheck()
            self.assertEqual(page.locator('html').get_attribute('data-theme'), 'mint')
            for _ in range(20):
                page.keyboard.press('Tab')
                self.assertTrue(page.evaluate('document.activeElement.closest("#settingsSheet") !== null'))
            page.keyboard.press('Escape')
            expect(page.locator('#settingsSheet')).not_to_be_visible()
            expect(opener).to_be_focused()
            self.settings()
            page.locator('#textSize').select_option('normal')
            page.keyboard.press('Escape')
        (OUT / 'ui-mobile-measurements.json').write_text(json.dumps(measurements, indent=2))
        self.assertFalse(any(row['overflow'] for row in measurements), 'Page overflow; see artifacts/ui-mobile-measurements.json')
        undersized = [{'width':r['width'], 'workspace':r['workspace'], 'count':len(r['smallButtons']), 'first':r['smallButtons'][:1]} for r in measurements if r['smallButtons']]
        self.assertEqual(undersized, [], 'Buttons below 44px; see artifacts/ui-mobile-measurements.json')

    def test_project_code_roundtrip(self):
        page = self.page
        self.workspace('code')
        page.locator('#codeEditor').fill(SOURCE)
        page.reload()
        page.wait_for_function("document.documentElement.dataset.ready === 'true'")
        self.assertEqual(page.locator('#codeEditor').input_value(), SOURCE)
        self.settings()
        project = json.loads(self.download('#exportProject', 'ui-project.json').read_text())
        self.assertEqual(project['version'], 1)
        self.assertEqual(project['code'], SOURCE)
        self.assertIn('settings', project)
        imported = dict(project, code='# <img src=x onerror=alert(1)>\n' + SOURCE)
        imported['settings']['bpm'] = 111
        self.import_project(imported)
        expect(page.locator('#settingsStatus')).to_contain_text('Project imported')
        self.assertEqual(page.locator('#codeEditor').input_value(), imported['code'])
        self.assertEqual(page.locator('#bpm').input_value(), '111')
        self.assertEqual(page.locator('#codeView img').count(), 0)
        self.import_project(dict(project, code='#' * 64000))
        expect(page.locator('#settingsStatus')).to_contain_text('Project imported')
        expect(page.locator('#codeEditor')).to_have_value('#' * 64000)
        self.import_project(imported)
        expect(page.locator('#codeEditor')).to_have_value(imported['code'])
        for invalid in [42, None, {}, 'a' * 64001]:
            self.import_project(dict(project, code=invalid))
            expect(page.locator('#settingsStatus')).to_contain_text('Invalid project code')
            self.assertEqual(page.locator('#codeEditor').input_value(), imported['code'])
            self.assertEqual(page.locator('#bpm').input_value(), '111')
        self.import_project({'version':1, 'settings':project['settings']})
        expect(page.locator('#settingsStatus')).to_contain_text('Project imported')
        self.assertEqual(page.locator('#codeEditor').input_value(), imported['code'])
        page.keyboard.press('Escape')
        self.workspace('code')
        page.locator('#codeExample').select_option(index=1)
        example = page.locator('#codeEditor').input_value()
        page.reload()
        page.wait_for_function("document.documentElement.dataset.ready === 'true'")
        self.assertEqual(page.locator('#codeEditor').input_value(), example)
        # Historical raw settings storage still loads without an envelope.
        self.settings()
        page.locator('#freshVisits').uncheck()
        page.keyboard.press('Escape')
        page.evaluate("s=>localStorage.setItem('boombox.project.v1',JSON.stringify(s))", project['settings'])
        page.reload()
        page.wait_for_function("document.documentElement.dataset.ready === 'true'")
        self.assertEqual(page.locator('#bpm').input_value(), str(project['settings']['bpm']))


if __name__ == '__main__':
    unittest.main(verbosity=2)
