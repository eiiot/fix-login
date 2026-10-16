import { isLoginURL, nextRecovery, serviceDestination } from './navigation.js';

// Session storage survives service-worker suspension, but not browser shutdown.
// Only the background worker can access this storage by default.
const queues = new Map();
const key = tabId => `tab:${tabId}`;
const read = async tabId => (await chrome.storage.session.get(key(tabId)))[key(tabId)];
const write = (tabId, state) => chrome.storage.session.set({ [key(tabId)]: state });

function enqueue(tabId, action) {
  const prior = queues.get(tabId) ?? Promise.resolve();
  const task = prior.then(action).catch(() => undefined);
  queues.set(tabId, task);
  void task.finally(() => { if (queues.get(tabId) === task) queues.delete(tabId); });
  return task;
}

chrome.webRequest.onBeforeRequest.addListener(details => {
  if (details.tabId < 0 || details.method !== 'GET') return;
  const destination = serviceDestination(details.url);
  if (!destination) return;
  void enqueue(details.tabId, async () => {
    const state = await read(details.tabId);
    // Keep the first service URL in a redirect chain, including a deep link.
    if (state?.requestId === details.requestId) return;
    await write(details.tabId, {
      destination,
      requestId: details.requestId,
      recoveryTimes: state?.recoveryTimes ?? [],
    });
  });
}, { urls: ['https://*.stanford.edu/*'], types: ['main_frame'] });

chrome.tabs.onCreated.addListener(tab => {
  if (tab.openerTabId === undefined) return;
  // A login opened from another tab should retain that tab's service context.
  void enqueue(tab.id, async () => {
    await (queues.get(tab.openerTabId) ?? Promise.resolve());
    const source = await read(tab.openerTabId);
    if (source && !(await read(tab.id))) await write(tab.id, { ...source, requestId: null });
  });
});

chrome.tabs.onRemoved.addListener(tabId => {
  void enqueue(tabId, () => chrome.storage.session.remove(key(tabId)));
});

chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (message?.type !== 'recover-login' || sender.frameId !== 0 || !sender.tab || !isLoginURL(sender.url)) return;
  void enqueue(sender.tab.id, async () => {
    // A queued message from a document being left must not hijack its successor.
    const tab = await chrome.tabs.get(sender.tab.id);
    if (tab.url !== sender.url) return { recovered: false };
    const state = nextRecovery(await read(sender.tab.id), Date.now());
    if (!state) return { recovered: false };
    await write(sender.tab.id, state);
    await chrome.tabs.update(sender.tab.id, { url: state.destination });
    return { recovered: true };
  }).then(result => respond(result ?? { recovered: false }));
  return true;
});
