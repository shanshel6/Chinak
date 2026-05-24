# Shanshal Admin App

This is a separate Android app for managing store orders.

## Features
- 🔐 Secure Admin Login
- 📦 Real-time Order Tracking
- 🔔 Instant Push Notifications (via Capacitor)
- 🔊 Loud "Order Received" Sound Notification
- 🔄 One-tap Order Status Management (Complete/Cancel)

## Setup Instructions

1. **Install Dependencies**
   ```bash
   cd admin-app
   npm install
   ```

2. **Initialize Android Project**
   ```bash
   npx cap add android
   ```

3. **Build the App**
   ```bash
   npm run build
   npx cap sync android
   ```

4. **Loud Notification Sound (Android)**
   To ensure the loud sound works on Android even when the app is in background:
   - Copy your sound file (e.g., `order_received.mp3`) to `admin-app/android/app/src/main/res/raw/order_received.mp3`.
   - The app is already configured to look for this resource.

5. **Generate APK**
   - Open the project in Android Studio: `npx cap open android`
   - Go to `Build` > `Build Bundle(s) / APK(s)` > `Build APK(s)`.
   - The APK will be generated in `android/app/build/outputs/apk/debug/app-debug.apk`.

## Development
To run in the browser:
```bash
npm run dev
```
