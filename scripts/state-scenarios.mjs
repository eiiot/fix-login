import { execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';

const entry = 'https://canvas.stanford.edu/login/1';
const extensionPath = process.env.STANFORD_EXTENSION_PATH;
const output = path.resolve(import.meta.dirname, '../evidence', `${extensionPath ? 'extension-' : ''}state-scenarios-${Date.now()}`);
await mkdir(output, { recursive: true });

function duplicateTabOrder(b, first) {
  const originalURL = b.url();
  const token = b.evaluate('document.querySelector("input[name=csrf_token]").value');
  b.run('tab', 'new', '--label', 'copy', originalURL); b.wait(); b.record('copy-rendered');
  const copyToken = b.evaluate('document.querySelector("input[name=csrf_token]").value');
  b.facts.csrfTokenChangedOnSecondRender = !!token && !!copyToken && token !== copyToken;
  b.facts.sameExecutionKeyAcrossTabs = originalURL === b.url();
  b.run('tab', first); b.submit(); b.record(`first-submission-from-${first}`);
  const second = first === 't1' ? 'copy' : 't1';
  b.run('tab', second); b.submit(); b.record(`second-submission-from-${second}`);
}

function safeURL(raw) {
  const url = new URL(raw);
  const execution = url.searchParams.get('execution');
  const queryKeys = [...new Set(url.searchParams.keys())];
  url.search = '';
  url.hash = '';
  return { url: url.href, execution, queryKeys };
}

const scenarios = {
  'refresh-current-form': b => { b.run('reload'); b.wait(); b.record('refresh'); },
  'two-sequential-current-submits': b => { b.submit(); b.record('first-submit'); b.submit(); b.record('second-submit-current-form'); },
  'get-old-step-after-submit': b => { const old = b.url(); b.submit(); b.record('advanced'); b.run('open', old); b.wait(); b.record('GET-old-step'); },
  'back-after-submit': b => { b.submit(); b.record('advanced'); b.run('back'); b.wait(); b.record('back'); },
  'back-then-submit': b => { b.submit(); b.record('advanced'); b.run('back'); b.wait(); b.record('back'); b.submit(); b.record('submit-restored-old-form'); },
  'duplicate-tab-before-advance': b => { b.run('tab', 'new', '--label', 'copy', b.url()); b.wait(); b.record('same-step-in-second-tab'); },
  'duplicate-tab-submit-original-first': b => duplicateTabOrder(b, 't1'),
  'duplicate-tab-submit-copy-first': b => duplicateTabOrder(b, 'copy'),
  'duplicate-tab-with-opener': b => {
    b.evaluate('window.open(location.href, "_blank"); true');
    b.run('tab', 't2'); b.wait(); b.record('copy-with-opener');
    b.submit(); b.record('copy-advanced');
    b.run('tab', 't1'); b.submit(); b.record('original-old-form');
  },
  'background-get-then-submit': b => {
    b.facts.backgroundFetch = b.evaluate(`(async () => {
      const key = location.href;
      const original = document.querySelector('input[name=csrf_token]').value;
      const response = await fetch(key, { credentials: 'same-origin', cache: 'no-store' });
      const page = new DOMParser().parseFromString(await response.text(), 'text/html');
      const next = page.querySelector('input[name=csrf_token]')?.value;
      return { status: response.status, sameExecutionURL: key === response.url, visibleURLUnchanged: key === location.href, originalDOMTokenUnchanged: original === document.querySelector('input[name=csrf_token]').value, tokenChangedOnBackgroundRender: !!next && original !== next };
    })()`);
    b.record('visible-form-after-background-GET'); b.submit(); b.record('single-submit-after-background-GET');
  },
  'independent-login-tabs': b => {
    b.run('tab', 'new', '--label', 'independent', entry); b.wait(); b.record('independent-flow');
    b.run('tab', 't1'); b.submit(); b.record('first-flow-advanced');
    b.run('tab', 'independent'); b.submit(); b.record('second-flow-submitted');
  },
  'lose-jsessionid-then-refresh': b => {
    const cookies = JSON.parse(b.run('cookies', 'get', '--json')).data.cookies;
    const sessionCookies = cookies.filter(c => c.name.endsWith('JSESSIONID') && c.domain === 'login.stanford.edu');
    if (!sessionCookies.length) throw new Error('No Stanford JSESSIONID found to test.');
    b.facts.deletedCookieMetadata = sessionCookies.map(({ name, domain, path }) => ({ name, domain, path }));
    for (const c of sessionCookies) b.run('cookies', 'set', c.name, 'expired-probe', '--url', 'https://login.stanford.edu/', '--path', c.path, '--secure', '--httpOnly', '--expires', '1');
    const remaining = JSON.parse(b.run('cookies', 'get', '--json')).data.cookies;
    b.facts.jsessionidRemoved = !remaining.some(c => c.name.endsWith('JSESSIONID') && c.domain === 'login.stanford.edu');
    if (!b.facts.jsessionidRemoved) throw new Error('Cookie removal failed.');
    b.run('reload'); b.wait(); b.record('refresh-without-original-session');
  },
  'clear-cookies-then-submit': b => { b.run('cookies', 'clear'); b.submit(); b.record('submit-without-session'); },
  'replay-original-saml-request': b => {
    const requests = JSON.parse(b.run('network', 'requests', '--type', 'document', '--json')).data.requests;
    const request = requests.find(r => new URL(r.url).host === 'login.stanford.edu' && new URL(r.url).searchParams.has('SAMLRequest'));
    if (!request) throw new Error('Initial SAML redirect not found.');
    b.run('network', 'requests', '--clear');
    b.run('open', request.url); b.wait(); b.record('replayed-SAML-request');
  },
  'many-independent-flows': b => {
    const old = b.url();
    for (let n = 1; n <= 6; n++) { b.run('open', entry); b.wait(); b.record(`new-flow-${n}`); }
    b.run('open', old); b.wait(); b.record('oldest-flow-after-six-new-flows');
  },
  'flow-eviction-boundary': b => {
    const old = b.url();
    const getCookie = () => JSON.parse(b.run('cookies', 'get', '--json')).data.cookies.find(c => c.name.endsWith('JSESSIONID') && c.domain === 'login.stanford.edu')?.value;
    const originalSession = getCookie();
    for (let n = 1; n <= 6; n++) {
      b.run('open', entry); b.wait(); b.record(`new-flow-${n}`);
      b.run('open', old); b.wait(); b.record(`oldest-flow-after-${n}-new-flows`);
      if (b.evaluate('document.title === "Stanford Login - Stale Request"')) { b.facts.firstFailureAfterNewFlows = n; break; }
    }
    b.facts.sameSessionCookieThroughout = !!originalSession && originalSession === getCookie();
  },
  'recovery-budget': b => {
    const old = b.url(); b.submit(); b.record('advanced');
    for (let n = 1; n <= 3; n++) {
      b.run('open', old); b.wait(); b.record(`failure-${n}`, n === 3);
    }
  },
  'unknown-destination': b => {
    b.record('error-in-fresh-browser-without-service-context', true);
  },
};

const chosen = process.argv.slice(2);
for (const name of chosen) if (!scenarios[name]) throw new Error(`Unknown scenario: ${name}. Choose from ${Object.keys(scenarios).join(', ')}`);
const summary = [];
for (const name of chosen.length ? chosen : Object.keys(scenarios)) {
  const session = `stanford-state-${randomUUID().slice(0, 8)}`;
  const report = { scenario: name, extensionEnabled: !!extensionPath, recordedAt: new Date().toISOString(), steps: [], facts: {} };
  const run = (...args) => execFileSync('agent-browser', ['--session', session, ...args], { encoding: 'utf8', timeout: 40000 }).trim();
  const evaluate = expression => JSON.parse(execFileSync('agent-browser', ['--session', session, 'eval', '--stdin'], { input: expression, encoding: 'utf8', timeout: 30000 }));
  const wait = () => {
    run('wait', '--url', '**login.stanford.edu/idp/profile/**');
    run('wait', '--fn', 'document.readyState === "complete" && document.title.startsWith("Stanford Login")');
  };
  const url = () => run('get', 'url');
  const record = (label, allowError = false) => {
    const inspect = () => evaluate('({title:document.title,url:location.href,text:document.body.innerText,hasLoginForm:!!document.querySelector("#password")})');
    let page = inspect();
    let recoveredFromTitle;
    if (extensionPath && !allowError && !page.hasLoginForm) {
      recoveredFromTitle = page.title;
      run('wait', '--fn', '!!document.querySelector("#password")');
      page = inspect();
    }
    report.steps.push({ label, recoveredFromTitle, ...page, ...safeURL(page.url), staleRequest: page.title === 'Stanford Login - Stale Request' });
  };
  const submit = () => {
    const blank = evaluate('!!document.querySelector("#username") && !!document.querySelector("#password") && !document.querySelector("#username").value && !document.querySelector("#password").value');
    if (!blank) throw new Error('Probe requires an empty Stanford credential form.');
    const old = url();
    run('click', 'input[type=submit][name=_eventId_proceed]');
    run('wait', '--fn', `(location.href !== ${JSON.stringify(old)} || !document.querySelector("#password")) && document.readyState === "complete"`);
    wait();
  };
  try {
    const initialURL = name === 'unknown-destination' ? 'https://login.stanford.edu/idp/profile/SAML2/Redirect/SSO?execution=e1s2' : entry;
    run('--headed', 'false', ...(extensionPath ? ['--extension', extensionPath] : []), 'open', initialURL); wait();
    if (name !== 'unknown-destination') run('wait', '--fn', '!!document.querySelector("#username") && !!document.querySelector("#password")');
    record('initial', name === 'unknown-destination');
    // Preserve initial requests only for the SAML-replay scenario; sanitize before writing.
    if (name !== 'replay-original-saml-request') run('network', 'requests', '--clear');
    scenarios[name]({ run, evaluate, wait, url, record, submit, facts: report.facts });
    const requests = JSON.parse(run('network', 'requests', '--type', 'document,fetch', '--json')).data.requests;
    report.requests = requests.map(r => ({ method: r.method, status: r.status, resourceType: r.resourceType, ...safeURL(r.url) }));
    const last = report.steps.at(-1);
    run('screenshot', path.join(output, `${name}.png`));
    report.outcome = { title: last.title, staleRequest: last.staleRequest, csrfFailure: last.text.includes('CSRF token verification failed.'), csrfFailureAtAnyStep: report.steps.some(s => s.text.includes('CSRF token verification failed.')), hasLoginForm: last.hasLoginForm, postExecutions: report.requests.filter(r => r.method === 'POST').map(r => r.execution) };
    if (extensionPath) {
      const expectError = name === 'recovery-budget' || name === 'unknown-destination';
      report.outcome.passed = expectError ? last.staleRequest && !last.hasLoginForm : last.hasLoginForm && !last.staleRequest;
    }
  } catch (error) {
    // Avoid serializing CLI errors containing arguments such as SAML URLs.
    report.error = error.status !== undefined ? `Browser command failed (exit ${error.status}).` : error.message;
  } finally {
    try { run('close'); } catch { /* Retain the probe evidence even if cleanup fails. */ }
  }
  await writeFile(path.join(output, `${name}.json`), JSON.stringify(report, null, 2) + '\n');
  const result = { scenario: name, ...(report.outcome ?? { error: report.error }) };
  summary.push(result);
  console.log(JSON.stringify(result));
}
await writeFile(path.join(output, 'summary.json'), JSON.stringify(summary, null, 2) + '\n');
console.log(`Evidence: ${output}`);
if (summary.some(r => r.error || r.passed === false)) process.exitCode = 1;
