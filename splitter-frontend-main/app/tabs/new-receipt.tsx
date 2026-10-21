import React, { useCallback } from 'react';
import { Alert, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import * as ImagePicker from 'expo-image-picker';
import { Camera, Image as ImageIcon, PencilLine } from '@tamagui/lucide-icons';

import { useColors } from '@/shared/lib/theme/use-colors';
import { useAppStore } from '@/shared/lib/stores/app-store';
import { space } from '@/shared/ui/tokens';
import { haptics } from '@/shared/lib/haptics';
import { Banner, Button, Card, FadeIn, Screen, Skeleton, Title } from '@/features/profile/ui/kit';
import { ChoiceCard } from '@/features/scan/ui/parts';
import { useScanQuota } from '@/features/scan/lib/use-scan-quota';
import { useDraftStore } from '@/features/scan/model/draft.store';
import { useCaptureStore } from '@/features/scan/model/capture.store';
import { SCAN_ROUTES } from '@/features/scan/lib/routes';
import { computeTotals, emptyDraft, formatMinor } from '@/features/scan/lib/receipt-calc';

function formatReset(iso: string | null, locale: string): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const sameDay = d.toDateString() === new Date().toDateString();
  return sameDay
    ? d.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })
    : d.toLocaleString(locale, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

export default function NewReceiptScreen() {
  const { t } = useTranslation();
  const c = useColors();
  const router = useRouter();
  const locale = useAppStore((s) => s.language) || 'en';
  const defaultCurrency = useAppStore((s) => s.defaultCurrency);
  const { status, quota, options, reload } = useScanQuota();
  const draft = useDraftStore((s) => s.draft);
  const hydrated = useDraftStore((s) => s.hydrated);
  const setDraft = useDraftStore((s) => s.setDraft);
  const setPhoto = useCaptureStore((s) => s.setPhoto);

  const hasDraft = hydrated && !!draft && (draft.items.length > 0 || draft.source === 'manual');
  const draftWorth = hasDraft && draft!.items.length > 0;

  const confirmReplace = useCallback(
    (then: () => void) => {
      if (!draftWorth) return then();
      Alert.alert(t('scan.new.replace.title', 'Start a new receipt?'), t('scan.new.replace.message', 'Your unfinished receipt will be replaced.'), [
        { text: t('common.cancel', 'Cancel'), style: 'cancel' },
        { text: t('scan.new.replace.confirm', 'Replace'), style: 'destructive', onPress: then },
      ]);
    },
    [draftWorth, t]
  );

  const onCamera = () => confirmReplace(() => router.push(SCAN_ROUTES.camera as never));

  const onGallery = () =>
    confirmReplace(async () => {
      try {
        const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 1, allowsEditing: false });
        if (res.canceled || !res.assets?.[0]) return;
        const a = res.assets[0];
        setPhoto({ uri: a.uri, width: a.width, height: a.height, source: 'gallery', frameCrop: null });
        router.push(SCAN_ROUTES.preview as never);
      } catch {
        haptics.error();
        Alert.alert(t('common.error', 'Error'), t('scan.new.galleryError', 'Could not open the gallery'));
      }
    });

  const onManual = () => {
    // an existing unfinished receipt is continued, never silently thrown away
    if (!hasDraft) setDraft(emptyDraft(defaultCurrency, 'manual'));
    router.push(SCAN_ROUTES.manual as never);
  };

  const discard = () =>
    Alert.alert(t('scan.new.discard.title', 'Discard this receipt?'), t('scan.new.discard.message', 'The items you entered will be deleted.'), [
      { text: t('common.cancel', 'Cancel'), style: 'cancel' },
      { text: t('scan.new.discard.confirm', 'Discard'), style: 'destructive', onPress: () => setDraft(null) },
    ]);

  // ---- AI cards: badge with the remaining count, or the reason they are blocked
  const blocked = !options.ai.enabled;
  const q = quota;
  const useDaily = q ? q.daily.remaining <= q.monthly.remaining : true;
  const left = q ? q.remaining : 0;
  const badge = blocked
    ? t('scan.new.unavailable', 'Unavailable')
    : status === 'ok' && q
      ? useDaily
        ? t('scan.new.leftToday', { count: left, defaultValue: '{{count}} recognitions left today' })
        : t('scan.new.leftMonth', { count: left, defaultValue: '{{count}} recognitions left this month' })
      : undefined;

  const reason =
    options.ai.reason === 'offline'
      ? t('scan.new.blocked.offline', "You're offline. Photo recognition needs internet — you can still enter the items by hand.")
      : options.ai.reason === 'quota_exhausted'
        ? (() => {
            const when = formatReset(q?.resetAt ?? null, locale);
            return when
              ? t('scan.new.blocked.quota', { when, defaultValue: 'You have used all recognitions for now. They come back at {{when}}. Entering items by hand is free.' })
              : t('scan.new.blocked.quotaNoTime', 'You have used all recognitions for now. Entering items by hand is free.');
          })()
        : options.ai.reason === 'unavailable'
          ? t('scan.new.blocked.unavailable', 'Photo recognition is temporarily unavailable. You can enter the items by hand.')
          : null;

  return (
    <Screen keyboard={false}>
      <FadeIn style={{ gap: space.sm }}>
        <Title>{t('scan.new.title', 'New receipt')}</Title>
        <Text maxFontSizeMultiplier={1.5} style={{ color: c.textMuted, fontSize: 15, lineHeight: 21 }}>
          {t('scan.new.subtitle', 'Photo recognition is limited, so use it when it helps. Entering items by hand is free and unlimited.')}
        </Text>
      </FadeIn>

      {draftWorth && draft && (
        <FadeIn delay={40}>
          <Card style={{ gap: space.md }}>
            <Text accessibilityRole="header" maxFontSizeMultiplier={1.4} style={{ color: c.text, fontSize: 17, fontWeight: '700' }}>{t('scan.new.draft.title', 'Unfinished receipt')}</Text>
            <Text maxFontSizeMultiplier={1.5} style={{ color: c.textMuted, fontSize: 14 }}>
              {t('scan.new.draft.summary', { count: draft.items.length, total: formatMinor(computeTotals(draft).total, draft.currency, locale), defaultValue: '{{count}} items · {{total}}' })}
            </Text>
            <Button title={t('scan.new.draft.continue', 'Continue')} onPress={() => router.push((draft.source === 'manual' && draft.items.length === 0 ? SCAN_ROUTES.manual : SCAN_ROUTES.review) as never)} />
            <Button variant="secondary" title={t('scan.new.draft.discard', 'Discard')} onPress={discard} />
          </Card>
        </FadeIn>
      )}

      {blocked && !!reason && (
        <FadeIn delay={60}>
          <Banner kind="info">{reason}</Banner>
        </FadeIn>
      )}

      <FadeIn delay={80} style={{ gap: space.md }}>
        {status === 'loading' && !blocked ? (
          <View accessibilityLabel={t('common.loading', 'Loading...')}>
            <Skeleton height={92} style={{ borderRadius: 16 }} />
          </View>
        ) : (
          <ChoiceCard
            icon={<Camera size={26} color={c.accentText} />}
            title={t('scan.new.camera.title', 'Take a photo')}
            subtitle={t('scan.new.camera.subtitle', 'Point the camera at the receipt')}
            badge={badge}
            disabled={blocked}
            onPress={onCamera}
          />
        )}
        <ChoiceCard
          icon={<ImageIcon size={26} color={c.accentText} />}
          title={t('scan.new.gallery.title', 'Choose from gallery')}
          subtitle={t('scan.new.gallery.subtitle', 'Use a photo you already have')}
          badge={badge}
          disabled={blocked}
          onPress={onGallery}
        />
        <ChoiceCard
          icon={<PencilLine size={26} color={c.accentText} />}
          title={t('scan.new.manual.title', 'Enter manually')}
          subtitle={t('scan.new.manual.subtitle', 'Free — no recognition needed')}
          onPress={onManual}
        />
      </FadeIn>

      {status === 'error' && !blocked && (
        <Card style={{ gap: space.sm }}>
          <Text maxFontSizeMultiplier={1.5} style={{ color: c.textMuted, fontSize: 14 }}>{t('scan.new.quotaError', "Couldn't check how many recognitions are left.")}</Text>
          <Button variant="secondary" title={t('common.retry', 'Retry')} onPress={reload} />
        </Card>
      )}

      <Text maxFontSizeMultiplier={1.5} style={{ color: c.textMuted, fontSize: 13, lineHeight: 18, textAlign: 'center' }}>
        {t('scan.new.privacy', 'The photo is sent for recognition and is not stored.')}
      </Text>
    </Screen>
  );
}
