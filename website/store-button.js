async function updateStoreLabel() {
  const label = document.querySelector('.store-label');
  if (!label) return;

  const brands = navigator.userAgentData?.brands.map(({ brand }) => brand) ?? [];
  const userAgent = navigator.userAgent;
  // Mobile browser names don't imply support for desktop Chrome extensions.
  if (navigator.userAgentData?.mobile || /Android|iPhone|iPad/.test(userAgent)) return;

  let browser = 'Chrome';
  if (brands.includes('Vivaldi') || /\bVivaldi\//.test(userAgent)) browser = 'Vivaldi';
  else if (brands.includes('Microsoft Edge') || /\bEdg\//.test(userAgent)) browser = 'Edge';
  else if (brands.includes('Opera') || /\bOPR\//.test(userAgent)) browser = 'Opera';
  else if (brands.includes('Brave')) browser = 'Brave';
  else if (typeof navigator.brave?.isBrave === 'function') {
    try {
      if (await navigator.brave.isBrave()) browser = 'Brave';
    } catch {
      // Keep the default label if the browser's privacy settings hide its name.
    }
  }

  label.textContent = `Add to ${browser}`;
}

void updateStoreLabel();
