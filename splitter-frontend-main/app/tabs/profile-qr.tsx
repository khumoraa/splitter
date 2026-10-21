import React, { useCallback, useState } from 'react';
import { Share, Text, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import QRCode from 'react-native-qrcode-svg';
import { useTranslation } from 'react-i18next';
import { Copy, Share2 } from '@tamagui/lucide-icons';

import { useAppStore } from '@/shared/lib/stores/app-store';
import { useColors } from '@/shared/lib/theme/use-colors';
import { haptics } from '@/shared/lib/haptics';
import { buildFriendIdLink } from '@/shared/lib/utils/invite';
import { ProfileAvatar } from '@/features/profile/ui/ProfileAvatar';
import { Banner, Button, Card, FadeIn, Screen } from '@/features/profile/ui/kit';
import { space } from '@/shared/ui/tokens';

export default function ProfileQrScreen() {
  const { t } = useTranslation();
  const c = useColors();
  const user = useAppStore((s) => s.user);
  const [copied, setCopied] = useState(false);

  const copy = useCallback(async () => {
    if (!user) return;
    await Clipboard.setStringAsync(user.uniqueId);
    haptics.success();
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }, [user]);

  const share = useCallback(async () => {
    if (!user) return;
    haptics.tap();
    try {
      await Share.share({ message: t('profile.qr.shareMessage', { name: user.username, id: user.uniqueId, defaultValue: 'Add me in Splitter: {{name}}, ID {{id}}' }) });
    } catch {
      /* the user closed the share sheet or sharing failed: nothing to report */
    }
  }, [t, user]);

  if (!user) return <Screen keyboard={false}><Banner kind="error">{t('errors.unauthorized', 'Please sign in again.')}</Banner></Screen>;

  return (
    <Screen keyboard={false}>
      <FadeIn>
        <Card style={{ alignItems: 'center', gap: space.lg, paddingVertical: space.xl }}>
          <ProfileAvatar uri={user.avatarUrl} name={user.username} seed={user.uniqueId} size={72} />
          <View style={{ alignItems: 'center', gap: 2 }}>
            <Text accessibilityRole="header" style={{ color: c.text, fontSize: 20, fontWeight: '800' }}>{user.username}</Text>
            <Text selectable style={{ color: c.textMuted, fontSize: 16, fontWeight: '600', letterSpacing: 0.5 }}>{user.uniqueId}</Text>
          </View>
          {/* a QR code is always dark-on-white so every scanner can read it, in both themes */}
          <View accessible accessibilityRole="image" accessibilityLabel={t('profile.qr.a11y', { id: user.uniqueId, defaultValue: 'QR code with your ID {{id}}' })} style={{ backgroundColor: '#FFFFFF', padding: space.lg, borderRadius: 16 }}>
            <QRCode value={buildFriendIdLink(user.uniqueId)} size={220} ecl="M" color="#000000" backgroundColor="#FFFFFF" />
          </View>
          <Text style={{ color: c.textMuted, fontSize: 14, textAlign: 'center', lineHeight: 20 }}>{t('profile.qr.hint', 'A friend can scan this code in Splitter (Friends → Scan invite) to send you a request.')}</Text>
        </Card>
      </FadeIn>
      <FadeIn delay={80} style={{ gap: space.md }}>
        <Button title={copied ? t('profile.id.copied', 'Copied') : t('profile.qr.copyId', 'Copy my ID')} icon={<Copy size={18} color="#FFFFFF" />} onPress={copy} />
        <Button variant="secondary" title={t('profile.qr.share', 'Share')} icon={<Share2 size={18} color={c.text} />} onPress={share} />
      </FadeIn>
    </Screen>
  );
}
