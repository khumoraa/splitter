import React, { memo, useRef, useState } from 'react';
import { Pressable, Text, TextInput, View, type StyleProp, type TextInputProps, type TextStyle } from 'react-native';
import ReanimatedSwipeable from 'react-native-gesture-handler/ReanimatedSwipeable';
import { useTranslation } from 'react-i18next';
import { Minus, Plus, Trash2 } from '@tamagui/lucide-icons';
import { useColors, useScheme } from '@/shared/lib/theme/use-colors';
import { MIN_TOUCH, radius, space } from '@/shared/ui/tokens';
import { haptics } from '@/shared/lib/haptics';
import { CURRENCIES } from '@/shared/config/currencies';
import { currencyFractionDigits } from '@/shared/lib/utils/money';
import {
  LOW_CONFIDENCE, MAX_QUANTITY, formatMinor, formatMinorInput, formatPercentInput, lineMinor, parseMinorInput, parsePercentInput,
  type Adjustment, type DraftItem,
} from '../lib/receipt-calc';

// ------------------------------------------------------------------ money input

type MoneyInputProps = {
  valueMinor: number;
  currency: string;
  onChangeMinor: (minor: number) => void;
  accessibilityLabel: string;
  placeholder?: string;
  invalid?: boolean;
  style?: StyleProp<TextStyle>;
  inputRef?: React.Ref<TextInput>;
  returnKeyType?: TextInputProps['returnKeyType'];
  onSubmitEditing?: () => void;
  blurOnSubmit?: boolean;
  big?: boolean;
  /** treat an empty field as "no value" instead of 0 (the parent reads valueMinor === 0 as empty) */
  emptyAsZero?: boolean;
};

/**
 * Amount field. Keeps what the user typed ("12." while typing) in local state and reports integer minor units upward.
 * decimal-pad for 2-digit currencies, number-pad for JPY/UZS.
 */
export function MoneyInput({ valueMinor, currency, onChangeMinor, accessibilityLabel, placeholder, invalid, style, inputRef, returnKeyType, onSubmitEditing, blurOnSubmit, big }: MoneyInputProps) {
  const c = useColors();
  const scheme = useScheme();
  // while focused the field shows what the user is typing ("12." is fine); otherwise it mirrors the value from the parent
  const [typing, setTyping] = useState(false);
  const [typed, setTyped] = useState('');
  const shown = typing ? typed : valueMinor ? formatMinorInput(valueMinor, currency) : '';
  const parsed = parseMinorInput(shown, currency);
  const bad = invalid || (shown.trim() !== '' && parsed === null);
  return (
    <TextInput
      ref={inputRef}
      value={shown}
      onChangeText={(t) => {
        setTyped(t);
        onChangeMinor(parseMinorInput(t, currency) ?? 0);
      }}
      onFocus={() => { setTyped(shown); setTyping(true); }}
      onBlur={() => setTyping(false)}
      keyboardType={currencyFractionDigits(currency) === 0 ? 'number-pad' : 'decimal-pad'}
      returnKeyType={returnKeyType ?? 'done'}
      onSubmitEditing={onSubmitEditing}
      blurOnSubmit={blurOnSubmit}
      placeholder={placeholder ?? '0'}
      placeholderTextColor={c.textMuted}
      selectionColor={c.accentText}
      keyboardAppearance={scheme}
      maxLength={14}
      accessibilityLabel={accessibilityLabel}
      maxFontSizeMultiplier={1.5}
      style={[
        {
          minHeight: big ? 56 : MIN_TOUCH, minWidth: 96, paddingHorizontal: space.md, borderRadius: radius.field, borderWidth: 1.5, textAlign: 'right',
          borderColor: bad ? c.danger : typing ? c.accentText : c.border, backgroundColor: c.field, color: c.text, fontSize: big ? 22 : 16, fontWeight: '600',
        },
        style,
      ]}
    />
  );
}

