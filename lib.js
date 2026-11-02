// Shared logic for the content script, background worker, popup, notebook page and Node tests.
// Everything hangs off globalThis.SoTu so classic scripts and importScripts() can share it.
(function (root) {
  'use strict';

  const KEY_PREFIX = 'item:';
  const SETTINGS_KEY = 'settings';
  const MAX_TEXT = 2000;
  const MAX_CONTEXT = 600;
  const API_URL = 'https://api.anthropic.com/v1/messages';
  const API_VERSION = '2026-10-21';

  const MODELS = [
    { id: 'claude-opus-5-5', label: 'Claude Opus 5.5 — giải thích kỹ nhất' },
    { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5 — nhanh hơn, rẻ hơn' },
    { id: 'claude-haiku-5-5', label: 'Claude Haiku 5.5 — rẻ nhất' },
  ];

  // OpenAI-compatible services. baseUrl is everything before /chat/completions.
  const OPENAI_PRESETS = [
    {
      id: 'opencode-go',
      label: 'OpenCode Go',
      baseUrl: 'https://opencode.ai/inference/go/openai/v1',
      modelsUrl: 'https://opencode.ai/inference/go/v1/models',
      sessionHeader: 'x-opencode-session',
    },
    { id: 'openai', label: 'OpenAI', baseUrl: 'https://api.openai.com/v1' },
    { id: 'openrouter', label: 'OpenRouter', baseUrl: 'https://openrouter.ai/api/v1' },
    { id: 'ollama', label: 'Ollama (chạy trên máy)', baseUrl: 'http://localhost:11434/v1' },
    { id: 'custom', label: 'Tự nhập', baseUrl: '' },
  ];

  const DEFAULT_SETTINGS = {
    enabled: true,
    showSaveButton: true,
    explainLanguage: 'Tiếng Việt',
    learnerProfile: '',
    provider: 'anthropic', // 'anthropic' or 'openai' (any OpenAI-compatible service)
    apiKey: '',
    model: 'claude-opus-5-5',
    oaPreset: 'opencode-go',
    oaBaseUrl: OPENAI_PRESETS[0].baseUrl,
    oaApiKey: '',
    oaModel: '',
    newPerDay: 20,
  };

  const KIND_LABELS = { word: 'Từ', phrase: 'Cụm từ', passage: 'Đoạn' };

  // ---------- text ----------

  function cleanText(s) {
    return String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    })[c]);
  }

  // Escapes the context and wraps the first match of text in <tag>.
  function highlight(context, text, tag) {
    tag = tag || 'mark';
    const at = text ? context.toLowerCase().indexOf(text.toLowerCase()) : -1;
    if (at < 0) return escapeHtml(context);
    return escapeHtml(context.slice(0, at)) +
      '<' + tag + '>' + escapeHtml(context.slice(at, at + text.length)) + '</' + tag + '>' +
      escapeHtml(context.slice(at + text.length));
  }

  function hash(str) {
    // FNV-1a, 32 bit.
    let h = 0x811c9dc5;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    return (h >>> 0).toString(16).padStart(8, '0');
  }

  function normalizeUrl(url) {
    try {
      const u = new URL(url);
      u.hash = '';
      return u.href;
    } catch (e) {
      return String(url || '');
    }
  }

  // Same text on the same page maps to the same item, so repeat lookups count up.
  // The "i" prefix keeps ids from looking like numbers when an AI echoes them back.
  function itemId(text, url) {
    return 'i' + hash(cleanText(text).toLowerCase() + '|' + normalizeUrl(url));
  }

  function countWords(text) {
    const seg = new Intl.Segmenter(undefined, { granularity: 'word' });
    let n = 0;
    for (const s of seg.segment(text)) if (s.isWordLike) n++;
    return n;
  }

  function classify(text) {
    const n = countWords(text);
    if (n <= 1) return 'word';
    if (n <= 6) return 'phrase';
    return 'passage';
  }

  // Returns the sentence(s) around blockText[start, end). Works for any language
  // through Intl.Segmenter. Returns '' when the selection already is the whole context.
  function sentenceContext(blockText, start, end) {
    const winStart = Math.max(0, start - 1500);
    const text = blockText.slice(winStart, Math.min(blockText.length, end + 1500));
    const s = start - winStart;
    const e = Math.max(s + 1, end - winStart);
    const sentences = [];
    for (const x of new Intl.Segmenter(undefined, { granularity: 'sentence' }).segment(text)) {
      sentences.push({ from: x.index, to: x.index + x.segment.length });
    }
    const first = sentences.findIndex((x) => x.to > s);
    if (first < 0) return '';
    let last = first;
    while (last + 1 < sentences.length && sentences[last + 1].from < e) last++;

    const selected = cleanText(text.slice(s, e));
    let ctx = cleanText(text.slice(sentences[first].from, sentences[last].to));
    // The selection already is a full sentence: add one sentence on each side.
    if (ctx.length <= selected.length + 3) {
      const a = Math.max(0, first - 1);
      const b = Math.min(sentences.length - 1, last + 1);
      ctx = cleanText(text.slice(sentences[a].from, sentences[b].to));
    }
    if (ctx.length <= selected.length + 3) return '';
    return clipAround(ctx, selected);
  }

  function clipAround(ctx, selected) {
    if (ctx.length <= MAX_CONTEXT) return ctx;
    const at = ctx.toLowerCase().indexOf(selected.toLowerCase());
    if (at < 0) return ctx.slice(0, MAX_CONTEXT) + '…';
    const half = Math.max(80, Math.floor((MAX_CONTEXT - selected.length) / 2));
    const from = Math.max(0, at - half);
    const to = Math.min(ctx.length, at + selected.length + half);
    return (from > 0 ? '…' : '') + ctx.slice(from, to) + (to < ctx.length ? '…' : '');
  }

  function chunk(list, size) {
    const out = [];
    for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
    return out;
  }

  // ---------- storage (chrome.storage.local, one key per item) ----------

  function store() {
    return root.chrome.storage.local;
  }

  async function getSettings() {
    const got = await store().get(SETTINGS_KEY);
    return Object.assign({}, DEFAULT_SETTINGS, got[SETTINGS_KEY] || {});
  }

  async function saveSettings(patch) {
    const next = Object.assign(await getSettings(), patch);
    await store().set({ [SETTINGS_KEY]: next });
    return next;
  }

  async function getItems() {
    const all = await store().get(null);
    return Object.keys(all)
      .filter((k) => k.startsWith(KEY_PREFIX))
      .map((k) => all[k])
      .sort((a, b) => b.lastSeenAt - a.lastSeenAt);
  }

  // Returns { item, previous } so the caller can undo the capture.
  async function addCapture(c) {
    const text = cleanText(c.text);
    const id = itemId(text, c.url);
    const key = KEY_PREFIX + id;
    const previous = (await store().get(key))[key] || null;
    const now = Date.now();
    const item = previous
      ? Object.assign({}, previous, {
        count: (previous.count || 1) + 1,
        lastSeenAt: now,
        context: previous.context || c.context || '',
      })
      : {
        id,
        text,
        kind: classify(text),
        context: c.context || '',
        heading: c.heading || '',
        lang: c.lang || '',
        url: c.url || '',
        title: c.title || '',
        createdAt: now,
        lastSeenAt: now,
        count: 1,
        explanation: null,
        explainedAt: null,
      };
    await store().set({ [key]: item });
    return { item, previous };
  }

  async function undoCapture(capture) {
    const key = KEY_PREFIX + capture.item.id;
    if (capture.previous) await store().set({ [key]: capture.previous });
    else await store().remove(key);
  }

  async function removeItems(ids) {
    await store().remove(ids.map((id) => KEY_PREFIX + id));
  }

  async function saveExplanations(list) {
    const keys = list.map((x) => KEY_PREFIX + x.id);
    const got = await store().get(keys);
    const now = Date.now();
    const patch = {};
    for (const ex of list) {
      const key = KEY_PREFIX + ex.id;
      if (!got[key]) continue;
      const explanation = Object.assign({}, ex);
      delete explanation.id;
      patch[key] = Object.assign({}, got[key], { explanation, explainedAt: now });
    }
    const matched = Object.keys(patch).length;
    if (matched) await store().set(patch);
    return { matched, unmatched: list.length - matched };
  }

  // Merges a backup. Keeps whichever copy of an item was seen last.
  async function importItems(items) {
    const valid = items.filter((x) => x && typeof x.id === 'string' && typeof x.text === 'string');
    const got = await store().get(valid.map((x) => KEY_PREFIX + x.id));
    const patch = {};
    for (const it of valid) {
      const cur = got[KEY_PREFIX + it.id];
      if (!cur || (it.lastSeenAt || 0) > (cur.lastSeenAt || 0) || (!cur.explanation && it.explanation)) {
        patch[KEY_PREFIX + it.id] = it;
      }
    }
    if (Object.keys(patch).length) await store().set(patch);
    return Object.keys(patch).length;
  }

  // ---------- AI prompt and results ----------

  const EXPLANATION_SCHEMA = {
    type: 'object',
    properties: {
      items: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            meaning: { type: 'string' },
            explanation: { type: 'string' },
            pronunciation: { type: 'string' },
            partOfSpeech: { type: 'string' },
            examples: { type: 'array', items: { type: 'string' } },
            related: { type: 'array', items: { type: 'string' } },
            note: { type: 'string' },
            sourceLanguage: { type: 'string' },
          },
          required: ['id', 'meaning', 'explanation', 'pronunciation', 'partOfSpeech',
            'examples', 'related', 'note', 'sourceLanguage'],
          additionalProperties: false,
        },
      },
    },
    required: ['items'],
    additionalProperties: false,
  };

  function systemPrompt(settings) {
    const lang = settings.explainLanguage || DEFAULT_SETTINGS.explainLanguage;
    const lines = [
      'You are a patient reading tutor.',
      'The learner marked the items below while reading because they did not understand them. ' +
        'Explain each item so the learner understands it in the place where it appeared and can remember it later.',
      `Write all explanations in ${lang}. Keep the item itself and the example sentences in the item's original language.`,
    ];
    if (settings.learnerProfile) lines.push(`About the learner: ${settings.learnerProfile}`);
    lines.push(
      '',
      'Fields for each item:',
      '- id: copy the id from the input.',
      '- meaning: the meaning in this context, in one short line.',
      '- explanation: why it means that here. For a passage, restate it in simple words, explain the hard parts and give the main point. 2 to 6 sentences.',
      '- pronunciation: IPA, pinyin, romaji or similar when it helps; empty string otherwise.',
      '- partOfSpeech: the word class for a word or phrase; empty string for a passage.',
      `- examples: 2 short new example sentences in the item's language, each followed by its translation in ${lang} in parentheses.`,
      '- related: up to 5 related words, synonyms, antonyms, collocations or idioms worth learning; empty list if none.',
      '- note: grammar, usage, register, cultural or word-origin notes that help memory; empty string if none.',
      `- sourceLanguage: the name of the item's language, written in ${lang}.`,
      'If an item is a name, a typo or a fragment with no meaning of its own, say so in meaning and keep the other fields short.',
    );
    return lines.join('\n');
  }

  function userPrompt(items) {
    const payload = items.map((it) => {
      const o = { id: it.id, kind: it.kind, text: it.text };
      if (it.context) o.context = it.context;
      if (it.heading) o.section = it.heading;
      if (it.title) o.source = it.title;
      if (it.lang) o.pageLanguage = it.lang;
      return o;
    });
    return 'Items:\n' + JSON.stringify(payload, null, 2);
  }

  const JSON_REPLY = 'Reply with one JSON object of the form {"items": [ ... ]} that has exactly these fields for every item, ' +
    'inside a ```json code block, and nothing else.';

  // One block of text to paste into any chat AI (Claude.ai, ChatGPT, Gemini...).
  function chatPrompt(items, settings) {
    return systemPrompt(settings) + '\n\n' + userPrompt(items) + '\n\n' + JSON_REPLY;
  }

  function normalizeExplanation(x) {
    const str = (v) => (typeof v === 'string' ? v.trim() : '');
    const arr = (v) => (Array.isArray(v) ? v.map((s) => String(s).trim()).filter(Boolean) : []);
    return {
      id: String(x.id).trim(),
      meaning: str(x.meaning),
      explanation: str(x.explanation),
      pronunciation: str(x.pronunciation),
      partOfSpeech: str(x.partOfSpeech),
      examples: arr(x.examples),
      related: arr(x.related),
      note: str(x.note),
      sourceLanguage: str(x.sourceLanguage),
    };
  }

  // Accepts raw JSON, a ```json block, or JSON wrapped in chat text.
  function parseAIResult(text) {
    // Reasoning models may put their thinking in <think> tags before the answer.
    let s = String(text || '').replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
    const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fence) s = fence[1].trim();
    const open = s.search(/[[{]/);
    if (open > 0) s = s.slice(open);
    const close = Math.max(s.lastIndexOf('}'), s.lastIndexOf(']'));
    if (close >= 0) s = s.slice(0, close + 1);
    let data;
    try {
      data = JSON.parse(s);
    } catch (e) {
      throw new Error('Kết quả không phải JSON hợp lệ: ' + e.message);
    }
    const list = Array.isArray(data) ? data : data && data.items;
    if (!Array.isArray(list)) throw new Error('Không thấy danh sách "items" trong kết quả.');
    return list
      .filter((x) => x && (typeof x.id === 'string' || typeof x.id === 'number'))
      .map(normalizeExplanation);
  }

  // Server-side refusal fallback is available on these model families, not on Haiku.
  function supportsFallback(model) {
    return /^claude-(opus|sonnet|fable)-/.test(model);
  }

  function buildApiRequest(items, settings) {
    const model = settings.model || DEFAULT_SETTINGS.model;
    const headers = {
      'content-type': 'application/json',
      'x-api-key': settings.apiKey,
      'anthropic-version': API_VERSION,
      'anthropic-dangerous-direct-browser-access': 'true',
    };
    const body = {
      model,
      max_tokens: 16000,
      system: systemPrompt(settings),
      messages: [{ role: 'user', content: userPrompt(items) }],
      output_config: {
        effort: 'medium',
        format: { type: 'json_schema', schema: EXPLANATION_SCHEMA },
      },
    };
    if (supportsFallback(model)) {
      headers['anthropic-beta'] = 'server-side-fallback-2026-07-01';
      body.fallbacks = 'default';
    }
    return { url: API_URL, init: { method: 'POST', headers, body: JSON.stringify(body) } };
  }

  async function explainWithClaude(items, settings, fetchImpl) {
    if (!settings.apiKey) throw new Error('Chưa có API key. Mở Cài đặt để nhập, hoặc dùng "Copy prompt".');
    const req = buildApiRequest(items, settings);
    const res = await (fetchImpl || root.fetch.bind(root))(req.url, req.init);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const msg = (data.error && data.error.message) || res.statusText;
      throw new Error(`Claude API lỗi ${res.status}: ${msg}`);
    }
    if (data.stop_reason === 'refusal') throw new Error('Claude từ chối giải thích nhóm mục này.');
    if (data.stop_reason === 'max_tokens') throw new Error('Kết quả bị cắt vì quá dài. Chọn ít mục hơn rồi thử lại.');
    const text = (data.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('');
    return parseAIResult(text);
  }

  // ---------- OpenAI-compatible services ----------

  function presetOf(settings) {
    return OPENAI_PRESETS.find((p) => p.id === settings.oaPreset) || OPENAI_PRESETS[OPENAI_PRESETS.length - 1];
  }

  // Accepts a base URL with or without a trailing slash or /chat/completions.
  function trimBase(url) {
    return String(url || '').trim().replace(/\/+$/, '').replace(/\/chat\/completions$/, '');
  }

  function providerName(settings) {
    if (settings.provider !== 'openai') return 'Claude API';
    const preset = presetOf(settings);
    if (preset.id !== 'custom') return preset.label;
    try {
      return new URL(trimBase(settings.oaBaseUrl)).host;
    } catch (e) {
      return 'AI';
    }
  }

  // Returns what is missing in the settings to call the chosen AI, or ''.
  function providerProblem(settings) {
    if (settings.provider === 'openai') {
      if (!/^https?:\/\/[^/]+/i.test(trimBase(settings.oaBaseUrl))) return 'Chưa có Base URL hợp lệ. Mở Cài đặt để nhập.';
      if (!settings.oaModel) return 'Chưa chọn model. Mở Cài đặt để chọn.';
      return '';
    }
    return settings.apiKey ? '' : 'Chưa có Claude API key.';
  }

  function openAIHeaders(settings, sessionId) {
    const headers = { 'content-type': 'application/json' };
    if (settings.oaApiKey) headers.authorization = 'Bearer ' + settings.oaApiKey;
    const preset = presetOf(settings);
    if (preset.sessionHeader && sessionId) headers[preset.sessionHeader] = sessionId;
    return headers;
  }

  function modelsUrl(settings) {
    const preset = presetOf(settings);
    const base = trimBase(settings.oaBaseUrl);
    return preset.modelsUrl && base === preset.baseUrl ? preset.modelsUrl : base + '/models';
  }

  async function fetchModels(settings, fetchImpl) {
    const headers = openAIHeaders(settings);
    delete headers['content-type'];
    const res = await (fetchImpl || root.fetch.bind(root))(modelsUrl(settings), { headers });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`Không tải được danh sách model (${res.status}).`);
    const list = Array.isArray(data.data) ? data.data : Array.isArray(data.models) ? data.models : [];
    return list.map((m) => (typeof m === 'string' ? m : m.id || m.name)).filter(Boolean).sort();
  }

  function buildOpenAIRequest(items, settings, sessionId) {
    const body = {
      model: settings.oaModel,
      messages: [
        { role: 'system', content: systemPrompt(settings) },
        { role: 'user', content: userPrompt(items) + '\n\n' + JSON_REPLY },
      ],
    };
    return {
      url: trimBase(settings.oaBaseUrl) + '/chat/completions',
      init: { method: 'POST', headers: openAIHeaders(settings, sessionId), body: JSON.stringify(body) },
    };
  }

  async function explainWithOpenAI(items, settings, fetchImpl, sessionId) {
    const problem = providerProblem(settings);
    if (problem) throw new Error(problem);
    const req = buildOpenAIRequest(items, settings, sessionId);
    const res = await (fetchImpl || root.fetch.bind(root))(req.url, req.init);
    const raw = await res.text();
    let data = {};
    try {
      data = JSON.parse(raw);
    } catch (e) {
      // Not JSON: keep the raw text for the error message.
    }
    if (!res.ok) {
      const err = data.error;
      const msg = (typeof err === 'string' ? err : err && err.message) || data.message || raw.slice(0, 200) || res.statusText;
      throw new Error(`${providerName(settings)} lỗi ${res.status}: ${msg}`);
    }
    const choice = data.choices && data.choices[0];
    if (!choice || !choice.message) throw new Error(`${providerName(settings)} không trả về nội dung.`);
    if (choice.finish_reason === 'length') throw new Error('Kết quả bị cắt vì quá dài. Chọn ít mục hơn rồi thử lại.');
    const content = choice.message.content;
    const text = Array.isArray(content) ? content.map((p) => p.text || '').join('') : String(content || '');
    return parseAIResult(text);
  }

  // Calls whichever AI the settings choose.
  function explain(items, settings, fetchImpl, sessionId) {
    return settings.provider === 'openai'
      ? explainWithOpenAI(items, settings, fetchImpl, sessionId)
      : explainWithClaude(items, settings, fetchImpl);
  }

  // ---------- spaced repetition (Anki-style SM-2) ----------
  // Every explained item is a card. Its schedule lives in item.srs:
  // { state: 'new'|'learning'|'review'|'relearning', step, interval (days), ease, due, reps, lapses, firstReview, lastReview }

  const MIN = 60000;
  const DAY = 86400000;
  const ROLLOVER_HOUR = 4; // a study day starts at 04:00, like Anki
  const LEARN_STEPS = [1, 10]; // minutes
  const RELEARN_STEPS = [10];
  const GRADUATE_DAYS = 1;
  const EASY_DAYS = 4;
  const START_EASE = 2.5;
  const MIN_EASE = 1.3;
  const MAX_DAYS = 36500;
  const LEARN_AHEAD = 20 * MIN; // when nothing else is due, show learning cards due this soon

  function dayStart(ts) {
    const d = new Date(ts - ROLLOVER_HOUR * 3600000);
    d.setHours(0, 0, 0, 0);
    return d.getTime() + ROLLOVER_HOUR * 3600000;
  }

  // grade: 1 = again, 2 = hard, 3 = good, 4 = easy. Returns a new srs object.
  function rate(prev, grade, now) {
    const s = Object.assign({ state: 'new', step: 0, interval: 0, ease: START_EASE, reps: 0, lapses: 0 }, prev || {});
    s.reps += 1;
    s.lastReview = now;
    if (!s.firstReview) s.firstReview = now;
    if (s.state === 'new') {
      s.state = 'learning';
      s.step = 0;
    }

    const inMinutes = (m) => { s.due = now + Math.round(m * MIN); return s; };
    const inDays = (d) => {
      s.interval = Math.min(MAX_DAYS, Math.max(1, Math.round(d)));
      s.state = 'review';
      s.step = 0;
      s.due = dayStart(now) + s.interval * DAY;
      return s;
    };

    if (s.state === 'learning' || s.state === 'relearning') {
      const steps = s.state === 'learning' ? LEARN_STEPS : RELEARN_STEPS;
      const step = Math.min(s.step, steps.length - 1);
      const after = s.state === 'learning' ? GRADUATE_DAYS : s.interval;
      if (grade === 1) {
        s.step = 0;
        return inMinutes(steps[0]);
      }
      if (grade === 2) {
        return inMinutes(step === 0 && steps.length > 1 ? (steps[0] + steps[1]) / 2 : steps[step]);
      }
      if (grade === 3) {
        if (step + 1 < steps.length) {
          s.step = step + 1;
          return inMinutes(steps[s.step]);
        }
        return inDays(after);
      }
      return inDays(s.state === 'learning' ? EASY_DAYS : after + 1);
    }

    // Review card.
    const ivl = Math.max(1, s.interval);
    if (grade === 1) {
      s.lapses += 1;
      s.ease = Math.max(MIN_EASE, s.ease - 0.2);
      s.interval = 1;
      s.state = 'relearning';
      s.step = 0;
      return inMinutes(RELEARN_STEPS[0]);
    }
    const hard = Math.max(ivl + 1, ivl * 1.2);
    const good = Math.max(hard + 1, ivl * s.ease);
    const easy = Math.max(good + 1, ivl * s.ease * 1.3);
    if (grade === 2) {
      s.ease = Math.max(MIN_EASE, s.ease - 0.15);
      return inDays(hard);
    }
    if (grade === 3) return inDays(good);
    s.ease += 0.15;
    return inDays(easy);
  }

  function formatInterval(ms) {
    const num = (n) => n.toLocaleString('vi-VN', { maximumFractionDigits: 1 });
    const m = ms / MIN;
    if (m < 1) return '<1 phút';
    if (m < 60) return Math.round(m) + ' phút';
    if (m < 24 * 60) return Math.round(m / 60) + ' giờ';
    const d = m / (24 * 60);
    if (d < 30) return Math.round(d) + ' ngày';
    if (d < 365) return num(d / 30) + ' tháng';
    return num(d / 365) + ' năm';
  }

  // Label for each grade button: what happens if the card gets that grade now.
  function previewIntervals(prev, now) {
    return [1, 2, 3, 4].map((g) => {
      const s = rate(prev, g, now);
      return s.state === 'review' ? formatInterval(s.interval * DAY) : formatInterval(s.due - now);
    });
  }

  function isNewCard(it) {
    return !it.srs || it.srs.state === 'new';
  }

  // Cards to study now. fresh is capped by newPerDay minus new cards already started today.
  function studyQueue(items, now, newPerDay) {
    const cards = items.filter((it) => it.explanation);
    const byDue = (a, b) => a.srs.due - b.srs.due;
    const learning = cards
      .filter((it) => it.srs && (it.srs.state === 'learning' || it.srs.state === 'relearning') && it.srs.due <= now + LEARN_AHEAD)
      .sort(byDue);
    const review = cards.filter((it) => it.srs && it.srs.state === 'review' && it.srs.due <= now).sort(byDue);
    const started = cards.filter((it) => it.srs && it.srs.firstReview >= dayStart(now)).length;
    const limit = Math.max(0, (newPerDay == null ? 20 : newPerDay) - started);
    const fresh = cards.filter(isNewCard).sort((a, b) => a.createdAt - b.createdAt).slice(0, limit);
    return { learning, review, fresh, total: learning.length + review.length + fresh.length };
  }

  // Order: learning cards due now, reviews, new cards, then learning cards due within LEARN_AHEAD.
  function nextCard(queue, now) {
    return queue.learning.find((it) => it.srs.due <= now) || queue.review[0] || queue.fresh[0] || queue.learning[0] || null;
  }

  // When the next card (outside today's queue) becomes due, or null.
  function nextDueAt(items) {
    const dues = items.filter((it) => it.explanation && it.srs && it.srs.state !== 'new').map((it) => it.srs.due);
    return dues.length ? Math.min(...dues) : null;
  }

  async function saveRating(item, grade, now) {
    const srs = rate(item.srs, grade, now);
    await store().set({ [KEY_PREFIX + item.id]: Object.assign({}, item, { srs }) });
    return srs;
  }

  // ---------- Anki export ----------

  // Tab-separated text with Anki file headers: File > Import, note type "Basic".
  function toAnki(items) {
    const field = (s) => String(s).replace(/\t/g, ' ').replace(/\r?\n/g, '<br>');
    const lines = ['#separator:tab', '#html:true', '#tags column:3'];
    for (const it of items) {
      const ex = it.explanation;
      if (!ex) continue;
      const front = `<div style="font-size:1.4em">${escapeHtml(it.text)}</div>` +
        (it.context ? `<div style="margin-top:.6em;color:#666">${highlight(it.context, it.text, 'b')}</div>` : '');
      const sub = [ex.pronunciation, ex.partOfSpeech].filter(Boolean).join(' · ');
      const back = [
        ex.meaning && `<div><b>${escapeHtml(ex.meaning)}</b></div>`,
        sub && `<div><i>${escapeHtml(sub)}</i></div>`,
        ex.explanation && `<p>${escapeHtml(ex.explanation)}</p>`,
        ex.examples && ex.examples.length && `<ul>${ex.examples.map((e) => `<li>${escapeHtml(e)}</li>`).join('')}</ul>`,
        ex.related && ex.related.length && `<div>↔ ${escapeHtml(ex.related.join(', '))}</div>`,
        ex.note && `<div><small>${escapeHtml(ex.note)}</small></div>`,
        it.title && `<div style="color:#999"><small>${escapeHtml(it.title)}</small></div>`,
      ].filter(Boolean).join('');
      const tags = ['so-tu', it.kind, ex.sourceLanguage]
        .filter(Boolean).map((t) => t.replace(/\s+/g, '_')).join(' ');
      lines.push([front, back, tags].map(field).join('\t'));
    }
    return lines.join('\n') + '\n';
  }

  const SoTu = {
    KEY_PREFIX, SETTINGS_KEY, MAX_TEXT, MODELS, OPENAI_PRESETS, DEFAULT_SETTINGS, KIND_LABELS, EXPLANATION_SCHEMA,
    cleanText, escapeHtml, highlight, hash, itemId, classify, sentenceContext, chunk,
    getSettings, saveSettings, getItems, addCapture, undoCapture, removeItems, saveExplanations, importItems,
    systemPrompt, userPrompt, chatPrompt, parseAIResult, buildApiRequest, explainWithClaude, toAnki,
    presetOf, providerName, providerProblem, modelsUrl, fetchModels, buildOpenAIRequest, explainWithOpenAI, explain,
    DAY, dayStart, rate, formatInterval, previewIntervals, studyQueue, nextCard, nextDueAt, saveRating,
  };

  root.SoTu = SoTu;
  if (typeof module !== 'undefined' && module.exports) module.exports = SoTu;
})(globalThis);
