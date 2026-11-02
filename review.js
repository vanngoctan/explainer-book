// The notebook page: list captured items, get them explained, review, export.
const S = globalThis.SoTu;
const $ = (id) => document.getElementById(id);
const esc = S.escapeHtml;
const API_BATCH = 12;

const VIEWS = ['study', 'new', 'done', 'all'];

const state = {
  items: [],
  settings: Object.assign({}, S.DEFAULT_SETTINGS),
  view: VIEWS.includes(location.hash.slice(1)) ? location.hash.slice(1) : 'new',
  query: '',
  selected: new Set(),
  revealed: new Set(),
  busy: false,
  study: { id: null, revealed: false, undo: null }, // card on screen; undo = { id, srs } of the last rating
};

// ---------- data ----------

async function load() {
  [state.items, state.settings] = await Promise.all([S.getItems(), S.getSettings()]);
  const ids = new Set(state.items.map((it) => it.id));
  for (const id of state.selected) if (!ids.has(id)) state.selected.delete(id);
  render();
}

let reloadTimer = null;
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  clearTimeout(reloadTimer);
  reloadTimer = setTimeout(load, 120);
});

function inView(it, view) {
  if (view === 'new') return !it.explanation;
  if (view === 'done') return !!it.explanation;
  return true;
}

function visible() {
  const q = state.query.trim().toLowerCase();
  return state.items.filter((it) => inView(it, state.view) && (!q ||
    [it.text, it.context, it.title, it.explanation && it.explanation.meaning]
      .some((s) => s && s.toLowerCase().includes(q))));
}

// Actions use the selected items, or every visible item when nothing is selected.
function targets() {
  return state.selected.size ? state.items.filter((it) => state.selected.has(it.id)) : visible();
}

// Explaining without a selection skips items that already have an explanation.
function explainTargets() {
  return state.selected.size ? targets() : visible().filter((it) => !it.explanation);
}

// ---------- render ----------

function render() {
  const counts = {
    study: S.studyQueue(state.items, Date.now(), state.settings.newPerDay).total,
    new: state.items.filter((it) => !it.explanation).length,
    done: state.items.filter((it) => it.explanation).length,
    all: state.items.length,
  };
  for (const b of $('tabs').querySelectorAll('button')) {
    b.classList.toggle('active', b.dataset.view === state.view);
    b.querySelector('.n').textContent = counts[b.dataset.view];
  }
  const today = new Date().setHours(0, 0, 0, 0);
  const todayCount = state.items.filter((it) => it.lastSeenAt >= today).length;
  $('stats').textContent = `${counts.all} mục · ${todayCount} hôm nay`;

  const studying = state.view === 'study';
  for (const id of ['toolbar', 'scope', 'list']) $(id).hidden = studying;
  $('study').hidden = !studying;
  if (studying) {
    $('empty').hidden = true;
    renderStudy();
    return;
  }

  const list = visible();
  const groups = [];
  for (const it of list) {
    const label = dayLabel(it.lastSeenAt);
    if (!groups.length || groups[groups.length - 1].label !== label) groups.push({ label, items: [] });
    groups[groups.length - 1].items.push(it);
  }
  $('list').innerHTML = groups.map((g) =>
    `<section class="day"><h3>${esc(g.label)}</h3>${g.items.map(card).join('')}</section>`).join('');

  const empty = $('empty');
  empty.hidden = list.length > 0;
  if (!list.length) empty.innerHTML = emptyMessage(counts);

  const picked = list.filter((it) => state.selected.has(it.id)).length;
  const all = $('select-all');
  all.checked = list.length > 0 && picked === list.length;
  all.indeterminate = picked > 0 && picked < list.length;
  $('pick-label').textContent = state.selected.size ? `Đã chọn ${state.selected.size}` : 'Chọn tất cả';
  $('delete-selected').disabled = state.busy || state.selected.size === 0;
  $('scope').textContent = state.selected.size
    ? `Các nút áp dụng cho ${state.selected.size} mục đã chọn.`
    : list.length ? `Chưa chọn mục nào: các nút áp dụng cho ${list.length} mục đang hiển thị.` : '';
  document.body.classList.toggle('quiz-mode', $('quiz').checked);
}

