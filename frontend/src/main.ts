import App from './App.svelte';

// Only register the service worker in production. In dev a controlling SW
// makes the browser cling to stale modules and fights HMR.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js');
} else if ('serviceWorker' in navigator) {
  // Tear down any SW already installed from a previous dev session.
  navigator.serviceWorker.getRegistrations().then((regs) => regs.forEach((r) => r.unregister()));
}

const app = new App({ target: document.getElementById('app')! });

export default app;
