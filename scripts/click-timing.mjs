import { execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

// Every run gets a fresh browser session and never uses a personal profile.
const session = `stanford-click-probe-${process.pid}`;
const delayMs = Number(process.argv[2] ?? 100);
const singleClick = process.argv.includes('--single');
const extensionPath = process.env.STANFORD_EXTENSION_PATH;
if (!Number.isFinite(delayMs) || delayMs < 0 || delayMs > 2000) {
  throw new Error('Click delay must be between 0 and 2000 ms.');
}
function browserCommand(...args) {
  return execFileSync('agent-browser', ['--session', session, ...args], { encoding: 'utf8', timeout: 40000 }).trim();
}
browserCommand('--headed', 'false', ...(extensionPath ? ['--extension', extensionPath] : []), 'open', 'https://canvas.stanford.edu/login/1');
browserCommand('wait', '--load', 'domcontentloaded');
browserCommand('wait', '--fn', '!!document.querySelector("#password")');
const endpoint = browserCommand('get', 'cdp-url');
const socket = new WebSocket(endpoint);
await new Promise((resolve, reject) => {
  socket.addEventListener('open', resolve, { once: true });
  socket.addEventListener('error', reject, { once: true });
});
let sequence = 0;
let targetSession;
const pending = new Map();
const events = [];
let recording = false;
const safeURL = (raw) => {
  const url = new URL(raw);
  const execution = url.searchParams.get('execution');
  const keys = [...new Set(url.searchParams.keys())];
  url.search = '';
  url.hash = '';
  return { url: url.href, execution, queryKeys: keys };
};
socket.addEventListener('message', ({ data }) => {
  const message = JSON.parse(String(data));
  if (message.id) {
    const request = pending.get(message.id);
    if (!request) return;
    clearTimeout(request.timeout);
    pending.delete(message.id);
    if (message.error) request.reject(new Error(message.error.message));
    else request.resolve(message.result);
    return;
  }
  if (!recording || message.sessionId !== targetSession) return;
  const p = message.params;
  if (message.method === 'Network.requestWillBeSent' && p.type === 'Document') {
    events.push({ kind: 'request', id: p.requestId, time: p.timestamp, method: p.request.method, ...safeURL(p.request.url) });
    if (p.redirectResponse) events.push({ kind: 'redirect', status: p.redirectResponse.status, ...safeURL(p.redirectResponse.url) });
  }
  if (message.method === 'Network.responseReceived' && p.type === 'Document') {
    events.push({ kind: 'response', id: p.requestId, time: p.timestamp, status: p.response.status, ...safeURL(p.response.url) });
  }
  if (message.method === 'Network.loadingFailed' && p.type === 'Document') {
    events.push({ kind: 'failure', id: p.requestId, error: p.errorText, canceled: p.canceled });
  }
});
function send(method, params = {}, sessionId = targetSession) {
  const id = ++sequence;
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => { pending.delete(id); reject(new Error(`${method} timed out`)); }, 15000);
    pending.set(id, { resolve, reject, timeout });
    socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
  });
}
async function evaluate(expression) {
  const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
  return result.result.value;
}
try {
  const { targetInfos } = await send('Target.getTargets');
  const target = targetInfos.find(t => t.type === 'page' && t.url.startsWith('https://login.stanford.edu/'));
  if (!target) throw new Error('The isolated browser did not reach a Stanford login form.');
  ({ sessionId: targetSession } = await send('Target.attachToTarget', { targetId: target.targetId, flatten: true }));
  await send('Network.enable');
  await send('Page.enable');
  const browser = await send('Browser.getVersion', {}, undefined);
  const before = await evaluate(`(() => {
    const u = document.querySelector('#username');
    const p = document.querySelector('#password');
    const b = document.querySelector('input[type=submit][name=_eventId_proceed]');
    if (!u || !p || !b || u.value || p.value) throw new Error('This probe requires the login form with both fields empty.');
    const r = b.getBoundingClientRect();
    return { title: document.title, url: location.href, x: r.x + r.width / 2, y: r.y + r.height / 2 };
  })()`);
  recording = true;
  const click = async (clickCount) => {
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: before.x, y: before.y, button: 'left', clickCount });
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: before.x, y: before.y, button: 'left', clickCount });
  };
  await click(1);
  if (!singleClick) {
    await new Promise(resolve => setTimeout(resolve, delayMs));
    await click(2);
  }
  // A short settling period is intentional for this timing probe.
  await new Promise(resolve => setTimeout(resolve, 2500));
  const after = await evaluate('({ title: document.title, url: location.href, text: document.body.innerText, hasLoginForm: !!document.querySelector("#password") })');
  const startTime = events.find(e => e.time)?.time;
  for (const event of events) if (event.time) event.time = Math.round((event.time - startTime) * 1000);
  const postCount = events.filter(e => e.kind === 'request' && e.method === 'POST').length;
  const staleRequest = after.title === 'Stanford Login - Stale Request' && !after.hasLoginForm;
  const report = {
    recordedAt: new Date().toISOString(),
    extensionEnabled: !!extensionPath,
    scenario: singleClick ? 'Single trusted click on Login with both credentials empty' : 'Two trusted clicks on Login with both credentials empty',
    delayMs: singleClick ? null : delayMs,
    result: { postCount, staleRequest, reproducedDuplicateSubmitFailure: !singleClick && postCount >= 2 && staleRequest },
    browser: { product: browser.product, userAgent: browser.userAgent },
    before: { title: before.title, ...safeURL(before.url) },
    after: { ...after, ...safeURL(after.url) },
    events,
  };
  const directory = path.resolve(import.meta.dirname, '../evidence');
  await mkdir(directory, { recursive: true });
  const filename = `${extensionPath ? 'extension-' : ''}${singleClick ? 'single-click' : `double-click-${delayMs}ms`}-${Date.now()}`;
  await writeFile(path.join(directory, `${filename}.json`), JSON.stringify(report, null, 2) + '\n');
  const screenshot = await send('Page.captureScreenshot', { format: 'png' });
  await writeFile(path.join(directory, `${filename}.png`), Buffer.from(screenshot.data, 'base64'));
  console.log(JSON.stringify(report, null, 2));
  console.log(`Evidence: ${path.join(directory, filename)}.{json,png}`);
  if (extensionPath && (postCount !== 1 || !after.hasLoginForm || staleRequest)) process.exitCode = 1;
} finally {
  socket.close();
  browserCommand('close');
}