function emptyMessage(counts) {
  if (state.query.trim()) return `Không tìm thấy “${esc(state.query.trim())}”.`;
  if (!counts.all) {
    return `<h2>Sổ đang trống</h2>
      <p>Mở một trang bất kỳ và đọc như bình thường.</p>
      <ul>
        <li><b>Double-click</b> vào từ chưa hiểu để lưu từ đó.</li>
        <li><b>Triple-click</b> để lưu cả đoạn.</li>
        <li>Bôi đen một cụm từ rồi bấm <b>+ Sổ Từ</b> hoặc <kbd>Alt</kbd>+<kbd>Shift</kbd>+<kbd>S</kbd>.</li>
      </ul>
      <p>Mỗi mục được lưu kèm câu chứa nó. Cuối buổi, quay lại đây để AI giải thích một lượt.</p>`;
  }
  if (state.view === 'new') return '<h2>Đã giải thích hết</h2><p>Mở tab “Đã giải thích” để ôn lại, hoặc bật “Tự kiểm tra”.</p>';
  return '<p>Chưa có mục nào được giải thích.</p>';
}

function card(it) {
  const ex = it.explanation;
  const cls = ['card', 'kind-' + it.kind];
  if (ex) cls.push('explained');
  if (state.selected.has(it.id)) cls.push('selected');
  if (state.revealed.has(it.id)) cls.push('revealed');
  const lang = it.lang ? ` lang="${esc(it.lang)}"` : '';
  const host = hostOf(it.url);
  const safeUrl = /^(https?|file):/i.test(it.url || '');
  const source = safeUrl
    ? `<a href="${esc(it.url)}" target="_blank" rel="noopener">${esc(it.title || host)}</a>`
    : esc(it.title || '');
  return `<article class="${cls.join(' ')}" data-id="${esc(it.id)}">
    <div class="head">
      <input type="checkbox" class="pick" ${state.selected.has(it.id) ? 'checked' : ''} aria-label="Chọn mục này">
      <span class="kind">${esc(S.KIND_LABELS[it.kind] || '')}</span>
      ${it.count > 1 ? `<span class="count" title="Số lần bạn đã lưu mục này">×${it.count}</span>` : ''}
      <span class="tools">
        ${ex ? '<button class="icon" data-act="unexplain" title="Chuyển về Chưa giải thích">↺</button>' : ''}
        <button class="icon" data-act="delete" title="Xoá">✕</button>
      </span>
    </div>
    <h2 class="text"${lang}>${esc(it.text)}</h2>
    ${it.context ? `<p class="ctx"${lang}>${S.highlight(it.context, it.text)}</p>` : ''}
    <p class="meta">${source}${host && it.title && safeUrl ? ` <span class="host">${esc(host)}</span>` : ''}<span class="dot">·</span>${esc(clock(it.lastSeenAt))}${scheduleNote(it)}</p>
    ${ex ? answer(ex) : ''}
  </article>`;
}

function answer(ex) {
  const sub = [ex.pronunciation, ex.partOfSpeech, ex.sourceLanguage].filter(Boolean).map(esc).join(' · ');
  return `<div class="answer" data-act="reveal">
    <p class="meaning">${esc(ex.meaning)}</p>
    ${sub ? `<p class="sub">${sub}</p>` : ''}
    ${ex.explanation ? `<p class="expl">${esc(ex.explanation)}</p>` : ''}
    ${ex.examples && ex.examples.length ? `<ul class="examples">${ex.examples.map((e) => `<li>${esc(e)}</li>`).join('')}</ul>` : ''}
    ${ex.related && ex.related.length ? `<div class="related">${ex.related.map((r) => `<span class="chip">${esc(r)}</span>`).join('')}</div>` : ''}
    ${ex.note ? `<p class="note">${esc(ex.note)}</p>` : ''}
    <div class="veil">Nhớ lại nghĩa trước, rồi bấm để xem</div>
  </div>`;
}

function scheduleNote(it) {
  if (!it.explanation || !it.srs || it.srs.state === 'new') return '';
  const wait = it.srs.due - Date.now();
  return `<span class="dot">·</span>${wait <= 0 ? 'đến hạn ôn' : 'ôn sau ' + esc(S.formatInterval(wait))}`;
}

// ---------- study (spaced repetition) ----------

const GRADES = [['Quên', 'again'], ['Khó', 'hard'], ['Nhớ', 'good'], ['Dễ', 'easy']];
const STATE_LABELS = { new: 'Thẻ mới', learning: 'Đang học', relearning: 'Học lại', review: 'Ôn lại' };

