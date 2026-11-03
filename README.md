# Mediketh — Medicine & Skincare Routine Companion

Mediketh is a local-first Android app for organizing medicine and skincare routines. It has separate Today, Routine, Calendar, and More screens, with daily tracking and reminders stored on your device.

## Download the Android app

**[Download the latest Mediketh APK](https://github.com/Saketh2243K/MediScan/releases/latest/download/app-debug.apk)** on your phone. Open the downloaded APK and follow Android's installation prompts. You may need to allow your browser or file manager to install unknown apps.

GitHub builds a new APK after changes are pushed to `main`. This is a debug APK for testing, not a Play Store release.

## Features

- Separate Today, Routine, Calendar, and More screens with phone-friendly bottom navigation.
- Multiple daily reminder times and selected weekdays for each routine item.
- Confirm, undo, or record a skipped routine step; a skip is only a personal log and is not dosing advice.
- Android reminders, including a 10-minute snooze when notifications are enabled.
- Calendar, recent history, and a simple seven-day progress overview.
- Private daily notes, saved only on this device.
- Optional manual supply counts, low-supply thresholds, and expiry dates. Supply counts are not automatically reduced.
- Scan package barcodes for a possible Open Food Facts food-product listing, or manually add a barcode. A user-approved product match can link multiple brand codes to the same routine item; this is not a medicine verification service.
- Capture up to three package-label photos for on-device ML Kit text recognition; photos are discarded and never uploaded. Recognized text and product-catalog details are suggestions to verify against the label.
- Light, dark, high-contrast dark, and device-matched themes, plus locale-aware date/time formats.
- JSON backup export, import, and delete-data controls. On Android, export opens the system share sheet so you can save the file to a location you choose; in the browser, it downloads directly.

## Run the web preview locally

```bash
npm install
npm run dev
```

The browser preview cannot send Android notifications. Test reminder delivery on an Android device.

## Privacy and limitations

- Routine data, notes, and history are stored locally. There are no accounts, cloud sync, or analytics.
- When you explicitly scan a barcode for lookup, that barcode is sent to Open Food Facts; package photos, routine details, and dose history are not sent. Open Food Facts data is community-contributed and may be incomplete or inaccurate.
- Open Food Facts is a food-products database, not a medical-product database. Its API asks integrators to review the [API documentation](https://openfoodfacts.github.io/openfoodfacts-server/api/), [reuse terms](https://world.openfoodfacts.org/terms-of-use), and [API usage form](https://docs.google.com/forms/d/e/1FAIpQLSdIE3D8qvjC_zRJw1W8OmuHhsWJ_NSckiiniAHlfaVwUZCziQ/viewform) before using it. Product listings are only suggestions and must be checked against the actual package.
- Product identity matching never marks a dose as taken by itself. After matching, you must separately confirm that you actually took/completed the scheduled step.
- Barcode scanning requires camera permission. Camera images are used for scanning and are not saved or sent to a product database. Check package details yourself; the barcode does not identify a safe dose or instructions.
- Keep exported backups private; they may contain sensitive personal notes. Android export uses a temporary app cache file shared through Android's share sheet.
- The interface is currently English. Regional date/time formatting is available, but full translations and right-to-left UI localization are not yet included.
- Cloud sync, caregiver sharing, widgets/wearable integrations, and signed Play Store distribution need additional infrastructure, testing, and release credentials.
- Mediketh is a personal tracker, not a medical record or a substitute for professional advice. Follow your medicine label or prescriber's instructions; do not take extra or double doses because an item was missed.
