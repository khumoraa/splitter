import { useColorScheme } from 'react-native';
import { useAppStore } from '@/shared/lib/stores/app-store';
import { palettes, resolveScheme, type Palette, type Scheme } from '@/shared/ui/tokens';

/** The scheme being rendered: the user's choice, or the phone's appearance for "system". */
export function useScheme(): Scheme {
  const mode = useAppStore((s) => s.themeMode);
  const system = useColorScheme();
  return resolveScheme(mode, system);
}

export function useColors(): Palette {
  return palettes[useScheme()];
}
