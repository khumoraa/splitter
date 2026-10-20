import React from 'react';
import { YStack, Paragraph, Button } from 'tamagui';
import { useTranslation } from 'react-i18next';

type Props = {
  message: string;
  onRetry: () => void;
  disabled?: boolean;
};

/** Error text with a Retry button, for list screens whose first load failed. */
export function ErrorRetry({ message, onRetry, disabled }: Props) {
  const { t } = useTranslation();
  return (
    <YStack gap="$2" ai="flex-start" py="$2">
      <Paragraph col="$red10">{message}</Paragraph>
      <Button size="$3" onPress={onRetry} disabled={disabled}>
        {t('common.retry', 'Retry')}
      </Button>
    </YStack>
  );
}
