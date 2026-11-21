# Boombox

An on-device electronic music instrument: generative groovebox, two local remix decks, and a separate live-code workspace. Inspired by [Stillwave](https://github.com/clavum-figendi/stillwave), with the same local-first approach, live visualization, genre selection, persistent transport and configurable mixing.

## Open / install

- Web: https://clavum-figendi.github.io/boombox/
- Android APK: see this repository's Releases.
- Source: MIT. No accounts, API keys, subscriptions, analytics, hosted inference or audio uploads.

## Workspaces

### New in 1.2.1 — Safari recovery and output level

Audio initialization now resumes both suspended and iOS-interrupted contexts inside the playback gesture. An interrupted player shows Play again and recovers on one tap, without auto-starting on visibility changes. Where supported, the Audio Session API is asked for the music playback category; unsupported platforms keep their normal path. Startup import failures now show a retry panel instead of leaving inert controls. **Help → Local audio diagnostics** can copy browser/audio-state details for a tester to share explicitly; no project, code, file names or secret values are included or uploaded.

New projects start at **85% master**, and nominal output normalization is stronger while retaining the compressor/limiter. The tested seeded dark-techno render is approximately **4.4 dB louder** than 1.2.0; saved master-slider values (including zero) remain unchanged. All 96 Chromium level/headroom renders passed below clipping. Seven recovery/diagnostic scenarios pass in real Chromium and Linux WebKit with an iPhone touch/viewport profile. This is not physical iPhone verification, and the reported first-launch failure was not reproduced on the untouched release in Linux WebKit. Testers can use the new diagnostics if their device still fails.

### New in 1.2

The scale menu now covers all seven diatonic modes, harmonic/melodic minor, pentatonic and blues scales, whole-tone and diminished colors, and darker regional minor variants. Bass, lead and pad generation follows the chosen intervals and root. Select instruments independently per mixer lane: sub/Reese/acid bass, FM bells, plucks, supersaws, organ and glassy pads, plus expanded kick, snare/clap/rim and hat percussion. Instrument choice and waveform/decay are separate tone controls where supported; existing projects retain their classic voice when an instrument field is absent.

**Session timer → Auto variation** enables a fresh genre-aware variation every custom **0.1–120 minutes** of groovebox playback. It works with **No timer** for continuous evolving music and can coexist with a stop timer. Pause holds the countdown, Stop resets it, and manual Variation or genre selection restarts the interval. A simultaneous stop deadline takes priority. Suspended audio does not advance the countdown; returning after a long scheduling gap causes at most one variation, not a burst. Automatic variation is off initially and remains an independent local preference: importing a project cannot enable it. Neither it nor the tour starts audio automatically. Browser/OS background suspension limits still apply.

### New in 1.1

Every visit starts a fresh genre-aware sound: tempo, groove, timbres, voice levels, decay and effects vary together within the selected style. Techno starts dark and minimal, with a rounded deep kick, low bass and restrained melody. Select another genre or press Variation to explore another complete sound. **Settings → Fresh sound on each visit** can be turned off to keep an exact sound across reloads. Export JSON before exploring if you want to keep a snapshot; imported projects apply exactly to the current visit.

A skippable first-run guide and a replayable mixer walkthrough explain the six voices, melody, timbre/decay, mute/solo, filter/resonance, drive, delay, reverb and master level. Audio starts only after a playback action.

**Groovebox:** techno, house, drum & bass, psytrance, breakbeat, hardcore, acid and dub recipes; six editable 16-step lanes; seeded musical variation; tempo, key, scale, swing, activity; channel level/mute/solo; synthesizer waveform and decay; filter, resonance, drive, delay and reverb; master level and session timer.

**Remix:** open two tracks from your device. Files are decoded and processed in memory, never uploaded. Waveforms, deck transport, loop boundaries, playback rate, reverse, three-band EQ, filtering and crossfade support manual mixing over synthesized music. This is sample/deck remixing, not AI stem separation, automatic beat detection or pitch-preserving time stretching. Rate changes alter pitch. Browser audio codec support varies; WAV is the most portable interchange format. Large decoded tracks may exceed phone memory.

**Live code:** write musical loops using `use_bpm`, `use_synth`, `live_loop`, `play`, `sample`, `sleep` and bounded repetitions. Boombox renders them through its own Web Audio instruments. Start with the included examples, consult the command reference and export your performance as `.rb`.

Project JSON saves settings, sequence and code, **not imported audio**; reopen source tracks after restoring. Settings use local browser storage. Browser storage is origin-scoped: data does not automatically transfer between the web app, another browser and the APK.

Code has one global tempo: the final `use_bpm` governs all code loops, independently of the groovebox tempo. Sleep and attack/sustain/release parameters are in beats. General Ruby, variables, user-defined functions and `with_fx` are not implemented. The instrument menu describes each patch; waveform selection is available when it shapes that patch, while decay controls its ring length.

## Offline and Android boundaries

Web: open online once and use Save offline; wait for successful cache verification. Later reloads and generation work disconnected. Browser storage eviction or clearing site data removes the cache. Android bundles the entire app and requires no network permission, so no first-run asset download is needed.

Android 8+ with **System WebView/Chromium 90 or newer** is the declared baseline. The Android wrapper uses the exact same client-side Web Audio engine. **Background/screen-off playback is not guaranteed**: this version does not include a native foreground audio service. Use it as a foreground instrument; browser/OS suspension may interrupt audio. File import/export uses the system document picker without broad storage or microphone permissions.

WAV export renders the synthesized groove. Mix recording, where supported, captures the live mixed output (including decks/code); recording support depends on MediaRecorder. Start at low volume, especially with drive/resonance and hardcore presets. The limiter is not a hearing-safety guarantee.

## Development

No runtime dependencies or CDN assets. Serve `web/` with any static server, under a domain root or project subpath:

```sh
python -m http.server 8097 --directory web
npm test
python tests/browser_test.py
python tests/ui_test.py
python tests/onboarding_test.py
python tests/preset_audio_test.py
python tests/expansion_ui_test.py
```

Tests use Node's built-in test runner; browser tests require Python Playwright and Chromium. Browser tests render real offline WAV, measure live audio, exercise offline reload and cache repair, and check document width at mobile sizes.

Install the browser test dependencies with `python -m pip install playwright` and `python -m playwright install chromium`. Optionally set `CHROMIUM_EXECUTABLE` to an existing Chromium executable. Run `BOOMBOX_AUDIO_TEST_URL=http://127.0.0.1:8097/ npm test` to include real PCM timbre/envelope/effect/silence regressions; without that variable the browser-dependent Node test is explicitly skipped.

Android build (Java 17, SDK 35):

```sh
cd android
./gradlew :app:assembleDebug :app:lintDebug :app:assembleDebugAndroidTest
```

Release signing uses an external keystore via `BOOMBOX_KEYSTORE` and `BOOMBOX_STORE_PASSWORD` (alias `boombox`). Do not put signing keys/passwords in source. Android offline instrumentation is manually dispatched via GitHub Actions; compile/lint, package inspection, browser testing and Android runtime evidence are distinct checks.

## Provenance and deployment

UI/workflow inspiration: Stillwave (MIT, copyright 2026 Stillwave contributors); its Gradle wrapper/build structure is adapted with its notice retained in LICENSE. Boombox's electronic engine and subset interpreter are separate implementations. Sonic Pi is a project by Sam Aaron and contributors; this is an independent app, not an official Sonic Pi port or endorsement. Browser platform: Web Audio, Canvas, Service Worker, File API and MediaRecorder. No third-party sound recordings or fonts are bundled. Created with Hermes Agent and AI coding assistance.

GitHub Pages publishes only `web/`. No personal server participates in public playback, file handling or synthesis. Tagged releases preserve source and signed APKs for rollback.
