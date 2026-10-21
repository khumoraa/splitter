import React from 'react';
import { ActivityIndicator, Pressable, Text, TextInput, View, type StyleProp, type TextInputProps, type ViewStyle } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Search, X } from '@tamagui/lucide-icons';
import { useColors, useScheme } from '@/shared/lib/theme/use-colors';
import { MIN_TOUCH, radius, space } from '@/shared/ui/tokens';
import { haptics } from '@/shared/lib/haptics';
import { ProfileAvatar } from '@/features/profile/ui/ProfileAvatar';

/** iOS-style segmented control; every segment is a 44pt target and may carry a count badge. */
export function Segmented<K extends string>({ options, value, onChange }: { options: { key: K; label: string; badge?: number }[]; value: K; onChange: (k: K) => void }) {
  const c = useColors();
  return (
    <View accessibilityRole="tablist" style={{ flexDirection: 'row', padding: 3, borderRadius: radius.field + 2, backgroundColor: c.field, borderWidth: 1, borderColor: c.border }}>
      {options.map((o) => {
        const on = o.key === value;
        const label = o.badge ? `${o.label}, ${o.badge}` : o.label;
        return (
          <Pressable
            key={o.key}
            onPress={() => { if (!on) { haptics.selection(); onChange(o.key); } }}
            accessibilityRole="tab"
            accessibilityLabel={label}
            accessibilityState={{ selected: on }}
            style={{ flex: 1, minHeight: MIN_TOUCH - 4, borderRadius: radius.field, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 6, backgroundColor: on ? c.surface : 'transparent', borderWidth: on ? 1 : 0, borderColor: c.border }}
          >
            <Text numberOfLines={1} maxFontSizeMultiplier={1.3} style={{ color: on ? c.text : c.textMuted, fontSize: 15, fontWeight: on ? '700' : '600' }}>{o.label}</Text>
            {!!o.badge && (
              <View style={{ minWidth: 20, height: 20, borderRadius: 10, paddingHorizontal: 5, backgroundColor: c.dangerFill, alignItems: 'center', justifyContent: 'center' }} importantForAccessibility="no-hide-descendants">
                <Text allowFontScaling={false} style={{ color: c.onDanger, fontSize: 12, fontWeight: '800' }}>{o.badge > 99 ? '99+' : o.badge}</Text>
              </View>
            )}
          </Pressable>
        );
      })}
    </View>
  );
}

type SearchFieldProps = Omit<TextInputProps, 'style' | 'onChangeText'> & { value: string; onChangeText: (t: string) => void; label: string };

/** Search box: no autocorrect/capitalisation (usernames and IDs), clear button, "search" return key. */
export const SearchField = React.forwardRef<TextInput, SearchFieldProps>(function SearchField({ value, onChangeText, label, ...rest }, ref) {
  const c = useColors();
  const scheme = useScheme();
  const { t } = useTranslation();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', minHeight: 48, borderRadius: radius.field, borderWidth: 1.5, borderColor: c.border, backgroundColor: c.field, paddingLeft: space.md }}>
      <Search size={18} color={c.textMuted} />
      <TextInput
        ref={ref}
        value={value}
        onChangeText={onChangeText}
        accessibilityLabel={label}
        placeholderTextColor={c.textMuted}
        selectionColor={c.accentText}
        keyboardAppearance={scheme}
        autoCapitalize="none"
        autoCorrect={false}
        spellCheck={false}
        returnKeyType="search"
        clearButtonMode="never"
        maxFontSizeMultiplier={1.5}
        {...rest}
        style={{ flex: 1, minHeight: 46, paddingHorizontal: space.sm, color: c.text, fontSize: 16 }}
      />
      {!!value && (
        <Pressable onPress={() => onChangeText('')} hitSlop={6} accessibilityRole="button" accessibilityLabel={t('social.clear', 'Clear')} style={{ width: MIN_TOUCH, height: MIN_TOUCH, alignItems: 'center', justifyContent: 'center' }}>
          <X size={18} color={c.textMuted} />
        </Pressable>
      )}
    </View>
  );
});

