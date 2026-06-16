import App from './App.svelte';

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js');
}

const app = new App({ target: document.getElementById('app')! });

export default app;
