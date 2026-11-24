/**
 * Release build settings that survive `expo prebuild`:
 *  - signs release builds with your own keystore when PREDICTPRO_UPLOAD_* gradle properties
 *    are set (e.g. in ~/.gradle/gradle.properties, or ORG_GRADLE_PROJECT_* env vars);
 *    otherwise falls back to the debug key so local builds still work
 *  - ARM only (every real phone, incl. 32-bit low-end devices) -> smaller APK
 *  - shrink unused resources
 *  - R8 keep rules for classes that libraries create by reflection (WorkManager's Room
 *    database, expo-notifications / expo-task-manager / expo-background-task internals).
 *    Without them the minified release build crashes on launch with
 *    "NoSuchMethodException: androidx.work.impl.WorkDatabase_Impl.<init>".
 */
const fs = require('fs');
const path = require('path');
const { withAppBuildGradle, withDangerousMod, withGradleProperties } = require('expo/config-plugins');

const KEEP_RULES = `
# --- MK Sports: classes created by reflection (keep through R8) ---
-keep class * extends androidx.room.RoomDatabase { <init>(); }
-keep class androidx.work.impl.WorkDatabase_Impl { *; }
-keep class androidx.work.impl.** { *; }
-keep class expo.modules.taskManager.** { *; }
-keep class expo.modules.backgroundtask.** { *; }
-keep class expo.modules.notifications.** { *; }
-keep class com.asterinet.react.bgactions.** { *; }
# --- end MK Sports ---
`;

const SIGNING = `
        release {
            if (findProperty('PREDICTPRO_UPLOAD_STORE_FILE')) {
                storeFile file(findProperty('PREDICTPRO_UPLOAD_STORE_FILE'))
                storePassword findProperty('PREDICTPRO_UPLOAD_STORE_PASSWORD')
                keyAlias findProperty('PREDICTPRO_UPLOAD_KEY_ALIAS')
                keyPassword findProperty('PREDICTPRO_UPLOAD_KEY_PASSWORD')
            }
        }`;

module.exports = function withAndroidRelease(config) {
  config = withGradleProperties(config, (c) => {
    const set = (key, value) => {
      c.modResults = c.modResults.filter((p) => !(p.type === 'property' && p.key === key));
      c.modResults.push({ type: 'property', key, value });
    };
    set('reactNativeArchitectures', 'armeabi-v7a,arm64-v8a');
    set('android.enableShrinkResourcesInReleaseBuilds', 'true');
    set('android.enableMinifyInReleaseBuilds', 'true');
    return c;
  });
  config = withDangerousMod(config, [
    'android',
    async (c) => {
      const file = path.join(c.modRequest.platformProjectRoot, 'app', 'proguard-rules.pro');
      const cur = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
      if (!cur.includes('MK Sports: classes created by reflection')) fs.writeFileSync(file, cur + KEEP_RULES);
      return c;
    },
  ]);
  return withAppBuildGradle(config, (c) => {
    let g = c.modResults.contents;
    if (!g.includes('PREDICTPRO_UPLOAD_STORE_FILE')) {
      g = g.replace(/signingConfigs\s*\{/, (m) => m + SIGNING);
      g = g.replace(
        /(release\s*\{\s*\n(?:\s*\/\/[^\n]*\n)*\s*)signingConfig signingConfigs\.debug/,
        "$1signingConfig findProperty('PREDICTPRO_UPLOAD_STORE_FILE') ? signingConfigs.release : signingConfigs.debug",
      );
    }
    c.modResults.contents = g;
    return c;
  });
};
