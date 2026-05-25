import { useEffect, useRef } from 'react';
import { Capacitor } from '@capacitor/core';
import { AppUpdate } from '@capawesome/capacitor-app-update';
import { App } from '@capacitor/app';

const AppUpdateChecker = () => {
  const isChecking = useRef(false);
  const lastCheckTime = useRef(0);

  useEffect(() => {
    const checkUpdate = async () => {
      // Only run on Android and if not already checking
      if (Capacitor.getPlatform() !== 'android' || isChecking.current) {
        return;
      }

      // Throttle checks to once every 30 seconds
      const now = Date.now();
      if (now - lastCheckTime.current < 30000) {
        return;
      }

      isChecking.current = true;
      lastCheckTime.current = now;

      try {
        console.log('Checking for app updates...');
        const result = await AppUpdate.getAppUpdateInfo();
        console.log('App Update Info:', JSON.stringify(result));
        
        // updateAvailability: 
        // 1 = UPDATE_NOT_AVAILABLE
        // 2 = UPDATE_AVAILABLE
        // 3 = DEVELOPER_TRIGGERED_UPDATE_IN_PROGRESS
        if (result.updateAvailability === 2 || result.updateAvailability === 3) {
          console.log('Triggering immediate update...');
          await AppUpdate.performImmediateUpdate();
        }
      } catch (error) {
        // Silently fail in production, but log for debugging
        console.warn('App update check failed:', error);
      } finally {
        isChecking.current = false;
      }
    };

    // Delay the initial check to allow the app to settle
    const initialTimer = setTimeout(() => {
      checkUpdate();
    }, 3000);

    // Check when app resumes
    const setupListener = async () => {
      const listener = await App.addListener('appStateChange', (state) => {
        if (state.isActive) {
          // Small delay on resume as well
          setTimeout(checkUpdate, 1000);
        }
      });
      return listener;
    };

    const listenerPromise = setupListener();

    return () => {
      clearTimeout(initialTimer);
      listenerPromise.then(handle => handle.remove());
    };
  }, []);

  return null;
};

export default AppUpdateChecker;
