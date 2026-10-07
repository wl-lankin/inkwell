// Apply the saved theme before first paint to avoid a flash.
try {
  const t = localStorage.getItem('inkwell.theme');
  if (t === 'light' || t === 'dark') document.documentElement.dataset.theme = t;
  if (window.inkwellNative) document.documentElement.classList.add('native');
} catch (e) { /* storage unavailable */ }
