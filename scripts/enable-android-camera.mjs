import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const manifestPath = resolve(process.argv[2] || 'android/app/src/main/AndroidManifest.xml');
let manifest = readFileSync(manifestPath, 'utf8');

if (!manifest.includes('android.permission.CAMERA')) {
  manifest = manifest.replace(
    '<application',
    '    <uses-permission android:name="android.permission.CAMERA" />\n    <uses-feature android:name="android.hardware.camera" android:required="false" />\n\n    <application'
  );
}
if (!manifest.includes('com.google.mlkit.vision.DEPENDENCIES')) {
  const applicationTag = manifest.match(/<application\b[^>]*>/);
  if (!applicationTag) throw new Error(`Could not find the application element in ${manifestPath}.`);
  manifest = manifest.replace(
    applicationTag[0],
    `${applicationTag[0]}\n        <meta-data android:name="com.google.mlkit.vision.DEPENDENCIES" android:value="ocr" />`
  );
}
writeFileSync(manifestPath, manifest);
console.log(`Camera permission configured in ${manifestPath}.`);

// Copy the 30-second reminder alarm into the generated Android project so the
// "mediketh-alarm-v1" notification channel can play it (res/raw/mediketh_alarm.wav).
const alarmSource = fileURLToPath(new URL('../resources/mediketh_alarm.wav', import.meta.url));
if (!existsSync(alarmSource)) throw new Error(`Alarm sound not found at ${alarmSource}.`);
const rawDir = resolve(dirname(manifestPath), 'res', 'raw');
mkdirSync(rawDir, { recursive: true });
copyFileSync(alarmSource, resolve(rawDir, 'mediketh_alarm.wav'));
console.log(`Reminder alarm sound copied to ${rawDir}.`);
