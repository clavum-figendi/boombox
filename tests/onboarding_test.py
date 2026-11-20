"""Visit preferences and hands-on walkthrough, exercised in Chromium."""
import copy
import json
import unittest
from ui_test import UIHarness, SOURCE
from playwright.sync_api import expect


class VisitRegression(UIHarness):
    def snapshot(self):
        return self.page.evaluate('boombox.settings')

    def reload(self):
        self.page.reload()
        self.page.wait_for_function("document.documentElement.dataset.ready === 'true'")

    def test_fresh_visits_and_local_consent(self):
        page = self.page
        self.assertEqual(self.snapshot()['style'], 'techno')
        for genre in page.locator('[data-genre]').evaluate_all('els=>els.map(e=>e.dataset.genre)'):
            page.locator(f'[data-genre="{genre}"]').click()
            before = self.snapshot()
            self.reload()
            after = self.snapshot()
            self.assertEqual(after['style'], genre)
            self.assertGreater(after['seed'], 0)
            self.assertNotEqual(before['seed'], after['seed'])
            self.assertNotEqual(before['patterns'], after['patterns'])
            self.assertNotEqual(before['channels'], after['channels'])
            self.assertNotEqual([before[k] for k in ['drive','delay','reverb']], [after[k] for k in ['drive','delay','reverb']])
            for selector in [f'[data-genre="{genre}"]', '#variation']:
                before = self.snapshot()
                page.locator(selector).click()
                after = self.snapshot()
                self.assertEqual(after['style'], genre)
                self.assertEqual(after['master'], before['master'])
                self.assertNotEqual(before['seed'], after['seed'])
                self.assertNotEqual(before['patterns'], after['patterns'])
                self.assertNotEqual(before['channels'], after['channels'])
                self.assertNotEqual([before[k] for k in ['drive','delay','reverb']], [after[k] for k in ['drive','delay','reverb']])
        self.settings()
        page.locator('#freshVisits').uncheck()
        page.locator('#theme').select_option('mint')
        page.keyboard.press('Escape')
        self.workspace('code')
        page.locator('#codeEditor').fill(SOURCE)
        page.locator('#master').focus()
        page.locator('#master').press('Home')
        before = self.snapshot()
        self.reload()
        self.assertEqual(self.snapshot(), before)
        self.assertEqual(page.locator('#codeEditor').input_value(), SOURCE)
        self.assertEqual(page.locator('html').get_attribute('data-theme'), 'mint')
        self.settings()
        project = {'version':1, 'settings':copy.deepcopy(before), 'code':SOURCE, 'freshVisits':True}
        project['settings']['bpm'] = 111
        self.import_project(project)
        expect(page.locator('#settingsStatus')).to_contain_text('Project imported')
        self.assertEqual(self.snapshot(), project['settings'])
        expect(page.locator('#freshVisits')).not_to_be_checked()
        self.reload()
        self.assertEqual(self.snapshot(), project['settings'])
        self.settings()
        page.locator('#freshVisits').check()
        project['freshVisits'] = False
        self.import_project(project)
        expect(page.locator('#settingsStatus')).to_contain_text('Project imported')
        self.assertEqual(self.snapshot(), project['settings'])
        expect(page.locator('#freshVisits')).to_be_checked()
        self.reload()
        self.assertNotEqual(self.snapshot()['seed'], project['settings']['seed'])
        self.assertEqual(self.snapshot()['master'], 0)

    def test_locked_short_hat_decay_survives_reload(self):
        # Force a reproducible fresh preset at the short-decay end of Psytrance.
        self.page.evaluate("() => {crypto.getRandomValues = words => {words[0]=4;return words;};}")
        self.page.locator('[data-genre="psytrance"]').click()
        self.settings()
        self.page.locator('#freshVisits').uncheck()
        self.page.keyboard.press('Escape')
        before = self.snapshot()
        self.reload()
        self.assertEqual(self.snapshot(), before)

    def test_tour_edits_real_melody_tone_and_effects(self):
        page = self.page
        page.locator('#melodyQuick').click()
        expect(page.locator('#tourTitle')).to_contain_text('Lead')
        page.locator('#tourControls').get_by_label('lead waveform', exact=True).select_option('square')
        self.assertEqual(self.snapshot()['channels']['lead']['wave'], 'square')
        density = page.get_by_label('Melody density', exact=True)
        density.focus()
        density.press('Home')
        self.assertEqual(self.snapshot()['density'], 0)
        before = self.snapshot()['patterns']['lead'][0]
        page.get_by_role('button', name='Tour lead step 1', exact=True).click()
        self.assertEqual(self.snapshot()['patterns']['lead'][0], not before)
        page.locator('#tourNext').click()
        page.locator('#tourControls').get_by_label('pad decay', exact=True).focus()
        page.keyboard.press('Home')
        self.assertEqual(self.snapshot()['channels']['pad']['decay'], .03)
        page.locator('#tourNext').click()
        page.locator('#tourControls').get_by_label('Cutoff', exact=True).focus()
        page.keyboard.press('Home')
        self.assertEqual(self.snapshot()['cutoff'], 40)
        page.locator('#tourNext').click()
        page.locator('#tourControls').get_by_label('Drive', exact=True).focus()
        page.keyboard.press('Home')
        self.assertEqual(self.snapshot()['drive'], 0)
        page.locator('#tourNext').click()
        page.locator('#tourControls').get_by_role('button', name='mute lead', exact=True).click()
        self.assertTrue(self.snapshot()['channels']['lead']['mute'])
        page.get_by_label('Tour master volume', exact=True).focus()
        page.keyboard.press('Home')
        self.assertEqual(self.snapshot()['master'], 0)
        page.keyboard.press('Escape')
        expect(page.locator('#melodyQuick')).to_be_focused()
        self.assertEqual(page.locator('#master').input_value(), '0')
        self.assertEqual(page.locator('#density').input_value(), '0')
        self.assertFalse(page.evaluate('!!boombox.engine.playing'))
        self.assertIsNone(page.evaluate('boombox.engine.context'))

    def test_walkthrough_controls_focus_and_mobile(self):
        page = self.page
        expect(page.locator('#welcome')).to_be_visible()
        self.assertFalse(page.evaluate('!!boombox.engine.playing'))
        before_tour = self.snapshot()
        page.locator('#welcome [data-tour]').click()
        expect(page.locator('#tourSheet')).to_be_visible()
        page.keyboard.press('Escape')
        expect(page.locator('#welcome [data-tour]')).to_be_focused()
        self.assertEqual(self.snapshot(), before_tour)
        page.locator('#dismissWelcome').click()
        self.reload()
        expect(page.locator('#welcome')).not_to_be_visible()
        page.get_by_role('button', name='Help', exact=True).click()
        page.locator('#helpSheet [data-tour]').click()
        expect(page.locator('#tourSheet')).to_be_visible()
        before = self.snapshot()
        page.locator('#tourNext').click()
        expect(page.locator('#tourTitle')).to_contain_text('Hats')
        page.locator('#tourBack').click()
        self.assertEqual(self.snapshot(), before)
        gain = page.locator('#tourControls input[type=range]').first
        gain.focus()
        gain.press('Home')
        self.assertEqual(self.snapshot()['channels']['kick']['gain'], 0)
        self.assertFalse(page.evaluate('!!boombox.engine.playing'))
        for width in [320, 390]:
            page.set_viewport_size({'width':width,'height':844})
            for _ in range(7):
                self.assertFalse(page.evaluate('document.documentElement.scrollWidth > innerWidth'))
                small = page.locator('#tourSheet button:visible, #tourSheet input:visible, #tourSheet select:visible').evaluate_all('els=>els.filter(e=>e.getBoundingClientRect().width<43.99||e.getBoundingClientRect().height<43.99).map(e=>e.outerHTML)')
                self.assertEqual(small, [])
                page.locator('#tourNext').click()
                if not page.locator('#tourSheet').is_visible():
                    break
            if not page.locator('#tourSheet').is_visible():
                page.locator('#helpSheet [data-tour]').click()
        page.locator('#tourSkip').click()
        expect(page.locator('#helpSheet [data-tour]')).to_be_focused()
        page.keyboard.press('Escape')
        self.settings()
        page.locator('#settingsSheet [data-tour]').click()
        for _ in range(7):
            page.locator('#tourNext').click()
        expect(page.locator('#tourSheet')).not_to_be_visible()
        expect(page.locator('#settingsSheet [data-tour]')).to_be_focused()
        self.assertFalse(page.evaluate('!!boombox.engine.playing'))
        prose = (page.locator('body').text_content() or '').lower()
        for warning in ['not full ruby', 'not a ruby runtime', 'no warranty', 'sonic pi-compatible subset', 'general ruby']:
            self.assertNotIn(warning, prose)


if __name__ == '__main__':
    unittest.main(verbosity=2)
