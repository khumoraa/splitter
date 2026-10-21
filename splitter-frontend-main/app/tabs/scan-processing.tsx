import React, { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { ActivityIndicator, BackHandler, Text, View } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, Check, ScanLine } from '@tamagui/lucide-icons';

import { isApiError, isCancelled } from '@/shared/api/api-error';
import { useAppStore } from '@/shared/lib/stores/app-store';
import { useColors } from '@/shared/lib/theme/use-colors';
import { haptics } from '@/shared/lib/haptics';
import { space } from '@/shared/ui/tokens';
import { Button, useReduceMotion } from '@/features/profile/ui/kit';
import { ScanApi } from '@/features/scan/api/scan.api';
import { useCaptureStore } from '@/features/scan/model/capture.store';
import { useDraftStore } from '@/features/scan/model/draft.store';
import { draftFromScan, emptyDraft } from '@/features/scan/lib/receipt-calc';
import { describeScanFailure, type ScanErrorInfo } from '@/features/scan/lib/scan-errors';
import { initialScanFlow, scanFlowReducer, stepIndex } from '@/features/scan/lib/scan-flow';
import { makeId } from '@/features/scan/lib/ids';
import { SCAN_ROUTES } from '@/features/scan/lib/routes';

const STEPS = ['uploading', 'reading', 'checking'] as const;
const SLOW_AFTER_MS = 20_000;

function Pulse({ children }: { children: React.ReactNode }) {
  const reduce = useReduceMotion();
  const s = useSharedValue(1);
  useEffect(() => {
    if (reduce) { s.value = 1; return; }
    s.value = withRepeat(withTiming(1.12, { duration: 900, easing: Easing.inOut(Easing.ease) }), -1, true);
  }, [reduce, s]);
  const style = useAnimatedStyle(() => ({ transform: [{ scale: s.value }] }));
  return <Animated.View style={style}>{children}</Animated.View>;
}

