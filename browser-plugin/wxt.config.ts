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
    name: 'Transparent Input Experimental',
    description: 'Overlays vocab cards on YouTube videos using Transparent Input data',
    version: '1.0.1',
    permissions: ['storage'],
    host_permissions: [
      // localhost only in dev — store builds reject it
      ...(mode === 'development' ? ['http://localhost:8000/*'] : ['https://161.35.205.56/*']),
      'https://api.openai.com/*',
      'https://generativelanguage.googleapis.com/*',
    ],
    ...(browser === 'firefox' && {
      browser_specific_settings: {
        gecko: {
          id: 'transparent-input-personal@koljasam.com',
          strict_min_version: '140.0',
          data_collection_permissions: {
            // Subtitle text is sent to OpenAI/Gemini using the user's own API key
            required: ['websiteContent'],
          },
        },
      },
    }),
  }),
});
