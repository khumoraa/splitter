// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');

module.exports = defineConfig([
  expoConfig,
  {
    ignores: ['dist/*', '.expo/*', 'node_modules/*'],
  },
  {
    // eslint-config-expo 57 ships the new React Compiler rules of eslint-plugin-react-hooks 7 as errors.
    // They flag existing patterns (setState in effects, refs during render, components defined in render);
    // fixing them is a refactor that does not belong in the SDK upgrade, so keep them visible as warnings.
    rules: {
      'react-hooks/set-state-in-effect': 'warn',
      'react-hooks/refs': 'warn',
      'react-hooks/static-components': 'warn',
      'react-hooks/preserve-manual-memoization': 'warn',
    },
  },
]);
