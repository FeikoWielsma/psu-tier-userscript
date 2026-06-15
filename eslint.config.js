const js = require('@eslint/js');
const globals = require('globals');

module.exports = [
  js.configs.recommended,
  {
    // High-signal correctness rules across all linted files.
    rules: {
      eqeqeq: ['error', 'smart'],
      'no-var': 'error',
      'prefer-const': 'error',
      'no-shadow': 'warn',
      'no-throw-literal': 'error'
    }
  },
  {
    // The userscript template has intentional /*__...__*/ placeholders and is
    // only valid after assembly; generated artifacts and deps are not linted.
    ignores: [
      'src/userscript.template.js',
      'psutier.user.js',
      'psu_data_var.js',
      'dist-extension/**',
      'node_modules/**'
    ]
  },
  {
    // Shared modules: run inlined in the browser AND required under Node, so
    // both sets of globals apply (module/document/location/window/...).
    files: ['src/matcher.js', 'src/adapters.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'script',
      globals: { ...globals.browser, ...globals.commonjs }
    },
    rules: {
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
      'no-empty': ['error', { allowEmptyCatch: true }]
    }
  },
  {
    files: ['tests/**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'commonjs',
      globals: { ...globals.node }
    }
  },
  {
    files: ['tools/**/*.mjs'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      // browser globals too: page.evaluate() callbacks run in the page context.
      globals: { ...globals.node, ...globals.browser }
    }
  },
  {
    files: ['eslint.config.js'],
    languageOptions: { sourceType: 'commonjs', globals: { ...globals.node } }
  }
];
