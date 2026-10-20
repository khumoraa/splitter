// src/features/friends/ui/RequestList.tsx

import { useEffect, useMemo, useState, useCallback } from 'react';
import {
  YStack, XStack, Paragraph, Separator, Card, Button, Spinner
} from 'tamagui';
import { useTranslation } from 'react-i18next';
import { useFriendsStore } from '../model/friends.store';
import { FriendsApi } from '../api/friends.api';
import { useAppStore } from '@/shared/lib/stores/app-store';

type Props = { type: 'incoming' | 'outgoing' };

export function RequestList({ type }: Props) {
  const { t } = useTranslation();
  const { requestsRaw, fetchAll, loading, error } = useFriendsStore();
  const meUniqueId = useAppStore((s) => s.user?.uniqueId);

  const [busyId, setBusyId] = useState<number | null>(null);
  const [notice, setNotice] = useState<string | undefined>();
  const [noticeKind, setNoticeKind] = useState<'success' | 'error' | undefined>();

  useEffect(() => { fetchAll(); }, [fetchAll]);

  // auto-dismiss notice
  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => { setNotice(undefined); setNoticeKind(undefined); }, 2200);
    return () => clearTimeout(t);
  }, [notice]);

  const arr = useMemo(
    () => (type === 'incoming' ? requestsRaw?.incoming : requestsRaw?.outgoing) ?? [],
    [requestsRaw, type]
  );

  const wrap = useCallback(
    async (fn: () => Promise<any>, id: number, okMsg: string) => {
      setBusyId(id);
      try {
        await fn();
        setNoticeKind('success');
        setNotice(okMsg);
      } catch (e: any) {
        setNoticeKind('error');
        setNotice(e?.message || t('friends.common.error', 'Something went wrong'));
      } finally {
        setBusyId(null);
        fetchAll();
      }
    },
    [fetchAll, t]
  );

  const accept = (requesterId: number, label?: string) =>
    wrap(() => FriendsApi.accept(meUniqueId!, requesterId), requesterId, t('friends.requests.accepted', { target: label ?? '', defaultValue: 'Accepted {{target}}' }).trim());

  const reject = (requesterId: number, label?: string) =>
    wrap(() => FriendsApi.reject(meUniqueId!, requesterId), requesterId, t('friends.requests.rejected', { target: label ?? '', defaultValue: 'Rejected {{target}}' }).trim());

  if (loading) {
    return (
      <YStack gap="$3" ai="center" py="$4">
        <Spinner />
        <Paragraph col="$gray10">{t('friends.requests.loading', 'Loading requests…')}</Paragraph>
      </YStack>
    );
  }

  if (error) {
    return <Paragraph col="$red10">{error}</Paragraph>;
  }

  return (
    <YStack gap="$3">
      {notice && (
        <Paragraph col={noticeKind === 'error' ? '$red10' : '$green10'}>
          {notice}
        </Paragraph>
      )}

      {arr.length === 0 ? (
        <YStack gap="$2" ai="center" py="$4">
          <Paragraph col="$gray10">
            {type === 'incoming' ? t('friends.requests.emptyIncoming', 'No incoming requests') : t('friends.requests.emptyOutgoing', 'No outgoing requests')}
          </Paragraph>
          <Separator />
        </YStack>
      ) : (
        arr.map((r: any, i: number) => {
          const side = type === 'incoming' ? r.from : r.to;
          const title = side?.username || side?.uniqueId || `User #${side?.id}`;
          const sub = side?.uniqueId ? side.uniqueId : undefined;
          const idNum = side?.id as number | undefined;
          const isBusy = !!idNum && busyId === idNum;

          return (
            <Card key={`${type}-${side?.uniqueId ?? side?.id ?? i}`} p="$3" br="$4" bc="$backgroundFocus">
              <XStack ai="center" jc="space-between" gap="$3">
                <YStack>
                  <Paragraph fow="600">{title}</Paragraph>
                  {!!sub && <Paragraph size="$2" col="$gray10">{sub}</Paragraph>}
                </YStack>

                {type === 'incoming' ? (
                  <XStack gap="$2">
                    <Button
                      size="$2"
                      onPress={() => idNum != null && accept(idNum, title)}
                      disabled={isBusy || idNum == null}
                    >
                      {isBusy ? '...' : t('friends.requests.accept', 'Accept')}
                    </Button>
                    <Button
                      size="$2"
                      theme="red"
                      onPress={() => idNum != null && reject(idNum, title)}
                      disabled={isBusy || idNum == null}
                    >
                      {isBusy ? '...' : t('friends.requests.reject', 'Reject')}
                    </Button>
                  </XStack>
                ) : (
                  // Outgoing: no actions for now (spec doesn’t have cancel)
                  <Paragraph size="$2" col="$gray10">{t('friends.status.requested', 'Requested')}</Paragraph>
                )}
              </XStack>
            </Card>
          );
        })
      )}
    </YStack>
  );
}
