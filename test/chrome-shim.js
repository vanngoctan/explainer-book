// Minimal chrome.* stand-in so content.js and review.js run on a plain web page for manual testing.
// Data lives in localStorage, so the capture page and the notebook page share it.
(() => {
  const KEY = 'sotu-test-store';
  const listeners = [];
  const load = () => {
    try {
      return JSON.parse(localStorage.getItem(KEY)) || {};
    } catch (e) {
      return {};
    }
  };
  const save = (d) => localStorage.setItem(KEY, JSON.stringify(d));
  const clone = (v) => (v === undefined ? v : JSON.parse(JSON.stringify(v)));
  const emit = (changes) => listeners.forEach((fn) => fn(changes, 'local'));

  window.chrome = {
    storage: {
      local: {
        async get(keys) {
          const d = load();
          if (keys == null) return d;
          const out = {};
          for (const k of [].concat(keys)) if (k in d) out[k] = d[k];
          return out;
        },
        async set(obj) {
          const d = load();
          const changes = {};
          for (const [k, v] of Object.entries(obj)) {
            changes[k] = { oldValue: d[k], newValue: clone(v) };
            d[k] = clone(v);
          }
          save(d);
          emit(changes);
        },
        async remove(keys) {
          const d = load();
          const changes = {};
          for (const k of [].concat(keys)) {
            if (k in d) {
              changes[k] = { oldValue: d[k] };
              delete d[k];
            }
          }
          save(d);
          emit(changes);
        },
      },
      onChanged: { addListener: (fn) => listeners.push(fn) },
    },
    runtime: { onMessage: { addListener() {} }, getURL: (p) => p },
    tabs: { create: ({ url }) => window.open(url) },
  };

  // Writes from another tab of the test pages.
  window.addEventListener('storage', (e) => {
    if (e.key === KEY) emit({ [KEY]: {} });
  });
})();
