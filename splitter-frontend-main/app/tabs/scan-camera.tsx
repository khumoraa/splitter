import React, { useCallback, useRef, useState } from 'react';
import { ActivityIndicator, Alert, LayoutChangeEvent, Pressable, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useIsFocused } from 'expo-router/react-navigation';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as ImagePicker from 'expo-image-picker';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { Image as ImageIcon, X, Zap, ZapOff } from '@tamagui/lucide-icons';

import { haptics } from '@/shared/lib/haptics';
import { MIN_TOUCH, space } from '@/shared/ui/tokens';
import { useColors } from '@/shared/lib/theme/use-colors';
import { Button, PermissionNotice } from '@/features/profile/ui/kit';
import { useCaptureStore } from '@/features/scan/model/capture.store';
import { frameToCrop, type Rect, type Size } from '@/features/scan/lib/crop';
import { SCAN_ROUTES } from '@/features/scan/lib/routes';

const GUIDE = '#FFFFFF';

export default function ScanCameraScreen() {
  const { t } = useTranslation();
  const c = useColors();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const focused = useIsFocused();
  const [perm, requestPerm] = useCameraPermissions();
  const cameraRef = useRef<CameraView | null>(null);
  const [view, setView] = useState<Size | null>(null);
  const [torch, setTorch] = useState(false);
  const [busy, setBusy] = useState(false);
  const setPhoto = useCaptureStore((s) => s.setPhoto);

  const onLayout = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    setView({ width, height });
  };

  // the guide the user lines the receipt up with; tall because receipts are
  const guide: Rect | null = view
    ? (() => {
        const width = view.width * 0.88;
        const height = Math.min(view.height * 0.66, width * 1.45);
        return { x: (view.width - width) / 2, y: (view.height - height) / 2 - view.height * 0.04, width, height };
      })()
    : null;

  const close = () => (router.canGoBack() ? router.back() : router.replace(SCAN_ROUTES.new as never));

  const shoot = useCallback(async () => {
    if (busy || !cameraRef.current) return;
    setBusy(true);
    haptics.tap();
    try {
      const pic = await cameraRef.current.takePictureAsync({ quality: 1, skipProcessing: false });
      if (!pic?.uri) throw new Error('no photo');
      const frameCrop = view && guide ? frameToCrop({ width: pic.width, height: pic.height }, view, guide, 'cover') : null;
      setPhoto({ uri: pic.uri, width: pic.width, height: pic.height, source: 'camera', frameCrop });
      haptics.success();
      router.push(SCAN_ROUTES.preview as never);
    } catch {
      haptics.error();
      Alert.alert(t('common.error', 'Error'), t('scan.camera.captureError', 'Could not take the photo. Please try again.'));
    } finally {
      setBusy(false);
    }
  }, [busy, view, guide, router, setPhoto, t]);

  const pickGallery = useCallback(async () => {
    try {
      const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 1, allowsEditing: false });
      if (res.canceled || !res.assets?.[0]) return;
      const a = res.assets[0];
      setPhoto({ uri: a.uri, width: a.width, height: a.height, source: 'gallery', frameCrop: null });
      router.push(SCAN_ROUTES.preview as never);
    } catch {
      Alert.alert(t('common.error', 'Error'), t('scan.new.galleryError', 'Could not open the gallery'));
    }
  }, [router, setPhoto, t]);

  // ---- permission flow: explain first, ask on tap, "Open settings" once the system will not ask again
  if (!perm) {
    return (
      <View style={[styles.fill, styles.center, { backgroundColor: c.screen }]}>
        <ActivityIndicator color={c.accentText} />
      </View>
    );
  }
  if (!perm.granted) {
    const canAsk = perm.canAskAgain;
    return (
      <View style={[styles.fill, { backgroundColor: c.screen, padding: space.lg, paddingTop: insets.top + space.lg, gap: space.lg }]}>
        <Pressable onPress={close} accessibilityRole="button" accessibilityLabel={t('scan.camera.close', 'Close')} style={styles.closePlain}>
          <X size={24} color={c.text} />
        </Pressable>
        <View style={{ flex: 1, justifyContent: 'center', gap: space.lg }}>
          {canAsk ? (
            <>
              <Text accessibilityRole="header" maxFontSizeMultiplier={1.4} style={{ color: c.text, fontSize: 26, fontWeight: '800' }}>{t('scan.camera.perm.title', 'Camera access')}</Text>
              <Text maxFontSizeMultiplier={1.5} style={{ color: c.textMuted, fontSize: 16, lineHeight: 23 }}>
                {t('scan.camera.perm.explain', 'Splitter uses the camera only to photograph a receipt. The photo is sent for recognition and is not stored.')}
              </Text>
              <Button title={t('scan.camera.perm.allow', 'Allow camera')} onPress={() => void requestPerm()} />
            </>
          ) : (
            <PermissionNotice
              title={t('scan.camera.perm.deniedTitle', 'Camera access is off')}
              message={t('scan.camera.perm.deniedMessage', 'To photograph receipts, turn the camera on in Settings. You can also choose a photo from the gallery or enter the items by hand.')}
            />
          )}
          <Button variant="secondary" title={t('scan.new.gallery.title', 'Choose from gallery')} onPress={() => void pickGallery()} />
          <Button variant="secondary" title={t('scan.new.manual.title', 'Enter manually')} onPress={() => router.replace(SCAN_ROUTES.manual as never)} />
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.fill, { backgroundColor: '#000' }]}>
      <View style={styles.fill} onLayout={onLayout}>
        {focused && (
          <CameraView ref={cameraRef} style={StyleSheet.absoluteFill} facing="back" enableTorch={torch} mode="picture" />
        )}

        {guide && view && (
          <View pointerEvents="none" style={StyleSheet.absoluteFill} importantForAccessibility="no-hide-descendants">
            {/* dim everything outside the guide */}
            <View style={[styles.dim, { top: 0, left: 0, right: 0, height: guide.y }]} />
            <View style={[styles.dim, { top: guide.y + guide.height, left: 0, right: 0, bottom: 0 }]} />
            <View style={[styles.dim, { top: guide.y, left: 0, width: guide.x, height: guide.height }]} />
            <View style={[styles.dim, { top: guide.y, left: guide.x + guide.width, right: 0, height: guide.height }]} />
            {(['tl', 'tr', 'bl', 'br'] as const).map((k) => (
              <View
                key={k}
                style={{
                  position: 'absolute', width: 34, height: 34, borderColor: GUIDE,
                  top: k[0] === 't' ? guide.y : guide.y + guide.height - 34,
                  left: k[1] === 'l' ? guide.x : guide.x + guide.width - 34,
                  borderTopWidth: k[0] === 't' ? 4 : 0, borderBottomWidth: k[0] === 'b' ? 4 : 0,
                  borderLeftWidth: k[1] === 'l' ? 4 : 0, borderRightWidth: k[1] === 'r' ? 4 : 0,
                  borderTopLeftRadius: k === 'tl' ? 14 : 0, borderTopRightRadius: k === 'tr' ? 14 : 0,
                  borderBottomLeftRadius: k === 'bl' ? 14 : 0, borderBottomRightRadius: k === 'br' ? 14 : 0,
                }}
              />
            ))}
          </View>
        )}

        {/* top bar */}
        <View style={[styles.topBar, { paddingTop: insets.top + space.sm }]}>
          <Pressable onPress={close} accessibilityRole="button" accessibilityLabel={t('scan.camera.close', 'Close')} style={styles.round}>
            <X size={22} color="#FFF" />
          </Pressable>
          <Pressable
            onPress={() => { haptics.selection(); setTorch((v) => !v); }}
            accessibilityRole="switch"
            accessibilityLabel={t('scan.camera.torch', 'Flashlight')}
            accessibilityState={{ checked: torch }}
            style={[styles.round, torch && { backgroundColor: '#FFFFFF' }]}
          >
            {torch ? <Zap size={22} color="#000" /> : <ZapOff size={22} color="#FFF" />}
          </Pressable>
        </View>

        {/* hint */}
        {guide && (
          <View pointerEvents="none" style={{ position: 'absolute', left: space.lg, right: space.lg, top: Math.max(insets.top + 64, guide.y - 64), alignItems: 'center' }}>
            <Text maxFontSizeMultiplier={1.3} style={styles.hint}>{t('scan.camera.hint', 'Fit the whole receipt in the frame. Keep it flat, well lit and sharp.')}</Text>
          </View>
        )}

        {/* bottom bar */}
        <View style={[styles.bottomBar, { paddingBottom: insets.bottom + space.lg }]}>
          <Pressable onPress={() => void pickGallery()} accessibilityRole="button" accessibilityLabel={t('scan.camera.gallery', 'Choose from gallery')} style={styles.round}>
            <ImageIcon size={24} color="#FFF" />
          </Pressable>
          <Pressable
            onPress={() => void shoot()}
            disabled={busy}
            accessibilityRole="button"
            accessibilityLabel={t('scan.camera.shutter', 'Take photo')}
            accessibilityState={{ busy, disabled: busy }}
            style={({ pressed }) => [styles.shutterOuter, { opacity: busy ? 0.5 : 1 }]}
          >
            {({ pressed }) => <View style={[styles.shutterInner, { transform: [{ scale: pressed ? 0.88 : 1 }] }]} />}
          </Pressable>
          <View style={{ width: MIN_TOUCH + 8 }} />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  center: { alignItems: 'center', justifyContent: 'center' },
  dim: { position: 'absolute', backgroundColor: 'rgba(0,0,0,0.55)' },
  topBar: { position: 'absolute', top: 0, left: 0, right: 0, flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: space.lg },
  bottomBar: { position: 'absolute', bottom: 0, left: 0, right: 0, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: space.xl },
  round: { width: MIN_TOUCH + 8, height: MIN_TOUCH + 8, borderRadius: (MIN_TOUCH + 8) / 2, backgroundColor: 'rgba(0,0,0,0.55)', alignItems: 'center', justifyContent: 'center' },
  closePlain: { width: MIN_TOUCH, height: MIN_TOUCH, alignItems: 'center', justifyContent: 'center' },
  hint: { color: '#FFF', fontSize: 15, fontWeight: '600', textAlign: 'center', backgroundColor: 'rgba(0,0,0,0.6)', paddingHorizontal: 14, paddingVertical: 8, borderRadius: 14, overflow: 'hidden' },
  shutterOuter: { width: 78, height: 78, borderRadius: 39, borderWidth: 4, borderColor: '#FFF', alignItems: 'center', justifyContent: 'center' },
  shutterInner: { width: 60, height: 60, borderRadius: 30, backgroundColor: '#FFF' },
});
