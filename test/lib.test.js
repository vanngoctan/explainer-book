// Run: node --test test/
const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('../lib.js');

function memoryChrome() {
  const data = {};
  const pick = (keys) => {
    if (keys == null) return { ...data };
    const list = Array.isArray(keys) ? keys : [keys];
    return Object.fromEntries(list.filter((k) => k in data).map((k) => [k, structuredClone(data[k])]));
  };
  return {
    data,
    storage: {
      local: {
        get: async (keys) => pick(keys),
        set: async (obj) => { Object.assign(data, structuredClone(obj)); },
        remove: async (keys) => { for (const k of [].concat(keys)) delete data[k]; },
      },
    },
  };
}

function ctx(block, word) {
  const start = block.indexOf(word);
  return S.sentenceContext(block, start, start + word.length);
}

test('sentenceContext picks the sentence around a word', () => {
  const block = 'The cat sat. Its demeanor was aloof and calm. Then it left.';
  assert.equal(ctx(block, 'aloof'), 'Its demeanor was aloof and calm.');
});

test('sentenceContext works for Japanese', () => {
  const block = '今日は晴れです。彼の態度はそっけなかった。明日は雨です。';
  assert.equal(ctx(block, 'そっけなかった'), '彼の態度はそっけなかった。');
});

test('sentenceContext widens when the selection is a whole sentence', () => {
  const block = 'First one. Second sentence here. Third one.';
  assert.equal(ctx(block, 'Second sentence here.'), block);
});

test('sentenceContext returns empty when selection is the whole block', () => {
  const block = 'Only one sentence.';
  assert.equal(ctx(block, block), '');
});

test('sentenceContext clips long sentences around the selection', () => {
  const block = 'a '.repeat(600) + 'TARGET ' + 'b '.repeat(600) + '.';
  const out = ctx(block, 'TARGET');
  assert.ok(out.includes('TARGET'));
  assert.ok(out.length <= 620, `length ${out.length}`);
  assert.ok(out.startsWith('…') && out.endsWith('…'));
});

test('classify by word count', () => {
  assert.equal(S.classify('serendipity'), 'word');
  assert.equal(S.classify('take for granted'), 'phrase');
  assert.equal(S.classify('This is a much longer sentence that the reader did not get.'), 'passage');
});

test('itemId is stable, case-insensitive and ignores URL hash', () => {
  const a = S.itemId('Aloof', 'https://x.com/a#p1');
  const b = S.itemId(' aloof ', 'https://x.com/a#p2');
  assert.equal(a, b);
  assert.match(a, /^i[0-9a-f]{8}$/);
  assert.notEqual(a, S.itemId('aloof', 'https://x.com/b'));
});

test('highlight escapes HTML and marks the match', () => {
  assert.equal(S.highlight('a <b> Word c', 'word'), 'a &lt;b&gt; <mark>Word</mark> c');
  assert.equal(S.highlight('<x>', 'zzz'), '&lt;x&gt;');
});

test('parseAIResult reads fenced JSON wrapped in chat text', () => {
  const text = 'Sure!\n```json\n{"items":[{"id":"i1","meaning":"xa cách","examples":["a"],"related":[]}]}\n```\nDone.';
  const out = S.parseAIResult(text);
  assert.equal(out.length, 1);
  assert.equal(out[0].id, 'i1');
  assert.equal(out[0].meaning, 'xa cách');
  assert.equal(out[0].note, '');
  assert.deepEqual(out[0].examples, ['a']);
});

test('parseAIResult accepts a bare array and rejects junk', () => {
  assert.equal(S.parseAIResult('[{"id":"i2","meaning":"m"}]').length, 1);
  assert.throws(() => S.parseAIResult('no json here'), /JSON/);
  assert.throws(() => S.parseAIResult('{"foo":1}'), /items/);
});

test('chatPrompt carries every item id and the explain language', () => {
  const items = [{ id: 'i1', kind: 'word', text: 'aloof', context: 'Its demeanor was aloof.' }];
  const p = S.chatPrompt(items, { ...S.DEFAULT_SETTINGS, explainLanguage: 'Tiếng Việt' });
  assert.ok(p.includes('"id": "i1"'));
  assert.ok(p.includes('Tiếng Việt'));
  assert.ok(p.includes('```json'));
});

