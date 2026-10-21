import React, { useCallback, useMemo, useRef, useState } from 'react';
import { FlatList, KeyboardAvoidingView, Platform, Pressable, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { Plus } from '@tamagui/lucide-icons';

import { useColors } from '@/shared/lib/theme/use-colors';
import { useAppStore } from '@/shared/lib/stores/app-store';
import { haptics } from '@/shared/lib/haptics';
import { radius, space } from '@/shared/ui/tokens';
import { Banner, Button, Card, Field, Skeleton } from '@/features/profile/ui/kit';
import { AdjustmentRow, CurrencyChips, ItemRow, MoneyInput } from '@/features/scan/ui/parts';
import { useDraftStore } from '@/features/scan/model/draft.store';
import { useReceiptSessionStore } from '@/features/receipt/model/receipt-session.store';
import {
  LOW_CONFIDENCE, MAX_ITEMS, balanceDraft, changeCurrency, computeTotals, defaultReceiptName, formatMinor, isValidIsoDate, reconcileDraft,
  toSplitItems, validateDraft, type Adjustment, type Draft, type DraftItem,
} from '@/features/scan/lib/receipt-calc';
import { makeId } from '@/features/scan/lib/ids';
import { SCAN_ROUTES } from '@/features/scan/lib/routes';

const update = (fn: (d: Draft) => Draft) => useDraftStore.getState().update(fn);

export default function ReceiptReviewScreen() {
  const { t } = useTranslation();
  const c = useColors();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const locale = useAppStore((s) => s.language) || 'en';
  const language = locale;
  const draft = useDraftStore((s) => s.draft);
  const hydrated = useDraftStore((s) => s.hydrated);
  const startFromReview = useReceiptSessionStore((s) => s.startFromReview);

  const listRef = useRef<FlatList<DraftItem>>(null);
  const [showErrors, setShowErrors] = useState(false);
  const [bannerDismissedFor, setBannerDismissedFor] = useState<number | null>(null);
  const [justAdded, setJustAdded] = useState<string | null>(null);
  const [undo, setUndo] = useState<{ item: DraftItem; index: number } | null>(null);
  const undoTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [dateText, setDateText] = useState<string | null>(null);

  // ---- item handlers: stable identities so rows do not re-render while typing in another row
  const onName = useCallback((id: string, name: string) => update((d) => ({ ...d, items: d.items.map((i) => (i.id === id ? { ...i, name, confidence: 1 } : i)) })), []);
  const onQty = useCallback((id: string, quantity: number) => update((d) => ({ ...d, items: d.items.map((i) => (i.id === id ? { ...i, quantity } : i)) })), []);
  const onPrice = useCallback((id: string, unitMinor: number) => update((d) => ({ ...d, items: d.items.map((i) => (i.id === id ? { ...i, unitMinor, confidence: 1 } : i)) })), []);
  const onDelete = useCallback((id: string) => {
    const d = useDraftStore.getState().draft;
    const index = d ? d.items.findIndex((i) => i.id === id) : -1;
    if (!d || index < 0) return;
    const item = d.items[index]!;
    update((x) => ({ ...x, items: x.items.filter((i) => i.id !== id) }));
    setUndo({ item, index });
    if (undoTimer.current) clearTimeout(undoTimer.current);
    undoTimer.current = setTimeout(() => setUndo(null), 5000);
  }, []);
  const onUndo = () => {
    if (!undo) return;
    const { item, index } = undo;
    update((d) => {
      const items = [...d.items];
      items.splice(Math.min(index, items.length), 0, item);
      return { ...d, items };
    });
    setUndo(null);
    haptics.selection();
  };
  const addItem = () => {
    const d = useDraftStore.getState().draft;
    if (!d || d.items.length >= MAX_ITEMS) return;
    const id = makeId();
    update((x) => ({ ...x, items: [...x.items, { id, name: '', quantity: 1, unitMinor: 0, confidence: 1 }] }));
    setJustAdded(id);
    haptics.tap();
    setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 120);
  };

  const totals = useMemo(() => (draft ? computeTotals(draft) : null), [draft]);
  const rec = useMemo(() => (draft ? reconcileDraft(draft) : ({ state: 'none' } as const)), [draft]);
  const issues = useMemo(() => (draft ? validateDraft(draft) : []), [draft]);
  const invalidNames = useMemo(() => new Set(issues.filter((i) => i.field === 'name' && i.itemId).map((i) => i.itemId!)), [issues]);

  const next = () => {
    if (!draft) return;
    if (issues.length > 0) {
      setShowErrors(true);
      haptics.error();
      const firstBad = draft.items.findIndex((i) => issues.some((x) => x.itemId === i.id));
      if (firstBad >= 0) listRef.current?.scrollToIndex({ index: firstBad, animated: true, viewPosition: 0.3 });
      return;
    }
    const lines = toSplitItems(draft, { tax: t('scan.review.tax', 'Tax / VAT'), tip: t('scan.review.tip', 'Tip / service'), discount: t('scan.review.discount', 'Discount') }, makeId);
    startFromReview({
      sessionName: draft.merchant.trim() || defaultReceiptName(new Date()),
      language,
      currency: draft.currency,
      items: lines.map((l) => ({ id: l.id, name: l.name, unitPrice: l.unitPrice, quantity: l.quantity, totalPrice: l.totalPrice, ...(l.kind ? { kind: l.kind } : {}) })),
    });
    if (draft.fromCache) update((d) => ({ ...d, fromCache: false }));
    router.push(SCAN_ROUTES.participants as never);
  };

  // ---------------------------------------------------------------- guards
  if (!hydrated) {
    return (
      <View style={{ flex: 1, backgroundColor: c.screen, padding: space.lg, gap: space.md }} accessibilityLabel={t('common.loading', 'Loading...')}>
        <Skeleton height={56} /><Skeleton height={110} /><Skeleton height={110} />
      </View>
    );
  }
  if (!draft || !totals) {
    return (
      <View style={{ flex: 1, backgroundColor: c.screen, padding: space.lg, justifyContent: 'center', gap: space.lg }}>
        <Text accessibilityRole="header" style={{ color: c.text, fontSize: 22, fontWeight: '800', textAlign: 'center' }}>{t('scan.review.empty.title', 'Nothing to check yet')}</Text>
        <Text style={{ color: c.textMuted, fontSize: 16, textAlign: 'center' }}>{t('scan.review.empty.message', 'Start a new receipt first.')}</Text>
        <Button title={t('scan.review.empty.cta', 'New receipt')} onPress={() => router.replace(SCAN_ROUTES.new as never)} />
      </View>
    );
  }

  const cur = draft.currency;
  const fmt = (m: number) => formatMinor(m, cur, locale);
  const mismatch = rec.state === 'mismatch' ? rec : null;
  const showMismatch = !!mismatch && bannerDismissedFor !== mismatch.differenceMinor;
  const hasLow = draft.items.some((i) => i.confidence < LOW_CONFIDENCE);
  const dateValue = dateText ?? draft.date ?? '';
  const dateBad = dateValue !== '' && !isValidIsoDate(dateValue);
  const setAdj = (key: 'tax' | 'tip' | 'discount') => (a: Adjustment) => update((d) => ({ ...d, [key]: a }));

  const header = (
    <View style={{ gap: space.lg, paddingBottom: space.md }}>
      {draft.fromCache && <Banner kind="info">{t('scan.review.cached', 'This photo was recognised before, so no recognition was used.')}</Banner>}
      {showMismatch && mismatch && (
        <View style={{ gap: space.md }}>
          <Banner kind="error">
            {t('scan.review.mismatch', {
              computed: fmt(totals.total), expected: fmt(draft.receiptTotalMinor ?? 0), diff: fmt(Math.abs(mismatch.differenceMinor)),
              defaultValue: 'The lines add up to {{computed}}, but the receipt total is {{expected}} (difference {{diff}}).',
            })}
          </Banner>
          <Button
            title={t('scan.review.fix', 'Fix automatically')}
            accessibilityHint={mismatch.differenceMinor > 0 ? t('scan.review.fixHintMissing', { diff: fmt(mismatch.differenceMinor), defaultValue: 'Adds the missing {{diff}} as a separate line' }) : t('scan.review.fixHintExcess', { diff: fmt(-mismatch.differenceMinor), defaultValue: 'Adds {{diff}} to the discount' })}
            onPress={() => { update((d) => balanceDraft(d, t('scan.review.otherLine', 'Other (not listed)'), makeId)); haptics.success(); }}
          />
          <Button variant="secondary" title={t('scan.review.editManually', 'Edit manually')} onPress={() => setBannerDismissedFor(mismatch.differenceMinor)} />
        </View>
      )}
      {hasLow && <Banner kind="info">{t('scan.review.lowInfo', 'Lines outlined in red may be misread. Please check them.')}</Banner>}
      {showErrors && issues.length > 0 && <Banner kind="error">{t('scan.review.fixErrors', 'Fill in the highlighted fields first.')}</Banner>}

      <Field label={t('scan.review.merchant', 'Place')} placeholder={t('scan.review.merchantPlaceholder', 'e.g. Cafe Roma')} value={draft.merchant} onChangeText={(v) => update((d) => ({ ...d, merchant: v }))} autoCapitalize="sentences" returnKeyType="next" maxLength={80} />
      <Field
        label={t('scan.review.date', 'Date')}
        placeholder="YYYY-MM-DD"
        value={dateValue}
        keyboardType="numbers-and-punctuation"
        maxLength={10}
        error={dateBad ? t('scan.review.dateInvalid', 'Use the format YYYY-MM-DD') : null}
        onChangeText={(v) => {
          setDateText(v);
          if (v === '') update((d) => ({ ...d, date: null }));
          else if (isValidIsoDate(v)) update((d) => ({ ...d, date: v }));
        }}
        onBlur={() => setDateText(null)}
      />
      <View style={{ gap: space.sm }}>
        <Text maxFontSizeMultiplier={1.4} style={{ color: c.text, fontSize: 14, fontWeight: '600' }}>{t('scan.review.currency', 'Currency')}</Text>
        <CurrencyChips value={cur} onChange={(code) => update((d) => changeCurrency(d, code))} />
      </View>
      <Text accessibilityRole="header" maxFontSizeMultiplier={1.4} style={{ color: c.textMuted, fontSize: 13, fontWeight: '700', letterSpacing: 0.6, textTransform: 'uppercase', marginTop: space.sm }}>
        {t('scan.review.items', 'Items')}
      </Text>
      {draft.items.length === 0 ? (
        <Text maxFontSizeMultiplier={1.5} style={{ color: c.textMuted, fontSize: 15 }}>{t('scan.review.noItems', 'No items yet. Add the first one.')}</Text>
      ) : (
        <Text maxFontSizeMultiplier={1.5} style={{ color: c.textMuted, fontSize: 13 }}>{t('scan.review.swipeHint', 'Swipe an item left to delete it.')}</Text>
      )}
    </View>
  );

  const footer = (
    <View style={{ gap: space.lg, paddingTop: space.md }}>
      <Button variant="secondary" icon={<Plus size={18} color={c.text} />} title={t('scan.review.addItem', 'Add item')} disabled={draft.items.length >= MAX_ITEMS} onPress={addItem} />

      <Card style={{ gap: space.lg }}>
        <Text accessibilityRole="header" maxFontSizeMultiplier={1.4} style={{ color: c.text, fontSize: 17, fontWeight: '700' }}>{t('scan.review.extras', 'Tax, tip and discount')}</Text>
        <AdjustmentRow label={t('scan.review.tax', 'Tax / VAT')} adj={draft.tax} currency={cur} resolvedMinor={totals.tax} locale={locale} onChange={setAdj('tax')} />
        <AdjustmentRow label={t('scan.review.tip', 'Tip / service')} adj={draft.tip} currency={cur} resolvedMinor={totals.tip} locale={locale} onChange={setAdj('tip')} />
        <AdjustmentRow label={t('scan.review.discount', 'Discount')} adj={draft.discount} currency={cur} resolvedMinor={totals.discount} locale={locale} onChange={setAdj('discount')} />
      </Card>

      <Card style={{ gap: space.sm }}>
        <Text maxFontSizeMultiplier={1.4} style={{ color: c.text, fontSize: 16, fontWeight: '600' }}>{t('scan.review.receiptTotal', 'Total on the receipt')}</Text>
        <MoneyInput
          valueMinor={draft.receiptTotalMinor ?? 0}
          currency={cur}
          onChangeMinor={(m) => update((d) => ({ ...d, receiptTotalMinor: m === 0 ? null : m }))}
          accessibilityLabel={t('scan.review.receiptTotal', 'Total on the receipt')}
          placeholder={t('scan.review.optional', 'Optional')}
          style={{ alignSelf: 'stretch' }}
        />
        <Text maxFontSizeMultiplier={1.5} style={{ color: c.textMuted, fontSize: 13, lineHeight: 18 }}>{t('scan.review.receiptTotalHelper', 'Optional. It is compared with the sum of the lines to catch mistakes.')}</Text>
        {rec.state === 'match' && <Text accessibilityLiveRegion="polite" style={{ color: c.accentText, fontSize: 14, fontWeight: '700' }}>{t('scan.review.matches', 'The sums match the receipt.')}</Text>}
      </Card>

      <Card style={{ gap: space.sm }}>
        {([['scan.review.subtotal', 'Subtotal', totals.subtotal], ['scan.review.tax', 'Tax / VAT', totals.tax], ['scan.review.tip', 'Tip / service', totals.tip]] as const).map(([k, def, v]) =>
          k === 'scan.review.subtotal' || v !== 0 ? (
            <View key={k} style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
              <Text maxFontSizeMultiplier={1.5} style={{ color: c.textMuted, fontSize: 15 }}>{t(k, def)}</Text>
              <Text maxFontSizeMultiplier={1.5} style={{ color: c.text, fontSize: 15, fontWeight: '600' }}>{fmt(v)}</Text>
            </View>
          ) : null
        )}
        {totals.discount !== 0 && (
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            <Text maxFontSizeMultiplier={1.5} style={{ color: c.textMuted, fontSize: 15 }}>{t('scan.review.discount', 'Discount')}</Text>
            <Text maxFontSizeMultiplier={1.5} style={{ color: c.text, fontSize: 15, fontWeight: '600' }}>−{fmt(totals.discount)}</Text>
          </View>
        )}
      </Card>
    </View>
  );

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: c.screen }} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={Platform.OS === 'ios' ? insets.top + 50 : 0}>
      <FlatList
        ref={listRef}
        data={draft.items}
        keyExtractor={(i) => i.id}
        renderItem={({ item }) => (
          <ItemRow
            item={item}
            currency={cur}
            locale={locale}
            invalidName={showErrors && invalidNames.has(item.id)}
            autoFocus={item.id === justAdded}
            onName={onName}
            onQty={onQty}
            onPrice={onPrice}
            onDelete={onDelete}
          />
        )}
        ItemSeparatorComponent={() => <View style={{ height: space.sm }} />}
        ListHeaderComponent={header}
        ListFooterComponent={footer}
        contentContainerStyle={{ padding: space.lg, paddingBottom: space.xl }}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
        automaticallyAdjustKeyboardInsets
        onScrollToIndexFailed={() => {}}
        initialNumToRender={12}
        windowSize={9}
      />

      {undo && (
        <View accessibilityLiveRegion="polite" style={{ marginHorizontal: space.lg, marginBottom: space.sm, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: space.lg, minHeight: 48, borderRadius: radius.field, backgroundColor: c.text }}>
          <Text maxFontSizeMultiplier={1.4} style={{ color: c.screen, fontSize: 15 }}>{t('scan.review.deleted', 'Item deleted')}</Text>
          <Pressable onPress={onUndo} accessibilityRole="button" accessibilityLabel={t('scan.review.undo', 'Undo')} style={{ minHeight: 44, minWidth: 44, alignItems: 'center', justifyContent: 'center' }}>
            <Text maxFontSizeMultiplier={1.4} style={{ color: c.screen, fontSize: 15, fontWeight: '800', textDecorationLine: 'underline' }}>{t('scan.review.undo', 'Undo')}</Text>
          </Pressable>
        </View>
      )}

      <View style={{ paddingHorizontal: space.lg, paddingTop: space.md, paddingBottom: insets.bottom + space.md, gap: space.md, borderTopWidth: 1, borderTopColor: c.border, backgroundColor: c.surface }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' }} accessible accessibilityLabel={`${t('scan.review.total', 'Total')}: ${fmt(totals.total)}`}>
          <Text maxFontSizeMultiplier={1.4} style={{ color: c.textMuted, fontSize: 15, fontWeight: '600' }}>{t('scan.review.total', 'Total')}</Text>
          <Text maxFontSizeMultiplier={1.3} style={{ color: c.text, fontSize: 26, fontWeight: '800' }}>{fmt(totals.total)}</Text>
        </View>
        <Button title={t('scan.review.next', 'Next: choose people')} onPress={next} />
      </View>
    </KeyboardAvoidingView>
  );
}
