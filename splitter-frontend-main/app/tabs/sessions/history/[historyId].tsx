import React, { useEffect, useMemo } from 'react';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { YStack, XStack, Text, ScrollView, Button } from 'tamagui';

import UserAvatar from '@/shared/ui/UserAvatar';
import { useSessionsHistoryStore } from '@/features/sessions/model/history.store';
import type {
  SessionHistoryEntry,
  SessionHistoryAllocation,
  SessionHistoryItem,
  SessionHistoryParticipantLight,
  SessionHistoryTotalsByParticipant,
} from '@/features/sessions/api/history.api';
import { formatAmount } from '@/shared/lib/utils/money';
import { useTranslation } from 'react-i18next';
import { SettlementBlock } from '@/features/payments/ui/SettlementBlock';

const DEFAULT_CURRENCY = 'UZS';
const fmtCurrency = (value: number, currency: string) => `${currency} ${formatAmount(value, currency)}`;
const BULLET = '\u2022';
const DETAIL_LIMIT = 50;

const formatSessionDate = (value?: string, locale: string = 'en') => {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const options: Intl.DateTimeFormatOptions = {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  };
  try {
    return date.toLocaleString(locale, options);
  } catch {
    return date.toLocaleString(undefined, options);
  }
};

type ParticipantView = {
  participant: SessionHistoryParticipantLight;
  avatarUrl?: string | null;
  amount: number;
  items: {
    id: string;
    title: string;
    price: number;
  }[];
};

const buildParticipantsView = (bill: SessionHistoryEntry | undefined, defaultItemName: string): ParticipantView[] => {
  if (!bill) return [];

  const totalsByParticipant = new Map<string, SessionHistoryTotalsByParticipant>();
  (bill.totals?.byParticipant ?? []).forEach(item => {
    totalsByParticipant.set(item.uniqueId, item);
  });

  const itemsById = new Map<string, SessionHistoryItem>();
  (bill.totals?.byItem ?? []).forEach(item => {
    itemsById.set(item.itemId, item);
  });

  const allocationsByParticipant = new Map<string, SessionHistoryAllocation[]>();
  (bill.allocations ?? []).forEach(alloc => {
    const collection = allocationsByParticipant.get(alloc.participantId) ?? [];
    collection.push(alloc);
    allocationsByParticipant.set(alloc.participantId, collection);
  });

  return (bill.participants ?? []).map(p => {
    const totals = totalsByParticipant.get(p.uniqueId);
    const allocations = allocationsByParticipant.get(p.uniqueId) ?? [];
    const items = allocations.map((allocation, index) => {
      const itemMeta = itemsById.get(allocation.itemId);
      return {
        id: `${allocation.itemId}-${p.uniqueId}-${index}`,
        title: itemMeta?.name || defaultItemName,
        price: allocation.shareAmount,
      };
    });
    return {
      participant: {
        uniqueId: p.uniqueId,
        username: totals?.username || p.username || 'U',
        avatarUrl: p.avatarUrl ?? null,
      },
      avatarUrl: p.avatarUrl ?? null,
      amount: totals?.amountOwed ?? 0,
      items,
    };
  });
};