/** Compact pill button for rows (Add, Accept, Cancel...). */
export function PillButton({ title, onPress, kind = 'primary', loading, disabled, a11yLabel }: { title: string; onPress: () => void; kind?: 'primary' | 'secondary' | 'danger'; loading?: boolean; disabled?: boolean; a11yLabel?: string }) {
  const c = useColors();
  const off = disabled || loading;
  const bg = kind === 'primary' ? c.accentFill : kind === 'danger' ? c.dangerFill : c.surface;
  const fg = kind === 'primary' ? c.onAccent : kind === 'danger' ? c.onDanger : c.text;
  return (
    <Pressable
      onPress={() => { if (!off) { haptics.tap(); onPress(); } }}
      accessibilityRole="button"
      accessibilityLabel={a11yLabel ?? title}
      accessibilityState={{ disabled: !!off, busy: !!loading }}
      style={({ pressed }) => ({ minHeight: MIN_TOUCH, minWidth: 76, paddingHorizontal: space.md, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center', backgroundColor: bg, borderWidth: kind === 'secondary' ? 1 : 0, borderColor: c.border, opacity: off ? 0.5 : pressed ? 0.8 : 1 })}
    >
      {loading ? <ActivityIndicator size="small" color={fg} /> : <Text numberOfLines={1} maxFontSizeMultiplier={1.3} style={{ color: fg, fontSize: 14, fontWeight: '700' }}>{title}</Text>}
    </Pressable>
  );
}

/** A person: avatar, name, ID, and whatever the screen puts on the right. */
export function UserRow({ user, right, subtitle, onPress, style, a11yHint }: {
  user: { username: string; uniqueId: string; avatarUrl: string | null };
  right?: React.ReactNode;
  subtitle?: string;
  onPress?: () => void;
  style?: StyleProp<ViewStyle>;
  a11yHint?: string;
}) {
  const c = useColors();
  const content = (
    <View style={[{ minHeight: 64, flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: space.sm, paddingHorizontal: space.lg }, style]}>
      <ProfileAvatar uri={user.avatarUrl} name={user.username} seed={user.uniqueId} size={44} />
      <View style={{ flex: 1, gap: 1 }}>
        <Text numberOfLines={1} maxFontSizeMultiplier={1.4} style={{ color: c.text, fontSize: 16, fontWeight: '600' }}>{user.username}</Text>
        <Text numberOfLines={1} maxFontSizeMultiplier={1.4} style={{ color: c.textMuted, fontSize: 13 }}>{subtitle ? `${user.uniqueId} · ${subtitle}` : user.uniqueId}</Text>
      </View>
      {right}
    </View>
  );
  if (!onPress) return content;
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={`${user.username}, ${user.uniqueId}`} accessibilityHint={a11yHint} style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}>
      {content}
    </Pressable>
  );
}

export function EmptyState({ icon, title, message, children }: { icon?: React.ReactNode; title: string; message?: string; children?: React.ReactNode }) {
  const c = useColors();
  return (
    <View style={{ alignItems: 'center', gap: space.md, paddingVertical: space.xxl, paddingHorizontal: space.lg }}>
      {!!icon && <View importantForAccessibility="no-hide-descendants" style={{ width: 64, height: 64, borderRadius: 32, backgroundColor: c.accentSurface, alignItems: 'center', justifyContent: 'center' }}>{icon}</View>}
      <Text accessibilityRole="header" maxFontSizeMultiplier={1.4} style={{ color: c.text, fontSize: 18, fontWeight: '700', textAlign: 'center' }}>{title}</Text>
      {!!message && <Text maxFontSizeMultiplier={1.5} style={{ color: c.textMuted, fontSize: 15, lineHeight: 21, textAlign: 'center' }}>{message}</Text>}
      {children}
    </View>
  );
}

export function SectionTitle({ children }: { children: React.ReactNode }) {
  const c = useColors();
  return (
    <Text accessibilityRole="header" maxFontSizeMultiplier={1.4} style={{ color: c.textMuted, fontSize: 13, fontWeight: '700', letterSpacing: 0.6, textTransform: 'uppercase', marginHorizontal: space.xs }}>
      {children}
    </Text>
  );
}

/** A selectable circle for multi-select lists. */
export function Check({ on }: { on: boolean }) {
  const c = useColors();
  return (
    <View importantForAccessibility="no-hide-descendants" style={{ width: 26, height: 26, borderRadius: 13, borderWidth: 2, borderColor: on ? c.accentFill : c.border, backgroundColor: on ? c.accentFill : 'transparent', alignItems: 'center', justifyContent: 'center' }}>
      {on && <Text allowFontScaling={false} style={{ color: c.onAccent, fontSize: 15, fontWeight: '900' }}>✓</Text>}
    </View>
  );
}

/** Round 44pt icon button (row menus). */
export function IconBtn({ children, label, onPress, disabled }: { children: React.ReactNode; label: string; onPress: () => void; disabled?: boolean }) {
  const c = useColors();
  return (
    <Pressable
      onPress={() => { haptics.selection(); onPress(); }}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!disabled }}
      style={({ pressed }) => ({ width: MIN_TOUCH, height: MIN_TOUCH, borderRadius: MIN_TOUCH / 2, alignItems: 'center', justifyContent: 'center', backgroundColor: c.field, borderWidth: 1, borderColor: c.border, opacity: disabled ? 0.4 : pressed ? 0.6 : 1 })}
    >
      {children}
    </Pressable>
  );
}
