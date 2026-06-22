import { defineConfig } from 'wxt';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  modules: ['@wxt-dev/module-vue'],
  vite: () => ({
    plugins: [tailwindcss()],
  }),
  browser: 'firefox',
  runner: {
    binaries: {
      firefox: '/usr/bin/firefox-devedition',
    },
  },
  manifest: {
    name: 'Transparent Input Vocab Overlay',
    description: 'Overlays vocab cards on YouTube videos using Transparent Input data',
    version: '1.0.0',
    permissions: ['storage'],
    host_permissions: [
      'http://localhost:8000/*',
      'https://api.openai.com/*',
      'https://generativelanguage.googleapis.com/*',
    ],
  },
});
