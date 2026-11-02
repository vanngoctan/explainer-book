// Captures what the reader double-clicks (word), triple-clicks (passage) or selects
// and saves it with the sentence around it. Runs in every page and frame.
(() => {
  // background.js injects this again into tabs that were open before an install or reload.
  // Retire the earlier copy so only one set of listeners runs.
  if (typeof window.__soTuCleanup === 'function') {
    try {
      window.__soTuCleanup();
    } catch (e) {
      // The earlier copy belongs to an unloaded extension; nothing else to do.
    }
  }

  const S = globalThis.SoTu;
  const BLOCK = 'p, li, dd, dt, td, th, blockquote, pre, figcaption, caption, h1, h2, h3, h4, h5, h6, article, section, div';
  // A triple-click starts with a double-click. Wait a little so it saves one passage, not word + passage.
  const WORD_DELAY = 450;
  const off = new AbortController();
  const on = (target, type, fn, opts) => target.addEventListener(type, fn, Object.assign({ signal: off.signal }, opts));

  let settings = Object.assign({}, S.DEFAULT_SETTINGS);
  S.getSettings().then((s) => { settings = s; }).catch(() => {});
  const onSettings = (changes, area) => {
    if (area === 'local' && changes[S.SETTINGS_KEY]) {
      settings = Object.assign({}, S.DEFAULT_SETTINGS, changes[S.SETTINGS_KEY].newValue);
    }
  };
  chrome.storage.onChanged.addListener(onSettings);

  let wordTimer = null;
  let last = null; // { capture, at, source }
  let ui = null;
  let buttonRange = null;
  let downAt = null; // pointer position of the last mousedown
  let dblAt = null; // pointer position of the last double-click

  window.__soTuCleanup = () => {
    off.abort();
    clearTimeout(wordTimer);
    if (ui) ui.host.remove();
    chrome.storage.onChanged.removeListener(onSettings);
    chrome.runtime.onMessage.removeListener(onMessage);
  };

  // ---------- events ----------

  on(document, 'mousedown', (e) => {
    downAt = { x: e.clientX, y: e.clientY };
    if (!isOwnUi(e.target)) hideSaveButton();
  }, { capture: true });

  on(document, 'dblclick', (e) => {
    dblAt = { x: e.clientX, y: e.clientY };
    if (!active(e)) return;
    clearTimeout(wordTimer);
    wordTimer = setTimeout(() => capture('dblclick'), WORD_DELAY);
  }, { capture: true });

  on(document, 'click', (e) => {
    // A real triple-click stays in place; a quick drag after a double-click can also report detail 3.
    if (e.detail !== 3 || !active(e) || !near(downAt, e, 4) || !near(dblAt, e, 12)) return;
    clearTimeout(wordTimer);
    // The third click came after the word was already saved: replace that word with the passage.
    if (last && last.source === 'dblclick' && Date.now() - last.at < 1500) {
      S.undoCapture(last.capture).catch(() => {});
      last = null;
    }
    setTimeout(() => capture('tripleclick'), 0);
  }, { capture: true });

  // After a drag-select, offer a button instead of saving right away.
  on(document, 'mouseup', (e) => {
    if (e.button !== 0 || near(downAt, e, 4) || !settings.showSaveButton || !active(e)) return;
    setTimeout(() => {
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed || !sel.rangeCount || !S.cleanText(sel.toString())) return;
      const range = sel.getRangeAt(0);
      showSaveButton(range.cloneRange(), range.getBoundingClientRect());
    }, 0);
  }, { capture: true });

  on(window, 'scroll', () => hideSaveButton(), { capture: true, passive: true });

  // Context menu and keyboard shortcut, sent by background.js.
  function onMessage(msg, sender, sendResponse) {
    if (!msg || msg.type !== 'sotu:capture-selection') return;
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed) {
      sendResponse({ ok: false });
      return;
    }
    capture(msg.source || 'menu').then((item) => sendResponse({ ok: !!item }));
    return true;
  }
  chrome.runtime.onMessage.addListener(onMessage);

  function near(p, e, r) {
    return !!p && Math.abs(p.x - e.clientX) <= r && Math.abs(p.y - e.clientY) <= r;
  }

  // False once the extension was reloaded or removed: this copy then stays quiet.
  function alive() {
    try {
      return !!chrome.runtime.id;
    } catch (e) {
      return false;
    }
  }

  function active(e) {
    return alive() && settings.enabled && !isEditable(e.target) && !isOwnUi(e.target);
  }

  function isEditable(el) {
    if (!el || el.nodeType !== Node.ELEMENT_NODE) return false;
    return el.isContentEditable || !!el.closest('input, textarea, select, [role="textbox"]');
  }

  function isOwnUi(el) {
    return !!ui && el === ui.host;
  }

  // ---------- capture ----------

  async function capture(source, range) {
    hideSaveButton();
    const data = readSelection(range);
    if (!data) return null;
    try {
      const result = await S.addCapture(data);
      last = { capture: result, at: Date.now(), source };
      showToast(result);
      return result.item;
    } catch (err) {
      const reloaded = /context invalidated/i.test(String(err && err.message));
      showToast(null, reloaded ? 'Sổ Từ vừa được cập nhật. Tải lại trang để tiếp tục lưu.' : 'Không lưu được: ' + err.message);
      return null;
    }
  }

  function readSelection(range) {
    const sel = window.getSelection();
    if (!range && sel && sel.rangeCount && !sel.isCollapsed) range = sel.getRangeAt(0);
    if (!range) return null;
    const text = S.cleanText(range.toString());
    if (!text || text.length > S.MAX_TEXT) return null;
    const start = startNode(range);
    const block = blockOf(start, text);
    return {
      text,
      context: block ? contextOf(block, range) : '',
      heading: block ? headingBefore(block) : '',
      lang: langOf(start.nodeType === Node.ELEMENT_NODE ? start : start.parentElement),
      url: location.href,
      title: document.title,
    };
  }

  // First node inside the range (a range can start at an element boundary).
  function startNode(range) {
    const n = range.startContainer;
    return (n.nodeType === Node.ELEMENT_NODE && n.childNodes[range.startOffset]) || n;
  }

  // Nearest block element. For a short selection, climb out of tiny wrappers
  // until the block holds enough text to give a sentence of context.
  function blockOf(node, text) {
    const el = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
    if (!el) return null;
    let block = el.closest(BLOCK) || document.body;
    const short = S.classify(text) !== 'passage';
    while (short && block !== document.body && block.textContent.length < text.length + 40) {
      block = (block.parentElement && block.parentElement.closest(BLOCK)) || document.body;
    }
    return block;
  }

  function contextOf(block, range) {
    try {
      const pre = document.createRange();
      pre.selectNodeContents(block);
      const blockText = pre.toString();
      pre.setEnd(range.startContainer, range.startOffset);
      const start = pre.toString().length;
      const end = Math.min(blockText.length, start + range.toString().length);
      return S.sentenceContext(blockText, start, end);
    } catch (e) {
      return '';
    }
  }

  function headingBefore(block) {
    let found = null;
    for (const h of document.querySelectorAll('h1, h2, h3')) {
      if (h === block || h.contains(block)) continue;
      if (h.compareDocumentPosition(block) & Node.DOCUMENT_POSITION_FOLLOWING) found = h;
      else break;
    }
    return found ? S.cleanText(found.textContent).slice(0, 200) : '';
  }

  function langOf(el) {
    const tagged = el && el.closest && el.closest('[lang]');
    return (tagged && tagged.getAttribute('lang')) || document.documentElement.lang || '';
  }

  // ---------- on-page UI (shadow DOM, so page CSS cannot touch it) ----------

  function ensureUi() {
    if (ui) return ui;
    const host = document.createElement('so-tu-ui');
    host.style.cssText = 'all: initial; position: fixed; top: 0; left: 0; width: 0; height: 0; z-index: 2147483647;';
    const root = host.attachShadow({ mode: 'closed' });
    root.innerHTML = `
      <style>
        :host { all: initial; }
        * { box-sizing: border-box; font: 13px/1.4 system-ui, -apple-system, "Segoe UI", sans-serif; }
        .toast {
          position: fixed; right: 16px; bottom: 16px; max-width: min(360px, calc(100vw - 32px));
          display: flex; align-items: center; gap: 12px; padding: 10px 12px 10px 14px;
          background: #1f2a28; color: #f4f1ea; border-radius: 10px;
          box-shadow: 0 8px 24px rgba(0,0,0,.25); opacity: 0; transform: translateY(8px);
          transition: opacity .15s, transform .15s; pointer-events: none;
        }
        .toast.show { opacity: 1; transform: none; pointer-events: auto; }
        .msg { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .msg b { font-weight: 600; color: #8fe0cf; }
        .undo {
          all: unset; cursor: pointer; color: #8fe0cf; font-weight: 600; padding: 2px 4px; border-radius: 4px;
        }
        .undo:hover { background: rgba(255,255,255,.08); }
        .save {
          all: unset; position: fixed; cursor: pointer; padding: 4px 10px; border-radius: 999px;
          background: #0f766e; color: #fff; font-weight: 600; box-shadow: 0 4px 12px rgba(0,0,0,.2);
          display: none;
        }
        .save:hover { background: #115e59; }
      </style>
      <div class="toast" role="status"><span class="msg"></span><button class="undo">Hoàn tác</button></div>
      <button class="save" title="Lưu vào Sổ Từ (Alt+Shift+S)">+ Sổ Từ</button>`;
    document.documentElement.appendChild(host);

    const toast = root.querySelector('.toast');
    const msg = root.querySelector('.msg');
    const undo = root.querySelector('.undo');
    const save = root.querySelector('.save');

    undo.addEventListener('click', async () => {
      if (!last) return;
      const done = last;
      last = null;
      await S.undoCapture(done.capture);
      showToast(null, 'Đã bỏ mục vừa lưu.');
    });
    // Keep the page selection when the button is pressed.
    save.addEventListener('mousedown', (e) => e.preventDefault());
    save.addEventListener('click', () => capture('button', buttonRange));

    ui = { host, toast, msg, undo, save, timer: null };
    return ui;
  }

  function showToast(result, text) {
    const u = ensureUi();
    if (result) {
      const short = result.item.text.length > 60 ? result.item.text.slice(0, 57) + '…' : result.item.text;
      const lead = result.previous ? `Gặp lại lần ${result.item.count}:` : 'Đã lưu';
      u.msg.innerHTML = `${lead} <b>${S.escapeHtml(short)}</b>`;
      u.undo.style.display = '';
    } else {
      u.msg.textContent = text;
      u.undo.style.display = 'none';
    }
    u.toast.classList.add('show');
    clearTimeout(u.timer);
    u.timer = setTimeout(() => u.toast.classList.remove('show'), result ? 3000 : 4000);
  }

  function showSaveButton(range, rect) {
    const u = ensureUi();
    buttonRange = range;
    const top = rect.bottom + 8 + 28 > window.innerHeight ? rect.top - 36 : rect.bottom + 8;
    u.save.style.left = Math.max(8, Math.min(rect.right - 70, window.innerWidth - 100)) + 'px';
    u.save.style.top = Math.max(8, top) + 'px';
    u.save.style.display = 'block';
  }

  function hideSaveButton() {
    if (ui) ui.save.style.display = 'none';
    buttonRange = null;
  }
})();