/** Percent field ("10.5") that reports basis points. */
export function PercentInput({ valueBp, onChangeBp, accessibilityLabel }: { valueBp: number; onChangeBp: (bp: number) => void; accessibilityLabel: string }) {
  const c = useColors();
  const scheme = useScheme();
  const [typing, setTyping] = useState(false);
  const [typed, setTyped] = useState('');
  const shown = typing ? typed : valueBp ? formatPercentInput(valueBp) : '';
  const bad = shown.trim() !== '' && parsePercentInput(shown) === null;
  return (
    <TextInput
      value={shown}
      onChangeText={(t) => {
        setTyped(t);
        onChangeBp(parsePercentInput(t) ?? 0);
      }}
      onFocus={() => { setTyped(shown); setTyping(true); }}
      onBlur={() => setTyping(false)}
      keyboardType="decimal-pad"
      returnKeyType="done"
      placeholder="0"
      placeholderTextColor={c.textMuted}
      selectionColor={c.accentText}
      keyboardAppearance={scheme}
      maxLength={6}
      accessibilityLabel={accessibilityLabel}
      maxFontSizeMultiplier={1.5}
      style={{
        minHeight: MIN_TOUCH, minWidth: 96, paddingHorizontal: space.md, borderRadius: radius.field, borderWidth: 1.5, textAlign: 'right',
        borderColor: bad ? c.danger : typing ? c.accentText : c.border, backgroundColor: c.field, color: c.text, fontSize: 16, fontWeight: '600',
      }}
    />
  );
}

// ------------------------------------------------------------------ small controls

export function IconButton({ icon, label, onPress, disabled }: { icon: React.ReactNode; label: string; onPress: () => void; disabled?: boolean }) {
  const c = useColors();
  return (
    <Pressable
      onPress={() => { haptics.selection(); onPress(); }}
      disabled={disabled}
      hitSlop={4}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!disabled }}
      style={({ pressed }) => ({
        width: MIN_TOUCH, height: MIN_TOUCH, borderRadius: MIN_TOUCH / 2, alignItems: 'center', justifyContent: 'center',
        backgroundColor: c.field, borderWidth: 1, borderColor: c.border, opacity: disabled ? 0.4 : pressed ? 0.6 : 1,
      })}
    >
      {icon}
    </Pressable>
  );
}

/** Quantity stepper; both buttons are 44pt targets. */
export function Stepper({ value, onChange, name }: { value: number; onChange: (v: number) => void; name: string }) {
  const c = useColors();
  const { t } = useTranslation();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.xs }} accessible={false}>
      <IconButton icon={<Minus size={18} color={c.text} />} label={t('scan.review.qtyDown', { name, defaultValue: 'Decrease quantity of {{name}}' })} disabled={value <= 1} onPress={() => onChange(value - 1)} />
      <Text accessibilityLabel={t('scan.review.qtyValue', { n: value, defaultValue: 'Quantity {{n}}' })} maxFontSizeMultiplier={1.4} style={{ minWidth: 28, textAlign: 'center', color: c.text, fontSize: 17, fontWeight: '700' }}>{value}</Text>
      <IconButton icon={<Plus size={18} color={c.text} />} label={t('scan.review.qtyUp', { name, defaultValue: 'Increase quantity of {{name}}' })} disabled={value >= MAX_QUANTITY} onPress={() => onChange(value + 1)} />
    </View>
  );
}