export default function ScanProcessingScreen() {
  const { t } = useTranslation();
  const c = useColors();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const language = useAppStore((s) => s.language) || 'en';
  const defaultCurrency = useAppStore((s) => s.defaultCurrency);
  const locale = language;
  const setPrepared = useCaptureStore((s) => s.setPrepared);
  const setDraft = useDraftStore((s) => s.setDraft);

  const [flow, dispatch] = useReducer(scanFlowReducer, initialScanFlow);
  const [info, setInfo] = useState<ScanErrorInfo | null>(null);
  const [resetAt, setResetAt] = useState<string | null>(null);
  const ctrlRef = useRef<AbortController | null>(null);
  const phaseRef = useRef(flow.phase);
  useEffect(() => {
    phaseRef.current = flow.phase;
  }, [flow.phase]);
  const started = useRef(false);

  const run = useCallback(async () => {
    const p = useCaptureStore.getState().prepared;
    if (!p) {
      setInfo({ key: 'scan.errors.unknown', action: 'retake', code: 'UNKNOWN' });
      dispatch({ type: 'START' });
      dispatch({ type: 'FAIL', code: 'UNKNOWN' });
      return;
    }
    dispatch({ type: 'RESET' });
    dispatch({ type: 'START' });
    setInfo(null);
    const ctrl = new AbortController();
    ctrlRef.current = ctrl;
    const slowTimer = setTimeout(() => dispatch({ type: 'SLOW' }), SLOW_AFTER_MS);
    // a ~200 KB upload is quick; if the progress callback never fires, still move to "reading"
    const readTimer = setTimeout(() => dispatch({ type: 'UPLOADED' }), 1500);
    try {
      const res = await ScanApi.scan(
        { imageBase64: p.base64, mimeType: 'image/jpeg', language, currency: defaultCurrency },
        { signal: ctrl.signal, idempotencyKey: p.idempotencyKey, onUploaded: () => dispatch({ type: 'UPLOADED' }) }
      );
      if (ctrl.signal.aborted) return;
      dispatch({ type: 'RESPONSE_OK' });
      const draft = draftFromScan(res.receipt, defaultCurrency, makeId);
      if (res.cached) draft.fromCache = true;
      setDraft(draft);
      setPrepared(null);
      haptics.success();
      setTimeout(() => {
        dispatch({ type: 'FINISHED' });
        router.replace(SCAN_ROUTES.review as never);
      }, 450);
    } catch (e) {
      if (ctrl.signal.aborted || isCancelled(e)) return;
      const failure = isApiError(e)
        ? { kind: e.kind, status: e.status, code: e.code, details: e.details }
        : { kind: 'unknown' as const };
      const d = describeScanFailure(failure);
      // expected outcomes (limit, not a receipt, offline) are warnings, not crashes
      console.warn('[scan] recognition failed:', d.code);
      const when = (failure as { details?: { resetAt?: unknown } }).details?.resetAt;
      setResetAt(typeof when === 'string' ? when : null);
      setInfo(d);
      haptics.error();
      dispatch({ type: 'FAIL', code: d.code });
    } finally {
      clearTimeout(slowTimer);
      clearTimeout(readTimer);
    }
  }, [defaultCurrency, language, router, setDraft, setPrepared]);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void run();
    return () => {
      // leaving while a request is running (not via Cancel) must not leave it dangling
      if (['uploading', 'reading', 'checking'].includes(phaseRef.current)) ctrlRef.current?.abort();
    };
  }, [run]);

  const cancel = useCallback(() => {
    ctrlRef.current?.abort();
    dispatch({ type: 'CANCEL' });
    setPrepared(null);
    haptics.tap();
    router.replace(SCAN_ROUTES.new as never);
  }, [router, setPrepared]);

  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (['uploading', 'reading', 'checking'].includes(phaseRef.current)) cancel();
      else router.replace(SCAN_ROUTES.new as never);
      return true;
    });
    return () => sub.remove();
  }, [cancel, router]);

  const toManual = () => {
    setPrepared(null);
    setDraft(emptyDraft(defaultCurrency, 'manual'));
    router.replace(SCAN_ROUTES.manual as never);
  };
  const toStart = () => {
    setPrepared(null);
    router.replace(SCAN_ROUTES.new as never);
  };

  // ------------------------------------------------------------ error state
  if (flow.phase === 'error' && info) {
    const message =
      info.code === 'QUOTA_EXCEEDED' && !resetAt
        ? t('scan.errors.quotaNoTime', 'You have used all recognitions for now. Entering items by hand is free.')
        : t(info.key, {
            when: resetAt ? new Date(resetAt).toLocaleString(locale, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '',
            defaultValue: 'Something went wrong. Please try again.',
          });
    return (
      <View style={{ flex: 1, backgroundColor: c.screen, padding: space.lg, paddingTop: insets.top + space.xl, paddingBottom: insets.bottom + space.lg, gap: space.lg, justifyContent: 'center' }}>
        <View style={{ alignItems: 'center', gap: space.md }} accessibilityRole="alert">
          <AlertTriangle size={44} color={c.danger} />
          <Text accessibilityRole="header" maxFontSizeMultiplier={1.4} style={{ color: c.text, fontSize: 22, fontWeight: '800', textAlign: 'center' }}>{t('scan.errors.title', "Couldn't read the receipt")}</Text>
          <Text maxFontSizeMultiplier={1.5} style={{ color: c.textMuted, fontSize: 16, lineHeight: 23, textAlign: 'center' }}>{message}</Text>
        </View>
        <View style={{ gap: space.md }}>
          {info.action === 'retry' && <Button title={t('scan.errors.retry', 'Try again')} onPress={() => void run()} />}
          {info.action === 'retake' && <Button title={t('scan.errors.retake', 'Try another photo')} onPress={toStart} />}
          <Button variant={info.action === 'none' ? 'primary' : 'secondary'} title={t('scan.new.manual.title', 'Enter manually')} onPress={toManual} />
          {info.action !== 'retake' && <Button variant="secondary" title={t('scan.errors.back', 'Back')} onPress={toStart} />}
        </View>
      </View>
    );
  }

  // ------------------------------------------------------------ working state
  const current = stepIndex(flow.phase);
  return (
    <View style={{ flex: 1, backgroundColor: c.screen, padding: space.lg, paddingTop: insets.top + space.xl, paddingBottom: insets.bottom + space.lg, justifyContent: 'space-between' }}>
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: space.xl }}>
        <Pulse>
          <View importantForAccessibility="no-hide-descendants" style={{ width: 96, height: 96, borderRadius: 48, backgroundColor: c.accentSurface, alignItems: 'center', justifyContent: 'center' }}>
            <ScanLine size={44} color={c.accentText} />
          </View>
        </Pulse>
        <Text accessibilityRole="header" maxFontSizeMultiplier={1.4} style={{ color: c.text, fontSize: 24, fontWeight: '800', textAlign: 'center' }}>{t('scan.processing.title', 'Recognising your receipt')}</Text>

        <View accessibilityLiveRegion="polite" style={{ alignSelf: 'stretch', gap: space.md }}>
          {STEPS.map((step, i) => {
            const state = i < current ? 'done' : i === current ? 'active' : 'pending';
            const label = t(`scan.processing.step.${step}`, step);
            return (
              <View key={step} accessible accessibilityLabel={`${label}: ${t(`scan.processing.state.${state}`, state)}`} style={{ flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: 36 }}>
                <View style={{ width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: state === 'done' ? c.accentFill : 'transparent', borderWidth: state === 'done' ? 0 : 2, borderColor: state === 'active' ? c.accentText : c.border }}>
                  {state === 'done' ? <Check size={16} color={c.onAccent} /> : state === 'active' ? <ActivityIndicator size="small" color={c.accentText} /> : null}
                </View>
                <Text maxFontSizeMultiplier={1.5} style={{ color: state === 'pending' ? c.textMuted : c.text, fontSize: 17, fontWeight: state === 'active' ? '700' : '500' }}>{label}</Text>
              </View>
            );
          })}
        </View>

        {flow.slow && (
          <Text accessibilityRole="alert" maxFontSizeMultiplier={1.5} style={{ color: c.textMuted, fontSize: 15, lineHeight: 21, textAlign: 'center' }}>
            {t('scan.processing.slow', 'This is taking longer than usual. You can keep waiting or cancel.')}
          </Text>
        )}
      </View>

      <View style={{ gap: space.md }}>
        <Text maxFontSizeMultiplier={1.5} style={{ color: c.textMuted, fontSize: 13, textAlign: 'center' }}>{t('scan.processing.privacy', 'The photo is not stored.')}</Text>
        <Button variant="secondary" title={t('scan.processing.cancel', 'Cancel')} onPress={cancel} />
      </View>
    </View>
  );
}
