import React, { useEffect, useState } from 'react';
import { AccessibilityInfo, Platform, View, type StyleProp, type ViewStyle } from 'react-native';
import { BlurView } from 'expo-blur';
import { GlassView, isLiquidGlassAvailable } from 'expo-glass-effect';
import { useColors, useScheme } from '@/shared/lib/theme/use-colors';
import { veil } from './glass';

/** "Reduce Transparency" in the phone's accessibility settings: glass becomes a solid surface. */
export function useReduceTransparency(): boolean {
  const [on, setOn] = useState(false);
  useEffect(() => {
    let alive = true;
    void AccessibilityInfo.isReduceTransparencyEnabled().then((v) => alive && setOn(v)).catch(() => {});
    const sub = AccessibilityInfo.addEventListener('reduceTransparencyChanged', setOn);
    return () => { alive = false; sub.remove(); };
  }, []);
  return on;
}

let liquid: boolean | null = null;
/** iOS 26 Liquid Glass (expo-glass-effect); false on older iOS, Android, or if the native module is missing. */
export function liquidGlassAvailable(): boolean {
  if (liquid !== null) return liquid;
  try {
    liquid = Platform.OS === 'ios' && isLiquidGlassAvailable();
  } catch {
    liquid = false;
  }
  return liquid;
}

/**
 * A glass panel for a FEW floating elements (action bar, summary header). Liquid Glass where available, otherwise the
 * system chrome blur; a solid surface with "Reduce Transparency" or on Android. A veil keeps text at WCAG AA (glass.ts).
 */
export function GlassSurface({ children, style, radius = 20 }: { children: React.ReactNode; style?: StyleProp<ViewStyle>; radius?: number }) {
  const c = useColors();
  const scheme = useScheme();
  const reduce = useReduceTransparency();
  const base: ViewStyle = { borderRadius: radius, overflow: 'hidden', borderWidth: 1, borderColor: c.border };

  if (reduce || Platform.OS !== 'ios') {
    return <View style={[base, { backgroundColor: c.surface }, style]}>{children}</View>;
  }
  if (liquidGlassAvailable()) {
    return (
      <GlassView glassEffectStyle="regular" style={[base, style]}>
        {/* same veil as the blur path: the contrast guarantee (glass.test.mjs) does not depend on what is behind */}
        <View style={{ backgroundColor: veil(c.surface) }}>{children}</View>
      </GlassView>
    );
  }
  return (
    <BlurView intensity={80} tint={scheme === 'dark' ? 'systemChromeMaterialDark' : 'systemChromeMaterialLight'} style={[base, style]}>
      <View style={{ backgroundColor: veil(c.surface) }}>{children}</View>
    </BlurView>
  );
}
