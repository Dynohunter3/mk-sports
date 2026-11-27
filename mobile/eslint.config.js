// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');
const globals = require('globals');

module.exports = defineConfig([
  expoConfig,
  {
    ignores: ['dist/*', 'android/*', 'ios/*', 'web-build/*', 'node_modules/*'],
  },
  {
    rules: {
      // The app does not use the React Compiler. These three rules are its advice for compiled code; they flag
      // React Native's usual patterns (`useRef(new Animated.Value(0)).current`, a loading flag set at the start
      // of a fetch effect, `Date.now()` for "starts in" labels), not bugs. rules-of-hooks and exhaustive-deps stay on.
      'react-hooks/refs': 'off',
      'react-hooks/set-state-in-effect': 'off',
      'react-hooks/purity': 'off',
      // apostrophes in <Text> render as typed in React Native
      'react/no-unescaped-entities': 'off',
      // TypeScript already checks named imports, and this rule cannot see enums re-exported by expo-notifications
      'import/namespace': 'off',
      // `cond && doThing()` and `cond ? a() : b()` as statements
      'no-unused-expressions': ['warn', { allowShortCircuit: true, allowTernary: true }],
      'react-hooks/exhaustive-deps': 'error',
    },
  },
  {
    files: ['scripts/**/*.js'],
    languageOptions: { globals: globals.node },
  },
]);
