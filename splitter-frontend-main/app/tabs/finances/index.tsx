import React, { memo, useCallback, useMemo, useState } from 'react';
import { FlatList, Platform, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useFocusEffect } from 'expo-router/react-navigation';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { Wallet } from '@tamagui/lucide-icons';

import { useColors } from '@/shared/lib/theme/use-colors';
import { useAppStore } from '@/shared/lib/stores/app-store';
import { haptics } from '@/shared/lib/haptics';
import { isApiError } from '@/shared/api/api-error';
import { MIN_TOUCH, radius, space } from '@/shared/ui/tokens';
import { GlassSurface } from '@/shared/ui/GlassSurface';
import { Button, Card, Skeleton } from '@/features/profile/ui/kit';
import { EmptyState, SearchField, Segmented, SectionTitle, UserRow } from '@/features/social/ui/parts';
import { formatMinor } from '@/features/scan/lib/receipt-calc';
import { PaymentsApi, type Summary } from '@/features/payments/api/payments.api';
import { paymentErrorKey } from '@/features/payments/lib/errors';
import { peopleRows, periodFrom, settledRatio, type Period, type Side } from '@/features/payments/lib/finance-view';

type StatusFilter = 'all' | 'open' | 'settled';

function Chip({ label, on, onPress }: { label: string; on: boolean; onPress: () => void }) {
  const c = useColors();
  return (
    <Pressable
      onPress={() => { haptics.selection(); onPress(); }}
      accessibilityRole="radio"
      accessibilityState={{ selected: on }}
      style={{ minHeight: MIN_TOUCH - 8, paddingHorizontal: space.md, borderRadius: radius.pill, justifyContent: 'center', backgroundColor: on ? c.accentFill : c.field, borderWidth: 1, borderColor: on ? c.accentFill : c.border }}
    >
      <Text maxFontSizeMultiplier={1.3} style={{ color: on ? c.onAccent : c.text, fontSize: 14, fontWeight: '600' }}>{label}</Text>
    </Pressable>
  );
}

const PersonRow = memo(function PersonRow({ row, side, locale, onOpen }: { row: ReturnType<typeof peopleRows>[number]; side: Side; locale: string; onOpen: (uniqueId: string) => void }) {
  const c = useColors();
  const { t } = useTranslation();
  const u = row.person.user!;
  const amount = formatMinor(row.person.outstandingMinor, row.currency, locale);
  return (
    <Card style={{ padding: 0 }}>
      <UserRow
        user={u}
        subtitle={t('finance.bills', { count: row.person.count })}
        onPress={() => onOpen(u.uniqueId)}
        a11yHint={side === 'owedToMe' ? t('finance.owesYouA11y', { name: u.username, amount }) : t('finance.youOweA11y', { name: u.username, amount })}
        right={
          <Text maxFontSizeMultiplier={1.3} numberOfLines={1} style={{ color: row.person.outstandingMinor === 0 ? c.textMuted : side === 'owedToMe' ? c.accentText : c.text, fontSize: 16, fontWeight: '800', fontVariant: ['tabular-nums'], maxWidth: 150 }}>
            {row.person.outstandingMinor === 0 ? t('finance.settledShort') : amount}
          </Text>
        }
      />
    </Card>
  );
});

