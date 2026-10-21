import React, { useCallback, useState } from 'react';
import { Alert, LayoutChangeEvent, Pressable, StyleSheet, Switch, Text, View } from 'react-native';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';
import { RotateCw, X } from '@tamagui/lucide-icons';

import { haptics } from '@/shared/lib/haptics';
import { MIN_TOUCH, radius, space } from '@/shared/ui/tokens';
import { useColors } from '@/shared/lib/theme/use-colors';
import { Button } from '@/features/profile/ui/kit';
import { useCaptureStore } from '@/features/scan/model/capture.store';
import { cropToView, type Size } from '@/features/scan/lib/crop';
import { deleteLocalFile, prepareForUpload } from '@/features/scan/lib/prepare-image';
import { makeId } from '@/features/scan/lib/ids';
import { SCAN_ROUTES } from '@/features/scan/lib/routes';

export default function ScanPreviewScreen() {
  const { t } = useTranslation();
  const c = useColors();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const photo = useCaptureStore((s) => s.photo);
  const setPhoto = useCaptureStore((s) => s.setPhoto);
  const setPrepared = useCaptureStore((s) => s.setPrepared);
  const [view, setView] = useState<Size | null>(null);
  const [crop, setCrop] = useState(true);
  const [busy, setBusy] = useState<null | 'rotate' | 'use'>(null);

  const onLayout = (e: LayoutChangeEvent) => setView({ width: e.nativeEvent.layout.width, height: e.nativeEvent.layout.height });

  const leave = useCallback(
    (toNew: boolean) => {
      deleteLocalFile(photo?.uri);
      setPhoto(null);
      if (router.canGoBack() && !toNew) router.back();
      else router.replace(SCAN_ROUTES.new as never);
    },
    [photo?.uri, router, setPhoto]
  );

  if (!photo) {
    // opened without a photo (e.g. after a reload): nothing to show
    return (
      <View style={[styles.fill, { backgroundColor: c.screen, alignItems: 'center', justifyContent: 'center', padding: space.lg, gap: space.lg }]}>
        <Text style={{ color: c.text, fontSize: 16 }}>{t('scan.preview.empty', 'No photo selected')}</Text>
        <Button title={t('scan.preview.backToStart', 'Back to New receipt')} onPress={() => router.replace(SCAN_ROUTES.new as never)} />
      </View>
    );
  }

  const cropOn = crop && !!photo.frameCrop;
  const overlay = cropOn && view && photo.frameCrop ? cropToView({ width: photo.width, height: photo.height }, view, photo.frameCrop) : null;

  const rotate = async () => {
    if (busy) return;
    setBusy('rotate');
    try {
      const out = await manipulateAsync(photo.uri, [{ rotate: 90 }], { compress: 0.92, format: SaveFormat.JPEG });
      deleteLocalFile(photo.uri);
      // rotating invalidates the camera-frame crop (its coordinates were for the old orientation)
      setPhoto({ uri: out.uri, width: out.width, height: out.height, source: photo.source, frameCrop: null });
      haptics.selection();
    } catch {
      haptics.error();
      Alert.alert(t('common.error', 'Error'), t('scan.preview.prepareError', 'Could not prepare the photo. Please try again.'));
    } finally {
      setBusy(null);
    }
  };

  const use = async () => {
    if (busy) return;
    setBusy('use');
    try {
      const prepared = await prepareForUpload({ uri: photo.uri, width: photo.width, height: photo.height, rotation: 0, crop: cropOn ? photo.frameCrop : null });
      // the bytes live in memory from here on; the files are not needed (and must not outlive the attempt)
      deleteLocalFile(photo.uri);
      deleteLocalFile(prepared.uri);
      setPrepared({ base64: prepared.base64, uri: '', idempotencyKey: makeId('scan-') });
      setPhoto(null);
      router.replace(SCAN_ROUTES.processing as never);
    } catch {
      haptics.error();
      Alert.alert(t('common.error', 'Error'), t('scan.preview.prepareError', 'Could not prepare the photo. Please try again.'));
      setBusy(null);
    }
  };

  return (
    <View style={[styles.fill, { backgroundColor: '#000' }]}>
      <View style={[styles.top, { paddingTop: insets.top + space.sm }]}>
        <Pressable onPress={() => leave(true)} accessibilityRole="button" accessibilityLabel={t('scan.camera.close', 'Close')} style={styles.round}>
          <X size={22} color="#FFF" />
        </Pressable>
        <Text accessibilityRole="header" maxFontSizeMultiplier={1.3} style={{ color: '#FFF', fontSize: 17, fontWeight: '700' }}>{t('scan.preview.title', 'Check the photo')}</Text>
        <Pressable onPress={() => void rotate()} disabled={!!busy} accessibilityRole="button" accessibilityLabel={t('scan.preview.rotate', 'Rotate 90°')} style={[styles.round, busy === 'rotate' && { opacity: 0.5 }]}>
          <RotateCw size={22} color="#FFF" />
        </Pressable>
      </View>

      <View style={styles.fill} onLayout={onLayout}>
        <Image source={{ uri: photo.uri }} contentFit="contain" style={StyleSheet.absoluteFill} accessibilityLabel={t('scan.preview.imageA11y', 'Photo of the receipt')} />
        {overlay && view && (
          <View pointerEvents="none" style={StyleSheet.absoluteFill} importantForAccessibility="no-hide-descendants">
            <View style={[styles.dim, { top: 0, left: 0, right: 0, height: overlay.y }]} />
            <View style={[styles.dim, { top: overlay.y + overlay.height, left: 0, right: 0, bottom: 0 }]} />
            <View style={[styles.dim, { top: overlay.y, left: 0, width: overlay.x, height: overlay.height }]} />
            <View style={[styles.dim, { top: overlay.y, left: overlay.x + overlay.width, right: 0, height: overlay.height }]} />
            <View style={{ position: 'absolute', left: overlay.x, top: overlay.y, width: overlay.width, height: overlay.height, borderWidth: 2, borderColor: '#FFF', borderRadius: 6 }} />
          </View>
        )}
      </View>

      <View style={[styles.bottom, { paddingBottom: insets.bottom + space.md, backgroundColor: c.screen }]}>
        {!!photo.frameCrop && (
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: MIN_TOUCH }}>
            <Text maxFontSizeMultiplier={1.4} style={{ color: c.text, fontSize: 16, fontWeight: '600', flexShrink: 1 }}>{t('scan.preview.crop', 'Crop to frame')}</Text>
            <Switch value={crop} onValueChange={(v) => { haptics.selection(); setCrop(v); }} accessibilityLabel={t('scan.preview.crop', 'Crop to frame')} trackColor={{ true: c.accentFill, false: c.border }} />
          </View>
        )}
        <Text maxFontSizeMultiplier={1.5} style={{ color: c.textMuted, fontSize: 13, lineHeight: 18 }}>
          {t('scan.preview.cost', 'Sending uses 1 recognition. Sending the same photo again is free.')}
        </Text>
        <Button title={t('scan.preview.use', 'Use this photo')} loading={busy === 'use'} disabled={busy === 'rotate'} onPress={() => void use()} />
        <Button variant="secondary" title={photo.source === 'camera' ? t('scan.preview.retake', 'Retake') : t('scan.preview.chooseAnother', 'Choose another')} disabled={!!busy} onPress={() => leave(photo.source === 'gallery')} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  dim: { position: 'absolute', backgroundColor: 'rgba(0,0,0,0.6)' },
  top: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: space.lg, paddingBottom: space.sm },
  bottom: { padding: space.lg, gap: space.md, borderTopLeftRadius: radius.card, borderTopRightRadius: radius.card },
  round: { width: MIN_TOUCH + 4, height: MIN_TOUCH + 4, borderRadius: (MIN_TOUCH + 4) / 2, backgroundColor: 'rgba(255,255,255,0.18)', alignItems: 'center', justifyContent: 'center' },
});