test('buildApiRequest uses structured output and fallback only where supported', () => {
  const items = [{ id: 'i1', kind: 'word', text: 'aloof' }];
  const opus = S.buildApiRequest(items, { ...S.DEFAULT_SETTINGS, apiKey: 'k' });
  const body = JSON.parse(opus.init.body);
  assert.equal(body.model, 'claude-opus-5-5');
  assert.equal(body.output_config.format.type, 'json_schema');
  assert.equal(body.fallbacks, 'default');
  assert.equal(opus.init.headers['anthropic-beta'], 'server-side-fallback-2026-07-01');
  assert.equal(body.temperature, undefined);

  const haiku = S.buildApiRequest(items, { ...S.DEFAULT_SETTINGS, apiKey: 'k', model: 'claude-haiku-5-5' });
  assert.equal(JSON.parse(haiku.init.body).fallbacks, undefined);
  assert.equal(haiku.init.headers['anthropic-beta'], undefined);
});

test('explainWithClaude parses text blocks and reports refusals', async () => {
  const items = [{ id: 'i1', kind: 'word', text: 'aloof' }];
  const settings = { ...S.DEFAULT_SETTINGS, apiKey: 'k' };
  const ok = async () => ({
    ok: true,
    json: async () => ({
      stop_reason: 'end_turn',
      content: [{ type: 'thinking', thinking: '' }, { type: 'text', text: '{"items":[{"id":"i1","meaning":"xa cách"}]}' }],
    }),
  });
  const out = await S.explainWithClaude(items, settings, ok);
  assert.equal(out[0].meaning, 'xa cách');

  const refused = async () => ({ ok: true, json: async () => ({ stop_reason: 'refusal', content: [] }) });
  await assert.rejects(S.explainWithClaude(items, settings, refused), /từ chối/);

  const bad = async () => ({ ok: false, status: 401, statusText: 'Unauthorized', json: async () => ({ error: { message: 'invalid x-api-key' } }) });
  await assert.rejects(S.explainWithClaude(items, settings, bad), /401: invalid x-api-key/);

  await assert.rejects(S.explainWithClaude(items, { ...settings, apiKey: '' }, ok), /API key/);
});

test('addCapture counts repeats, undo restores, explanations attach', async () => {
  globalThis.chrome = memoryChrome();
  const c = { text: 'aloof ', context: 'Its demeanor was aloof.', url: 'https://x.com/a', title: 'X' };
  const first = await S.addCapture(c);
  assert.equal(first.item.count, 1);
  assert.equal(first.previous, null);
  const second = await S.addCapture(c);
  assert.equal(second.item.count, 2);
  await S.undoCapture(second);
  assert.equal((await S.getItems())[0].count, 1);

  const r = await S.saveExplanations([{ id: first.item.id, meaning: 'xa cách', examples: [], related: [] }, { id: 'inope' }]);
  assert.deepEqual(r, { matched: 1, unmatched: 1 });
  const [item] = await S.getItems();
  assert.equal(item.explanation.meaning, 'xa cách');
  assert.equal(item.explanation.id, undefined);

  await S.undoCapture(first);
  assert.equal((await S.getItems()).length, 0);
});

test('toAnki writes headers, one escaped row per explained item', () => {
  const items = [
    {
      id: 'i1', kind: 'word', text: 'aloof', context: 'He was <aloof>\tthere.', title: 'Book',
      explanation: { meaning: 'xa cách', pronunciation: '/əˈluːf/', partOfSpeech: 'adj', explanation: 'line1\nline2', examples: ['e1'], related: ['distant'], note: '', sourceLanguage: 'Tiếng Anh' },
    },
    { id: 'i2', kind: 'word', text: 'skip', explanation: null },
  ];
  const out = S.toAnki(items).trimEnd().split('\n');
  assert.deepEqual(out.slice(0, 3), ['#separator:tab', '#html:true', '#tags column:3']);
  assert.equal(out.length, 4);
  const cols = out[3].split('\t');
  assert.equal(cols.length, 3);
  assert.ok(cols[0].includes('&lt;<b>aloof</b>&gt;'));
  assert.ok(cols[1].includes('line1<br>line2'));
  assert.equal(cols[2], 'so-tu word Tiếng_Anh');
});

test('parseAIResult drops <think> blocks from reasoning models', () => {
  const out = S.parseAIResult('<think>maybe {"items": []} ?</think>\n{"items":[{"id":"i9","meaning":"m"}]}');
  assert.equal(out.length, 1);
  assert.equal(out[0].id, 'i9');
});

