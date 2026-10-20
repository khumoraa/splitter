import React, { useMemo } from 'react';
import { YStack, XStack, Text } from 'tamagui';
import { useTranslation } from 'react-i18next';

import { computeSettlements, type ShareInput } from '@/shared/lib/utils/settlement';
import { formatAmount } from '@/shared/lib/utils/money';

type Person = { uniqueId: string; username: string };

type Props = {
  shares: ShareInput[];
  /** the person who paid the bill; nothing is rendered while unknown (older history entries) */
  payer?: Person | null;
  currency: string;
  /** current user's uniqueId, shown as "You" */
  meUniqueId?: string;
};

export function SettlementList({ shares, payer, currency, meUniqueId }: Props) {
  const { t } = useTranslation();

  const transfers = useMemo(
    () => (payer ? computeSettlements(shares, payer) : []),
    [shares, payer]
  );

  if (!payer) return null;

  const nameOf = (p: Person) => (p.uniqueId === meUniqueId ? t('settlement.you', 'You') : p.username || p.uniqueId);

  return (
    <YStack gap="$2" mt="$4">
      <Text fontSize={14} fontWeight="600" color="$gray11" mb="$1">
        {t('settlement.title', 'Who owes whom')}
      </Text>
      <Text fontSize={12} color="$gray10">
        {t('settlement.paidBy', { name: nameOf(payer), defaultValue: '{{name}} paid the bill' })}
      </Text>

      {transfers.length === 0 ? (
        <Text fontSize={13} color="$gray10">
          {t('settlement.nothing', 'Nobody owes anything.')}
        </Text>
      ) : (
        transfers.map((tr) => (
          <XStack
            key={`${tr.from.uniqueId}->${tr.to.uniqueId}`}
            ai="center"
            jc="space-between"
            px="$3"
            py="$3"
            borderWidth={1}
            borderColor={tr.to.uniqueId === meUniqueId ? '#2ECC71' : '$gray5'}
            borderRadius={12}
            bg="$color1"
          >
            <Text fontSize={15} fontWeight="600" f={1} pr="$2" numberOfLines={2}>
              {t('settlement.transfer', { from: nameOf(tr.from), to: nameOf(tr.to), defaultValue: '{{from}} → {{to}}' })}
            </Text>
            <XStack ai="baseline" gap="$1">
              <Text fontSize={12} color="$gray10">{currency}</Text>
              <Text fontSize={16} fontWeight="700" color="#2ECC71">{formatAmount(tr.amount, currency)}</Text>
            </XStack>
          </XStack>
        ))
      )}
    </YStack>
  );
}
