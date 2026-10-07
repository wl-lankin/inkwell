// Apply the saved theme before first paint to avoid a flash.
try {
  const t = localStorage.getItem('inkwell.theme');
  if (t === 'light' || t === 'dark') document.documentElement.dataset.theme = t;
  if (window.inkwellNative) document.documentElement.classList.add('native');
  if (window.inkwellNative && window.inkwellNative.platform === 'darwin') document.documentElement.classList.add('mac');
} catch (e) { /* storage unavailable */ }
