# Mediketh - Medicine & Skincare Routine Companion

Mediketh helps you organize medicine and skincare routines, schedule daily reminders, and keep a simple history of your confirmations. Your routine data is stored locally on your device.

## Download the Android APK

**[Download the latest Android APK](https://github.com/Saketh2243K/MediScan/releases/latest/download/app-debug.apk)** directly to your phone. If GitHub opens a release page instead, tap the `app-debug.apk` file under **Assets**.

After downloading, open the APK from your phone's Downloads and follow Android's prompts to install it. You may need to allow your browser or file manager to install unknown apps. GitHub publishes a new APK release whenever a build on `main` succeeds.

## Run the web version locally

From the project folder, run:

```bash
npm install
npm run dev
```

## Features

- Add, edit, and remove medicine/skincare routine items with validated reminder times.
- Enable, refresh, and turn off daily Android notifications.
- Confirm routine items with an option to undo an accidental confirmation.
- Recent history that preserves the routine snapshot recorded with each day's first confirmation.
- Local device storage; routine data is not synced to an account.

## Limitations

- Data is stored locally; there is no account or cloud sync.
- AI product recognition, photo matching, refill/expiry tracking, a monthly calendar, streaks, and full end-of-day missed-dose automation are not included.
- Android notification permissions and exact alarm behaviour vary by Android version and device settings. Test reminders on your phone.
- Reminder scheduling and delivery need verification on a physical Android device; browser preview cannot send Android notifications.
- Mediketh records your own confirmation; a photo cannot establish that a medicine was taken or a skincare product was applied.
- Do not take extra or double doses because an item was missed. Follow the medicine's label or prescriber's instructions.