function renderStudy() {
  const now = Date.now();
  const q = S.studyQueue(state.items, now, state.settings.newPerDay);
  let item = state.study.id && state.items.find((it) => it.id === state.study.id && it.explanation);
  if (!item) {
    item = S.nextCard(q, now);
    state.study.id = item ? item.id : null;
    state.study.revealed = false;
  }
  $('study-stats').innerHTML =
    `<span class="q-new">${q.fresh.length} mới</span> · <span class="q-learn">${q.learning.length} đang học</span> · ` +
    `<span class="q-review">${q.review.length} ôn lại</span>` +
    (state.study.undo ? ' <button class="link" data-study="undo">Hoàn tác thẻ vừa chấm</button>' : '');
  $('study-card').innerHTML = item ? studyCard(item, now) : studyDone(now);
}

function studyCard(it, now) {
  const lang = it.lang ? ` lang="${esc(it.lang)}"` : '';
  const head = `<div class="head">
      <span class="kind">${esc(S.KIND_LABELS[it.kind] || '')}</span>
      <span class="srs-state">${STATE_LABELS[it.srs ? it.srs.state : 'new']}</span>
    </div>
    <h2 class="text"${lang}>${esc(it.text)}</h2>
    ${it.context ? `<p class="ctx"${lang}>${S.highlight(it.context, it.text)}</p>` : ''}`;
  if (!state.study.revealed) {
    return `<article class="card study-card kind-${esc(it.kind)}">${head}
      <div class="reveal"><button class="btn primary" data-study="reveal">Hiện đáp án <kbd>Space</kbd></button></div>
    </article>`;
  }
  const ivls = S.previewIntervals(it.srs, now);
  return `<article class="card study-card kind-${esc(it.kind)} revealed">${head}
    <p class="meta">${esc(it.title || hostOf(it.url))}</p>
    ${answer(it.explanation)}
    <div class="grades">${GRADES.map(([label, cls], i) => `<button class="grade ${cls}" data-grade="${i + 1}">
      <span class="g-ivl">${esc(ivls[i])}</span><span class="g-label">${label}</span><kbd>${i + 1}</kbd></button>`).join('')}
    </div>
  </article>`;
}

function studyDone(now) {
  if (!state.items.some((it) => it.explanation)) {
    return `<div class="study-empty"><h2>Chưa có thẻ nào</h2>
      <p>Thẻ ôn tập được tạo từ các mục đã giải thích. Hãy giải thích vài mục ở tab “Chưa giải thích” trước.</p></div>`;
  }
  const next = S.nextDueAt(state.items);
  const waiting = state.items.filter((it) => it.explanation && (!it.srs || it.srs.state === 'new')).length;
  return `<div class="study-empty"><h2>Xong lượt ôn hôm nay</h2>
    ${next ? `<p>Thẻ tiếp theo đến hạn sau ${esc(S.formatInterval(Math.max(0, next - now)))}.</p>` : ''}
    ${waiting ? `<p>Còn ${waiting} thẻ mới chờ học, mỗi ngày mở tối đa ${state.settings.newPerDay} thẻ (đổi trong Cài đặt).</p>` : ''}
  </div>`;
}

function revealCard() {
  if (!state.study.id) return;
  state.study.revealed = true;
  renderStudy();
}

async function gradeCard(grade) {
  const item = state.items.find((it) => it.id === state.study.id);
  if (!item || !state.study.revealed) return;
  state.study.undo = { id: item.id, srs: item.srs || null };
  state.study.id = null;
  state.study.revealed = false;
  await S.saveRating(item, grade, Date.now());
}

async function undoGrade() {
  const u = state.study.undo;
  const item = u && state.items.find((it) => it.id === u.id);
  if (!item) return;
  state.study = { id: item.id, revealed: true, undo: null };
  await chrome.storage.local.set({ [S.KEY_PREFIX + item.id]: Object.assign({}, item, { srs: u.srs }) });
}

$('study').addEventListener('click', (e) => {
  const grade = e.target.closest('[data-grade]');
  if (grade) return gradeCard(Number(grade.dataset.grade));
  const act = e.target.closest('[data-study]');
  if (act && act.dataset.study === 'reveal') revealCard();
  if (act && act.dataset.study === 'undo') undoGrade();
});

