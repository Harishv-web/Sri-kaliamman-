let deferredInstallPrompt = null;

const note = document.querySelector('[data-install-note]');
const installLinks = document.querySelectorAll('[data-install-link]');

window.addEventListener('beforeinstallprompt', (event) => {
  event.preventDefault();
  deferredInstallPrompt = event;
  if (note) note.textContent = 'Ready to install on this device. 🅿️';
});

window.addEventListener('appinstalled', () => {
  deferredInstallPrompt = null;
  if (note) note.textContent = 'Installed — open Sri Kaliamman Parking from your home screen. ✅';
});

installLinks.forEach((link) => {
  link.addEventListener('click', async (event) => {
    if (!deferredInstallPrompt) return;
    event.preventDefault();
    await deferredInstallPrompt.prompt();
    const { outcome } = await deferredInstallPrompt.userChoice;
    deferredInstallPrompt = null;
    if (outcome === 'accepted' && note) note.textContent = 'Installing Sri Kaliamman Parking…';
    if (outcome !== 'accepted') window.location.assign(link.href);
  });
});

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js'));
}
