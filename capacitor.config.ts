import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.chinak.app',
  appName: 'Chinak',
  webDir: 'dist',
  server: {
    androidScheme: 'http',
    hostname: 'localhost',
    allowMixedContent: true
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
    CapacitorHttp: {
      enabled: true
    }
  }
};

export default config;
