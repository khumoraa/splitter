import React, { useCallback, useState } from 'react';
import { FlatList, Pressable, Share, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useFocusEffect } from 'expo-router/react-navigation';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';

import { useColors } from '@/shared/lib/theme/use-colors';
import { useAppStore } from '@/shared/lib/stores/app-store';
import { haptics } from '@/shared/lib/haptics';
import { isApiError, logLevelForError } from '@/shared/api/api-error';
import { space } from '@/shared/ui/tokens';
import { GlassSurface } from '@/shared/ui/GlassSurface';
import { Banner, Button, Card, Skeleton } from '@/features/profile/ui/kit';
import { ProfileAvatar } from '@/features/profile/ui/ProfileAvatar';
import { EmptyState, SectionTitle } from '@/features/social/ui/parts';
import { useNotice } from '@/features/social/lib/use-notice';
import { formatMinor } from '@/features/scan/lib/receipt-calc';
import { PaymentsApi, type PersonDetail } from '@/features/payments/api/payments.api';
import { obligationLook } from '@/features/payments/lib/status-ui';
import { paymentErrorKey } from '@/features/payments/lib/errors';
import { sharePdf } from '@/features/payments/lib/export';
import { LEGAL_NOTE_KEY, type StatementModel } from '@/features/payments/lib/statement';
import { StatusBadge } from '@/features/payments/ui/StatusBadge';

