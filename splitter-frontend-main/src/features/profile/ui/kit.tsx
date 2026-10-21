import React, { forwardRef, useEffect, useState } from 'react';
import {
  AccessibilityInfo, ActivityIndicator, KeyboardAvoidingView, Linking, Platform, Pressable, RefreshControl,
  ScrollView, Text, TextInput, View, type StyleProp, type TextInputProps, type ViewStyle,
} from 'react-native';
import Animated, { Easing, FadeInDown, useAnimatedStyle, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { Check, ChevronRight, Eye, EyeOff } from '@tamagui/lucide-icons';
import { useColors, useScheme } from '@/shared/lib/theme/use-colors';
import { MIN_TOUCH, radius, space, type Palette } from '@/shared/ui/tokens';
import { haptics } from '@/shared/lib/haptics';

/** "Reduce Motion" in the phone's accessibility settings: animations are skipped. */
export function useReduceMotion(): boolean {
  const [reduce, setReduce] = useState(false);
  useEffect(() => {
    let alive = true;
    void AccessibilityInfo.isReduceMotionEnabled().then((v) => alive && setReduce(v));
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduce);
    return () => {
      alive = false;
      sub.remove();
    };
  }, []);
  return reduce;
}

/** Fades a block in (with a small slide). Plain View when Reduce Motion is on. */
export function FadeIn({ children, delay = 0, style }: { children: React.ReactNode; delay?: number; style?: StyleProp<ViewStyle> }) {
  const reduce = useReduceMotion();
  if (reduce) return <View style={style}>{children}</View>;
  return (
    <Animated.View entering={FadeInDown.duration(220).delay(delay)} style={style}>
      {children}
    </Animated.View>
  );
}

/** Pulsing placeholder block while data loads. */
export function Skeleton({ width, height, round = false, style }: { width?: number | `${number}%`; height: number; round?: boolean; style?: StyleProp<ViewStyle> }) {
  const c = useColors();
  const reduce = useReduceMotion();
  const o = useSharedValue(1);
  useEffect(() => {
    if (reduce) { o.value = 0.6; return; }
    o.value = withRepeat(withTiming(0.45, { duration: 800, easing: Easing.inOut(Easing.ease) }), -1, true);
  }, [reduce, o]);
  const anim = useAnimatedStyle(() => ({ opacity: o.value }));
  return (
    <Animated.View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[{ width: width ?? '100%', height, borderRadius: round ? height / 2 : 8, backgroundColor: c.border }, anim, style]}
    />
  );
}

// ---------------------------------------------------------------- layout

export function Screen({ children, refreshing, onRefresh, keyboard = true }: { children: React.ReactNode; refreshing?: boolean; onRefresh?: () => void; keyboard?: boolean }) {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const body = (
    <ScrollView
      style={{ flex: 1, backgroundColor: c.screen }}
      contentContainerStyle={{ padding: space.lg, paddingBottom: insets.bottom + space.xxl, gap: space.xl }}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
      automaticallyAdjustKeyboardInsets
      showsVerticalScrollIndicator={false}
      refreshControl={onRefresh ? <RefreshControl refreshing={!!refreshing} onRefresh={onRefresh} tintColor={c.accentText} colors={[c.accentText]} /> : undefined}
    >
      {children}
    </ScrollView>
  );
  if (!keyboard) return body;
  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: c.screen }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      {body}
    </KeyboardAvoidingView>
  );
}

export function Title({ children }: { children: React.ReactNode }) {
  const c = useColors();
  return (
    <Text accessibilityRole="header" maxFontSizeMultiplier={1.4} style={{ color: c.text, fontSize: 28, lineHeight: 34, fontWeight: '800' }}>
      {children}
    </Text>
  );
}

export function Section({ title, footer, children }: { title?: string; footer?: string; children: React.ReactNode }) {
  const c = useColors();
  const rows = React.Children.toArray(children).filter(Boolean);
  return (
    <View style={{ gap: space.sm }}>
      {!!title && (
        <Text accessibilityRole="header" maxFontSizeMultiplier={1.4} style={{ color: c.textMuted, fontSize: 13, fontWeight: '700', letterSpacing: 0.6, textTransform: 'uppercase', marginLeft: space.xs }}>
          {title}
        </Text>
      )}
      <View style={{ backgroundColor: c.surface, borderRadius: radius.card, borderWidth: 1, borderColor: c.border, overflow: 'hidden' }}>
        {rows.map((child, i) => (
          <React.Fragment key={i}>
            {i > 0 && <View style={{ height: 1, backgroundColor: c.border, marginLeft: space.lg }} />}
            {child}
          </React.Fragment>
        ))}
      </View>
      {!!footer && (
        <Text maxFontSizeMultiplier={1.4} style={{ color: c.textMuted, fontSize: 13, lineHeight: 18, marginHorizontal: space.xs }}>
          {footer}
        </Text>
      )}
    </View>
  );
}

