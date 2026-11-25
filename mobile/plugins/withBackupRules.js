/**
 * Android Auto Backup rules for MK Sports.
 *
 * expo-secure-store's default rules back up only shared preferences. Everything the app keeps (picks, points,
 * badges, profile, private leagues, settings) is in AsyncStorage's SQLite database "RKStorage", so with those
 * rules a restore brought nothing back. These rules include that database and the shared preferences, and still
 * leave out the secure store.
 */
const fs = require('fs');
const path = require('path');
const { AndroidConfig, withAndroidManifest, withDangerousMod } = require('expo/config-plugins');

const RULES = `    <include domain="database" path="RKStorage"/>
    <include domain="sharedpref" path="."/>
    <exclude domain="sharedpref" path="SecureStore"/>`;
const FULL = `<?xml version="1.0" encoding="utf-8"?>
<!-- Auto Backup, Android 11 and lower: the app's database (picks, leagues, settings) and preferences; never the secure store -->
<full-backup-content>
${RULES.replace(/^ {4}/gm, '  ')}
</full-backup-content>
`;
const EXTRACT = `<?xml version="1.0" encoding="utf-8"?>
<!-- Auto Backup and device transfer, Android 12 and higher -->
<data-extraction-rules>
  <cloud-backup>
${RULES}
  </cloud-backup>
  <device-transfer>
${RULES}
  </device-transfer>
</data-extraction-rules>
`;

module.exports = function withBackupRules(config) {
  config = withDangerousMod(config, [
    'android',
    async (c) => {
      const dir = path.join(c.modRequest.platformProjectRoot, 'app/src/main/res/xml');
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'mk_backup_rules.xml'), FULL);
      fs.writeFileSync(path.join(dir, 'mk_data_extraction_rules.xml'), EXTRACT);
      return c;
    },
  ]);
  return withAndroidManifest(config, (c) => {
    const app = AndroidConfig.Manifest.getMainApplicationOrThrow(c.modResults);
    app.$['android:allowBackup'] = 'true';
    app.$['android:fullBackupContent'] = '@xml/mk_backup_rules';
    app.$['android:dataExtractionRules'] = '@xml/mk_data_extraction_rules';
    return c;
  });
};