/** Everything between me and one person: balance per currency, every bill, payments; reminder and statement. */
export default function PersonBalanceScreen() {
  const { t } = useTranslation();
  const c = useColors();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const locale = useAppStore((s) => s.language) || 'en';
  const { uniqueId } = useLocalSearchParams<{ uniqueId: string }>();
  const [data, setData] = useState<PersonDetail | null>(null);
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, notify] = useNotice();

  const load = useCallback(async () => {
    try {
      setData(await PaymentsApi.person(uniqueId));
      setErrorKey(null);
    } catch (e) {
      setErrorKey(isApiError(e) && e.status === 404 ? 'finance.person.none' : paymentErrorKey(isApiError(e) ? e : {}));
    }
  }, [uniqueId]);
  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const date = (iso: string) => new Date(iso).toLocaleDateString(locale, { day: 'numeric', month: 'short', year: 'numeric' });

  const remind = async () => {
    if (!data) return;
    const owed = data.currencies.filter((cur) => cur.owedToMe.outstandingMinor > 0).map((cur) => formatMinor(cur.owedToMe.outstandingMinor, cur.currency, locale)).join(' + ');
    if (!owed) return;
    await Share.share({ message: t('finance.person.remindMessage', { name: data.person.username, amount: owed }) });
  };

  const exportPdf = async () => {
    if (!data || busy) return;
    setBusy(true);
    try {
      const model: StatementModel = {
        title: t('payments.statement.personTitle', { name: data.person.username }),
        subtitle: data.currencies.map((cur) => `${cur.currency}: ${t('finance.person.net', { amount: formatMinor(cur.netMinor, cur.currency, locale) })}`).join(' · '),
        shortId: `P-${data.person.uniqueId.replace('#', '')}`,
        generatedAt: t('payments.statement.generated', { date: new Date().toLocaleString(locale, { dateStyle: 'medium', timeStyle: 'short' }) }),
        sections: data.currencies.map((cur) => ({
          title: cur.currency,
          rows: [
            ...data.obligations.filter((o) => o.currency === cur.currency).map((o) => ({
              label: `${o.bill ? date(o.bill.date) : ''} · ${o.bill?.name || t('payments.statement.untitled')} · ${o.myRole === 'creditor' ? t('finance.person.theyOwe') : t('finance.person.iOwe')} · ${t(`payments.status.${o.status}`)}`,
              value: `${formatMinor(o.amountMinor, cur.currency, locale)} · ${t('payments.statement.left', { amount: formatMinor(o.outstandingMinor, cur.currency, locale) })}`,
            })),
            { label: t('finance.person.balance'), value: formatMinor(cur.netMinor, cur.currency, locale), strong: true },
          ],
        })),
        legalNote: t(LEGAL_NOTE_KEY),
        signature: t('payments.statement.signature'),
      };
      await sharePdf(model, model.title);
      haptics.success();
    } catch (e) {
      console[logLevelForError(e)]('person statement export failed');
      notify({ kind: 'error', text: t('payments.errors.export') });
    } finally {
      setBusy(false);
    }
  };

  if (!data) {
    return (
      <View style={{ flex: 1, backgroundColor: c.screen, padding: space.lg, gap: space.md }}>
        {errorKey ? <EmptyState title={t(errorKey)}><Button variant="secondary" title={t('common.retry', 'Retry')} onPress={() => void load()} /></EmptyState> : <><Skeleton height={120} /><Skeleton height={64} /><Skeleton height={64} /></>}
      </View>
    );
  }

  const owesMe = data.currencies.some((cur) => cur.owedToMe.outstandingMinor > 0);
  return (
    <FlatList
      style={{ flex: 1, backgroundColor: c.screen }}
      contentContainerStyle={{ padding: space.lg, paddingBottom: insets.bottom + space.xxl, gap: space.sm }}
      data={data.obligations}
      keyExtractor={(o) => String(o.id)}
      ListHeaderComponent={
        <View style={{ gap: space.lg, paddingBottom: space.md }}>
          <GlassSurface style={{ padding: space.lg, gap: space.md }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
              <ProfileAvatar uri={data.person.avatarUrl} name={data.person.username} seed={data.person.uniqueId} size={56} />
              <View style={{ flex: 1 }}>
                <Text accessibilityRole="header" maxFontSizeMultiplier={1.4} style={{ color: c.text, fontSize: 20, fontWeight: '800' }}>{data.person.username}</Text>
                <Text maxFontSizeMultiplier={1.4} style={{ color: c.textMuted, fontSize: 14 }}>{data.person.uniqueId}</Text>
              </View>
            </View>
            {data.currencies.map((cur) => (
              <View key={cur.currency} accessible style={{ flexDirection: 'row', justifyContent: 'space-between', gap: space.md }}>
                <Text maxFontSizeMultiplier={1.4} style={{ color: c.textMuted, fontSize: 15, flexShrink: 1 }}>
                  {cur.netMinor > 0 ? t('finance.person.owesYou', { name: data.person.username }) : cur.netMinor < 0 ? t('finance.person.youOweThem', { name: data.person.username }) : t('finance.person.even')}
                </Text>
                <Text maxFontSizeMultiplier={1.3} numberOfLines={1} style={{ color: cur.netMinor > 0 ? c.accentText : c.text, fontSize: 18, fontWeight: '800', fontVariant: ['tabular-nums'] }}>{formatMinor(Math.abs(cur.netMinor), cur.currency, locale)}</Text>
              </View>
            ))}
          </GlassSurface>
          {notice && <Banner kind={notice.kind === 'error' ? 'error' : 'success'}>{notice.text}</Banner>}
          <View style={{ flexDirection: 'row', gap: space.sm }}>
            {owesMe && <View style={{ flex: 1 }}><Button variant="secondary" title={t('payments.action.remind')} onPress={() => void remind()} /></View>}
            <View style={{ flex: 1 }}><Button variant="secondary" title={t('payments.share.pdf')} loading={busy} onPress={() => void exportPdf()} /></View>
          </View>
          <SectionTitle>{t('finance.person.bills')}</SectionTitle>
        </View>
      }
      renderItem={({ item: o }) => (
        <Pressable
          onPress={() => router.push({ pathname: '/tabs/sessions/history/[historyId]', params: { historyId: String(o.sessionId) } } as never)}
          accessibilityRole="button"
          accessibilityLabel={`${o.bill?.name || t('payments.statement.untitled')}, ${formatMinor(o.amountMinor, o.currency, locale)}, ${t(obligationLook(o.status).labelKey)}`}
          style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
        >
          <Card style={{ gap: space.sm }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: space.md }}>
              <View style={{ flex: 1, gap: 2 }}>
                <Text maxFontSizeMultiplier={1.4} numberOfLines={1} style={{ color: c.text, fontSize: 16, fontWeight: '600' }}>{o.bill?.name || t('payments.statement.untitled')}</Text>
                <Text maxFontSizeMultiplier={1.4} style={{ color: c.textMuted, fontSize: 13 }}>
                  {o.bill ? date(o.bill.date) : ''} · {o.myRole === 'creditor' ? t('finance.person.theyOwe') : t('finance.person.iOwe')}
                </Text>
              </View>
              <Text maxFontSizeMultiplier={1.3} style={{ color: c.text, fontSize: 16, fontWeight: '800', fontVariant: ['tabular-nums'] }}>{formatMinor(o.amountMinor, o.currency, locale)}</Text>
            </View>
            <StatusBadge look={obligationLook(o.status)} compact />
          </Card>
        </Pressable>
      )}
      ListFooterComponent={<Text maxFontSizeMultiplier={1.5} style={{ color: c.textMuted, fontSize: 11, lineHeight: 15, textAlign: 'center', marginTop: space.lg }}>{t(LEGAL_NOTE_KEY)}</Text>}
    />
  );
}