export function Card({ children, style }: { children: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  const c = useColors();
  return <View style={[{ backgroundColor: c.surface, borderRadius: radius.card, borderWidth: 1, borderColor: c.border, padding: space.lg }, style]}>{children}</View>;
}

// ---------------------------------------------------------------- rows

type RowProps = {
  label: string;
  value?: string;
  subtitle?: string;
  icon?: React.ReactNode;
  onPress?: () => void;
  destructive?: boolean;
  /** shows a ">" (default when onPress is set and `right` is not) */
  chevron?: boolean;
  right?: React.ReactNode;
  selected?: boolean;
  disabled?: boolean;
  role?: 'button' | 'radio' | 'link';
  accessibilityHint?: string;
  accessibilityLabel?: string;
};

export function Row({ label, value, subtitle, icon, onPress, destructive, chevron, right, selected, disabled, role = 'button', accessibilityHint, accessibilityLabel }: RowProps) {
  const c = useColors();
  const color = destructive ? c.danger : c.text;
  const interactive = !!onPress && !disabled;
  const content = (
    <View style={{ minHeight: 52, paddingVertical: space.md, paddingHorizontal: space.lg, flexDirection: 'row', alignItems: 'center', gap: space.md }}>
      {!!icon && <View style={{ width: 28, alignItems: 'center' }} importantForAccessibility="no-hide-descendants">{icon}</View>}
      <View style={{ flex: 1, gap: 2 }}>
        <Text maxFontSizeMultiplier={1.5} style={{ color, fontSize: 16, fontWeight: destructive ? '600' : '500' }}>{label}</Text>
        {!!subtitle && <Text maxFontSizeMultiplier={1.5} style={{ color: c.textMuted, fontSize: 13, lineHeight: 18 }}>{subtitle}</Text>}
      </View>
      {!!value && <Text maxFontSizeMultiplier={1.5} numberOfLines={1} style={{ color: c.textMuted, fontSize: 15, maxWidth: '45%' }}>{value}</Text>}
      {right}
      {selected && <Check size={20} color={c.accentText} />}
      {interactive && (chevron ?? !right) && !selected && <ChevronRight size={18} color={c.textMuted} />}
    </View>
  );
  if (!onPress) return <View accessible accessibilityLabel={accessibilityLabel ?? [label, value, subtitle].filter(Boolean).join(', ')}>{content}</View>;
  return (
    <Pressable
      onPress={() => { haptics.selection(); onPress(); }}
      disabled={disabled}
      accessibilityRole={role}
      accessibilityLabel={accessibilityLabel ?? [label, value].filter(Boolean).join(', ')}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: !!disabled, selected: role === 'radio' ? !!selected : undefined }}
      style={({ pressed }) => ({ opacity: disabled ? 0.45 : pressed ? 0.6 : 1, minHeight: MIN_TOUCH })}
    >
      {content}
    </Pressable>
  );
}

// ---------------------------------------------------------------- buttons

type ButtonProps = {
  title: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'danger';
  loading?: boolean;
  disabled?: boolean;
  icon?: React.ReactNode;
  accessibilityHint?: string;
};

export function Button({ title, onPress, variant = 'primary', loading, disabled, icon, accessibilityHint }: ButtonProps) {
  const c = useColors();
  const off = disabled || loading;
  const bg = variant === 'primary' ? c.accentFill : variant === 'danger' ? c.dangerFill : c.surface;
  const fg = variant === 'secondary' ? c.text : variant === 'danger' ? c.onDanger : c.onAccent;
  return (
    <Pressable
      // a second tap while a request is running does nothing (double-submit guard)
      onPress={() => { if (!off) { haptics.tap(); onPress(); } }}
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: !!off, busy: !!loading }}
      style={({ pressed }) => ({
        minHeight: 50, borderRadius: radius.button, backgroundColor: bg, opacity: off ? 0.5 : pressed ? 0.85 : 1,
        borderWidth: variant === 'secondary' ? 1 : 0, borderColor: c.border,
        alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: space.sm, paddingHorizontal: space.lg,
      })}
    >
      {loading ? <ActivityIndicator color={fg} /> : icon}
      <Text maxFontSizeMultiplier={1.4} style={{ color: fg, fontSize: 16, fontWeight: '700' }}>{title}</Text>
    </Pressable>
  );
}

