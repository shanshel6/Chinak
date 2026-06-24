import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.chinak.app',
  appName: 'DFC',
  webDir: 'dist',
  server: {
    // When using a physical device, the app cannot reach 10.0.2.2 (which is only for emulators).
    // For production/physical device testing, we should use the local dist files.
    // In dev mode with 'npx cap run android', the CLI will automatically handle live reload URLs if configured.
    androidScheme: 'http',
    cleartext: true,
    // Allow navigation only to the local scheme. This is critical so the WebView
    // doesn't try to navigate to external hosts and break the model loading flow.
    allowNavigation: ['http://localhost', 'https://localhost', 'https://huggingface.co']
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 2000,
      launchAutoHide: true,
      backgroundColor: "#ffffffff",
      androidSplashResourceName: "splash",
      androidScaleType: "CENTER_CROP",
      showSpinner: true,
      androidSpinnerStyle: "large",
      spinnerColor: "#2563eb"
    },
  }
};

export default config;