// Space / Enter shows the answer, then 1–4 grade it (Space again = Nhớ), as in Anki.
document.addEventListener('keydown', (e) => {
  if (state.view !== 'study' || e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
  if (document.querySelector('dialog[open]') || /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
  const space = e.key === ' ' || e.key === 'Enter';
  if (!state.study.revealed && space) {
    e.preventDefault();
    revealCard();
  } else if (state.study.revealed && (space || /^[1-4]$/.test(e.key))) {
    e.preventDefault();
    gradeCard(space ? 3 : Number(e.key));
  }
});

// Learning cards come due within minutes: refresh the counts and the "done" screen.
setInterval(() => {
  if (state.view === 'study' && !state.study.id) render();
}, 30000);

function dayLabel(ts) {
  const day = new Date(ts).setHours(0, 0, 0, 0);
  const today = new Date().setHours(0, 0, 0, 0);
  const diff = Math.round((today - day) / 86400000);
  if (diff === 0) return 'Hôm nay';
  if (diff === 1) return 'Hôm qua';
  return new Date(ts).toLocaleDateString('vi-VN', { weekday: 'long', day: 'numeric', month: 'numeric', year: 'numeric' });
}

function clock(ts) {
  return new Date(ts).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
}

function hostOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch (e) {
    return '';
  }
}

// ---------- status line ----------

let statusTimer = null;
function status(html, kind) {
  kind = kind || 'info';
  const el = $('status');
  el.hidden = false;
  el.className = 'status ' + kind;
  el.innerHTML = html;
  clearTimeout(statusTimer);
  if (kind === 'info') statusTimer = setTimeout(() => { el.hidden = true; }, 10000);
}

function setBusy(on) {
  state.busy = on;
  for (const id of ['explain-api', 'copy-prompt', 'paste-result', 'export-anki', 'delete-selected']) $(id).disabled = on;
  if (!on) render();
}

// ---------- list events ----------

$('tabs').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-view]');
  if (!b) return;
  state.view = b.dataset.view;
  state.selected.clear();
  history.replaceState(null, '', '#' + state.view);
  render();
});

$('search').addEventListener('input', (e) => {
  state.query = e.target.value;
  render();
});

$('select-all').addEventListener('change', () => {
  const list = visible();
  const allPicked = list.length && list.every((it) => state.selected.has(it.id));
  for (const it of list) {
    if (allPicked) state.selected.delete(it.id);
    else state.selected.add(it.id);
  }
  render();
});

$('quiz').addEventListener('change', () => {
  state.revealed.clear();
  render();
});

$('list').addEventListener('change', (e) => {
  if (!e.target.classList.contains('pick')) return;
  const id = e.target.closest('.card').dataset.id;
  if (e.target.checked) state.selected.add(id);
  else state.selected.delete(id);
  render();
});

$('list').addEventListener('click', async (e) => {
  const actEl = e.target.closest('[data-act]');
  if (!actEl) return;
  const cardEl = actEl.closest('.card');
  const id = cardEl.dataset.id;
  const item = state.items.find((it) => it.id === id);
  if (!item) return;
  const act = actEl.dataset.act;
  if (act === 'delete') {
    await deleteItems([item]);
  } else if (act === 'unexplain') {
    await chrome.storage.local.set({
      [S.KEY_PREFIX + id]: Object.assign({}, item, { explanation: null, explainedAt: null }),
    });
  } else if (act === 'reveal' && document.body.classList.contains('quiz-mode')) {
    if (state.revealed.has(id)) state.revealed.delete(id);
    else state.revealed.add(id);
    cardEl.classList.toggle('revealed');
  }
});

async function deleteItems(list) {
  await S.removeItems(list.map((it) => it.id));
  for (const it of list) state.selected.delete(it.id);
  status(`Đã xoá ${list.length} mục. <button class="link" id="undo-delete">Hoàn tác</button>`);
  $('undo-delete').addEventListener('click', async () => {
    await S.importItems(list);
    status(`Đã khôi phục ${list.length} mục.`);
  }, { once: true });
}

$('delete-selected').addEventListener('click', async () => {
  const list = targets();
  if (!state.selected.size || !list.length) return;
  if (!confirm(`Xoá ${list.length} mục đã chọn?`)) return;
  await deleteItems(list);
});

// ---------- explain ----------