export default function HistoryDetailsScreen() {
  const { historyId } = useLocalSearchParams<{ historyId: string }>();
  const router = useRouter();
  const { t, i18n } = useTranslation();
  const sessions = useSessionsHistoryStore(state => state.sessions);
  const loading = useSessionsHistoryStore(state => state.loading);
  const initialized = useSessionsHistoryStore(state => state.initialized);
  const currentLimit = useSessionsHistoryStore(state => state.limit);
  const error = useSessionsHistoryStore(state => state.error);
  const fetchHistory = useSessionsHistoryStore(state => state.fetchHistory);

  const bill: SessionHistoryEntry | undefined = useMemo(() => {
    if (!historyId) return undefined;
    const id = Number(historyId);
    if (Number.isNaN(id)) return undefined;
    return sessions.find(session => session.sessionId === id);
  }, [historyId, sessions]);

  useEffect(() => {
    if (loading) return;
    const hasBill = Boolean(bill);
    if (!initialized || (!hasBill && (currentLimit ?? 0) < DETAIL_LIMIT)) {
      fetchHistory(DETAIL_LIMIT).catch(() => {});
    }
  }, [initialized, loading, currentLimit, fetchHistory, bill]);

  const participants = useMemo(
    () => buildParticipantsView(bill, t('history.defaultItem', 'Item')),
    [bill, t]
  );
  const currency =
    bill?.currency ||
    bill?.totals?.currency ||
    bill?.payload?.totals?.currency ||
    DEFAULT_CURRENCY;

  if (!bill && loading) {
    return (
      <YStack f={1} bg="$background" ai="center" jc="center">
        <Text fontSize={16}>{t('history.loading', 'Loading...')}</Text>
      </YStack>
    );
  }

  if (!bill) {
    return (
      <YStack f={1} bg="$background" ai="center" jc="center" gap="$3">
        <Text fontSize={16} fontWeight="600">{t('history.notFound', 'History not found')}</Text>
        {error && (
          <Text fontSize={14} color="$red10">
            {error}
          </Text>
        )}
        <Button onPress={() => router.back()}>{t('history.goBack', 'Go back')}</Button>
      </YStack>
    );
  }

  return (
    <YStack f={1} bg="$background" px="$4" pt="$4" pb="$4">
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ alignItems: 'center', paddingBottom: 32, gap: 16 }}
      >
        <YStack w={358} gap="$3">
          <Text fontSize={24} fontWeight="700">{bill.sessionName || t('history.defaultName', 'Bill')}</Text>
          <Button unstyled alignSelf="flex-start" onPress={() => router.back()}>
            <Text color="#2ECC71">{t('history.back', '< Back')}</Text>
          </Button>
          <Text fontSize={14} color="$gray10">
            {`${formatSessionDate(bill.finalizedAt || bill.createdAt, i18n.language)} ${BULLET} ${t('history.participantsCount', { count: (bill.participants ?? []).length, defaultValue: '{{count}} participants' })}`}
          </Text>
          <Text fontSize={16} fontWeight="700" color="#2ECC71">
            {fmtCurrency(bill.grandTotal ?? 0, currency)}
          </Text>
        </YStack>

        <YStack w={358}>
          <SettlementBlock sessionId={bill.sessionId} />
        </YStack>

        {participants.map(({ participant, avatarUrl, amount, items }) => (
          <YStack
            key={participant.uniqueId}
            w={358}
            borderWidth={1}
            borderColor="#2ECC71"
            br={12}
            bg="$background"
            px={16}
            py={12}
            gap="$3"
          >
            <XStack jc="space-between" ai="center">
              <XStack ai="center" gap="$2">
                <UserAvatar
                  uri={avatarUrl ?? undefined}
                  label={(participant.username || 'U').slice(0, 1).toUpperCase()}
                  size={40}
                  textSize={16}
                  backgroundColor="$gray5"
                />
                <Text fontSize={16} fontWeight="600">{participant.username}</Text>
              </XStack>
              <Text fontSize={16} fontWeight="700" color="#2ECC71">
                {fmtCurrency(amount, currency)}
              </Text>
            </XStack>

            <YStack gap={8}>
              {items.length ? (
                items.map(item => (
                  <XStack key={item.id} jc="space-between" ai="center">
                    <Text fontSize={14}>{item.title}</Text>
                    <Text fontSize={14} fontWeight="600" color="#2ECC71">
                      {formatAmount(item.price, currency)}
                    </Text>
                  </XStack>
                ))
              ) : (
                <Text fontSize={12} color="$gray9">
                  {t('history.noItems', 'No items assigned')}
                </Text>
              )}
            </YStack>
          </YStack>
        ))}
      </ScrollView>
    </YStack>
  );
}
