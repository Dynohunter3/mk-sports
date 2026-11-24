/**
 * Android settings for reliable alerts (they survive `expo prebuild`):
 *  - exact alarms, so kick-off reminders and kick-off alerts fire on time instead of "roughly then"
 *    (USE_EXACT_ALARM on Android 13+, SCHEDULE_EXACT_ALARM on Android 12);
 *  - the live-tracking foreground service (react-native-background-actions), declared as a data-sync
 *    service as Android 14 requires: while your matches are live it shows a live-score notification and
 *    checks every 30 seconds, so goal and full-time alerts are not left to Android's 15-minute background
 *    schedule.
 */
const { withAndroidManifest } = require('expo/config-plugins');

const SERVICE = 'com.asterinet.react.bgactions.RNBackgroundActionsTask';
const PERMISSIONS = [
  ['android.permission.FOREGROUND_SERVICE'],
  ['android.permission.FOREGROUND_SERVICE_DATA_SYNC'],
  ['android.permission.WAKE_LOCK'],
  ['android.permission.USE_EXACT_ALARM'],
  ['android.permission.SCHEDULE_EXACT_ALARM', '32'],
];

module.exports = function withLiveTracking(config) {
  return withAndroidManifest(config, (cfg) => {
    const manifest = cfg.modResults.manifest;
    manifest['uses-permission'] = manifest['uses-permission'] ?? [];
    for (const [name, maxSdk] of PERMISSIONS) {
      if (!manifest['uses-permission'].some((p) => p.$['android:name'] === name)) {
        manifest['uses-permission'].push({ $: { 'android:name': name, ...(maxSdk ? { 'android:maxSdkVersion': maxSdk } : {}) } });
      }
    }
    const app = manifest.application[0];
    app.service = (app.service ?? []).filter((s) => s.$['android:name'] !== SERVICE);
    app.service.push({ $: { 'android:name': SERVICE, 'android:exported': 'false', 'android:foregroundServiceType': 'dataSync' } });
    return cfg;
  });
};
