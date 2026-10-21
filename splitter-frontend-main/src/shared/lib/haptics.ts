import * as Haptics from 'expo-haptics';

/** Small tactile confirmations. Never throws (unsupported devices, simulators, disabled haptics). */
const safe = (fn: () => Promise<void>) => {
  try {
    void fn().catch(() => {});
  } catch {
    /* ignore */
  }
};

export const haptics = {
  /** a choice was made (theme, language, list selection) */
  selection: () => safe(() => Haptics.selectionAsync()),
  /** something was saved / copied */
  success: () => safe(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)),
  /** an error the user should notice */
  error: () => safe(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error)),
  /** a light tap on a key action */
  tap: () => safe(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)),
};