// ---------------------------------------------------------------- form

type FieldProps = Omit<TextInputProps, 'style'> & {
  label: string;
  error?: string | null;
  helper?: string;
  /** adds the show/hide button and secureTextEntry handling */
  password?: boolean;
};

export const Field = forwardRef<TextInput, FieldProps>(function Field({ label, error, helper, password, ...input }, ref) {
  const c = useColors();
  const scheme = useScheme();
  const { t } = useTranslation();
  const [shown, setShown] = useState(false);
  const [focused, setFocused] = useState(false);
  return (
    <View style={{ gap: 6 }}>
      <Text maxFontSizeMultiplier={1.4} style={{ color: c.text, fontSize: 14, fontWeight: '600' }}>{label}</Text>
      <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: c.field, borderRadius: radius.field, borderWidth: 1.5, borderColor: error ? c.danger : focused ? c.accentText : c.border }}>
        <TextInput
          ref={ref}
          accessibilityLabel={label}
          accessibilityHint={error ?? helper}
          placeholderTextColor={c.textMuted}
          selectionColor={c.accentText}
          keyboardAppearance={scheme}
          autoCapitalize="none"
          autoCorrect={false}
          maxFontSizeMultiplier={1.5}
          {...input}
          secureTextEntry={password && !shown}
          onFocus={(e) => { setFocused(true); input.onFocus?.(e); }}
          onBlur={(e) => { setFocused(false); input.onBlur?.(e); }}
          style={{ flex: 1, minHeight: 50, paddingHorizontal: space.lg, color: c.text, fontSize: 16 }}
        />
        {password && (
          <Pressable
            onPress={() => setShown((s) => !s)}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={shown ? t('auth.hidePassword', 'Hide password') : t('auth.showPassword', 'Show password')}
            style={{ width: MIN_TOUCH, height: MIN_TOUCH, alignItems: 'center', justifyContent: 'center' }}
          >
            {shown ? <EyeOff size={20} color={c.textMuted} /> : <Eye size={20} color={c.textMuted} />}
          </Pressable>
        )}
      </View>
      {!!error ? (
        <Text accessibilityRole="alert" accessibilityLiveRegion="polite" maxFontSizeMultiplier={1.5} style={{ color: c.danger, fontSize: 13, lineHeight: 18 }}>{error}</Text>
      ) : !!helper ? (
        <Text maxFontSizeMultiplier={1.5} style={{ color: c.textMuted, fontSize: 13, lineHeight: 18 }}>{helper}</Text>
      ) : null}
    </View>
  );
});

export function Banner({ kind, children }: { kind: 'error' | 'success' | 'info'; children: React.ReactNode }) {
  const c = useColors();
  const bg = kind === 'error' ? c.dangerSurface : c.accentSurface;
  const border = kind === 'error' ? c.danger : c.accentText;
  return (
    <View accessibilityRole={kind === 'error' ? 'alert' : undefined} accessibilityLiveRegion="polite" style={{ backgroundColor: bg, borderRadius: radius.field, borderWidth: 1, borderColor: border, padding: space.md }}>
      <Text maxFontSizeMultiplier={1.5} style={{ color: c.text, fontSize: 14, lineHeight: 20 }}>{children}</Text>
    </View>
  );
}

/** Shown when camera / photo access was refused: explains why and opens the system settings. */
export function PermissionNotice({ title, message }: { title: string; message: string }) {
  const { t } = useTranslation();
  const c = useColors();
  return (
    <Card style={{ gap: space.md }}>
      <Text accessibilityRole="header" style={{ color: c.text, fontSize: 16, fontWeight: '700' }}>{title}</Text>
      <Text style={{ color: c.text, fontSize: 14, lineHeight: 20 }}>{message}</Text>
      <Button variant="secondary" title={t('common.openSettings', 'Open settings')} onPress={() => void Linking.openSettings()} />
    </Card>
  );
}

export type { Palette };
