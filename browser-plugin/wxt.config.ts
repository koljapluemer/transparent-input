import { defineConfig } from 'wxt';

export default defineConfig({
  modules: ['@wxt-dev/module-vue'],
  browser: 'firefox',
  runner: {
    binaries: {
      firefox: '/usr/bin/firefox-devedition',
    },
  },
  manifest: ({ mode, browser }) => ({
    name: 'Transparent Input Vocab Overlay',
    description: 'Overlays vocab cards on YouTube videos using Transparent Input data',
    version: '1.0.0',
    permissions: ['storage'],
    host_permissions: [
      // localhost only in dev — store builds reject it
      ...(mode === 'development' ? ['http://localhost:8000/*'] : []),
      'https://api.openai.com/*',
      'https://generativelanguage.googleapis.com/*',
    ],
    ...(browser === 'firefox' && {
      browser_specific_settings: {
        gecko: {
          // TODO: replace with your real extension ID before first AMO submission
          id: 'transparent-input@transparent-input.app',
          strict_min_version: '109.0',
        },
      },
    }),
  }),
});
