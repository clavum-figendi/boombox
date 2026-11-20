# Boombox

An on-device electronic music instrument: generative groovebox, two local remix decks, and a separate live-code workspace. Inspired by [Stillwave](https://github.com/clavum-figendi/stillwave), with the same local-first approach, live visualization, genre selection, persistent transport and configurable mixing.

## Open / install

- Web: https://clavum-figendi.github.io/boombox/
- Android APK: see this repository's Releases.
- Source: MIT. No accounts, API keys, subscriptions, analytics, hosted inference or audio uploads.

## Workspaces

**Groovebox:** techno, house, drum & bass, psytrance, breakbeat, hardcore, acid and dub recipes; six editable 16-step lanes; seeded musical variation; tempo, key, scale, swing, activity; channel level/mute/solo; synthesizer waveform and decay; filter, resonance, drive, delay and reverb; master level and session timer.

**Remix:** open two tracks from your device. Files are decoded and processed in memory, never uploaded. Waveforms, deck transport, loop boundaries, playback rate, reverse, three-band EQ, filtering and crossfade support manual mixing over synthesized music. This is sample/deck remixing, not AI stem separation, automatic beat detection or pitch-preserving time stretching. Rate changes alter pitch. Browser audio codec support varies; WAV is the most portable interchange format. Large decoded tracks may exceed phone memory.

**Live code:** a safe, bounded parser for a **Sonic Pi-compatible subset**, rendered by Boombox's own Web Audio instruments. Supports a documented selection of `use_bpm`, `use_synth`, `live_loop`, `play`, `sample`, `sleep` and bounded repetitions. Unsupported Ruby produces an error rather than executing arbitrary JavaScript. Export `.rb` to continue in desktop [Sonic Pi](https://sonic-pi.net/). **The actual Sonic Pi Ruby/SuperCollider runtime is not bundled.** Effects, instruments, samples and exact sonic output differ from desktop Sonic Pi. No Sonic Pi samples or runtime code are redistributed.

Project JSON saves settings, sequence and code, **not imported audio**; reopen source tracks after restoring. Settings use local browser storage. Browser storage is origin-scoped: data does not automatically transfer between the web app, another browser and the APK.

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
```

Tests use Node's built-in test runner; browser tests require Python Playwright and Chromium. Browser tests render real offline WAV, measure live audio, exercise offline reload and cache repair, and check document width at mobile sizes.

Android build (Java 17, SDK 35):

```sh
cd android
./gradlew :app:assembleDebug :app:lintDebug :app:assembleDebugAndroidTest
```

Release signing uses an external keystore via `BOOMBOX_KEYSTORE` and `BOOMBOX_STORE_PASSWORD` (alias `boombox`). Do not put signing keys/passwords in source. Android offline instrumentation is manually dispatched via GitHub Actions; compile/lint, package inspection, browser testing and Android runtime evidence are distinct checks.

## Provenance and deployment

UI/workflow inspiration: Stillwave (MIT, copyright 2026 Stillwave contributors); its Gradle wrapper/build structure is adapted with its notice retained in LICENSE. Boombox's electronic engine and subset interpreter are separate implementations. Sonic Pi is a project by Sam Aaron and contributors; this is an independent app, not an official Sonic Pi port or endorsement. Browser platform: Web Audio, Canvas, Service Worker, File API and MediaRecorder. No third-party sound recordings or fonts are bundled. Created with Hermes Agent and AI coding assistance.

GitHub Pages publishes only `web/`. No personal server participates in public playback, file handling or synthesis. Tagged releases preserve source and signed APKs for rollback.
