export default defineBackground(() => {
  browser.runtime.onMessage.addListener((message) => {
    if (message === 'openOptionsPage') {
      browser.runtime.openOptionsPage();
    }
  });
});
