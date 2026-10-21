const { getDefaultConfig } = require('expo/metro-config');

// Default Expo config. (A leftover Tamagui block mapped '@tamagui/core' -> '@tamagui/core' and
// '@tamagui/config' -> '@tamagui/config', i.e. aliases to themselves; it was a no-op and was removed.)
module.exports = getDefaultConfig(__dirname);
