// Runs in MAIN world (the page's own JS context).
// Handles fetches that need full YouTube session credentials (PoToken etc.).
// Communicates with content.js via window.postMessage.

window.addEventListener('message', async (e) => {
  if (e.source !== window || !e.data?._tiRequest) return;

  const { id, url } = e.data._tiRequest;

  try {
    const resp = await fetch(url);
    const text = await resp.text();
    window.postMessage({ _tiResponse: { id, text } }, '*');
  } catch (err) {
    window.postMessage({ _tiResponse: { id, text: '' } }, '*');
  }
});
