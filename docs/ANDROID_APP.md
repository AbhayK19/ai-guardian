# AI Guardian Android SOS app

The repository includes a native Kotlin app in `android/`. It uses the existing authenticated safety API and the user's explicitly trusted emergency contacts. It does not replace the website or remove the separate account-phone MSG91 OTP flow; emergency SMS is composed on the Android phone and does not use MSG91 or a paid SMS gateway.

## Safety behavior

- The SOS screen has a 10-second countdown and a cancel button.
- After the countdown, the app requests Android fine/coarse location permission. It requests a fresh device-location fix (GPS when available, network provider when only approximate access is available), labels fixes older than five minutes as stale, and continues without coordinates if permission, location providers, or the timeout prevents a fix.
- It records the incident through `POST /api/safety/android-sos` when the backend is reachable. This route does not send SMS. An already-active incident is not duplicated.
- It opens `ACTION_SENDTO` for one contact explicitly trusted and enabled by the account owner. Trust is user consent to include the contact; it is not phone-number verification. The user reviews the recipient/message and taps Send in the system SMS app. The app does not request `SEND_SMS`.
- On return from the composer, the user can report whether they tapped Send. The backend stores that as a user report only. Neither the app nor website represents it as carrier delivery confirmation.
- The SMS contains the selected incident type, current message time, and a Google Maps URL built from the device fix. Missing location is explicitly stated; stale fixes say "Last reported location (stale)" and retain the fix timestamp and accuracy when available.
- If no compatible SMS app or telephony capability exists, the app reports that no composer was opened. If Android reports no ready SIM, the app warns the user but cannot reliably predict carrier service; a SIM, carrier service, messaging plan, and SMS-capable app may still be needed to send. Opening a composer cannot prove that the carrier accepted the message.
- MSG91 remains available only for the separate account-phone OTP flow. Emergency contact management and Android SOS SMS do not call MSG91 or another SMS gateway.

## Open and run in Android Studio

1. Install Android Studio and use a JDK 17 or 21 for Gradle (Android Studio's Gradle JDK setting is under **Settings > Build, Execution, Deployment > Build Tools > Gradle**). In SDK Manager, install Android SDK Platform 35 and a compatible Android SDK Build-Tools package.
2. In Android Studio select **File > Open** and choose this repository's `android` directory. The project includes a Gradle 8.9 wrapper pinned to the official distribution SHA-256. Android Gradle Plugin 8.7.3 requires Gradle 8.9; use JDK 17 or 21 for Gradle. Android Studio will download the verified Gradle distribution and any missing Android Gradle Plugin/Kotlin dependencies during sync.
3. Choose a physical Android phone or emulator with API 26 or later, enable developer options/USB debugging on a phone, and select it in the device menu.
4. Set the backend address in the app and tap **Sign in to AI Guardian**. Sign in using the website's normal OAuth flow in the app's WebView, then load Emergency contacts. The normal OAuth state cookie is Secure, so use an HTTPS deployment for sign-in; local HTTP is only a network-development option and does not bypass authentication. If the identity provider disallows embedded WebViews, do not weaken its policy: use the website until a supported native OAuth redirect flow is added.
5. For local development networking, Android Emulator can reach the host as `http://10.0.2.2:3000`. A physical phone must use the development computer's LAN address and the computer firewall must allow the dev port. Debug builds permit HTTP for local testing only; release builds require HTTPS.
6. In the website, add an emergency contact and explicitly check **I trust this contact and authorize this number for Android SOS messages**. This does not verify ownership of that phone number. Only trusted/enabled contacts appear in the Android selector, and the UI separately reports phone verification state.
7. In Android Studio use **Build > Make Project**, then select the `app` run configuration and press **Run**. To install on a USB-connected phone, enable developer options and USB debugging, accept the device's debugging prompt, and select the phone as the run target. Unit tests are in `app/src/test`.

The Android module is independent of the website's pnpm scripts. On Windows, open PowerShell in the repository and run:

```powershell
Set-Location .\android
$env:JAVA_HOME = 'C:\Program Files\Java\jdk-21'
$env:ANDROID_HOME = "$env:LOCALAPPDATA\Android\Sdk"
.\gradlew.bat testDebugUnitTest assembleDebug
adb devices
adb install -r .\app\build\outputs\apk\debug\app-debug.apk
```

The wrapper verifies the downloaded Gradle distribution against the pinned SHA-256. Internet access may be needed for that distribution and Android/Maven dependencies. Set `JAVA_HOME` to an installed JDK 17 or 21 (adjust the example path to your machine). To install directly to a connected phone, enable developer options and USB debugging, accept the phone's prompt, confirm `adb devices` lists it as `device`, then run `.\gradlew.bat installDebug`. The APK output is `app\build\outputs\apk\debug\app-debug.apk`. Alternatively, run `:app:testDebugUnitTest` and `:app:assembleDebug` from Android Studio's Gradle tool window and use its Run target selector.

## Controlled phone test

Development and automated checks must not trigger a real send. Before a live test:

1. Configure an HTTPS backend address for a deployment reachable from the phone, sign in, and confirm the app loads only the intended trusted contact.
2. Confirm with that recipient that they agree to receive a test message. Ensure the phone has an SMS-capable app, active SIM/carrier service, and permission to use device location.
3. Start the SOS countdown and cancel once to verify cancellation. This should create no incident and open no composer.
4. Only when ready, start a new SOS. Grant location permission if desired, verify the timestamp/accuracy and map position in the prefilled message, and inspect the recipient and complete message in the system composer.
5. Tap Send yourself only if you intend to send the real SMS. On returning to AI Guardian, accurately report whether you tapped Send. Check the Incidents page for the timeline. A user-reported send is not delivery proof; confirm receipt directly with the consenting recipient.
6. Resolve the incident in the website or another supported workflow when safe. This one-time Android fix does not start continuous location tracking or create a server-side share link.

No live Android device/SIM/location/SMS test has been performed as part of repository implementation. Do not use real recipients until the user explicitly approves the first live test.

## Backend API additions

- `POST /api/safety/android-sos`: authenticated, validates an enabled trusted contact and optional device location, creates a persistent active incident and timeline events; it never sends SMS or calls MSG91.
- `POST /api/safety/incidents/:id/android-sms-status`: authenticated and owner-scoped; accepts `composer_opened`, `user_reported_sent`, `user_reported_cancelled`, or `composer_unavailable`. All such outcomes remain unconfirmed as to delivery.

The website's `POST /api/safety/sos` endpoint records the incident/location share but does not send SMS. The regular account-phone OTP API remains separate and provider-backed; contact OTP requests are no longer accepted.
