import { ErrorRetry } from '@/shared/ui/ErrorRetry';
import React, { useEffect, useMemo, useState, useCallback } from 'react';
import { useRouter } from 'expo-router';
import { Pressable, RefreshControl } from 'react-native';
import { YStack, XStack, Text, ScrollView, View } from 'tamagui';
import { useTranslation } from 'react-i18next';

import UserAvatar from '@/shared/ui/UserAvatar';
import { useSessionsHistoryStore } from '@/features/sessions/model/history.store';
import type { SessionHistoryEntry, SessionHistoryParticipantLight } from '@/features/sessions/api/history.api';
import { formatAmount } from '@/shared/lib/utils/money';

const BULLET = '\u2022';
const HISTORY_LIMIT = 50;
const DEFAULT_CURRENCY = 'UZS';

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

function AvatarGroup({ participants }: { participants: SessionHistoryParticipantLight[] }) {
  const shown = participants.slice(0, 4);
  const extra = Math.max(0, participants.length - shown.length);
  return (
    <XStack ai="center">
      {shown.map((participant, idx) => (
        <View key={participant.uniqueId ?? idx} ml={idx === 0 ? 0 : -8}>
          <UserAvatar
            uri={participant.avatarUrl ?? undefined}
            label={(participant.username || 'U').slice(0, 1).toUpperCase()}
            size={28}
            textSize={12}
            backgroundColor="$gray5"
          />
        </View>
      ))}
      {extra > 0 && (
        <View
          w={28}
          h={28}
          br={14}
          backgroundColor="#CBD5F5"
          borderWidth={2}
          borderColor="white"
          ml={shown.length === 0 ? 0 : -8}
          ai="center"
          jc="center"
        >
          <Text fontSize={10} color="$gray11">+{extra}</Text>
        </View>
      )}
    </XStack>
  );
}

function HistoryCard({
  title,
  summary,
  amountLabel,
  participants,
  onPress,
}: {
  title: string;
  summary: string;
  amountLabel: string;
  participants: SessionHistoryParticipantLight[];
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => ({ width: 358, opacity: pressed ? 0.9 : 1 })}
    >
      <YStack
        h={110}
        br={12}
        borderWidth={1}
        borderColor="#E4E7EB"
        p="$3"
        backgroundColor="white"
      >
        <XStack jc="space-between" ai="center">
          <YStack>
            <Text fontSize={16} fontWeight="600" lineHeight={19}>
              {title}
            </Text>
            <Text mt="$1" fontSize={12} lineHeight={12} color="$gray10">
              {summary}
            </Text>
          </YStack>
          <Text fontSize={14} lineHeight={22} fontWeight="700" color="#2ECC71">
            {amountLabel}
          </Text>
        </XStack>

        <XStack mt="auto" ai="center">
          <AvatarGroup participants={participants} />
        </XStack>
      </YStack>
    </Pressable>
  );
}

export default function SessionsHistoryScreen() {
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const sessions = useSessionsHistoryStore(state => state.sessions);
  const loading = useSessionsHistoryStore(state => state.loading);
  const initialized = useSessionsHistoryStore(state => state.initialized);
  const currentLimit = useSessionsHistoryStore(state => state.limit);
  const error = useSessionsHistoryStore(state => state.error);
  const fetchHistory = useSessionsHistoryStore(state => state.fetchHistory);
  const refreshIfStale = useSessionsHistoryStore(state => state.refreshIfStale);

  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    if (loading) return;
    if (!initialized || (currentLimit ?? 0) < HISTORY_LIMIT) {
      fetchHistory(HISTORY_LIMIT).catch(() => {});
    } else {
      // если уже инициализировано — подёргаем обновление по давности
      refreshIfStale(15_000, HISTORY_LIMIT).catch(() => {});
    }
  }, [initialized, loading, currentLimit, fetchHistory, refreshIfStale]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await fetchHistory(HISTORY_LIMIT);
    } finally {
      setRefreshing(false);
    }
  }, [fetchHistory]);

  const history = useMemo<SessionHistoryEntry[]>(() => sessions, [sessions]);

  return (
    <YStack f={1} bg="$background" px="$4" pt="$4">
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ alignItems: 'center', paddingBottom: 32, gap: 16 }}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
        }
      >
        <YStack w={358} gap="$1" mb="$2">
          <Text fontSize={24} fontWeight="700">{t('history.title', 'Recent bills')}</Text>
          <Text fontSize={12} color="$gray10">{t('history.subtitle', 'Home')}</Text>
        </YStack>

        {loading && (
          <Text color="$gray10" fontSize={14}>
            {t('history.loading', 'Loading...')}
          </Text>
        )}
        {error && <ErrorRetry message={error} onRetry={onRefresh} disabled={loading || refreshing} />}
        {!loading && !error && !history.length && (
          <Text color="$gray10" fontSize={14}>
            {t('history.empty', 'No history yet')}
          </Text>
        )}

        {history.map((bill) => {
          const participants = bill.participants ?? [];
          const dateForSummary = bill.finalizedAt || bill.createdAt;
          const summary = `${formatSessionDate(dateForSummary, i18n.language)} ${BULLET} ${t('history.participantsCount', { count: participants.length, defaultValue: '{{count}} participants' })}`;
          const totalAmount = bill.grandTotal ?? 0;
          const currency = bill.currency || bill.totals?.currency || bill.payload?.totals?.currency || DEFAULT_CURRENCY;
          const amountLabel = `${currency} ${formatAmount(totalAmount, currency)}`;
          return (
            <HistoryCard
              key={bill.sessionId}
              title={bill.sessionName || t('history.defaultName', 'Bill')}
              summary={summary}
              amountLabel={amountLabel}
              participants={participants}
              onPress={() =>
                router.push({
                  pathname: '/tabs/sessions/history/[historyId]',
                  params: { historyId: String(bill.sessionId) },
                })
              }
            />
          );
        })}
      </ScrollView>
    </YStack>
  );
}
