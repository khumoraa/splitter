import React from 'react';
import { Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { CheckCircle2, Circle, CircleDot, Clock, Gift, XCircle } from '@tamagui/lucide-icons';
import { useColors } from '@/shared/lib/theme/use-colors';
import { radius } from '@/shared/ui/tokens';
import type { StatusLook } from '../lib/status-ui';

/** Icon + text, tinted: the colour is never the only signal. */
export function StatusBadge({ look, compact }: { look: StatusLook; compact?: boolean }) {
  const c = useColors();
  const { t } = useTranslation();
  const color = look.tone === 'success' ? c.accentText : look.tone === 'danger' ? c.danger : look.tone === 'warning' ? c.text : c.textMuted;
  const bg = look.tone === 'success' ? c.accentSurface : look.tone === 'danger' ? c.dangerSurface : c.field;
  const Icon = { check: CheckCircle2, clock: Clock, circle: Circle, half: CircleDot, gift: Gift, x: XCircle }[look.icon];
  const label = t(look.labelKey);
  return (
    <View accessible accessibilityLabel={label} style={{ flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-start', paddingHorizontal: compact ? 6 : 8, paddingVertical: compact ? 2 : 4, borderRadius: radius.pill, backgroundColor: bg }}>
      <Icon size={compact ? 12 : 14} color={color} />
      <Text maxFontSizeMultiplier={1.4} style={{ color, fontSize: compact ? 12 : 13, fontWeight: '700' }}>{label}</Text>
    </View>
  );
}
