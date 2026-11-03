import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const manifestPath = resolve(process.argv[2] || 'android/app/src/main/AndroidManifest.xml');
let manifest = readFileSync(manifestPath, 'utf8');

if (!manifest.includes('android.permission.CAMERA')) {
  const applicationTag = manifest.match(/<application\b/);
  if (!applicationTag) throw new Error(`Could not find the application element in ${manifestPath}.`);
  manifest = manifest.replace(
    '<application',
    '    <uses-permission android:name="android.permission.CAMERA" />\n    <uses-feature android:name="android.hardware.camera" android:required="false" />\n\n    <application'
  );
  writeFileSync(manifestPath, manifest);
}
console.log(`Camera permission configured in ${manifestPath}.`);