$('explain-api').addEventListener('click', async () => {
  const settings = await S.getSettings();
  const problem = S.providerProblem(settings);
  if (problem) {
    openSettings(problem + ' Không muốn cài AI thì đóng hộp này và dùng “Copy prompt”.');
    return;
  }
  const list = explainTargets();
  if (!list.length) {
    status('Không có mục nào cần giải thích.');
    return;
  }
  setBusy(true);
  let done = 0;
  let missing = 0;
  const name = esc(S.providerName(settings));
  const session = crypto.randomUUID();
  try {
    for (const part of S.chunk(list, API_BATCH)) {
      status(`Đang giải thích ${done + 1}–${done + part.length} / ${list.length} bằng ${name}…`, 'busy');
      const result = await S.explain(part, settings, undefined, session);
      const saved = await S.saveExplanations(result);
      done += part.length;
      missing += part.length - saved.matched;
    }
    state.selected.clear();
    status(`Đã giải thích ${done - missing} mục.` + (missing ? ` ${missing} mục không có kết quả, thử lại sau.` : '') +
      ' Mở tab “Đã giải thích” để đọc.');
  } catch (err) {
    status(`${esc(err.message)}${done ? ` (đã xong ${done} mục trước khi lỗi)` : ''}`, 'error');
  } finally {
    setBusy(false);
  }
});

$('copy-prompt').addEventListener('click', async () => {
  const list = explainTargets();
  if (!list.length) {
    status('Không có mục nào cần giải thích.');
    return;
  }
  const settings = await S.getSettings();
  await copyText(S.chatPrompt(list, settings));
  status(`Đã copy prompt cho ${list.length} mục. Dán vào <a href="https://claude.ai/new" target="_blank" rel="noopener">Claude.ai</a> ` +
    'hoặc AI bạn dùng, copy khối JSON trả về, rồi bấm <b>Dán kết quả</b>.' +
    (list.length > 40 ? ' Danh sách dài: nếu câu trả lời bị cắt, chọn ít mục hơn.' : ''));
});

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
  } catch (e) {
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
  }
}

$('paste-result').addEventListener('click', () => {
  $('paste-text').value = '';
  $('paste-error').hidden = true;
  $('paste-dialog').showModal();
  $('paste-text').focus();
});

$('paste-import').addEventListener('click', async (e) => {
  e.preventDefault();
  try {
    const result = S.parseAIResult($('paste-text').value);
    const saved = await S.saveExplanations(result);
    if (!saved.matched) throw new Error('Không mục nào khớp id trong sổ. Kiểm tra lại bạn đã dán đúng câu trả lời chưa.');
    $('paste-dialog').close();
    status(`Đã nhập giải thích cho ${saved.matched} mục.` + (saved.unmatched ? ` Bỏ qua ${saved.unmatched} mục không khớp id.` : ''));
  } catch (err) {
    $('paste-error').textContent = err.message;
    $('paste-error').hidden = false;
  }
});

// ---------- export ----------

$('export-anki').addEventListener('click', () => {
  const list = targets().filter((it) => it.explanation);
  if (!list.length) {
    status('Chưa có mục nào đã giải thích để xuất. Giải thích trước, rồi xuất.');
    return;
  }
  download(`so-tu-anki-${today()}.txt`, S.toAnki(list), 'text/plain;charset=utf-8');
  status(`Đã xuất ${list.length} thẻ. Trong Anki: File › Import, chọn file vừa tải, note type “Basic”.`);
});

function download(name, text, type) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

// ---------- settings ----------

$('open-settings').addEventListener('click', () => openSettings());

async function openSettings(note) {
  const s = await S.getSettings();
  const form = $('settings-form');
  const f = form.elements;
  const models = S.MODELS.some((m) => m.id === s.model) ? S.MODELS : S.MODELS.concat({ id: s.model, label: s.model });
  f.model.innerHTML = models.map((m) => `<option value="${esc(m.id)}">${esc(m.label)}</option>`).join('');
  f.oaPreset.innerHTML = S.OPENAI_PRESETS.map((p) => `<option value="${esc(p.id)}">${esc(p.label)}</option>`).join('');
  for (const name of ['explainLanguage', 'learnerProfile', 'apiKey', 'model', 'oaPreset', 'oaBaseUrl', 'oaApiKey', 'oaModel']) {
    f[name].value = s[name] || '';
  }
  for (const name of ['enabled', 'showSaveButton']) f[name].checked = !!s[name];
  f.provider.value = s.provider;
  f.newPerDay.value = s.newPerDay;
  $('oa-models').innerHTML = '';
  $('models-status').hidden = true;
  showProviderFields();
  setNote(note);
  $('settings-dialog').showModal();
  if (note) {
    const missing = s.provider === 'openai' ? (s.oaModel ? f.oaBaseUrl : f.oaModel) : f.apiKey;
    missing.focus();
  }
}

function setNote(text, kind) {
  $('settings-note').hidden = !text;
  $('settings-note').textContent = text || '';
  $('settings-note').className = kind === 'error' ? 'error' : 'dlg-note';
}

