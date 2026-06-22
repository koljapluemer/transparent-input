// Runs in the page's MAIN world. Acts as a fetch proxy for content.js if needed.
// Currently unused — the ANDROID Innertube client trick bypasses PoToken without this.
// Kept as infrastructure in case a credentialed fetch from the page context is needed later.
export default defineContentScript({
  matches: ['*://www.youtube.com/*'],
  world: 'MAIN',
  runAt: 'document_idle',
  main() {
    window.addEventListener('message', (e: MessageEvent) => {
      if (!e.data?._tiRequest) return;
      const { id, url } = e.data._tiRequest as { id: string; url: string };
      fetch(url)
        .then(r => r.text())
        .then(text => window.postMessage({ _tiResponse: { id, text } }, '*'))
        .catch(() => window.postMessage({ _tiResponse: { id, text: '' } }, '*'));
    });
  },
});
