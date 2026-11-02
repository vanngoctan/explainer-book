// Context menu, keyboard shortcut and the toolbar badge (number of items not yet explained).
importScripts('lib.js');
const S = self.SoTu;

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({ id: 'sotu-save', title: 'Lưu “%s” vào Sổ Từ', contexts: ['selection'] });
    chrome.contextMenus.create({ id: 'sotu-open', title: 'Mở Sổ Từ', contexts: ['action'] });
  });
  updateBadge();
});

chrome.runtime.onStartup.addListener(updateBadge);

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId === 'sotu-open') {
    openNotebook();
    return;
  }
  if (info.menuItemId !== 'sotu-save') return;
  const ok = tab && tab.id >= 0 && await askTab(tab.id, 'menu', info.frameId || 0);
  // Page cannot run scripts (built-in PDF viewer, browser pages): save the bare selection.
  if (!ok && info.selectionText) {
    await S.addCapture({
      text: info.selectionText,
      url: info.frameUrl || info.pageUrl || (tab && tab.url) || '',
      title: (tab && tab.title) || '',
    });
  }
});

chrome.commands.onCommand.addListener(async (command, tab) => {
  if (command === 'save-selection' && tab && tab.id >= 0) await askTab(tab.id, 'shortcut');
});

// Asks the page to save its selection: one frame when frameId is given, else every frame.
// A tab opened before the extension was installed or reloaded has no content script:
// inject it (the menu click or shortcut grants activeTab) and ask again.
async function askTab(tabId, source, frameId) {
  const first = await sendCapture(tabId, source, frameId);
  if (first !== null) return first;
  try {
    await chrome.scripting.executeScript({
      target: { tabId, frameIds: [frameId || 0] },
      files: ['lib.js', 'content.js'],
    });
  } catch (e) {
    return false;
  }
  return (await sendCapture(tabId, source, frameId)) === true;
}

// true / false = a content script answered; null = nobody is listening.
async function sendCapture(tabId, source, frameId) {
  const msg = { type: 'sotu:capture-selection', source };
  try {
    const res = frameId === undefined
      ? await chrome.tabs.sendMessage(tabId, msg)
      : await chrome.tabs.sendMessage(tabId, msg, { frameId });
    return !!(res && res.ok);
  } catch (e) {
    return null;
  }
}

function openNotebook() {
  chrome.tabs.create({ url: chrome.runtime.getURL('review.html') });
}

// Badge: cards to review now (teal). With none due, items still waiting for an explanation (grey).
async function updateBadge() {
  const [items, settings] = await Promise.all([S.getItems(), S.getSettings()]);
  const due = S.studyQueue(items, Date.now(), settings.newPerDay).total;
  const unexplained = items.filter((i) => !i.explanation).length;
  const n = due || unexplained;
  await chrome.action.setBadgeBackgroundColor({ color: due ? '#0f766e' : '#6b7471' });
  await chrome.action.setBadgeText({ text: n ? (n > 999 ? '999+' : String(n)) : '' });
  await chrome.action.setTitle({ title: `Sổ Từ: ${due} thẻ cần ôn · ${unexplained} mục chưa giải thích` });
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local') updateBadge();
});

// Cards come due with time, not only on storage changes. Create the alarm once:
// re-creating it on every service worker start would keep pushing it back.
chrome.alarms.get('badge').then((alarm) => {
  if (!alarm) chrome.alarms.create('badge', { periodInMinutes: 15 });
});
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'badge') updateBadge();
});