function showProviderFields() {
  const f = $('settings-form').elements;
  const openai = f.provider.value === 'openai';
  $('anthropic-fields').hidden = openai;
  $('openai-fields').hidden = !openai;
  $('opencode-note').hidden = f.oaPreset.value !== 'opencode-go';
}

function formSettings() {
  const f = $('settings-form').elements;
  return {
    explainLanguage: f.explainLanguage.value.trim() || S.DEFAULT_SETTINGS.explainLanguage,
    learnerProfile: f.learnerProfile.value.trim(),
    provider: f.provider.value || 'anthropic',
    apiKey: f.apiKey.value.trim(),
    model: f.model.value,
    oaPreset: f.oaPreset.value,
    oaBaseUrl: f.oaBaseUrl.value.trim(),
    oaApiKey: f.oaApiKey.value.trim(),
    oaModel: f.oaModel.value.trim(),
    enabled: f.enabled.checked,
    showSaveButton: f.showSaveButton.checked,
    newPerDay: Math.max(0, Math.min(999, parseInt(f.newPerDay.value, 10) || 0)),
  };
}

// Extension pages need host access to call a service outside api.anthropic.com.
// Call it straight from a click handler, before any await: Chrome only asks during a user gesture.
function askHostAccess(url) {
  let origin;
  try {
    origin = new URL(url).origin;
  } catch (e) {
    return Promise.resolve(false);
  }
  if (!chrome.permissions) return Promise.resolve(true);
  return chrome.permissions.request({ origins: [origin + '/*'] });
}

$('settings-form').addEventListener('change', (e) => {
  const f = $('settings-form').elements;
  if (e.target.name === 'oaPreset') {
    const preset = S.OPENAI_PRESETS.find((p) => p.id === f.oaPreset.value);
    if (preset && preset.baseUrl) f.oaBaseUrl.value = preset.baseUrl;
    f.oaModel.value = '';
    $('oa-models').innerHTML = '';
    $('models-status').hidden = true;
  }
  if (e.target.name === 'provider' || e.target.name === 'oaPreset') showProviderFields();
});

$('load-models').addEventListener('click', async () => {
  const s = formSettings();
  const msg = $('models-status');
  const granted = await askHostAccess(s.oaBaseUrl);
  msg.hidden = false;
  if (!granted) {
    msg.textContent = 'Chưa có quyền truy cập Base URL này, hoặc Base URL không hợp lệ.';
    return;
  }
  msg.textContent = 'Đang tải…';
  try {
    const ids = await S.fetchModels(s);
    $('oa-models').innerHTML = ids.map((id) => `<option value="${esc(id)}"></option>`).join('');
    msg.textContent = ids.length
      ? `Có ${ids.length} model. Bấm vào ô Model để chọn, hoặc gõ tên.`
      : 'Dịch vụ không trả về model nào. Hãy gõ tên model.';
    if (ids.length) $('oa-model').focus();
  } catch (err) {
    msg.textContent = err.message;
  }
});

$('settings-save').addEventListener('click', async (e) => {
  e.preventDefault();
  const s = formSettings();
  if (s.provider === 'openai') {
    const granted = await askHostAccess(s.oaBaseUrl);
    if (!granted) {
      setNote('Không lưu được: Base URL không hợp lệ, hoặc bạn chưa cho phép truy cập địa chỉ này.', 'error');
      return;
    }
  }
  await S.saveSettings(s);
  $('settings-dialog').close();
  // Without a Claude key, Copy prompt still works, so only an unfinished OpenAI setup is worth a warning.
  const problem = s.provider === 'openai' ? S.providerProblem(s) : '';
  status('Đã lưu cài đặt.' + (problem ? ` Lưu ý: ${esc(problem)}` : ''));
});

$('backup-export').addEventListener('click', () => {
  const data = { app: 'so-tu', version: 1, exportedAt: new Date().toISOString(), items: state.items };
  download(`so-tu-backup-${today()}.json`, JSON.stringify(data, null, 2), 'application/json');
});

$('backup-import').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    const items = Array.isArray(data) ? data : data.items;
    if (!Array.isArray(items)) throw new Error('File không có danh sách items.');
    const n = await S.importItems(items);
    $('settings-dialog').close();
    status(`Đã nhập ${n} mục từ bản sao lưu.`);
  } catch (err) {
    $('settings-dialog').close();
    status('Không nhập được: ' + esc(err.message), 'error');
  }
});

load();
