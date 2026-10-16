export const LOGIN_HOST = 'login.stanford.edu';
export const RETRY_WINDOW_MS = 60_000;
export const MAX_RECOVERIES = 2;

function parse(raw) {
  try { return new URL(raw); } catch { return null; }
}

export function isLoginURL(raw) {
  const url = parse(raw);
  return url?.protocol === 'https:' && url.hostname === LOGIN_HOST && url.pathname.startsWith('/idp/profile/');
}

// Revisit a service URL to obtain a new authentication request. Never replay
// an IdP execution URL, an assertion, an OAuth callback, or a POST callback.
export function serviceDestination(raw) {
  const url = parse(raw);
  if (!url || url.protocol !== 'https:' || url.username || url.password) return null;
  if (url.hostname !== 'stanford.edu' && !url.hostname.endsWith('.stanford.edu')) return null;
  if (url.hostname === LOGIN_HOST || url.hostname === 'login-assets.stanford.edu') return null;
  if (/\/(?:SAML2\/(?:POST|Artifact)|acs|oauth2?\/callback|callback)\/?$/i.test(url.pathname)) return null;
  const forbidden = new Set(['samlrequest', 'samlresponse', 'relaystate', 'execution', 'csrf_token', 'code', 'access_token', 'id_token', 'password', 'ticket']);
  if ([...url.searchParams.keys()].some(key => forbidden.has(key.toLowerCase()))) return null;
  return url.href;
}

export function nextRecovery(state, now) {
  if (!state?.destination || !serviceDestination(state.destination)) return null;
  const recent = (state.recoveryTimes ?? []).filter(time => time > now - RETRY_WINDOW_MS);
  if (recent.length >= MAX_RECOVERIES) return null;
  return { ...state, recoveryTimes: [...recent, now] };
}