test('buildOpenAIRequest targets chat/completions with bearer key and opencode session', () => {
  const items = [{ id: 'i1', kind: 'word', text: 'aloof' }];
  const settings = {
    ...S.DEFAULT_SETTINGS, provider: 'openai', oaPreset: 'opencode-go',
    oaBaseUrl: 'https://opencode.ai/inference/go/openai/v1/', oaApiKey: 'k', oaModel: 'glm-5.3',
  };
  const req = S.buildOpenAIRequest(items, settings, 'sess-1');
  assert.equal(req.url, 'https://opencode.ai/inference/go/openai/v1/chat/completions');
  assert.equal(req.init.headers.authorization, 'Bearer k');
  assert.equal(req.init.headers['x-opencode-session'], 'sess-1');
  const body = JSON.parse(req.init.body);
  assert.equal(body.model, 'glm-5.3');
  assert.equal(body.messages[0].role, 'system');
  assert.ok(body.messages[1].content.includes('"id": "i1"'));
  assert.ok(body.messages[1].content.includes('```json'));

  const plain = S.buildOpenAIRequest(items, { ...settings, oaPreset: 'ollama', oaBaseUrl: 'http://localhost:11434/v1/chat/completions', oaApiKey: '' }, 'sess-1');
  assert.equal(plain.url, 'http://localhost:11434/v1/chat/completions');
  assert.equal(plain.init.headers.authorization, undefined);
  assert.equal(plain.init.headers['x-opencode-session'], undefined);
});

test('modelsUrl uses the preset list URL only for the preset base URL', () => {
  const go = { ...S.DEFAULT_SETTINGS, provider: 'openai' };
  assert.equal(S.modelsUrl(go), 'https://opencode.ai/inference/go/v1/models');
  assert.equal(S.modelsUrl({ ...go, oaPreset: 'custom', oaBaseUrl: 'https://x.ai/v1/' }), 'https://x.ai/v1/models');
});

test('explainWithOpenAI reads choices, reports truncation and errors', async () => {
  const items = [{ id: 'i1', kind: 'word', text: 'aloof' }];
  const settings = { ...S.DEFAULT_SETTINGS, provider: 'openai', oaApiKey: 'k', oaModel: 'glm-5.3' };
  const reply = (status, obj) => async () => ({ ok: status < 400, status, statusText: '', text: async () => (typeof obj === 'string' ? obj : JSON.stringify(obj)) });

  const ok = reply(200, { choices: [{ finish_reason: 'stop', message: { content: '```json\n{"items":[{"id":"i1","meaning":"xa cách"}]}\n```' } }] });
  assert.equal((await S.explain(items, settings, ok, 's'))[0].meaning, 'xa cách');

  const cut = reply(200, { choices: [{ finish_reason: 'length', message: { content: '{"items":[' } }] });
  await assert.rejects(S.explain(items, settings, cut), /bị cắt/);

  const denied = reply(401, { error: { message: 'Invalid API key' } });
  await assert.rejects(S.explain(items, settings, denied), /OpenCode Go lỗi 401: Invalid API key/);

  const html = reply(502, '<html>Bad gateway</html>');
  await assert.rejects(S.explain(items, settings, html), /502: <html>Bad gateway/);

  await assert.rejects(S.explain(items, { ...settings, oaModel: '' }, ok), /model/);
});

test('fetchModels reads OpenAI-style model lists', async () => {
  const settings = { ...S.DEFAULT_SETTINGS, provider: 'openai', oaApiKey: 'k' };
  let seen;
  const fake = async (url, init) => {
    seen = { url, init };
    return { ok: true, status: 200, json: async () => ({ object: 'list', data: [{ id: 'kimi-k3' }, { id: 'glm-5.3' }] }) };
  };
  assert.deepEqual(await S.fetchModels(settings, fake), ['glm-5.3', 'kimi-k3']);
  assert.equal(seen.url, 'https://opencode.ai/inference/go/v1/models');
  assert.equal(seen.init.headers.authorization, 'Bearer k');
});

test('providerProblem and providerName follow the chosen provider', () => {
  assert.match(S.providerProblem({ ...S.DEFAULT_SETTINGS }), /Claude API key/);
  assert.equal(S.providerProblem({ ...S.DEFAULT_SETTINGS, apiKey: 'k' }), '');
  const oa = { ...S.DEFAULT_SETTINGS, provider: 'openai', oaModel: 'm' };
  assert.equal(S.providerProblem(oa), '');
  assert.match(S.providerProblem({ ...oa, oaBaseUrl: 'nope' }), /Base URL/);
  assert.equal(S.providerName(oa), 'OpenCode Go');
  assert.equal(S.providerName({ ...oa, oaPreset: 'custom', oaBaseUrl: 'https://api.groq.com/openai/v1' }), 'api.groq.com');
});

