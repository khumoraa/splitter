import { useCallback, useRef } from 'react';
import { Alert } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useNavigation, usePreventRemove } from 'expo-router/react-navigation';
import { shouldConfirmLeave, type LeaveState } from './leave-guard';

/**
 * Asks before leaving a screen with unsaved input (also catches the iOS swipe-back gesture).
 * Returns `allowLeave()`: call it right before navigating away on purpose (e.g. after a successful save).
 */
export function useLeaveGuard(state: Omit<LeaveState, 'allowOnce'>) {
  const { t } = useTranslation();
  const navigation = useNavigation();
  const allow = useRef(false);
  const active = shouldConfirmLeave(state);

  usePreventRemove(active, ({ data }) => {
    if (allow.current) {
      navigation.dispatch(data.action);
      return;
    }
    Alert.alert(
      t('leave.title', 'Discard changes?'),
      state.busy ? t('leave.busyMessage', 'Something is still in progress. If you leave now, it may not finish.') : t('leave.message', 'What you entered on this screen will be lost.'),
      [
        { text: t('leave.stay', 'Keep editing'), style: 'cancel' },
        { text: t('leave.discard', 'Discard'), style: 'destructive', onPress: () => navigation.dispatch(data.action) },
      ]
    );
  });

  return useCallback(() => { allow.current = true; }, []);
}
