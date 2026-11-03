# Mediketh - Medicine & Skincare Routine Companion

Mediketh helps you organize medicine and skincare routines, schedule daily reminders, and keep a simple history of your confirmations. Your routine data is stored locally on your device.

## Download the Android APK

**[Open APK builds on GitHub Actions](https://github.com/Saketh2243K/MediScan/actions/workflows/android-debug.yml)**, select the latest successful run, and download the `mediketh-debug-apk` artifact. Extract it and install `app-debug.apk` on your Android phone.

GitHub creates the APK automatically when changes are pushed to `main`. Build artifacts are temporary and may expire; run the workflow again if the latest APK is no longer available.

## Run the web version locally

From the project folder, run:

```bash
npm install
npm run dev
```

## Features

- Add and remove medicine/skincare routine items.
- Daily reminder times and Android local notification scheduling.
- Explicit daily confirmation.
- Basic recent history and progress.

## Limitations

- Data is stored locally; there is no account or cloud sync.
- AI product recognition, photo matching, refill/expiry tracking, a monthly calendar, streaks, and full end-of-day missed-dose automation are not included.
- Android notification permissions and exact alarm behaviour vary by Android version and device settings. Test reminders on your phone.
- Mediketh records your own confirmation; a photo cannot establish that a medicine was taken or a skincare product was applied.
- Do not take extra or double doses because an item was missed. Follow the medicine's label or prescriber's instructions.
