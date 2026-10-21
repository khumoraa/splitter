// src/application/providers/TamaguiProvider.tsx
import React, { useEffect } from 'react'
import { Appearance } from 'react-native'
import { StatusBar } from 'expo-status-bar'
import * as SystemUI from 'expo-system-ui'
import { TamaguiProvider as Provider, Theme } from '@tamagui/core'
import { PortalProvider } from '@tamagui/portal'
import { useFonts } from 'expo-font'
import config from '../../../tamagui.config'
import { useAppStore } from '@/shared/lib/stores/app-store'
import { useScheme } from '@/shared/lib/theme/use-colors'
import { palettes } from '@/shared/ui/tokens'

interface TamaguiProviderProps {
  children: React.ReactNode
}

export const TamaguiProvider: React.FC<TamaguiProviderProps> = ({ children }) => {
  const [fontsLoaded] = useFonts({
    Inter: require('@tamagui/font-inter/otf/Inter-Medium.otf'),
    InterBold: require('@tamagui/font-inter/otf/Inter-Bold.otf'),
  })
  const mode = useAppStore((s) => s.themeMode)
  const scheme = useScheme()

  // Make native pieces (alerts, keyboard, scroll indicators) follow an explicit choice; 'unspecified' = back to the phone's setting.
  useEffect(() => {
    Appearance.setColorScheme(mode === 'system' ? 'unspecified' : mode)
  }, [mode])

  // Android root view / overscroll colour, so a dark screen never flashes white
  useEffect(() => {
    void SystemUI.setBackgroundColorAsync(palettes[scheme].screen).catch(() => {})
  }, [scheme])

  if (!fontsLoaded) {
    return null
  }

  return (
    <Provider config={config} defaultTheme={scheme}>
      <Theme name={scheme}>
        <PortalProvider>
          <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />
          {children}
        </PortalProvider>
      </Theme>
    </Provider>
  )
}
