const S = globalThis.SoTu;

(async () => {
  const [settings, items] = await Promise.all([S.getSettings(), S.getItems()]);
  const due = S.studyQueue(items, Date.now(), settings.newPerDay).total;
  const fresh = items.filter((i) => !i.explanation).length;
  const today = new Date().setHours(0, 0, 0, 0);
  const todayCount = items.filter((i) => i.lastSeenAt >= today).length;
  document.getElementById('stats').innerHTML =
    `<b>${due}</b> thẻ cần ôn · <b>${fresh}</b> chưa giải thích · <b>${todayCount}</b> lưu hôm nay`;
  document.getElementById('study').textContent = due ? `Ôn tập (${due} thẻ)` : 'Ôn tập';

  for (const name of ['enabled', 'showSaveButton']) {
    const box = document.getElementById(name);
    box.checked = !!settings[name];
    box.addEventListener('change', () => S.saveSettings({ [name]: box.checked }));
  }
})();

function openNotebook(view) {
  chrome.tabs.create({ url: chrome.runtime.getURL('review.html') + '#' + view });
  window.close();
}

document.getElementById('study').addEventListener('click', () => openNotebook('study'));
document.getElementById('open').addEventListener('click', () => openNotebook('new'));
