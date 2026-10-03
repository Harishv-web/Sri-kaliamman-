# Android APK source

This is a native Android wrapper for the bundled Sri Kaliamman Parking app.

- Package ID: `com.harishv.srikaliammanparking`
- Start screen: the parking dashboard
- Data: stored locally in the app's secure WebView storage
- Build output: `Sri-Kaliamman-Parking.apk`

The GitHub Actions workflow stages the current `app/`, `assets/`, manifest, and service worker into the APK before compiling. This avoids maintaining a second copy of the parking application.
