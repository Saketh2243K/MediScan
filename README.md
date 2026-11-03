# Mediketh Android starter

This is the **source project** for Mediketh. It is not an APK yet. GitHub Actions builds the APK automatically after you push it to the `main` branch.

## 1. Open in VS Code
1. Extract the ZIP.
2. In VS Code choose **File → Open Folder**.
3. Select the extracted `mediketh-android` folder.
4. Open **Terminal → New Terminal**.

## 2. Test the web version
Run:
```bash
npm install
npm run dev
```
Open the local URL shown in the terminal.

## 3. Push to your own GitHub repository
Create a new **empty public repository** named `MediKeth` (do not add a README or .gitignore on GitHub).

In the VS Code terminal, run these commands from the project folder:
```bash
git init
git add .
git commit -m "Initial Mediketh Android app"
git branch -M main
git remote add origin https://github.com/YOUR-USERNAME/MediKeth.git
git push -u origin main
```
Replace `YOUR-USERNAME` with your GitHub username.

## 4. Get the APK
1. Open your GitHub repository.
2. Select the **Actions** tab.
3. Open **Build Mediketh Android APK**.
4. Wait until the run has a green check mark.
5. Open the successful run and scroll to **Artifacts**.
6. Download `mediketh-debug-apk`.
7. Extract the ZIP and install `app-debug.apk` on your Android phone.

If GitHub asks you to allow workflows, approve it. If the build fails, open the failed run and share the error log.

## Current starter scope
- Add and remove medicine/skincare routine items.
- Daily reminder times and Android local notification scheduling.
- Explicit daily confirmation.
- Basic recent history and progress.
- Local device storage.

## Important limitations
- Data is stored locally on the device/browser; there is no account or cloud sync yet.
- This starter does not include AI product recognition, photo matching, refill/expiry tracking, monthly calendar, streaks, or the full end-of-day missed-dose automation yet.
- Android notification permissions and exact alarm behaviour vary by Android version and device settings. Test reminders on your phone.
- Mediketh records your own confirmation; a photo cannot establish that a medicine was taken or a skincare product was applied.
- Do not take extra or double doses because an item was missed. Follow the medicine's label or prescriber's instructions.