export default function FinancesScreen() {
  const { t } = useTranslation();
  const c = useColors();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const locale = useAppStore((s) => s.language) || 'en';
  const [side, setSide] = useState<Side>('owedToMe');
  const [status, setStatus] = useState<StatusFilter>('open');
  const [period, setPeriod] = useState<Period>('all');
  const [groupId, setGroupId] = useState<number | null>(null);
  const [q, setQ] = useState('');
  const [data, setData] = useState<Summary | null>(null);
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const from = periodFrom(period, Date.now());
      const d = await PaymentsApi.summary({ ...(status !== 'all' ? { status } : {}), ...(from ? { from } : {}), ...(groupId ? { groupId } : {}) });
      setData(d);
      setErrorKey(null);
    } catch (e) {
      setErrorKey(paymentErrorKey(isApiError(e) ? e : {}));
    }
  }, [status, period, groupId]);
  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const rows = useMemo(() => (data ? peopleRows(data.currencies, side, q) : []), [data, side, q]);
  const open = useCallback((uniqueId: string) => router.push({ pathname: '/tabs/finances/person', params: { uniqueId } } as never), [router]);

  const header = (
    <View style={{ gap: space.lg, paddingBottom: space.md }}>
      {/* summary header on glass, one card per currency: amounts of different currencies are never added together */}
      {data && data.currencies.length > 0 && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: space.md }}>
          {data.currencies.map((cur) => (
            <GlassSurface key={cur.currency} style={{ padding: space.lg, minWidth: 240, gap: space.sm }}>
              <Text maxFontSizeMultiplier={1.3} style={{ color: c.textMuted, fontSize: 13, fontWeight: '700', letterSpacing: 0.6 }}>{cur.currency}</Text>
              <View accessible accessibilityLabel={`${t('finance.owedToYou')}: ${formatMinor(cur.owedToMe.outstandingMinor, cur.currency, locale)}`}>
                <Text maxFontSizeMultiplier={1.3} style={{ color: c.textMuted, fontSize: 13 }}>{t('finance.owedToYou')}</Text>
                <Text maxFontSizeMultiplier={1.2} numberOfLines={1} adjustsFontSizeToFit style={{ color: c.accentText, fontSize: 24, fontWeight: '800', fontVariant: ['tabular-nums'] }}>{formatMinor(cur.owedToMe.outstandingMinor, cur.currency, locale)}</Text>
              </View>
              <View accessible accessibilityLabel={`${t('finance.youOwe')}: ${formatMinor(cur.iOwe.outstandingMinor, cur.currency, locale)}`}>
                <Text maxFontSizeMultiplier={1.3} style={{ color: c.textMuted, fontSize: 13 }}>{t('finance.youOwe')}</Text>
                <Text maxFontSizeMultiplier={1.2} numberOfLines={1} adjustsFontSizeToFit style={{ color: c.text, fontSize: 24, fontWeight: '800', fontVariant: ['tabular-nums'] }}>{formatMinor(cur.iOwe.outstandingMinor, cur.currency, locale)}</Text>
              </View>
            </GlassSurface>
          ))}
        </ScrollView>
      )}

      <Segmented value={side} onChange={setSide} options={[{ key: 'owedToMe', label: t('finance.owedToYou') }, { key: 'iOwe', label: t('finance.youOwe') }]} />

      <View accessibilityRole="radiogroup" style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
        <Chip label={t('finance.filter.open')} on={status === 'open'} onPress={() => setStatus('open')} />
        <Chip label={t('finance.filter.settled')} on={status === 'settled'} onPress={() => setStatus('settled')} />
        <Chip label={t('finance.filter.all')} on={status === 'all'} onPress={() => setStatus('all')} />
      </View>
      <View accessibilityRole="radiogroup" style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
        {(['all', '30d', '90d', 'year'] as Period[]).map((p) => <Chip key={p} label={t(`finance.period.${p}`)} on={period === p} onPress={() => setPeriod(p)} />)}
      </View>
      {data && data.groups.length > 0 && (
        <View accessibilityRole="radiogroup" style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
          <Chip label={t('finance.filter.allGroups')} on={groupId === null} onPress={() => setGroupId(null)} />
          {[...new Map(data.groups.map((g) => [g.group.id, g.group])).values()].map((g) => <Chip key={g.id} label={g.name} on={groupId === g.id} onPress={() => setGroupId(g.id)} />)}
        </View>
      )}
      <SearchField value={q} onChangeText={setQ} label={t('finance.searchLabel')} placeholder={t('finance.searchPlaceholder')} />
    </View>
  );

  const footer = data && data.groups.length > 0 ? (
    <View style={{ gap: space.sm, paddingTop: space.lg }}>
      <SectionTitle>{t('finance.groupsTitle')}</SectionTitle>
      {data.groups.map((g) => {
        const r = settledRatio(g.settledMinor, g.totalMinor);
        return (
          <Card key={`${g.group.id}:${g.currency}`} style={{ gap: space.sm }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: space.md }}>
              <Text maxFontSizeMultiplier={1.4} numberOfLines={1} style={{ color: c.text, fontSize: 16, fontWeight: '600', flexShrink: 1 }}>{g.group.name}</Text>
              <Text maxFontSizeMultiplier={1.3} style={{ color: c.textMuted, fontSize: 14 }}>{Math.round(r * 100)}%</Text>
            </View>
            <View accessible accessibilityLabel={t('payments.block.progressA11y', { settled: formatMinor(g.settledMinor, g.currency, locale), total: formatMinor(g.totalMinor, g.currency, locale) })} style={{ height: 8, borderRadius: 4, backgroundColor: c.field, overflow: 'hidden' }}>
              <View style={{ width: `${Math.round(r * 100)}%`, height: 8, backgroundColor: c.accentFill }} />
            </View>
            <Text maxFontSizeMultiplier={1.4} style={{ color: c.textMuted, fontSize: 13 }}>{t('finance.groupProgress', { settled: formatMinor(g.settledMinor, g.currency, locale), total: formatMinor(g.totalMinor, g.currency, locale) })}</Text>
          </Card>
        );
      })}
    </View>
  ) : null;

  if (!data && !errorKey) {
    return <View style={{ flex: 1, backgroundColor: c.screen, padding: space.lg, gap: space.md }} accessibilityLabel={t('common.loading', 'Loading...')}><Skeleton height={150} style={{ borderRadius: radius.card }} /><Skeleton height={44} /><Skeleton height={64} /><Skeleton height={64} /></View>;
  }

  return (
    <FlatList
      style={{ flex: 1, backgroundColor: c.screen }}
      contentInsetAdjustmentBehavior="automatic"
      data={rows}
      keyExtractor={(r) => r.key}
      renderItem={({ item }) => <PersonRow row={item} side={side} locale={locale} onOpen={open} />}
      ItemSeparatorComponent={() => <View style={{ height: space.sm }} />}
      ListHeaderComponent={header}
      ListFooterComponent={footer}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} tintColor={c.accentText} colors={[c.accentText]} />}
      contentContainerStyle={{ padding: space.lg, paddingBottom: insets.bottom + space.xxl }}
      ListEmptyComponent={
        errorKey ? (
          <EmptyState title={t('social.loadError', "Couldn't load")} message={t(errorKey)}><Button variant="secondary" title={t('common.retry', 'Retry')} onPress={() => void load()} /></EmptyState>
        ) : (
          <EmptyState
            icon={<Wallet size={30} color={c.accentText} />}
            title={side === 'owedToMe' ? t('finance.empty.owedTitle') : t('finance.empty.oweTitle')}
            message={q ? t('finance.empty.search') : t('finance.empty.message')}
          >
            {!q && <Button variant="secondary" title={t('finance.empty.cta')} onPress={() => router.push('/tabs/new-receipt' as never)} />}
          </EmptyState>
        )
      }
    />
  );
}
