"""Catalog and playback-time cadence regression: python tests/expansion_ui_test.py."""
import json
from pathlib import Path
import unittest
from playwright.sync_api import expect
from ui_test import UIHarness


class ExpansionUI(UIHarness):
    def cadence(self, enabled=True, minutes='0.1', timer='0'):
        page = self.page
        page.locator('#timerButton').click()
        page.locator('#variationMinutes').fill(minutes)
        page.locator('#autoVariation').set_checked(enabled)
        page.locator('#timer').select_option(timer)
        page.get_by_role('button', name='Close timer', exact=True).click()

    def seed(self):
        return self.page.evaluate('boombox.settings.seed')

    def inject_audio_clock(self):
        # Real click unlocks the real graph first. Only its observed time is replaced.
        self.page.locator('#play').click()
        self.page.evaluate('''() => {
          const e=boombox.engine;
          clearInterval(e.timer);
          window.testAudioTime=e.context.currentTime;
          Object.defineProperty(e.context,'currentTime',{configurable:true,get:()=>window.testAudioTime});
          boombox.variationTick();
        }''')

    def advance(self, seconds):
        self.page.evaluate('seconds=>{testAudioTime+=seconds;boombox.variationTick();}', seconds)

    def exported(self):
        with self.page.expect_download() as pending:
            self.page.locator('#exportProject').click()
        return json.loads(Path(pending.value.path()).read_text())

    def test_real_audio_no_stop_timer_and_persistence_without_autoplay(self):
        page = self.page
        expect(page.locator('#variationStatus')).to_have_text('Auto variation off')
        self.cadence()
        original = self.seed()
        master = page.evaluate('boombox.settings.master')
        page.locator('#play').click()
        page.wait_for_function('seed=>boombox.settings.seed!==seed', arg=original, timeout=10000)
        self.assertEqual(page.evaluate('boombox.settings.master'), master)
        self.assertTrue(page.evaluate('boombox.engine.playing'))
        signal = page.evaluate('''()=>{const a=boombox.engine.analyser,d=new Float32Array(a.fftSize);a.getFloatTimeDomainData(d);return Math.max(...d.map(Math.abs));}''')
        self.assertGreater(signal, 0.00001)
        page.reload()
        page.wait_for_function("document.documentElement.dataset.ready==='true'")
        self.assertFalse(page.evaluate('boombox.engine.playing'))
        self.assertIsNone(page.evaluate('boombox.engine.context'))
        page.locator('#timerButton').click()
        expect(page.locator('#autoVariation')).to_be_checked()
        expect(page.locator('#variationMinutes')).to_have_value('0.1')

    def test_pause_stop_manual_reset_suspension_and_long_gap(self):
        page = self.page
        self.cadence()
        self.inject_audio_clock()
        original = self.seed()
        self.advance(3)
        page.locator('#play').click()
        remaining = page.evaluate('boombox.variationClock.remaining')
        self.advance(300)
        self.assertEqual(self.seed(), original)
        self.assertEqual(page.evaluate('boombox.variationClock.remaining'), remaining)
        page.locator('#play').click()
        page.evaluate('clearInterval(boombox.engine.timer)')
        self.advance(3.1)
        self.assertNotEqual(self.seed(), original)
        page.locator('#stop').click()
        self.assertEqual(page.evaluate('boombox.variationClock.remaining'), 6)
        self.inject_audio_clock()
        self.advance(2)
        page.locator('#variation').click()
        self.assertEqual(page.evaluate('boombox.variationClock.remaining'), 6)
        self.advance(2)
        page.locator('[data-genre="dub"]').click()
        self.assertEqual(page.evaluate('boombox.variationClock.remaining'), 6)
        self.advance(1)
        page.locator('[data-open="mixerSheet"]').click()
        page.get_by_label('bass instrument', exact=True).select_option('sub')
        self.assertEqual(page.evaluate('boombox.variationClock.remaining'), 5)
        page.get_by_role('button', name='Close mixer', exact=True).click()
        page.evaluate('boombox.engine.context.suspend()')
        self.advance(100)
        self.assertEqual(page.evaluate('boombox.variationClock.remaining'), 5)
        page.evaluate('boombox.engine.context.resume()')
        self.advance(1)
        self.assertEqual(page.evaluate('boombox.variationClock.remaining'), 4)
        original = self.seed()
        self.advance(1000)
        self.assertNotEqual(self.seed(), original)
        after = self.seed()
        self.advance(0)
        self.assertEqual(self.seed(), after)
        self.assertEqual(page.evaluate('boombox.variationClock.remaining'), 6)

    def test_reset_after_delayed_tick_starts_at_the_action_time(self):
        self.cadence()
        self.inject_audio_clock()
        result = self.page.evaluate('''()=>{
          testAudioTime+=20;
          document.querySelector('#variation').click();
          const manual=boombox.settings.seed;
          boombox.variationTick();
          const manualHeld=boombox.settings.seed===manual;
          const toggle=document.querySelector('#autoVariation');
          toggle.checked=false;toggle.dispatchEvent(new Event('change'));
          testAudioTime+=20;
          toggle.checked=true;toggle.dispatchEvent(new Event('change'));
          const enabled=boombox.settings.seed;
          boombox.variationTick();
          return {manualHeld,enableHeld:boombox.settings.seed===enabled,remaining:boombox.variationClock.remaining};
        }''')
        self.assertTrue(result['manualHeld'])
        self.assertTrue(result['enableHeld'])
        self.assertEqual(result['remaining'], 6)

    def test_timer_wins_disabled_and_repeated_toggles(self):
        page = self.page
        self.cadence(minutes='5', timer='5')
        self.inject_audio_clock()
        original = self.seed()
        self.advance(300)
        self.assertFalse(page.evaluate('boombox.engine.playing'))
        self.assertEqual(self.seed(), original)
        expect(page.locator('#status')).to_contain_text('Session complete')
        self.cadence(enabled=False)
        self.inject_audio_clock()
        self.advance(600)
        self.assertEqual(self.seed(), original)
        for _ in range(3):
            page.locator('#play').click()
            page.locator('#play').click()
            page.evaluate('clearInterval(boombox.engine.timer)')
        page.evaluate('''()=>{window.cadenceCalls=0;const c=boombox.variationClock,advance=c.advance.bind(c);c.advance=(...args)=>{cadenceCalls++;return advance(...args);};}''')
        page.wait_for_timeout(1100)
        calls = page.evaluate('cadenceCalls')
        self.assertGreaterEqual(calls, 3)
        self.assertLessEqual(calls, 5, 'Repeated Play must not create duplicate cadence timers')
        self.cadence()
        page.evaluate('boombox.variationClock.reset()')
        self.advance(6)
        after = self.seed()
        self.assertNotEqual(after, original)
        self.advance(0)
        self.assertEqual(self.seed(), after)
        self.assertEqual(page.evaluate('boombox.variationClock.remaining'), 6)

    def test_custom_interval_validation_and_turning_off_incomplete_field(self):
        page = self.page
        self.cadence(minutes='2.375')
        self.assertEqual(page.evaluate('boombox.variationClock.remaining'), 142.5)
        page.locator('#variationStatus').click()
        page.locator('#variationMinutes').fill('')
        page.locator('#autoVariation').uncheck()
        self.assertFalse(page.evaluate('boombox.variationClock.enabled'))
        page.locator('#variationMinutes').fill('121')
        page.locator('#autoVariation').click()
        expect(page.locator('#autoVariation')).not_to_be_checked()
        self.assertFalse(page.evaluate('boombox.variationClock.enabled'))
        self.assertEqual(page.evaluate('boombox.variationClock.minutes'), 2.375)
        page.locator('#variationMinutes').fill('0.1')
        page.locator('#autoVariation').check()
        self.assertTrue(page.evaluate('boombox.variationClock.enabled'))

    def test_project_permission_and_legacy_migration(self):
        page = self.page
        project = page.evaluate('({version:1,settings:structuredClone(boombox.settings),code:"use_bpm 123"})')
        for channel in project['settings']['channels'].values():
            channel.pop('instrument', None)
        project['autoVariation'] = True
        project['variationMinutes'] = .1
        project['settings']['autoVariation'] = True
        project['settings']['channels']['kick']['instrument'] = 'supersaw'
        project['settings']['channels']['lead']['instrument'] = '__proto__'
        self.settings()
        self.import_project(project)
        expect(page.locator('#settingsStatus')).to_contain_text('Project imported')
        instruments = page.evaluate('Object.values(boombox.settings.channels).map(c=>c.instrument)')
        self.assertEqual(instruments, ['classic'] * 6)
        exported = self.exported()
        self.assertNotIn('autoVariation', exported)
        self.assertNotIn('autoVariation', exported['settings'])
        self.assertFalse(page.evaluate('boombox.variationClock.enabled'))
        self.assertFalse(page.evaluate('boombox.engine.playing'))
        page.get_by_role('button', name='Close settings', exact=True).click()
        self.cadence()
        self.settings()
        self.import_project(project)
        expect(page.locator('#settingsStatus')).to_contain_text('Project imported')
        self.assertTrue(page.evaluate('boombox.variationClock.enabled'))
        self.assertFalse(page.evaluate('boombox.engine.playing'))

    def test_every_catalog_entry_roundtrip_and_engine_voice(self):
        page = self.page
        catalogs = page.evaluate('''async()=>{const {SCALES,INSTRUMENTS}=await import('./js/engine.js');return {scales:SCALES,instruments:INSTRUMENTS};}''')
        self.assertEqual(page.locator('#scale option').evaluate_all('(xs)=>xs.map(x=>x.value)'), list(catalogs['scales']))
        self.settings()
        page.locator('#freshVisits').uncheck()
        page.get_by_role('button', name='Close settings', exact=True).click()
        for scale in catalogs['scales']:
            page.locator('#scale').select_option(scale)
            self.settings()
            project = self.exported()
            self.assertEqual(project['settings']['scale'], scale)
            self.import_project(project)
            expect(page.locator('#settingsStatus')).to_contain_text('Project imported')
            self.assertEqual(page.evaluate('boombox.settings.scale'), scale)
            page.get_by_role('button', name='Close settings', exact=True).click()
        page.locator('[data-open="mixerSheet"]').click()
        for lane in ['kick','snare','hat','bass','lead','pad']:
            actual = page.get_by_label(f'{lane} instrument', exact=True).locator('option').evaluate_all('(xs)=>xs.map(x=>x.value)')
            self.assertEqual(actual, [key for key, patch in catalogs['instruments'].items() if lane in patch['lanes']])
        for voice, patch in catalogs['instruments'].items():
            lane = patch['lanes'][0]
            select = page.get_by_label(f'{lane} instrument', exact=True)
            select.select_option(voice)
            self.assertEqual(select.get_attribute('title'), patch['description'])
            wave = page.get_by_label(f'{lane} waveform', exact=True)
            self.assertEqual(wave.is_visible(), patch.get('wave') is not False)
            page.get_by_role('button', name='Close mixer', exact=True).click()
            self.settings()
            project = self.exported()
            self.assertEqual(project['settings']['channels'][lane]['instrument'], voice)
            self.import_project(project)
            expect(page.locator('#settingsStatus')).to_contain_text('Project imported')
            self.assertEqual(page.evaluate('(lane)=>boombox.settings.channels[lane].instrument', lane), voice)
            events = page.evaluate('''async lane=>{const {patternEvents}=await import('./js/engine.js');const s=structuredClone(boombox.settings);s.density=1;s.patterns[lane].fill(true);return patternEvents(s).filter(e=>e.instrument===lane).map(e=>e.voice);}''', lane)
            self.assertEqual(events, [voice] * 16)
            page.get_by_role('button', name='Close settings', exact=True).click()
            page.locator('[data-open="mixerSheet"]').click()
        page.get_by_role('button', name='Close mixer', exact=True).click()
        # The tour uses the same live lane selectors, rather than disconnected controls.
        page.locator('#melodyQuick').click()
        page.get_by_label('lead instrument', exact=True).select_option('fm_bell')
        self.assertEqual(page.evaluate('boombox.settings.channels.lead.instrument'), 'fm_bell')
        expect(page.get_by_label('lead waveform', exact=True)).to_be_hidden()
        page.get_by_role('button', name='Close walkthrough', exact=True).click()
        page.reload()
        page.wait_for_function("document.documentElement.dataset.ready==='true'")
        self.assertEqual(page.evaluate('boombox.settings.channels.lead.instrument'), 'fm_bell')
        self.assertFalse(page.evaluate('boombox.engine.playing'))


if __name__ == '__main__':
    unittest.main()
