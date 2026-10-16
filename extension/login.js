(() => {
  let submitted = new WeakSet();
  let recoveryRequested = false;

  document.addEventListener('submit', event => {
    const form = event.target;
    if (!(form instanceof HTMLFormElement) || form.method.toLowerCase() !== 'post') return;
    const action = new URL(form.action, location.href);
    if (action.origin !== location.origin || !action.pathname.startsWith('/idp/profile/') || !action.searchParams.has('execution')) return;
    if (submitted.has(form)) {
      event.preventDefault();
      event.stopImmediatePropagation();
      return;
    }
    submitted.add(form);
    queueMicrotask(() => { if (event.defaultPrevented) submitted.delete(form); });
    // Leave the first submission and its named submitter entirely intact.
  }, true);

  function recoverKnownFailure() {
    if (recoveryRequested || document.querySelector('#password') || !document.body) return;
    const stale = document.title === 'Stanford Login - Stale Request';
    const csrf = document.title === 'Stanford Login - Processing Error' && document.body.textContent.includes('CSRF token verification failed.');
    if (!stale && !csrf) return;
    recoveryRequested = true;
    void chrome.runtime.sendMessage({ type: 'recover-login' }).catch(() => {});
  }

  document.addEventListener('DOMContentLoaded', recoverKnownFailure, { once: true });
  window.addEventListener('pageshow', event => {
    if (event.persisted) {
      // Back/forward cache restores the old JS state along with the old form.
      submitted = new WeakSet();
      recoveryRequested = false;
    }
    recoverKnownFailure();
  });
  if (document.readyState !== 'loading') recoverKnownFailure();
})();
