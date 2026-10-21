import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLeaveGuard } from '@/shared/lib/navigation/use-leave-guard';
import { FlatList, KeyboardAvoidingView, Platform, Text, TextInput, View } from 'react-native';
import ReanimatedSwipeable from 'react-native-gesture-handler/ReanimatedSwipeable';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { Plus, Trash2 } from '@tamagui/lucide-icons';

import { useColors, useScheme } from '@/shared/lib/theme/use-colors';
import { useAppStore } from '@/shared/lib/stores/app-store';
import { haptics } from '@/shared/lib/haptics';
import { radius, space } from '@/shared/ui/tokens';
import { Button, Card, Skeleton } from '@/features/profile/ui/kit';
import { CurrencyChips, MoneyInput, Stepper } from '@/features/scan/ui/parts';
import { useDraftStore } from '@/features/scan/model/draft.store';
import { MAX_ITEMS, changeCurrency, computeTotals, emptyDraft, formatMinor, lineMinor, type DraftItem } from '@/features/scan/lib/receipt-calc';
import { makeId } from '@/features/scan/lib/ids';
import { SCAN_ROUTES } from '@/features/scan/lib/routes';

const SavedRow = memo(function SavedRow({ item, currency, locale, onDelete }: { item: DraftItem; currency: string; locale: string; onDelete: (id: string) => void }) {
  const c = useColors();
  const { t } = useTranslation();
  const total = formatMinor(lineMinor(item), currency, locale);
  return (
    <ReanimatedSwipeable
      overshootRight={false}
      rightThreshold={64}
      onSwipeableOpen={() => { haptics.tap(); onDelete(item.id); }}
      renderRightActions={() => (
        <View importantForAccessibility="no-hide-descendants" style={{ width: 88, marginLeft: space.sm, borderRadius: radius.card, backgroundColor: c.dangerFill, alignItems: 'center', justifyContent: 'center' }}>
          <Trash2 size={22} color={c.onDanger} />
        </View>
      )}
    >
      <View
        accessible
        accessibilityLabel={t('scan.manual.itemLine', { name: item.name, qty: item.quantity, price: formatMinor(item.unitMinor, currency, locale), total, defaultValue: '{{name}}, {{qty}} × {{price}}, total {{total}}' })}
        accessibilityActions={[{ name: 'delete', label: t('scan.review.delete', 'Delete') }]}
        onAccessibilityAction={(e) => { if (e.nativeEvent.actionName === 'delete') onDelete(item.id); }}
        style={{ minHeight: 56, flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.md, borderRadius: radius.card, borderWidth: 1, borderColor: c.border, backgroundColor: c.surface }}
      >
        <View style={{ flex: 1 }}>
          <Text numberOfLines={2} maxFontSizeMultiplier={1.5} style={{ color: c.text, fontSize: 16, fontWeight: '600' }}>{item.name}</Text>
          {item.quantity > 1 && <Text maxFontSizeMultiplier={1.5} style={{ color: c.textMuted, fontSize: 13 }}>{item.quantity} × {formatMinor(item.unitMinor, currency, locale)}</Text>}
        </View>
        <Text maxFontSizeMultiplier={1.5} style={{ color: c.text, fontSize: 16, fontWeight: '700' }}>{total}</Text>
      </View>
    </ReanimatedSwipeable>
  );
});

