import React, { useEffect, useState } from 'react';
import { YStack, XStack, Text, Button, Input } from 'tamagui';
import { useTranslation } from 'react-i18next';

export type ItemFormValues = {
  name: string;
  price: number;
  quantity: number;
};

type Props = {
  /** Initial values; the modal is rendered only while the parent keeps it mounted */
  initial: { name: string; price: number; quantity: number };
  currency: string;
  /** 'new' shows "Add item" and hides the assignment-reset hint */
  mode?: 'edit' | 'new';
  topInset?: number;
  onSave: (values: ItemFormValues) => void;
  onClose: () => void;
};

/** "12,5" and "12.5" are both accepted; returns NaN for anything else */
const parseNumber = (raw: string): number => {
  const cleaned = raw.trim().replace(/\s/g, '').replace(',', '.');
  if (cleaned === '' || !/^-?\d*\.?\d+$/.test(cleaned)) return NaN;
  return Number(cleaned);
};

export function ItemEditModal({ initial, currency, mode = 'edit', topInset = 0, onSave, onClose }: Props) {
  const { t } = useTranslation();
  const [name, setName] = useState(initial.name);
  const [price, setPrice] = useState(String(initial.price));
  const [quantity, setQuantity] = useState(String(initial.quantity));
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setName(initial.name);
    setPrice(String(initial.price));
    setQuantity(String(initial.quantity));
    setError(null);
  }, [initial.name, initial.price, initial.quantity]);

  const submit = () => {
    const trimmed = name.trim();
    const p = parseNumber(price);
    const q = parseNumber(quantity);
    if (!trimmed) return setError(t('items.errorName', 'Enter a name'));
    if (!Number.isFinite(p)) return setError(t('items.errorPrice', 'Enter a valid price'));
    if (!Number.isInteger(q) || q < 1) {
      return setError(t('items.errorQuantity', 'Quantity must be a whole number, 1 or more'));
    }
    onSave({ name: trimmed, price: Math.round(p * 100) / 100, quantity: q });
  };

  return (
    <YStack position="absolute" inset={0} bg="rgba(0,0,0,0.35)" ai="center" pt={topInset + 12} zIndex={20}>
      <YStack w={358} maxWidth="94%" bg="$color1" borderRadius={8} p="$3" gap="$3">
        <Text fontSize={16} fontWeight="700">
          {mode === 'new' ? t('items.addTitle', 'Add item') : t('items.editTitle', 'Edit item')}
        </Text>

        <YStack gap="$1">
          <Text fontSize={12} color="$gray10">{t('items.name', 'Name')}</Text>
          <Input value={name} onChangeText={setName} placeholder={t('items.name', 'Name')} />
        </YStack>

        <XStack gap="$3">
          <YStack f={1} gap="$1">
            <Text fontSize={12} color="$gray10">
              {t('items.unitPrice', 'Price per unit')} ({currency})
            </Text>
            <Input value={price} onChangeText={setPrice} keyboardType="decimal-pad" />
          </YStack>
          <YStack w={96} gap="$1">
            <Text fontSize={12} color="$gray10">{t('items.quantity', 'Qty')}</Text>
            <Input value={quantity} onChangeText={setQuantity} keyboardType="number-pad" />
          </YStack>
        </XStack>

        {mode === 'edit' && (
          <Text fontSize={12} color="$gray10">
            {t('items.assignmentsReset', 'Changing the quantity clears who was assigned to this item.')}
          </Text>
        )}

        {error && <Text color="$red10" fontSize={13}>{error}</Text>}

        <XStack gap="$2">
          <Button unstyled f={1} height={41} borderRadius={10} borderWidth={1} borderColor="$gray5" ai="center" jc="center" onPress={onClose}>
            <Text>{t('common.cancel', 'Cancel')}</Text>
          </Button>
          <Button unstyled f={1} height={41} borderRadius={10} bg="#2ECC71" ai="center" jc="center" onPress={submit} pressStyle={{ opacity: 0.9 }}>
            <Text color="white" fontWeight="600">{t('items.save', 'Save')}</Text>
          </Button>
        </XStack>
      </YStack>
    </YStack>
  );
}
