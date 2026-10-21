import React, { useRef, useState } from 'react';
import { Alert, KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { X } from '@tamagui/lucide-icons';

import { useColors, useScheme } from '@/shared/lib/theme/use-colors';
import { useAppStore } from '@/shared/lib/stores/app-store';
import { haptics } from '@/shared/lib/haptics';
import { isApiError, logLevelForError } from '@/shared/api/api-error';
import { MIN_TOUCH, radius, space } from '@/shared/ui/tokens';
import { useLeaveGuard } from '@/shared/lib/navigation/use-leave-guard';
import { Banner, Button, Skeleton } from '@/features/profile/ui/kit';
import { MoneyInput } from '@/features/scan/ui/parts';
import { formatMinor } from '@/features/scan/lib/receipt-calc';
import { makeId } from '@/features/scan/lib/ids';
import { useOnline } from '@/features/social/lib/use-online';
import { PaymentsApi, type PaymentMethod } from '@/features/payments/api/payments.api';
import { checkAmount, MAX_NOTE_LEN, recordableMinor } from '@/features/payments/lib/rules';
import { paymentErrorKey } from '@/features/payments/lib/errors';
import { useLedger } from '@/features/payments/lib/use-ledger';

type Mode = 'mark' | 'record' | 'reject' | 'forgive';
const METHODS: PaymentMethod[] = ['CASH', 'TRANSFER', 'OTHER'];

/**
 * Native iOS sheet for one payment action. "I paid" waits for the payer's confirmation; "Received" is recorded at once.
 * Splitter does not move money: this only records a settlement made in cash or by transfer outside the app.
 */
export default function PaymentSheet() {
  const { t } = useTranslation();
  const c = useColors();
  const scheme = useScheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const online = useOnline();
  const locale = useAppStore((s) => s.language) || 'en';
  const p = useLocalSearchParams<{ sessionId: string; obligationId: string; mode: Mode; paymentId?: string }>();
  const sessionId = Number(p.sessionId);
  const obligationId = Number(p.obligationId);
  const mode: Mode = p.mode === 'record' || p.mode === 'reject' || p.mode === 'forgive' ? p.mode : 'mark';
  const { data } = useLedger(sessionId);
  const o = data?.obligations.find((x) => x.id === obligationId);
  const payment = o?.payments.find((x) => x.id === Number(p.paymentId));

  const [amountMinor, setAmountMinor] = useState<number | null>(null); // null = the full rest
  const [method, setMethod] = useState<PaymentMethod>('CASH');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // one key per opened sheet: a double tap or a retry after a lost answer records the payment only once
  const idemKey = useRef(makeId('pay-')).current;

  const allowLeave = useLeaveGuard({ dirty: (amountMinor !== null && amountMinor > 0) || note.trim() !== '', busy });

  const currency = o?.currency ?? 'USD';
  const fmt = (m: number) => formatMinor(m, currency, locale);
  const room = o ? recordableMinor(o) : 0;
  const amountCheck = o ? checkAmount(o, o.status, amountMinor === null || amountMinor === 0 ? undefined : amountMinor) : null;
  const reasonMissing = mode === 'reject' && note.trim() === '';
  const canSubmit = !!o && online && !busy && !reasonMissing && (mode === 'reject' || mode === 'forgive' || !!amountCheck?.ok);

  const title = { mark: t('payments.sheet.markTitle'), record: t('payments.sheet.recordTitle'), reject: t('payments.sheet.rejectTitle'), forgive: t('payments.sheet.forgiveTitle') }[mode];

  const submit = async () => {
    if (!o || !canSubmit) return;
    const run = async () => {
      setBusy(true);
      setError(null);
      try {
        if (mode === 'mark' || mode === 'record') {
          await PaymentsApi.pay(o.id, { ...(amountMinor ? { amountMinor } : {}), method, ...(note.trim() ? { note: note.trim() } : {}) }, idemKey);
        } else if (mode === 'reject' && payment) {
          await PaymentsApi.reject(o.id, payment.id, note.trim());
        } else if (mode === 'forgive') {
          await PaymentsApi.forgive(o.id, note.trim() || undefined);
        }
        haptics.success();
        allowLeave();
        router.back();
      } catch (e) {
        haptics.error();
        console[logLevelForError(e)]('payment action failed');
        setError(t(paymentErrorKey(isApiError(e) ? e : {})));
        setBusy(false);
      }
    };
    if (mode === 'forgive') {
      // irreversible: ask once more
      Alert.alert(t('payments.sheet.forgiveConfirmTitle'), t('payments.sheet.forgiveConfirm', { amount: fmt(o.outstandingMinor), name: o.debtor.username }), [
        { text: t('common.cancel', 'Cancel'), style: 'cancel' },
        { text: t('payments.action.forgive'), style: 'destructive', onPress: () => void run() },
      ]);
    } else {
      await run();
    }
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: c.screen }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: space.lg, paddingTop: space.xl, paddingBottom: insets.bottom + space.xl, gap: space.lg }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.md }}>
          <Text accessibilityRole="header" maxFontSizeMultiplier={1.4} style={{ color: c.text, fontSize: 22, fontWeight: '800', flexShrink: 1 }}>{title}</Text>
          <Pressable
            onPress={() => router.back()}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={t('common.close', 'Close')}
            style={{ width: MIN_TOUCH, height: MIN_TOUCH, borderRadius: MIN_TOUCH / 2, alignItems: 'center', justifyContent: 'center', backgroundColor: c.field }}
          >
            <X size={20} color={c.text} />
          </Pressable>
        </View>

        {!o ? (
          <View style={{ gap: space.md }} accessibilityLabel={t('common.loading', 'Loading...')}><Skeleton height={20} /><Skeleton height={56} /></View>
        ) : (
          <>
            <Text maxFontSizeMultiplier={1.5} style={{ color: c.textMuted, fontSize: 15, lineHeight: 21 }}>
              {mode === 'mark' && t('payments.sheet.markHint', { name: o.creditor.username, amount: fmt(room) })}
              {mode === 'record' && t('payments.sheet.recordHint', { name: o.debtor.username, amount: fmt(room) })}
              {mode === 'reject' && payment && t('payments.sheet.rejectHint', { name: o.debtor.username, amount: fmt(payment.amountMinor) })}
              {mode === 'forgive' && t('payments.sheet.forgiveHint', { name: o.debtor.username, amount: fmt(o.outstandingMinor) })}
            </Text>

            {(mode === 'mark' || mode === 'record') && (
              <>
                <View style={{ gap: space.sm }}>
                  <Text maxFontSizeMultiplier={1.4} style={{ color: c.text, fontSize: 14, fontWeight: '600' }}>{t('payments.sheet.amount')}</Text>
                  <MoneyInput
                    big
                    valueMinor={amountMinor ?? 0}
                    currency={currency}
                    onChangeMinor={(m) => setAmountMinor(m === 0 ? null : m)}
                    placeholder={fmt(room)}
                    accessibilityLabel={t('payments.sheet.amount')}
                    returnKeyType="done"
                    style={{ textAlign: 'left' }}
                  />
                  <Text maxFontSizeMultiplier={1.4} style={{ color: amountCheck && !amountCheck.ok && amountMinor ? c.danger : c.textMuted, fontSize: 13 }}>
                    {amountCheck && !amountCheck.ok && amountMinor ? t(`payments.errors.${amountCheck.code === 'VALIDATION' ? 'amount' : amountCheck.code}`) : t('payments.sheet.amountHelp', { amount: fmt(room) })}
                  </Text>
                </View>
                <View style={{ gap: space.sm }}>
                  <Text maxFontSizeMultiplier={1.4} style={{ color: c.text, fontSize: 14, fontWeight: '600' }}>{t('payments.sheet.method')}</Text>
                  <View accessibilityRole="radiogroup" style={{ flexDirection: 'row', gap: space.sm }}>
                    {METHODS.map((m) => {
                      const on = m === method;
                      return (
                        <Pressable
                          key={m}
                          onPress={() => { haptics.selection(); setMethod(m); }}
                          accessibilityRole="radio"
                          accessibilityState={{ selected: on }}
                          style={{ flex: 1, minHeight: MIN_TOUCH, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center', backgroundColor: on ? c.accentFill : c.field, borderWidth: 1, borderColor: on ? c.accentFill : c.border }}
                        >
                          <Text maxFontSizeMultiplier={1.3} style={{ color: on ? c.onAccent : c.text, fontSize: 15, fontWeight: '700' }}>{t(`payments.method.${m}`)}</Text>
                        </Pressable>
                      );
                    })}
                  </View>
                </View>
              </>
            )}

            <View style={{ gap: space.sm }}>
              <Text maxFontSizeMultiplier={1.4} style={{ color: c.text, fontSize: 14, fontWeight: '600' }}>
                {mode === 'reject' ? t('payments.sheet.reason') : t('payments.sheet.note')}
              </Text>
              <TextInput
                value={note}
                onChangeText={setNote}
                placeholder={mode === 'reject' ? t('payments.sheet.reasonPlaceholder') : t('payments.sheet.notePlaceholder')}
                placeholderTextColor={c.textMuted}
                selectionColor={c.accentText}
                keyboardAppearance={scheme}
                maxLength={MAX_NOTE_LEN}
                multiline
                returnKeyType="done"
                blurOnSubmit
                accessibilityLabel={mode === 'reject' ? t('payments.sheet.reason') : t('payments.sheet.note')}
                maxFontSizeMultiplier={1.5}
                style={{ minHeight: 72, padding: space.md, borderRadius: radius.field, borderWidth: 1.5, borderColor: reasonMissing && note !== '' ? c.danger : c.border, backgroundColor: c.field, color: c.text, fontSize: 16, textAlignVertical: 'top' }}
              />
            </View>

            {!!error && <Banner kind="error">{error}</Banner>}
            {!online && <Banner kind="info">{t('payments.sheet.offline')}</Banner>}

            <Button
              variant={mode === 'forgive' || mode === 'reject' ? 'danger' : 'primary'}
              title={{ mark: t('payments.action.iPaid'), record: t('payments.action.received'), reject: t('payments.action.reject'), forgive: t('payments.action.forgive') }[mode]}
              loading={busy}
              disabled={!canSubmit}
              onPress={() => void submit()}
            />
            <Text maxFontSizeMultiplier={1.5} style={{ color: c.textMuted, fontSize: 12, lineHeight: 16, textAlign: 'center' }}>{t('payments.sheet.disclaimer')}</Text>
          </>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
