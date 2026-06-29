/**
 * Lightweight, crash-proof haptic feedback helper.
 *
 * Every call is guarded so it is a complete no-op on the web / desktop and can
 * never throw (a failed haptic must never affect app logic). On a real device
 * it produces the native tap/buzz that makes interactions feel physical.
 */
import { Capacitor } from '@capacitor/core';
import { Haptics, ImpactStyle, NotificationType } from '@capacitor/haptics';

const canHaptic = (): boolean => {
  try {
    return Capacitor.isNativePlatform();
  } catch {
    return false;
  }
};

const impact = (style: ImpactStyle) => {
  if (!canHaptic()) return;
  // Fire-and-forget; swallow any rejection.
  Haptics.impact({ style }).catch(() => {});
};

const notify = (type: NotificationType) => {
  if (!canHaptic()) return;
  Haptics.notification({ type }).catch(() => {});
};

export const haptics = {
  /** Subtle tap — taps, toggles, tab switches. */
  light: () => impact(ImpactStyle.Light),
  /** Medium thunk — add to cart, confirm. */
  medium: () => impact(ImpactStyle.Medium),
  /** Strong — destructive / important confirmations. */
  heavy: () => impact(ImpactStyle.Heavy),
  /** Success buzz — order placed, payment done. */
  success: () => notify(NotificationType.Success),
  /** Warning buzz. */
  warning: () => notify(NotificationType.Warning),
  /** Error buzz — failed action. */
  error: () => notify(NotificationType.Error),
};

export default haptics;
