if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js').catch(() => {
    // The app remains usable online if a browser blocks service workers.
  });
}
