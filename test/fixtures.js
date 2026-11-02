// Test data for notebook.html (?seed loads it, ?reset clears) and a fake Claude API.
(() => {
  const KEY = 'sotu-test-store';
  const params = new URLSearchParams(location.search);
  if (params.has('reset')) localStorage.removeItem(KEY);

  if (params.has('seed')) {
    const now = Date.now();
    const H = 3600000;
    const items = [
      {
        id: 'i0000a001', kind: 'word', text: 'tepid', count: 2, lang: 'en',
        context: "The committee's decision was met with a tepid response.",
        heading: 'Budget news', title: 'Council cuts library hours — The Daily', url: 'https://example.com/news/council',
        createdAt: now - 26 * H, lastSeenAt: now - 1 * H,
        explanation: {
          meaning: 'hờ hững, không mấy nhiệt tình',
          explanation: 'Nghĩa gốc là "âm ấm" (nước không nóng không lạnh). Ở đây dùng nghĩa bóng: phản ứng của mọi người với quyết định chỉ ở mức chiếu lệ, không ủng hộ mạnh cũng không phản đối mạnh.',
          pronunciation: '/ˈtɛpɪd/', partOfSpeech: 'tính từ',
          examples: ['The film got a tepid reception. (Bộ phim được đón nhận khá hờ hững.)', 'Drink tepid water after exercise. (Uống nước âm ấm sau khi tập.)'],
          related: ['lukewarm', 'half-hearted', 'enthusiastic (trái nghĩa)'],
          note: 'Hay đi với: tepid response, tepid support, tepid applause.',
          sourceLanguage: 'Tiếng Anh',
        },
        explainedAt: now - 1 * H,
      },
      {
        id: 'i0000a002', kind: 'phrase', text: 'rock the boat', count: 1, lang: 'en',
        context: 'Nobody wanted to rock the boat.', heading: 'Budget news',
        title: 'Council cuts library hours — The Daily', url: 'https://example.com/news/council',
        createdAt: now - 2 * H, lastSeenAt: now - 2 * H, explanation: null, explainedAt: null,
      },
      {
        id: 'i0000a003', kind: 'word', text: 'そっけなかった', count: 1, lang: 'ja',
        context: '彼の態度はそっけなかったが、悪気はなかったと思う。', heading: '日記',
        title: 'ブログ', url: 'https://example.jp/blog/1',
        createdAt: now - 3 * H, lastSeenAt: now - 3 * H, explanation: null, explainedAt: null,
      },
      {
        id: 'i0000a004', kind: 'passage', count: 1, lang: 'en',
        text: 'Critics argued that the plan was ostensibly about safety, but in reality it was a cost-cutting measure.',
        context: "The committee's decision was met with a tepid response. Critics argued that the plan was ostensibly about safety, but in reality it was a cost-cutting measure. Nobody wanted to rock the boat.",
        heading: 'Budget news', title: 'Council cuts library hours — The Daily', url: 'https://example.com/news/council',
        createdAt: now - 4 * H, lastSeenAt: now - 4 * H, explanation: null, explainedAt: null,
      },
      {
        id: 'i0000a005', kind: 'word', text: 'idempotent', count: 3, lang: 'en',
        context: 'PUT requests should be idempotent, so retrying them is safe.', heading: 'HTTP methods',
        title: 'MDN — HTTP request methods', url: 'https://developer.mozilla.org/en-US/docs/Web/HTTP/Methods',
        createdAt: now - 30 * H, lastSeenAt: now - 30 * H, explanation: null, explainedAt: null,
      },
    ];
    const d = { settings: { apiKey: params.has('nokey') ? '' : 'test-key', model: 'claude-opus-5-5' } };
    for (const it of items) d['item:' + it.id] = it;
    localStorage.setItem(KEY, JSON.stringify(d));
  }

  // Fake Claude API and fake OpenAI-compatible service (opencode.ai): one explanation per id.
  const realFetch = window.fetch.bind(window);
  const json = (obj) => new Response(JSON.stringify(obj), { status: 200, headers: { 'content-type': 'application/json' } });
  const explainIds = (content) => {
    const list = content.slice(content.indexOf('['), content.lastIndexOf(']') + 1);
    return JSON.parse(list).map((x) => x.id).map((id) => ({
      id, meaning: '(giả lập) nghĩa của ' + id, explanation: 'Giải thích giả lập.', pronunciation: '',
      partOfSpeech: '', examples: ['Example one. (Ví dụ một.)'], related: ['foo'], note: '', sourceLanguage: 'Tiếng Anh',
    }));
  };
  window.fetch = async (url, init) => {
    url = String(url);
    const anthropic = url.startsWith('https://api.anthropic.com/');
    const openai = url.startsWith('https://opencode.ai/');
    if (!anthropic && !openai) return realFetch(url, init);
    window.__lastApiRequest = { url, headers: init && init.headers, body: init && init.body ? JSON.parse(init.body) : null };
    await new Promise((r) => setTimeout(r, 400));
    if (url.endsWith('/models')) return json({ object: 'list', data: [{ id: 'kimi-k3' }, { id: 'glm-5.3' }, { id: 'deepseek-v4-pro' }] });
    const body = window.__lastApiRequest.body;
    if (anthropic) {
      const items = explainIds(body.messages[0].content);
      return json({ stop_reason: 'end_turn', content: [{ type: 'thinking', thinking: '' }, { type: 'text', text: JSON.stringify({ items }) }] });
    }
    const items = explainIds(body.messages[1].content.split('\n\nReply with')[0]);
    return json({ choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: '```json\n' + JSON.stringify({ items }) + '\n```' } }] });
  };
})();