export default function ReceiptManualScreen() {
  const { t } = useTranslation();
  const c = useColors();
  const scheme = useScheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const locale = useAppStore((s) => s.language) || 'en';
  const defaultCurrency = useAppStore((s) => s.defaultCurrency);
  const draft = useDraftStore((s) => s.draft);
  const hydrated = useDraftStore((s) => s.hydrated);

  const nameRef = useRef<TextInput>(null);
  const priceRef = useRef<TextInput>(null);
  const [name, setName] = useState('');
  const [priceMinor, setPriceMinor] = useState(0);
  const [priceKey, setPriceKey] = useState(0); // remounts the price field to clear its text after adding
  const [qty, setQty] = useState(1);
  // an item typed but not added yet would be lost (added items live in the saved draft)
  useLeaveGuard({ dirty: name.trim() !== '' || priceMinor > 0 });

  // opened without a draft (e.g. via a deep link): start an empty one
  useEffect(() => {
    if (hydrated && !useDraftStore.getState().draft) useDraftStore.getState().setDraft(emptyDraft(defaultCurrency, 'manual'));
  }, [hydrated, defaultCurrency]);

  const items = draft?.items ?? [];
  const cur = draft?.currency ?? defaultCurrency;
  const totals = useMemo(() => (draft ? computeTotals(draft) : null), [draft]);
  const canAdd = name.trim().length > 0 && priceMinor > 0 && items.length < MAX_ITEMS;

  const add = useCallback(() => {
    if (!canAdd) { haptics.error(); return; }
    const item: DraftItem = { id: makeId(), name: name.trim(), quantity: qty, unitMinor: priceMinor, confidence: 1 };
    useDraftStore.getState().update((d) => ({ ...d, items: [...d.items, item] }));
    haptics.success();
    setName(''); setPriceMinor(0); setQty(1); setPriceKey((k) => k + 1);
    // keep the keyboard up and go straight to the next item
    setTimeout(() => nameRef.current?.focus(), 30);
  }, [canAdd, name, priceMinor, qty]);

  const onDelete = useCallback((id: string) => useDraftStore.getState().update((d) => ({ ...d, items: d.items.filter((i) => i.id !== id) })), []);

  if (!hydrated || !draft || !totals) {
    return <View style={{ flex: 1, backgroundColor: c.screen, padding: space.lg, gap: space.md }} accessibilityLabel={t('common.loading', 'Loading...')}><Skeleton height={56} /><Skeleton height={56} /></View>;
  }

  const form = (
    <View style={{ gap: space.lg, paddingBottom: space.lg }}>
      <Text maxFontSizeMultiplier={1.5} style={{ color: c.textMuted, fontSize: 15, lineHeight: 21 }}>
        {t('scan.manual.intro', 'Add each item from the receipt. Tax, tip and the receipt total come on the next screen.')}
      </Text>
      <Card style={{ gap: space.md }}>
        <TextInput
          ref={nameRef}
          autoFocus
          value={name}
          onChangeText={setName}
          placeholder={t('scan.manual.namePlaceholder', 'Item, e.g. Pizza')}
          placeholderTextColor={c.textMuted}
          selectionColor={c.accentText}
          keyboardAppearance={scheme}
          returnKeyType="next"
          blurOnSubmit={false}
          onSubmitEditing={() => priceRef.current?.focus()}
          maxLength={200}
          accessibilityLabel={t('scan.manual.name', 'Item name')}
          maxFontSizeMultiplier={1.4}
          style={{ minHeight: 56, paddingHorizontal: space.lg, borderRadius: radius.field, borderWidth: 1.5, borderColor: c.border, backgroundColor: c.field, color: c.text, fontSize: 20, fontWeight: '600' }}
        />
        <View style={{ flexDirection: 'row', gap: space.md, alignItems: 'center' }}>
          <View style={{ flex: 1 }}>
            <MoneyInput
              key={priceKey}
              inputRef={priceRef}
              big
              valueMinor={priceMinor}
              currency={cur}
              onChangeMinor={setPriceMinor}
              accessibilityLabel={t('scan.manual.price', 'Price per unit')}
              placeholder={t('scan.manual.pricePlaceholder', 'Price')}
              returnKeyType="done"
              blurOnSubmit={false}
              onSubmitEditing={add}
              style={{ textAlign: 'left' }}
            />
          </View>
          <Stepper value={qty} name={name.trim() || t('scan.manual.name', 'Item name')} onChange={setQty} />
        </View>
        <Button icon={<Plus size={18} color={c.onAccent} />} title={t('scan.manual.add', 'Add')} disabled={!canAdd} onPress={add} />
      </Card>

      <View style={{ gap: space.sm }}>
        <Text maxFontSizeMultiplier={1.4} style={{ color: c.text, fontSize: 14, fontWeight: '600' }}>{t('scan.review.currency', 'Currency')}</Text>
        <CurrencyChips value={cur} onChange={(code) => useDraftStore.getState().update((d) => changeCurrency(d, code))} />
      </View>

      <Text accessibilityRole="header" maxFontSizeMultiplier={1.4} style={{ color: c.textMuted, fontSize: 13, fontWeight: '700', letterSpacing: 0.6, textTransform: 'uppercase' }}>
        {t('scan.manual.count', { count: items.length, defaultValue: '{{count}} items' })}
      </Text>
      {items.length === 0 ? (
        <Text maxFontSizeMultiplier={1.5} style={{ color: c.textMuted, fontSize: 15 }}>{t('scan.manual.empty', 'No items yet.')}</Text>
      ) : (
        <Text maxFontSizeMultiplier={1.5} style={{ color: c.textMuted, fontSize: 13 }}>{t('scan.review.swipeHint', 'Swipe an item left to delete it.')}</Text>
      )}
    </View>
  );

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: c.screen }} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={Platform.OS === 'ios' ? insets.top + 50 : 0}>
      <FlatList
        data={items}
        keyExtractor={(i) => i.id}
        renderItem={({ item }) => <SavedRow item={item} currency={cur} locale={locale} onDelete={onDelete} />}
        ItemSeparatorComponent={() => <View style={{ height: space.sm }} />}
        ListHeaderComponent={form}
        contentContainerStyle={{ padding: space.lg, paddingBottom: space.xl }}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
        automaticallyAdjustKeyboardInsets
      />
      <View style={{ paddingHorizontal: space.lg, paddingTop: space.md, paddingBottom: insets.bottom + space.md, gap: space.md, borderTopWidth: 1, borderTopColor: c.border, backgroundColor: c.surface }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' }} accessible accessibilityLabel={`${t('scan.review.subtotal', 'Subtotal')}: ${formatMinor(totals.subtotal, cur, locale)}`}>
          <Text maxFontSizeMultiplier={1.4} style={{ color: c.textMuted, fontSize: 15, fontWeight: '600' }}>{t('scan.review.subtotal', 'Subtotal')}</Text>
          <Text maxFontSizeMultiplier={1.3} style={{ color: c.text, fontSize: 26, fontWeight: '800' }}>{formatMinor(totals.subtotal, cur, locale)}</Text>
        </View>
        <Button title={t('scan.manual.review', 'Review receipt')} disabled={items.length === 0} onPress={() => router.push(SCAN_ROUTES.review as never)} />
      </View>
    </KeyboardAvoidingView>
  );
}
