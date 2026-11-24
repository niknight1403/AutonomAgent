#!/usr/bin/env bash
set -euo pipefail
pkg=com.autonomagent.trader
apk=$(find apps/mobile/android/app/build/outputs/apk/release -name '*.apk' -print -quit)
test -n "$apk"
trap 'rc=$?; if [ "$rc" -ne 0 ]; then adb logcat -d -b crash || true; adb logcat -d -t 2000 | grep -E "AndroidRuntime|ReactNativeJS|FATAL EXCEPTION|com.autonomagent.trader|SoLoader|UnsatisfiedLinkError" || true; fi; exit "$rc"' EXIT
adb install "$apk"
adb logcat -c
adb shell am start -W -n "$pkg/.MainActivity"
sleep 20
adb shell pidof "$pkg" || { echo 'App process exited after launch'; exit 1; }
adb shell uiautomator dump /sdcard/autonomagent-window.xml
adb shell cat /sdcard/autonomagent-window.xml | grep -q 'Produktrecherche'
adb logcat -d -b crash > /tmp/autonomagent-crash.log
cat /tmp/autonomagent-crash.log
if grep -Fq "$pkg" /tmp/autonomagent-crash.log; then exit 1; fi
