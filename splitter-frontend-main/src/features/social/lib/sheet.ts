import { ActionSheetIOS, Alert, Platform } from 'react-native';

export interface SheetOption { label: string; destructive?: boolean; onPress: () => void }

/** iOS action sheet (Alert with buttons elsewhere). The cancel button is added last. */
export function showSheet(title: string, options: SheetOption[], cancelLabel: string, message?: string) {
  if (Platform.OS === 'ios') {
    ActionSheetIOS.showActionSheetWithOptions(
      {
        title,
        ...(message ? { message } : {}),
        options: [...options.map((o) => o.label), cancelLabel],
        cancelButtonIndex: options.length,
        destructiveButtonIndex: options.findIndex((o) => o.destructive) >= 0 ? options.findIndex((o) => o.destructive) : undefined,
      },
      (i) => { if (i < options.length) options[i]!.onPress(); }
    );
    return;
  }
  Alert.alert(title, message, [...options.map((o) => ({ text: o.label, style: o.destructive ? ('destructive' as const) : ('default' as const), onPress: o.onPress })), { text: cancelLabel, style: 'cancel' as const }]);
}