export function CurrencyChips({ value, onChange }: { value: string; onChange: (code: string) => void }) {
  const c = useColors();
  const { t } = useTranslation();
  const codes = CURRENCIES.some((x) => x.code === value) ? CURRENCIES.map((x) => x.code) : [value, ...CURRENCIES.map((x) => x.code)];
  return (
    <View accessibilityRole="radiogroup" style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
      {codes.map((code) => {
        const on = code === value;
        return (
          <Pressable
            key={code}
            onPress={() => { haptics.selection(); onChange(code); }}
            accessibilityRole="radio"
            accessibilityLabel={t(`currencies.${code}`, { defaultValue: code })}
            accessibilityState={{ selected: on }}
            style={{ minHeight: MIN_TOUCH, minWidth: 64, paddingHorizontal: space.md, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center', backgroundColor: on ? c.accentFill : c.field, borderWidth: 1, borderColor: on ? c.accentFill : c.border }}
          >
            <Text maxFontSizeMultiplier={1.4} style={{ color: on ? c.onAccent : c.text, fontSize: 15, fontWeight: '700' }}>{code}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/** Large tappable card used on the "New receipt" screen. */
export function ChoiceCard({ icon, title, subtitle, badge, onPress, disabled, loading, hint }: {
  icon: React.ReactNode; title: string; subtitle?: string; badge?: string; onPress: () => void; disabled?: boolean; loading?: boolean; hint?: string;
}) {
  const c = useColors();
  return (
    <Pressable
      onPress={() => { haptics.tap(); onPress(); }}
      accessibilityRole="button"
      accessibilityLabel={[title, badge, subtitle].filter(Boolean).join('. ')}
      accessibilityHint={hint}
      accessibilityState={{ disabled: !!disabled, busy: !!loading }}
      style={({ pressed }) => ({
        minHeight: 92, flexDirection: 'row', alignItems: 'center', gap: space.lg, padding: space.lg, borderRadius: radius.card, borderWidth: 1,
        borderColor: c.border, backgroundColor: c.surface, opacity: disabled ? 0.55 : pressed ? 0.7 : 1,
      })}
    >
      <View importantForAccessibility="no-hide-descendants" style={{ width: 52, height: 52, borderRadius: 26, alignItems: 'center', justifyContent: 'center', backgroundColor: c.accentSurface }}>{icon}</View>
      <View style={{ flex: 1, gap: 2 }}>
        <Text maxFontSizeMultiplier={1.4} style={{ color: c.text, fontSize: 18, fontWeight: '700' }}>{title}</Text>
        {!!subtitle && <Text maxFontSizeMultiplier={1.5} style={{ color: c.textMuted, fontSize: 14, lineHeight: 19 }}>{subtitle}</Text>}
        {!!badge && <Text maxFontSizeMultiplier={1.5} style={{ color: disabled ? c.danger : c.accentText, fontSize: 13, fontWeight: '700' }}>{badge}</Text>}
      </View>
    </Pressable>
  );
}

// ------------------------------------------------------------------ item row

type ItemRowProps = {
  item: DraftItem;
  currency: string;
  locale: string;
  invalidName: boolean;
  onName: (id: string, name: string) => void;
  onQty: (id: string, qty: number) => void;
  onPrice: (id: string, minor: number) => void;
  onDelete: (id: string) => void;
  nameRef?: React.Ref<TextInput>;
  autoFocus?: boolean;
};

/** One receipt line: name, quantity stepper, unit price, line total. Swipe left (or the VoiceOver "Delete" action) removes it. */
export const ItemRow = memo(function ItemRow({ item, currency, locale, invalidName, onName, onQty, onPrice, onDelete, nameRef, autoFocus }: ItemRowProps) {
  const c = useColors();
  const scheme = useScheme();
  const { t } = useTranslation();
  const low = item.confidence < LOW_CONFIDENCE;
  const swipeRef = useRef<{ close: () => void } | null>(null);
  return (
    <ReanimatedSwipeable
      ref={swipeRef as never}
      overshootRight={false}
      rightThreshold={64}
      onSwipeableOpen={() => { haptics.tap(); onDelete(item.id); }}
      renderRightActions={() => (
        <View style={{ width: 88, marginLeft: space.sm, borderRadius: radius.card, backgroundColor: c.dangerFill, alignItems: 'center', justifyContent: 'center' }} importantForAccessibility="no-hide-descendants">
          <Trash2 size={22} color={c.onDanger} />
        </View>
      )}
    >
      <View
        accessible={false}
        accessibilityActions={[{ name: 'delete', label: t('scan.review.delete', 'Delete') }]}
        onAccessibilityAction={(e) => { if (e.nativeEvent.actionName === 'delete') onDelete(item.id); }}
        style={{ gap: space.sm, padding: space.md, borderRadius: radius.card, borderWidth: low || invalidName ? 2 : 1, borderColor: invalidName ? c.danger : low ? c.danger : c.border, backgroundColor: c.surface }}
      >
        <TextInput
          ref={nameRef}
          autoFocus={autoFocus}
          value={item.name}
          onChangeText={(v) => onName(item.id, v)}
          placeholder={t('scan.review.itemName', 'Item name')}
          placeholderTextColor={c.textMuted}
          selectionColor={c.accentText}
          keyboardAppearance={scheme}
          returnKeyType="next"
          maxLength={200}
          accessibilityLabel={t('scan.review.itemName', 'Item name')}
          maxFontSizeMultiplier={1.5}
          style={{ minHeight: MIN_TOUCH, color: c.text, fontSize: 17, fontWeight: '600', paddingHorizontal: space.xs }}
        />
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.sm, flexWrap: 'wrap' }}>
          <Stepper value={item.quantity} name={item.name || t('scan.review.itemName', 'Item name')} onChange={(q) => onQty(item.id, q)} />
          <MoneyInput valueMinor={item.unitMinor} currency={currency} onChangeMinor={(m) => onPrice(item.id, m)} accessibilityLabel={t('scan.review.unitPrice', { name: item.name, defaultValue: 'Price per unit of {{name}}' })} style={{ minWidth: 110 }} />
        </View>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          {low ? (
            <Text accessibilityRole="alert" maxFontSizeMultiplier={1.5} style={{ color: c.danger, fontSize: 13, fontWeight: '600', flex: 1 }}>{t('scan.review.checkLine', 'Not sure about this line — please check')}</Text>
          ) : <View style={{ flex: 1 }} />}
          <Text accessibilityLabel={t('scan.review.lineTotalA11y', { amount: formatMinor(lineMinor(item), currency, locale), defaultValue: 'Line total {{amount}}' })} maxFontSizeMultiplier={1.5} style={{ color: c.textMuted, fontSize: 14, fontWeight: '600' }}>
            {formatMinor(lineMinor(item), currency, locale)}
          </Text>
        </View>
      </View>
    </ReanimatedSwipeable>
  );
});

// ------------------------------------------------------------------ tax / tip / discount

export function AdjustmentRow({ label, adj, currency, resolvedMinor, locale, onChange }: {
  label: string; adj: Adjustment; currency: string; resolvedMinor: number; locale: string; onChange: (a: Adjustment) => void;
}) {
  const c = useColors();
  const { t } = useTranslation();
  const seg = (mode: Adjustment['mode'], text: string) => {
    const on = adj.mode === mode;
    return (
      <Pressable
        key={mode}
        onPress={() => { haptics.selection(); onChange({ ...adj, mode }); }}
        accessibilityRole="radio"
        accessibilityLabel={`${label}: ${text}`}
        accessibilityState={{ selected: on }}
        style={{ minHeight: MIN_TOUCH, minWidth: 52, alignItems: 'center', justifyContent: 'center', paddingHorizontal: space.md, backgroundColor: on ? c.accentFill : c.field }}
      >
        <Text maxFontSizeMultiplier={1.4} style={{ color: on ? c.onAccent : c.text, fontSize: 15, fontWeight: '700' }}>{text}</Text>
      </Pressable>
    );
  };
  return (
    <View style={{ gap: space.sm }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.md }}>
        <Text maxFontSizeMultiplier={1.4} style={{ color: c.text, fontSize: 16, fontWeight: '600', flexShrink: 1 }}>{label}</Text>
        <View accessibilityRole="radiogroup" style={{ flexDirection: 'row', borderRadius: radius.field, overflow: 'hidden', borderWidth: 1, borderColor: c.border }}>
          {seg('amount', currency)}
          {seg('percent', '%')}
        </View>
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: space.md }}>
        {adj.mode === 'percent' && (
          <Text maxFontSizeMultiplier={1.5} style={{ color: c.textMuted, fontSize: 14 }}>
            {t('scan.review.equals', { amount: formatMinor(resolvedMinor, currency, locale), defaultValue: '= {{amount}}' })}
          </Text>
        )}
        {adj.mode === 'percent' ? (
          <PercentInput valueBp={adj.percentBp} onChangeBp={(bp) => onChange({ ...adj, percentBp: bp })} accessibilityLabel={t('scan.review.percentOf', { name: label, defaultValue: '{{name}}, percent of subtotal' })} />
        ) : (
          <MoneyInput valueMinor={adj.amountMinor} currency={currency} onChangeMinor={(m) => onChange({ ...adj, amountMinor: m })} accessibilityLabel={t('scan.review.amountOf', { name: label, defaultValue: '{{name}}, amount' })} />
        )}
      </View>
    </View>
  );
}