// ---------- spaced repetition ----------

const at = (y, mo, d, h, mi = 0) => new Date(y, mo - 1, d, h, mi).getTime();

test('dayStart rolls over at 04:00 local time', () => {
  assert.equal(S.dayStart(at(2026, 11, 2, 21)), at(2026, 11, 2, 4));
  assert.equal(S.dayStart(at(2026, 11, 3, 2)), at(2026, 11, 2, 4));
});

test('new card: learning steps, then graduates to 1 day; easy jumps to 4 days', () => {
  const now = at(2026, 11, 2, 21);
  let s = S.rate(null, 3, now);
  assert.equal(s.state, 'learning');
  assert.equal(s.due - now, 10 * 60000);
  s = S.rate(s, 3, now);
  assert.equal(s.state, 'review');
  assert.equal(s.interval, 1);
  assert.equal(s.due, at(2026, 11, 3, 4));
  assert.equal(S.rate(null, 4, now).interval, 4);
  assert.equal(S.rate(null, 1, now).due - now, 60000);
  assert.equal(S.rate(null, 2, now).due - now, 5.5 * 60000);
});

test('review card: intervals grow in order, again lapses into relearning', () => {
  const now = at(2026, 11, 10, 9);
  const card = { state: 'review', interval: 10, ease: 2.5, reps: 5, lapses: 0, step: 0, due: now };
  const [hard, good, easy] = [2, 3, 4].map((g) => S.rate(card, g, now));
  assert.deepEqual([hard.interval, good.interval, easy.interval], [12, 25, 33]);
  assert.equal(hard.ease, 2.35);
  assert.equal(easy.ease, 2.65);

  const lapse = S.rate(card, 1, now);
  assert.equal(lapse.state, 'relearning');
  assert.equal(lapse.lapses, 1);
  assert.equal(lapse.ease, 2.3);
  assert.equal(lapse.due - now, 10 * 60000);
  const back = S.rate(lapse, 3, now);
  assert.equal(back.state, 'review');
  assert.equal(back.interval, 1);

  let low = { ...card, ease: 1.35 };
  low = S.rate(low, 1, now);
  assert.equal(low.ease, 1.3);
});

test('previewIntervals labels each grade', () => {
  const now = at(2026, 11, 2, 21);
  assert.deepEqual(S.previewIntervals(null, now), ['1 phút', '6 phút', '10 phút', '4 ngày']);
  const card = { state: 'review', interval: 10, ease: 2.5, reps: 5, lapses: 0, step: 0, due: now };
  assert.deepEqual(S.previewIntervals(card, now), ['10 phút', '12 ngày', '25 ngày', '1,1 tháng']);
});

test('studyQueue orders learning, review, new and caps new cards per day', () => {
  const now = at(2026, 11, 2, 21);
  const ex = { meaning: 'm' };
  const items = [
    { id: 'a', createdAt: 1, explanation: ex },
    { id: 'b', createdAt: 2, explanation: ex },
    { id: 'c', createdAt: 3, explanation: ex },
    { id: 'u', createdAt: 0, explanation: null },
    { id: 'r', createdAt: 4, explanation: ex, srs: { state: 'review', due: now - 1, firstReview: 0 } },
    { id: 'f', createdAt: 5, explanation: ex, srs: { state: 'review', due: now + S.DAY, firstReview: 0 } },
    { id: 'l', createdAt: 6, explanation: ex, srs: { state: 'learning', due: now - 1, firstReview: now - 60000 } },
    { id: 'soon', createdAt: 7, explanation: ex, srs: { state: 'learning', due: now + 5 * 60000, firstReview: now - 60000 } },
  ];
  const q = S.studyQueue(items, now, 3);
  assert.deepEqual(q.learning.map((i) => i.id), ['l', 'soon']);
  assert.deepEqual(q.review.map((i) => i.id), ['r']);
  assert.deepEqual(q.fresh.map((i) => i.id), ['a']); // 3 per day, 2 already started today
  assert.equal(q.total, 4);
  assert.equal(S.nextCard(q, now).id, 'l');
  const later = S.studyQueue(items.filter((i) => !['l', 'r', 'a', 'b', 'c'].includes(i.id)), now, 3);
  assert.equal(S.nextCard(later, now).id, 'soon');
  assert.equal(S.nextDueAt(items), now - 1);
});
