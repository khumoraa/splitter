module.exports = function (api) {
  api.cache(true);
  
  const isProduction = process.env.NODE_ENV === 'production';
  
  return {
    presets: ['babel-preset-expo'],
    plugins: [
      // removed deprecated 'expo-router/babel' (use 'babel-preset-expo' in SDK 50+)
      // Отключаем Tamagui babel plugin для production сборки
      // Это уберет оптимизацию, но решит проблему со сборкой
      ...(!isProduction ? [
        [
          '@tamagui/babel-plugin',
          {
            components: ['tamagui'],
            config: './tamagui.config.ts',
            logTimings: true,
            disableExtraction: true
          }
        ]
      ] : []),
      [
        'module-resolver',
        {
          root: ['./'],
          alias: {
            '@': './src'
          },
          extensions: ['.ts', '.tsx', '.js', '.jsx', '.json']
        }
      ],
      // 'react-native-reanimated/plugin' removed: babel-preset-expo (SDK 54+) adds react-native-worklets/plugin
      // automatically when it is installed, so listing it here would apply the same transform twice.
    ]
  };
};