#!/usr/bin/env bash
set -euo pipefail
trap 'timeout 10s adb logcat -d -v threadtime > android/logcat.log || true' EXIT
# Only trusted fixed instrumentation scripts are evaluated; no user code enters this harness.
timeout 120s adb install --no-streaming -r android/app/build/outputs/apk/debug/app-debug.apk
timeout 120s adb install --no-streaming -r android/app/build/outputs/apk/androidTest/debug/app-debug-androidTest.apk
adb shell cmd connectivity airplane-mode enable
adb shell svc wifi disable
adb shell svc data disable
test "$(adb shell settings get global airplane_mode_on | tr -d '\r')" = 1
test "$(adb shell settings get global wifi_on | tr -d '\r')" = 0
# Radio requests are asynchronous; wait for the actual default route to disappear.
deadline=$((SECONDS + 30))
while true; do
  timeout 5s adb shell dumpsys connectivity > android/connectivity.log
  if grep -q 'Active default network:' android/connectivity.log && ! grep -Eq 'Active default network: [0-9]' android/connectivity.log; then break; fi
  if (( SECONDS >= deadline )); then printf 'Offline setup timed out: default network still active or unreadable\n'; exit 1; fi
  sleep 1
done
timeout 120s adb shell am instrument -w -r app.boombox.local.test/app.boombox.local.OfflineTest | tee android/offline-test.log
grep -q BOOMBOX_OFFLINE_AUDIO_PASS android/offline-test.log
grep -q 'INSTRUMENTATION_CODE: -1' android/offline-test.log
