import test from 'node:test';
import assert from 'node:assert/strict';
import { isLoginURL, serviceDestination, nextRecovery } from '../extension/navigation.js';

test('recovery preserves protected Stanford destinations, including deep links', () => {
  const destination = 'https://canvas.stanford.edu/courses/123/assignments/456?view=student#details';
  assert.equal(serviceDestination(destination), destination);
  assert.equal(serviceDestination('https://axess.sahr.stanford.edu/'), 'https://axess.sahr.stanford.edu/');
});

test('recovery rejects lookalike hosts, credentials, login state and authentication callbacks', () => {
  for (const destination of [
    'https://stanford.edu.example.com/',
    'https://evilstanford.edu/',
    'http://canvas.stanford.edu/',
    'https://user:password@canvas.stanford.edu/',
    'https://login.stanford.edu/idp/profile/SAML2/Redirect/SSO?execution=e1s2',
    'https://canvas.stanford.edu/login?SAMLResponse=assertion',
    'https://canvas.stanford.edu/login?SAMLRequest=request',
    'https://canvas.stanford.edu/login?CODE=one-time-code',
    'https://canvas.stanford.edu/Shibboleth.sso/SAML2/POST',
    'javascript:alert(1)',
  ]) assert.equal(serviceDestination(destination), null, destination);
});

test('only the actual Stanford IdP profile may request recovery', () => {
  assert.equal(isLoginURL('https://login.stanford.edu/idp/profile/SAML2/Redirect/SSO?execution=e1s2'), true);
  assert.equal(isLoginURL('https://login.stanford.edu/help'), false);
  assert.equal(isLoginURL('https://login.stanford.edu.evil.example/idp/profile/'), false);
});

test('automatic recovery has a sliding limit and does not reset on navigation', () => {
  const now = 1_000_000;
  const initial = { destination: 'https://canvas.stanford.edu/login/1' };
  const first = nextRecovery(initial, now);
  const second = nextRecovery(first, now + 1000);
  assert.equal(nextRecovery(second, now + 2000), null);
  assert.equal(nextRecovery(second, now + 60_001).recoveryTimes.length, 2);
  assert.equal(initial.recoveryTimes, undefined);
  assert.equal(nextRecovery(undefined, now), null);
  assert.equal(nextRecovery({ destination: 'https://example.com/' }, now), null);
});
