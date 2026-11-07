// Run: node --test tests/journalView.mjs
// Set CHROME_BIN to override the Chrome executable. Skips if Chrome is unavailable.
// Renders the production view in real Chrome with local fixtures; makes no API calls.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { build } from 'esbuild';

const chromeBin =
	process.env.CHROME_BIN || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
let available = true;
try {
	await access(chromeBin);
} catch {
	available = false;
}

const fixture = String.raw`
import { WereadJournalView } from './src/components/wereadJournal';
import { WereadFavoritesPanel } from './src/components/wereadFavorites';
import { settingsStore } from './src/settings';
const RealDate = Date;
const NOW = RealDate.parse('2026-11-06T04:00:00Z');
window.Date = class extends RealDate {
  constructor(...args) { if (args.length) super(...args); else super(NOW); }
  static now() { return NOW; }
};
Math.random = () => 0;
const intervals = new Set();
const originalSet = window.setInterval.bind(window);
const originalClear = window.clearInterval.bind(window);
window.setInterval = (...args) => { const id = originalSet(...args); intervals.add(id); return id; };
window.clearInterval = (id) => { intervals.delete(id); originalClear(id); };
const create = function(tag, options = {}) {
  if (typeof options === 'string') options = { cls: options };
  const node = document.createElement(tag);
  if (options.cls) node.className = options.cls;
  if (options.text !== undefined) node.textContent = options.text;
  for (const key of ['type', 'href', 'value']) if (options[key] !== undefined) node[key] = options[key];
  for (const [key, value] of Object.entries(options.attr || {})) {
    if (tag === 'img' && key === 'src' && String(value).startsWith('https://fixture.invalid/')) {
      const color = String(value).includes('latest') ? '#a68a64' : String(value).includes('third') ? '#647e87' : '#718562';
      node.src = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="64" height="90"><rect width="64" height="90" rx="3" fill="' + color + '"/><text x="32" y="39" text-anchor="middle" fill="#fff" font-size="12" font-family="serif">阅读</text><path d="M12 63h40M12 68h28" stroke="#fff" stroke-opacity=".45"/></svg>');
      node.loading = 'eager';
    } else node.setAttribute(key, value);
  }
  if (tag === 'img' && node.src.startsWith('data:image/svg+xml,')) node.loading = 'eager';
  this.append(node);
  return node;
};
HTMLElement.prototype.createEl = create;
HTMLElement.prototype.createDiv = function(options) { return create.call(this, 'div', options); };
HTMLElement.prototype.createSpan = function(options) { return create.call(this, 'span', options); };
HTMLElement.prototype.empty = function() { this.replaceChildren(); };
HTMLElement.prototype.addClass = function(...names) { this.classList.add(...names); };
HTMLElement.prototype.setText = function(text) { this.textContent = text; };
const check = (value, message) => { if (!value) throw new Error(message); assertions.push(message); };
const assertions = [];
const clipboardWrites = [];
let clipboardFails = false;
Object.defineProperty(navigator, 'clipboard', {configurable: true, value: {async writeText(text) { if (clipboardFails) throw new Error('clipboard denied'); clipboardWrites.push(text); }}});
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
const gate = () => { let resolve; const promise = new Promise((done) => { resolve = done; }); return {promise, resolve}; };
const note = (id, bookId, kind, text, date) => ({
  id: bookId + ':' + kind + ':' + id, bookId, kind, text, createTime: RealDate.parse(date), cover: 'https://fixture.invalid/' + bookId + '.svg',
  bookTitle: bookId === 'a' ? '山间的阅读' : '城市与记忆', author: bookId === 'a' ? '林间' : '周行',
  chapterTitle: '在日常里发现光', sourceUrl: 'weread://reading?bId=' + bookId
});
const baseNotes = [
  note('today-h', 'a', 'highlight', '晨光穿过树叶，阅读让平凡的一天有了新的层次。', '2026-11-05T16:30:00Z'),
  note('today-r', 'a', 'thought', '今日想法：慢下来，看见身边被忽略的细节。', '2026-11-06T02:00:00Z'),
  note('old-one', 'a', 'highlight', '昨日句子：脚步可以慢一些，方向要清楚。', '2026-11-05T15:59:00Z'),
  note('old-two', 'a', 'highlight', '另一个旧句：在山与水之间，找回内心的安静。', '2026-11-05T08:00:00Z'),
  note('other-book', 'b', 'highlight', '城市记忆：每一条街道都藏着故事。', '2026-11-04T02:00:00Z'),
  note('anniversary', 'b', 'thought', '去年今日：书页记录了成长的痕迹。', '2025-11-06T02:00:00Z'),
  note('future', 'b', 'thought', 'FUTURE SENTINEL', '2026-11-06T16:30:00Z')
];
let state = { notes: baseNotes, totalBooks: 2, scannedBooks: 2, failedBooks: 0, updatedAt: NOW, syncing: false, error: '', hasCache: true };
const listeners = new Set();
const journal = {
  getSnapshot: () => state,
  subscribe(listener) { listeners.add(listener); listener(state); return () => listeners.delete(listener); },
  async load() { journalLoads++; return state; },
  publish(next = state) { state = next; for (const listener of listeners) listener(state); }
};
let favoriteState = { favorites: [], loaded: true, loading: false, writable: true, error: '', warning: '', pendingIds: [] };
const favoriteListeners = new Set();
let favoriteWriteGate;
let favoriteWriteFails = false;
let favoriteWrites = 0;
let canvasEnsureGate;
let canvasEnsureFails = false;
let canvasEnsureCalls = 0;
let canvasOpenFails = false;
const canvasOpens = [];
const favoriteLoads = [];
let journalLoads = 0;
const favorites = {
  getSnapshot: () => favoriteState,
  subscribe(listener) { favoriteListeners.add(listener); listener(favoriteState); return () => favoriteListeners.delete(listener); },
  publish(patch = {}) { favoriteState = {...favoriteState, ...patch}; for (const listener of favoriteListeners) listener(favoriteState); },
  async load(force) { favoriteLoads.push(force); return favoriteState; },
  isFavorite(id) { return favoriteState.favorites.some(entry => entry.id === id); },
  async write(id, change) {
    favoriteWrites++; this.publish({pendingIds: [id]});
    try {
      if (favoriteWriteGate) await favoriteWriteGate.promise;
      if (favoriteWriteFails) throw new Error('FAKE DISK WRITE FAILED');
      change(); this.publish({pendingIds: [], error: ''});
    } catch (error) { this.publish({pendingIds: [], error: error.message}); throw error; }
  },
  async setFavorite(note, active) {
    await this.write(note.id, () => { favoriteState.favorites = favoriteState.favorites.filter(entry => entry.id !== note.id); if (active) favoriteState.favorites.push({id: note.id, note: {...note}, favoritedAt: NOW, updatedAt: NOW}); });
  },
  async remove(id) { await this.write(id, () => { favoriteState.favorites = favoriteState.favorites.filter(entry => entry.id !== id); }); },
  async restore(entry) { await this.write(entry.id, () => { favoriteState.favorites = [...favoriteState.favorites.filter(current => current.id !== entry.id), {...entry, note: {...entry.note}}]; }); },
  async ensureCanvas() {
    canvasEnsureCalls++;
    if (canvasEnsureGate) await canvasEnsureGate.promise;
    if (canvasEnsureFails) throw new Error('CANVAS ENSURE FAILED FIXTURE');
    return 'WereadData/favorites/favorites.canvas';
  }
};
const settings = (key) => ({ wereadApiKey: key, userVid: '', cookies: [], journalRefreshHours: 24, journalExcludedBookIds: [], favoritesViewMode: 'cards' });
settingsStore.set(settings('account-a'));
const plugin = {
  app: {workspace: {async openLinkText(...args) {
    if (canvasOpenFails) throw new Error('CANVAS OPEN FAILED FIXTURE');
    canvasOpens.push(args);
  }}},
  favoritesService: favorites,
  async activateJournalView() {}, async activateBookshelfView() {}, async activateReadingStatsView() {},
  async activateBookDetailView() {}
};
let apiCalls = 0;
let api = {
  async getShelf() { apiCalls++; return {books: [
    { bookId: 'older', title: 'OLDER BOOK SENTINEL', author: '旧书', readUpdateTime: NOW / 1000 - 400 },
    { bookId: 'a', title: '山间的阅读', author: '林间', readUpdateTime: NOW / 1000 - 60 },
    { bookId: 'third', title: '第三本今日书', author: '作者三', readUpdateTime: NOW / 1000 - 120 },
    { bookId: 'latest', title: '新书', author: '作者一', readUpdateTime: NOW / 1000 - 30 },
    { bookId: 'fourth', title: 'FOURTH BOOK SENTINEL', author: '作者四', readUpdateTime: NOW / 1000 - 300 },
    { bookId: 'b', title: 'YESTERDAY BOOK SENTINEL', readUpdateTime: RealDate.parse('2026-11-05T15:59:00Z') / 1000 }
  ].map((book) => ({...book, cover: 'https://fixture.invalid/' + book.bookId + '.svg'}))}; },
  async getReadingStats() { apiCalls++; return { readTimes: { [RealDate.parse('2026-11-05T16:00:00Z') / 1000]: 3660 } }; }
};
let view;
let favoritesPreviewPanel;
const closeFavoritesPreview = async () => {
  if (!favoritesPreviewPanel) return;
  await favoritesPreviewPanel.onClose();
  favoritesPreviewPanel.contentEl.remove();
  favoritesPreviewPanel = undefined;
};
const mount = async (mode, cache = journal, router = api) => {
  if (view) { await view.onClose(); view.contentEl.remove(); }
  view = new WereadJournalView({}, plugin, cache, router, mode);
  await view.onOpen(); await tick(); return view;
};
const click = (label, root = document) => {
  const button = [...root.querySelectorAll('button')].find((node) => node.textContent === label);
  check(button && !button.disabled, 'button available: ' + label); button.click();
};
const cards = (root = document) => [...root.querySelectorAll('article')].map((node) => node.textContent);
const results = () => document.querySelector('.weread-journal-day-notes');
window.smoke = {
  assertions,
  async favoritesPreview(mode = 'cards') {
    await closeFavoritesPreview();
    if (view) { await view.onClose(); view.contentEl.remove(); view = undefined; }
    settingsStore.actions.setFavoritesViewMode(mode);
    favorites.publish({
      loaded: true, loading: false, writable: true, error: '', warning: '', pendingIds: [],
      favorites: [baseNotes[0], baseNotes[2], baseNotes[4]].map((note, index) => ({
        id: note.id, note: {...note}, favoritedAt: NOW - index * 86400000, updatedAt: NOW - index * 86400000
      }))
    });
    const host = document.createElement('main'); document.body.append(host);
    favoritesPreviewPanel = new WereadFavoritesPanel(host, plugin, favorites);
    await favoritesPreviewPanel.onOpen();
    if (mode === 'list') host.querySelector('.weread-favorites-summary').click();
    await tick();
    check(host.querySelectorAll('article').length === 3 && host.querySelector('.is-' + mode), 'Favorites preview mounts three realistic records in ' + mode);
    check(document.documentElement.scrollWidth <= innerWidth, 'Favorites ' + mode + ' preview fits its viewport');
  },
  async closeFavoritesPreview() { await closeFavoritesPreview(); },
  async today() {
    await mount('today');
    check(document.body.textContent.includes('1小时1分钟'), 'Today reads local-day duration');
    check(document.querySelector('.weread-journal-summary').textContent.includes('今日划线1 条'), 'Today counts highlight after UTC midnight boundary');
    const completeState = { ...state, syncing: false, failedBooks: 0, error: '' };
    const metricCards = () => [...document.querySelector('.weread-journal-today-metrics-grid').children];
    journal.publish({ ...completeState, notes: [], syncing: true, scannedBooks: 428, totalBooks: 565 });
    check(metricCards().slice(1).every(card => card.querySelector('strong').textContent === '0 条'), 'Partial zero counts contain only numbers and units');
    check(metricCards().slice(1).every(card => card.querySelector('small.weread-journal-metric-status')?.textContent === '统计中，当前为部分结果'), 'In-progress counts explain partial coverage below the value');
    check(!metricCards()[0].querySelector('.weread-journal-metric-status'), 'Note coverage does not qualify the independent reading duration');
    check(metricCards().slice(1).every(card => parseFloat(getComputedStyle(card.querySelector('small')).fontSize) < parseFloat(getComputedStyle(card.querySelector('strong')).fontSize)), 'Coverage uses smaller type than the metric value');
    journal.publish({ ...completeState, notes: [], syncing: false, failedBooks: 1 });
    check(metricCards().slice(1).every(card => card.querySelector('strong').textContent === '0 条' && card.querySelector('small')?.textContent === '部分书籍加载失败，当前为部分结果'), 'Failed coverage stays distinct from a complete zero count');
    journal.publish({ ...completeState, notes: [], hasCache: false, syncing: true });
    check(metricCards().slice(1).every(card => card.querySelector('strong').textContent === '加载中…'), 'No initial cache never claims a known zero');
    journal.publish(completeState);
    check(!document.querySelector('.weread-journal-metric-status'), 'Complete successful statistics remove partial-result hints');
    const traces = document.querySelector('.weread-journal-today-notes');
    check(cards(traces).some((text) => text.includes('晨光穿过树叶')), 'Today renders local-day highlight');
    check(!cards(traces).some((text) => text.includes('昨日句子') || text.includes('FUTURE SENTINEL')), 'Today notes exclude yesterday and future notes');
    const summary = document.querySelector('.weread-journal-summary');
    const metrics = summary.querySelector('.weread-journal-today-metrics');
    check(summary.children.length === 2 && metrics.querySelector('.weread-journal-today-metrics-grid').children.length === 3 && summary.lastElementChild.classList.contains('weread-journal-today-books'), 'Today overview groups three metrics and books into two halves');
    check(metrics.querySelector('span').textContent === '阅读时长', 'Duration uses the requested reading-only label');
    const titles = [...summary.querySelectorAll('.weread-journal-today-book-list .weread-journal-source')].map((node) => node.textContent);
    check(JSON.stringify(titles) === JSON.stringify(['《新书》', '《山间的阅读》', '《第三本今日书》']), 'Today books are sorted by recency and limited to the latest three');
    check(!summary.textContent.includes('OLDER BOOK SENTINEL') && !summary.textContent.includes('FOURTH BOOK SENTINEL'), 'Older same-day books are omitted');
    if (innerWidth > 1000) {
      const left = metrics.getBoundingClientRect(), right = summary.lastElementChild.getBoundingClientRect();
      check(left.width < right.width && Math.abs(left.top - right.top) < 1, 'Metrics card is narrower than the books card');
      const list = summary.querySelector('.weread-journal-today-book-list');
      check(Math.abs(list.lastElementChild.getBoundingClientRect().right - list.getBoundingClientRect().right) < 1, 'Book cards fill the available width without unused right-side space');
      const links = [...summary.querySelectorAll('.weread-journal-original')].map(node => node.getBoundingClientRect());
      check(links.length === 3 && links.every(rect => Math.abs(rect.bottom - links[0].bottom) < 1), 'Reading links align at the bottom despite different title lengths');
      check(metrics.querySelector('.weread-journal-today-metrics-grid').getBoundingClientRect().left > left.left, 'Metrics are inset inside their own card');
    }
    const quote = () => document.querySelector('.weread-journal-quote');
    check(quote().querySelector('h2').textContent === '旧句重逢' && !quote().textContent.includes('晨光穿过树叶'), 'Today quote reencounters a past highlight even when today has a highlight');
    click('换一句', quote());
    check(!quote().textContent.includes('晨光穿过树叶'), 'Change quote stays among past highlights');
    click('换一本', quote());
    check(quote().textContent.includes('城市记忆') && quote().querySelector('h2').textContent === '旧句重逢', 'Change book also keeps the old-quote scope');
    const metadata = quote().querySelector('.weread-journal-note-meta');
    check(metadata.children[0].tagName === 'SMALL' && metadata.children[1].tagName === 'A' && metadata.children[2].tagName === 'BUTTON', 'Original and copy icons follow the note kind and date');
    check(metadata.querySelector('a[aria-label] svg') && metadata.querySelector('button[aria-label="复制正文"] svg'), 'Actions have icons and accessible names');
    check(!quote().querySelector('.weread-journal-original'), 'Text footer link is removed from note cards');
    const copy = metadata.querySelector('button');
    copy.click(); await tick();
    check(clipboardWrites.at(-1) === quote().querySelector('.weread-journal-note-text').textContent && window.journalNotices.at(-1) === '已复制', 'Copy writes the exact body and confirms success');
    clipboardFails = true; const written = clipboardWrites.length; copy.click(); await tick(); clipboardFails = false;
    check(clipboardWrites.length === written && window.journalNotices.at(-1) === '复制失败，请重试', 'Clipboard failure gives feedback without claiming success');
    check(!document.body.textContent.includes('YESTERDAY BOOK SENTINEL'), 'Today shelf excludes previous local day');
    check(document.querySelector('a[href^="weread://"]'), 'Original source links rendered');
    return assertions;
  },
  async review() {
    await mount('review');
    check(document.body.textContent.includes('去年今日'), 'Review includes anniversary thought');
    const quote = document.querySelector('.weread-journal-quote');
    const before = quote.querySelector('article').textContent;
    click('换一句', quote);
    check(document.querySelector('.weread-journal-quote article').textContent !== before, 'Quote changes within same book');
    click('换一本', document.querySelector('.weread-journal-quote'));
    check(document.querySelector('.weread-journal-quote article').textContent.includes('城市与记忆'), 'Quote changes book');
    let search = document.querySelector('input[type=search]');
    search.value = '城市记忆'; search.dispatchEvent(new Event('input'));
    check(cards(results()).length === 1 && cards(results())[0].includes('城市记忆'), 'Search finds cached notes across dates');
    search.focus(); search.setSelectionRange(1, 3);
    journal.publish({ ...state, syncing: true });
    search = document.querySelector('input[type=search]');
    check(document.activeElement === search && search.selectionStart === 1 && search.selectionEnd === 3, 'Search focus and selection survive cache progress');
    search.value = ''; search.dispatchEvent(new Event('input'));
    const day = document.querySelector('button[aria-label^="2026-11-05，"]'); day.click();
    check(cards(results()).filter((text) => !text.includes('去年今日')).length === 2 && cards(results()).filter((text) => !text.includes('去年今日')).every((text) => text.includes('旧句') || text.includes('昨日句子')), 'Calendar day selection filters local dates');
    const select = document.querySelector('select'); select.value = 'thought'; select.dispatchEvent(new Event('change'));
    check(cards(results()).length === 0 && results().textContent.includes('这个范围内还没有笔记') && cards(document.querySelector('.weread-journal-anniversaries')).every((text) => text.includes('去年今日')), 'Kind filter applies to selected calendar day and separate anniversaries');
    select.value = 'all'; select.dispatchEvent(new Event('change'));
    journal.publish({ ...state, syncing: false, failedBooks: 1, error: '1 本书未完整获取' });
    check(document.querySelector('.weread-journal-status').textContent.includes('1 本未完整获取'), 'Partial state is visible beside cached content');
    return assertions;
  },
  async layout() {
    await mount('review');
    const calendar = document.querySelector('.weread-journal-calendar');
    const box = calendar.getBoundingClientRect();
    check(box.width <= 261 && results().getBoundingClientRect().left >= box.right, 'Desktop uses compact left calendar and right notes');
    const day = calendar.querySelector('.weread-journal-day');
    check(day.getBoundingClientRect().width <= 36 && day.getBoundingClientRect().height <= 42, 'Calendar days stay compact under host button styles');
    check(getComputedStyle(document.querySelector('h1')).fontFamily.includes('Songti SC') && getComputedStyle(document.querySelector('.weread-journal-note-text')).fontFamily.includes('Songti SC'), 'Reference serif stack is applied to heading and reading prose');
    check(Boolean(document.querySelector('.weread-journal-retro-grid').compareDocumentPosition(document.querySelector('.weread-journal-quote')) & Node.DOCUMENT_POSITION_FOLLOWING), 'Calendar and notes precede the featured quote');
    check(calendar.querySelector('button[aria-label^="2026-11-07，"]').disabled, 'Future calendar dates are disabled');
    calendar.querySelector('button[aria-label="上个月"]').click();
    check(document.querySelector('input[type=month]').value === '2026-10', 'Previous month uses compact navigation');
    click('回到今天');
    check(document.querySelector('input[type=month]').value === '2026-11' && document.querySelector('.weread-journal-day[aria-current=date]').getAttribute('aria-pressed') === 'true', 'Back to today restores current month and selection');
    const jump = document.querySelector('input[type=month]'); jump.value = '2025-11'; jump.dispatchEvent(new Event('change'));
    check(document.querySelector('input[type=month]').value === '2025-11', 'Month picker jumps directly to an earlier year');
    click('最近笔记日');
    check(document.querySelector('input[type=month]').value === '2026-11', 'Latest note shortcut returns to latest non-future note month');
    return assertions;
  },
  async favorites() {
    await mount('review');
    const search = document.querySelector('input[type=search]');
    search.value = '昨日句子'; search.dispatchEvent(new Event('input'));
    const stars = () => [...document.querySelectorAll('.weread-journal-favorite')].filter(star => star.dataset.favoriteId === baseNotes[2].id);
    check(stars().length === 2, 'Same source highlight has stars in search and featured quote');
    check(!document.querySelector('.is-thought .weread-journal-favorite'), 'Thoughts never show favorites');
    const quote = document.querySelector('.weread-journal-quote article');
    const prose = quote.querySelector('.weread-journal-note-text');
    const loads = journalLoads;
    const pending = gate(); favoriteWriteGate = pending;
    const first = stars()[0]; first.click(); await tick();
    check(stars().every(star => star.disabled && star.getAttribute('aria-pressed') === 'false'), 'Stars disable while disk acknowledgement is pending without false success');
    pending.resolve(); await tick(); favoriteWriteGate = undefined;
    check(stars().every(star => !star.disabled && star.getAttribute('aria-pressed') === 'true'), 'Acknowledged favorite appears in both copies');
    check(document.querySelector('.weread-journal-quote article') === quote && quote.querySelector('.weread-journal-note-text') === prose && journalLoads === loads, 'Favorite mutation preserves quote DOM and does not reload journal');
    check(window.journalNotices.at(-1) === '已收藏', 'Favorite success notice follows disk acknowledgement');
    first.click(); await tick();
    check(stars().every(star => star.getAttribute('aria-pressed') === 'false') && document.querySelector('.weread-favorites-undo'), 'Cancel updates both stars and offers undo');
    click('撤销'); await tick();
    check(stars().every(star => star.getAttribute('aria-pressed') === 'true'), 'Journal undo restores both stars');
    first.click(); await tick();
    favoriteWriteFails = true; first.click(); await tick(); favoriteWriteFails = false;
    check(stars().every(star => star.getAttribute('aria-pressed') === 'false') && window.journalNotices.at(-1) === 'FAKE DISK WRITE FAILED', 'Disk failure keeps star inactive and surfaces error');
    favorites.publish({writable: false, error: 'READ ONLY FIXTURE'});
    check(stars().every(star => star.disabled && star.title === 'READ ONLY FIXTURE'), 'Read-only stars explain the storage error');
    favorites.publish({writable: true, error: ''});
    await view.onClose(); view.contentEl.remove(); view = undefined;
    check(favoriteListeners.size === 0, 'Journal closes its sole favorites subscription');
    const favoriteEntries = [baseNotes[0], baseNotes[2], baseNotes[4]].map((note, index) => ({id: note.id, note, favoritedAt: NOW + index * 1000, updatedAt: NOW + index * 1000}));
    favorites.publish({favorites: favoriteEntries, error: ''});
    const offlineApiCalls = apiCalls, offlineJournalLoads = journalLoads;
    const host = document.createElement('main'); document.body.append(host);
    let panel = new WereadFavoritesPanel(host, plugin, favorites); await panel.onOpen();
    check(host.querySelector('.is-cards') && host.querySelectorAll('article').length === 3 && host.querySelector('article').dataset.favoriteId === baseNotes[4].id, 'Favorites default to cards sorted by latest favorite');
    check(host.querySelector('.weread-favorites-cover') && host.textContent.includes('划线于') && host.textContent.includes('收藏于'), 'Cards show cover and separate source/favorite dates');
    const sort = host.querySelector('select'); sort.value = 'created'; sort.dispatchEvent(new Event('change'));
    check(host.querySelector('article').dataset.favoriteId === baseNotes[0].id, 'Source-created sort orders by note timestamp');
    const query = host.querySelector('input');
    for (const term of ['城市记忆', '城市与记忆', '周行']) {
      query.value = term; query.dispatchEvent(new Event('input'));
      check(host.querySelectorAll('article').length === 1, 'Local favorites search covers ' + term);
    }
    query.value = '在日常里发现光'; query.dispatchEvent(new Event('input'));
    check(host.querySelectorAll('article').length === 3, 'Favorites search includes chapter');
    query.value = '<script>not present</script>'; query.dispatchEvent(new Event('input'));
    check(host.querySelectorAll('article').length === 0 && host.textContent.includes('没有找到'), 'Search explains no matching favorites');
    query.value = ''; query.dispatchEvent(new Event('input'));
    click('列表', host);
    check(host.querySelector('.is-list') && settingsStore.current().favoritesViewMode === 'list', 'List mode is saved through settings action');
    const summary = host.querySelector('.weread-favorites-summary'); summary.click();
    check(summary.getAttribute('aria-expanded') === 'true' && !summary.nextElementSibling.hidden && summary.textContent === '收起全文', 'List expansion shows the full body once with a collapse control');
    const previous = favoriteState.favorites.find(entry => entry.id === host.querySelector('article').dataset.favoriteId);
    host.querySelector('button[aria-label="取消收藏"]').click(); await tick();
    check(!favorites.isFavorite(previous.id) && host.querySelector('.weread-favorites-undo'), 'Panel removal offers five-second undo');
    const staleUndo = host.querySelector('.weread-favorites-undo button');
    click('撤销', host); await tick();
    check(favorites.isFavorite(previous.id) && favoriteState.favorites.find(entry => entry.id === previous.id).favoritedAt === previous.favoritedAt, 'Undo restores the precise favorite timestamp');
    host.querySelector('button[aria-label="取消收藏"]').click(); await tick();
    const writes = favoriteWrites; staleUndo.click(); await tick();
    check(favoriteWrites === writes, 'Detached earlier undo cannot restore the wrong later removal');
    click('撤销', host); await tick();
    const canvasButton = () => host.querySelector('button[aria-label="在Canvas中打开收藏"]');
    check(canvasButton() && host.querySelector('.weread-favorites-muted').textContent === '收藏保存在当前笔记库的Canvas，可直接打开整理卡片。', 'Favorites explain Canvas storage and offer an accessible native Canvas action');
    check(favoriteLoads.at(-1) === true, 'Opening the panel rereads serialized Canvas data');
    const canvasPending = gate(); canvasEnsureGate = canvasPending;
    const ensureCalls = canvasEnsureCalls, opensBefore = canvasOpens.length;
    click('在Canvas中打开', host); await tick();
    canvasButton().click(); await tick();
    check(canvasButton().disabled && canvasEnsureCalls === ensureCalls + 1 && canvasOpens.length === opensBefore, 'Canvas opening stays pending without duplicate ensures or opening before file acknowledgement');
    canvasPending.resolve(); await tick(); canvasEnsureGate = undefined;
    check(JSON.stringify(canvasOpens.at(-1)) === JSON.stringify(['WereadData/favorites/favorites.canvas', '', true]) && !canvasButton().disabled, 'Canvas action opens the vault-relative native Canvas in a new leaf through the public workspace API');
    canvasEnsureFails = true; click('在Canvas中打开', host); await tick(); canvasEnsureFails = false;
    check(window.journalNotices.at(-1) === 'CANVAS ENSURE FAILED FIXTURE' && canvasOpens.length === opensBefore + 1 && !canvasButton().disabled, 'Canvas file failure reports an error and permits retry without opening');
    canvasOpenFails = true; click('在Canvas中打开', host); await tick(); canvasOpenFails = false;
    check(window.journalNotices.at(-1) === 'CANVAS OPEN FAILED FIXTURE' && !canvasButton().disabled, 'Workspace Canvas opening failure reports an error and resets pending state');
    favorites.publish({writable: false, warning: 'RECOVERY WARNING FIXTURE', error: 'READ ONLY FIXTURE'});
    check(host.querySelectorAll('article').length === 3 && host.querySelector('button[aria-label="取消收藏"]').disabled && host.textContent.includes('RECOVERY WARNING FIXTURE') && host.textContent.includes('只读'), 'Read-only mode preserves records and explains recovery warnings');
    check(canvasButton().disabled && canvasButton().title === 'READ ONLY FIXTURE', 'Read-only favorites disable native Canvas opening and explain why');
    favorites.publish({writable: true, warning: '', error: '', favorites: []});
    check(host.textContent.includes('还没有收藏'), 'Empty collection explains where to add favorites');
    click('在Canvas中打开', host); await tick();
    check(canvasOpens.length === opensBefore + 2, 'Loaded writable empty favorites can open their native Canvas');
    const longNote = {...baseNotes[0], text: '<img src=x onerror=alert(1)> ' + '长句'.repeat(300)};
    favorites.publish({favorites: Array.from({length: 35}, (_, index) => ({id: 'page:' + index, note: {...longNote, id: 'page:' + index}, favoritedAt: NOW + index, updatedAt: NOW}))});
    click('卡片', host);
    check(host.querySelectorAll('article').length === 30 && !host.querySelector('.weread-favorites-text img'), 'Favorites page size is 30 and note text cannot inject HTML');
    click('再看 5 条', host); check(host.querySelectorAll('article').length === 35, 'Load more reveals remaining local favorites');
    check(document.documentElement.scrollWidth <= innerWidth, 'Favorites fit the mobile viewport without horizontal overflow');
    const lateCanvas = gate(); canvasEnsureGate = lateCanvas;
    click('在Canvas中打开', host); await tick();
    const opensAtClose = canvasOpens.length, noticesAtClose = window.journalNotices.length;
    await panel.onClose();
    const closed = host.innerHTML; favorites.publish({favorites: []});
    lateCanvas.resolve(); await tick(); canvasEnsureGate = undefined;
    check(canvasOpens.length === opensAtClose && window.journalNotices.length === noticesAtClose && host.innerHTML === closed, 'Closing while Canvas ensure is pending prevents late workspace opening, notices and DOM writes');
    check(favoriteListeners.size === 0 && host.innerHTML === closed && !host.querySelector('.weread-favorites-undo'), 'Panel close removes its subscription and prevents later DOM writes');
    panel = new WereadFavoritesPanel(host, plugin, favorites); await panel.onOpen();
    check(host.querySelector('button[aria-pressed="true"]').textContent === '卡片', 'Panel reopens using saved view preference');
    await panel.onClose();
    check(apiCalls === offlineApiCalls && journalLoads === offlineJournalLoads, 'Favorites panel interactions never call APIs or load the journal');
    const hydration = gate();
    favorites.publish({loaded: false, loading: true, writable: false});
    const loadingFavorites = {...favorites, load: () => hydration.promise};
    panel = new WereadFavoritesPanel(host, plugin, loadingFavorites);
    const opening = panel.onOpen(); await tick();
    check(host.textContent.includes('正在读取本地收藏') && host.querySelector('button').disabled, 'Hydration shows loading and disables Canvas opening until records are loaded');
    await panel.onClose(); const closedLoading = host.innerHTML;
    favorites.publish({loaded: true, loading: false, error: 'HYDRATION FAILED FIXTURE', writable: false});
    hydration.resolve(favoriteState); await opening;
    check(host.innerHTML === closedLoading && favoriteListeners.size === 0, 'Closing during favorites hydration prevents late DOM writes and subscriptions');
    panel = new WereadFavoritesPanel(host, plugin, favorites); await panel.onOpen();
    check(host.textContent.includes('HYDRATION FAILED FIXTURE') && host.textContent.includes('只读'), 'Hydration error is visible with meaningful read-only recovery state');
    click('重新读取收藏', host);
    check(favoriteLoads.at(-1) === true, 'Read-only recovery forces a fresh read of serialized Canvas data');
    favorites.publish({favorites: favoriteEntries, writable: true, error: ''});
    check(host.querySelectorAll('article').length === 3 && !host.textContent.includes('HYDRATION FAILED FIXTURE'), 'Recovery publishes usable records and clears hydration error');
    await mount('review');
    const liveSearch = view.contentEl.querySelector('input[type=search]');
    liveSearch.value = '昨日句子'; liveSearch.dispatchEvent(new Event('input'));
    const nativeDeletedStars = () => [...view.contentEl.querySelectorAll('.weread-journal-favorite')].filter(star => star.dataset.favoriteId === baseNotes[2].id);
    check(nativeDeletedStars().length === 2 && nativeDeletedStars().every(star => star.getAttribute('aria-pressed') === 'true'), 'Live Canvas reload fixture starts with the native-deleted record starred in both journal copies');
    const nativeEditedText = 'CANVAS LIVE EDIT: 整理卡片后的新正文';
    favorites.publish({favorites: favoriteEntries.filter(entry => entry.id !== baseNotes[2].id).map(entry => entry.id === baseNotes[0].id ? {...entry, note: {...entry.note, text: nativeEditedText}} : entry)});
    check(host.querySelectorAll('article').length === 2 && host.querySelector('.is-cards') && host.textContent.includes(nativeEditedText) && !host.querySelector('article[data-favorite-id="' + baseNotes[2].id + '"]'), 'Live native Canvas publish refreshes the favorites layout with edited note text and removes the native-deleted record');
    check(nativeDeletedStars().every(star => star.getAttribute('aria-pressed') === 'false' && !star.disabled), 'Live native Canvas deletion refreshes all journal stars without remounting');
    await panel.onClose(); host.remove();
    const service = plugin.favoritesService; delete plugin.favoritesService;
    await mount('review'); check(!document.querySelector('.weread-journal-favorite'), 'Legacy plugin fixtures work without favorites service');
    plugin.favoritesService = service;
    await view.onClose(); view.contentEl.remove(); view = undefined;
    return assertions;
  },
  async exclusions() {
    const extended = [...baseNotes,
      note('other-two', 'b', 'highlight', '城市第二句', '2026-11-03T02:00:00Z'),
      note('third-book', 'c', 'highlight', '第三本旧句', '2026-11-02T02:00:00Z')
    ];
    for (const mode of ['today', 'review']) {
      journal.publish({...state, notes: extended});
      settingsStore.actions.setJournalExcludedBookIds(['b', 'c']);
      await mount(mode);
      const quote = () => view.contentEl.querySelector('.weread-journal-quote');
      const quoteId = () => quote().querySelector('.weread-journal-favorite')?.dataset.favoriteId;
      const button = label => [...quote().querySelectorAll('button')].find(node => node.textContent === label);
      check(quoteId()?.startsWith('a:'), mode + ': initial quote respects existing excluded books');
      const ordinary = view.contentEl.querySelector(mode === 'today' ? '.weread-journal-today-notes' : '.weread-journal-day-notes');
      const calendar = view.contentEl.querySelector('.weread-journal-calendar');
      let search, filter, month, selectedDay, calendarHtml;
      if (mode === 'review') {
        month = view.contentEl.querySelector('input[type=month]'); month.value = '2026-10'; month.dispatchEvent(new Event('change'));
        view.contentEl.querySelector('button[aria-label^="2026-10-05，"]').click();
        search = view.contentEl.querySelector('input[type=search]'); search.value = '昨日句子'; search.dispatchEvent(new Event('input'));
        filter = view.contentEl.querySelector('select'); filter.value = 'highlight'; filter.dispatchEvent(new Event('change'));
        month = view.contentEl.querySelector('input[type=month]');
        selectedDay = view.contentEl.querySelector('.weread-journal-day.is-selected');
        calendarHtml = view.contentEl.querySelector('.weread-journal-calendar').innerHTML;
        filter.focus();
      }
      const retainedResults = view.contentEl.querySelector(mode === 'today' ? '.weread-journal-today-notes' : '.weread-journal-day-notes');
      const notesHtml = retainedResults.innerHTML;
      const loadsBefore = journalLoads, callsBefore = apiCalls, writesBefore = favoriteWrites;
      settingsStore.actions.setJournalExcludedBookIds(['a']);
      await tick();
      check(quoteId()?.startsWith('b:'), mode + ': excluding selected book immediately replaces its quote');
      check(retainedResults.isConnected && retainedResults.innerHTML === notesHtml, mode + ': ordinary notes from excluded books remain visible and retain DOM');
      if (mode === 'today') {
        check(quote().nextElementSibling === ordinary, 'Today: quote replacement keeps its position before today notes');
        check(ordinary.textContent.includes('晨光穿过树叶'), 'Today: exclusion does not hide ordinary today highlights');
      } else {
        check(search.isConnected && search.value === '昨日句子' && filter.isConnected && filter.value === 'highlight' && document.activeElement === filter, 'Review: exclusion preserves search, kind and focused control');
        check(month.isConnected && month.value === '2026-10' && selectedDay.isConnected && selectedDay.classList.contains('is-selected') && calendarHtml === view.contentEl.querySelector('.weread-journal-calendar').innerHTML, 'Review: exclusion preserves visible month, selected date and calendar DOM');
        check(retainedResults.textContent.includes('昨日句子'), 'Review: excluded book remains searchable');
        search.focus(); settingsStore.actions.setJournalExcludedBookIds(['a', 'a']);
        check(document.activeElement === search && search.isConnected, 'Review: equivalent IDs preserve focused search');
      }
      const beforeChange = quoteId(); click('换一句', quote());
      check(quoteId()?.startsWith('b:') && quoteId() !== beforeChange, mode + ': change quote uses eligible same-book highlights');
      click('换一本', quote());
      check(quoteId()?.startsWith('c:'), mode + ': change book never selects the excluded book');
      click('换一本', quote());
      check(quoteId()?.startsWith('b:'), mode + ': repeated change book stays eligible');
      check(journalLoads === loadsBefore && apiCalls === callsBefore && favoriteWrites === writesBefore, mode + ': preferences and quote changes trigger no journal reload, API call or favorite write');
      journal.publish({...state, notes: [...extended], syncing: true}); await tick();
      journal.publish({...state, notes: [...extended], syncing: false}); await tick();
      check(!quoteId()?.startsWith('a:'), mode + ': async cache publications never reintroduce excluded quotes');
      click('刷新笔记', view.contentEl); await tick();
      check(!quoteId()?.startsWith('a:'), mode + ': explicit refresh never reintroduces excluded quotes');
      const loadsAfterRefresh = journalLoads, callsAfterRefresh = apiCalls;
      settingsStore.actions.setJournalExcludedBookIds(['a', 'b', 'c']);
      check(!quote().querySelector('article') && quote().textContent.includes('设置') && button('换一句').disabled && button('换一本').disabled, mode + ': all excluded shows helpful settings hint and disables both change buttons');
      journal.publish({...state, notes: extended}); await tick();
      check(!quote().querySelector('article'), mode + ': all-excluded cache publication cannot fall back to excluded notes');
      settingsStore.actions.setJournalExcludedBookIds(['b', 'c']);
      check(quoteId()?.startsWith('a:') && !button('换一句').disabled && button('换一本').disabled, mode + ': including a book restores eligibility and correct change controls');
      settingsStore.actions.setJournalExcludedBookIds([]);
      check(!button('换一本').disabled, mode + ': empty exclusions restore other-book selection');
      check(journalLoads === loadsAfterRefresh && apiCalls === callsAfterRefresh, mode + ': exclusion and inclusion updates never reset network data');
      for (const malformed of [undefined, null, 'a', {}, [null, {}, true]]) {
        settingsStore.set({...settingsStore.current(), journalExcludedBookIds: malformed});
        check(!!quoteId(), mode + ': missing or malformed exclusion fixture remains backward compatible');
      }
      settingsStore.actions.setJournalExcludedBookIds([]);
    }
    journal.publish({...state, notes: baseNotes});
    await view.onClose(); view.contentEl.remove(); view = undefined;
  },
  async scrollNotesSetup() {
    const many = Array.from({length: 400}, (_, i) => note('scroll-' + i, 'a', i % 2 ? 'thought' : 'highlight', 'SCROLL FIXTURE ' + i + ' 阅读让每一天留下清晰的痕迹。', '2026-11-06T03:00:00Z'));
    journal.publish({...state, notes: [...many, ...baseNotes.filter(entry => entry.createTime < RealDate.parse('2026-11-05T16:00:00Z'))], syncing: false});
    await mount('review');
    const list = document.querySelector('.weread-journal-day-list');
    check(list.getAttribute('role') === 'region' && list.tabIndex === 0 && list.getAttribute('aria-label') === '2026-11-06 · 笔记', 'Review day list is a keyboard-focusable region labelled by the selected date');
    check(list.querySelectorAll('article').length === 100 && list.scrollHeight > list.clientHeight * 5, '400-note day keeps pagination inside a genuinely overflowing list');
    check(list.clientHeight > 100 && list.clientHeight <= innerHeight * .65 + 1, 'Review note list height is bounded by the current viewport');
    const style = getComputedStyle(list);
    check(style.overflowY === 'auto' && style.overscrollBehaviorY === 'contain', 'Review list scrolls locally and contains overscroll');
    check(!list.querySelector('h2, .weread-journal-calendar, .weread-journal-controls') && list.previousElementSibling.tagName === 'H2', 'Date heading, calendar and search controls remain outside the scrolling list');
    check(document.documentElement.scrollHeight < 2400 && document.documentElement.scrollWidth <= innerWidth && list.scrollWidth <= list.clientWidth, 'Hundreds of notes do not create a huge outer page or horizontal overflow');
    if (innerWidth <= 400) check(list.getBoundingClientRect().top >= document.querySelector('.weread-journal-calendar').getBoundingClientRect().bottom, 'Mobile keeps the compact calendar above the bounded list');
    list.scrollIntoView({block: 'center'}); list.focus({preventScroll: true});
    window.scrollTestOuterY = scrollY;
  },
  async scrollNotesAfterKey() {
    let list = document.querySelector('.weread-journal-day-list');
    check(list.scrollTop > 0 && Math.abs(scrollY - window.scrollTestOuterY) < 2, 'PageDown scrolls the focused notes region without scrolling the outer page');
    list.scrollTop = 240;
    const before = list.scrollTop;
    const loads = journalLoads, calls = apiCalls;
    journal.publish({...state, syncing: true}); await tick();
    list = document.querySelector('.weread-journal-day-list');
    check(list.scrollTop === before && document.activeElement === list, 'Background progress preserves inner scroll and focused region across rerenders');
    journal.publish({...state, notes: [...state.notes], syncing: false}); await tick();
    list = document.querySelector('.weread-journal-day-list');
    check(list.scrollTop === before, 'Async cache completion preserves inner scroll');
    favorites.publish(); await tick();
    check(document.querySelector('.weread-journal-day-list') === list && list.scrollTop === before, 'Favorite updates preserve the list DOM and inner scroll');
    settingsStore.actions.setJournalExcludedBookIds(['a']);
    check(document.querySelector('.weread-journal-day-list') === list && list.scrollTop === before, 'Quote exclusion updates preserve inner scroll');
    settingsStore.actions.setJournalExcludedBookIds([]);
    const activateDetail = plugin.activateBookDetailView;
    plugin.activateBookDetailView = async () => { view.contentEl.hidden = true; };
    list.querySelector('.weread-journal-source').click(); await tick();
    view.contentEl.hidden = false; plugin.activateBookDetailView = activateDetail;
    check(document.querySelector('.weread-journal-day-list') === list && list.scrollTop === before, 'Opening a source book and returning to the retained Review DOM preserves inner scroll');
    list.scrollTop = list.scrollHeight;
    const pageScroll = list.scrollTop;
    click('再看 100 条', list); await tick();
    list = document.querySelector('.weread-journal-day-list');
    check(list.querySelectorAll('article').length === 200 && list.scrollTop === pageScroll, 'Loading the next page retains the previous inner reading position');
    click('刷新笔记', view.contentEl); await tick();
    journal.publish({...state, notes: [...state.notes]}); await tick();
    list = document.querySelector('.weread-journal-day-list');
    check(list.scrollTop === pageScroll, 'Explicit refresh and subsequent cache publish preserve the current list position');
    const filter = document.querySelector('.weread-journal-controls select'); filter.value = 'thought'; filter.dispatchEvent(new Event('change'));
    list = document.querySelector('.weread-journal-day-list');
    check(list.scrollTop === 0 && list.querySelectorAll('article').length === 100 && [...list.querySelectorAll('article')].every(card => card.classList.contains('is-thought')), 'Kind changes reset scroll and pagination for the new results');
    list.scrollTop = 200;
    const search = document.querySelector('input[type=search]'); search.value = 'SCROLL FIXTURE'; search.dispatchEvent(new Event('input'));
    list = document.querySelector('.weread-journal-day-list');
    check(list.scrollTop === 0 && list.getAttribute('aria-label') === '搜索全部已缓存笔记', 'Search changes reset inner scroll and update the accessible region label');
    search.value = ''; search.dispatchEvent(new Event('input'));
    document.querySelector('.weread-journal-controls select').value = 'all'; document.querySelector('.weread-journal-controls select').dispatchEvent(new Event('change'));
    list = document.querySelector('.weread-journal-day-list'); list.scrollTop = 200;
    document.querySelector('button[aria-label^="2026-11-05，"]').click();
    list = document.querySelector('.weread-journal-day-list');
    check(list.scrollTop === 0 && list.getAttribute('aria-label') === '2026-11-05 · 笔记' && list.querySelectorAll('article').length === 2, 'Changing the selected date starts its notes at the top');
    document.querySelector('button[aria-label^="2026-11-06，"]').click();
    list = document.querySelector('.weread-journal-day-list'); list.scrollTop = 200;
    const month = document.querySelector('input[type=month]'); month.value = '2026-10'; month.dispatchEvent(new Event('change'));
    list = document.querySelector('.weread-journal-day-list');
    check(list.scrollTop === 0 && !list.querySelector('article') && list.textContent.includes('这个范围内还没有笔记') && list.clientHeight < 100, 'Empty selected day resets scroll and does not reserve an oversized blank region');
    click('回到今天');
    check(document.querySelector('.weread-journal-day-list').querySelectorAll('article').length === 100, 'Returning to today restores its first page of notes');
    check(apiCalls === calls && journalLoads === loads + 1, 'Scrolling, local filters and pagination need no API calls or journal loads beyond explicit refresh');
    await mount('today');
    const today = document.querySelector('.weread-journal-today-notes');
    check(!document.querySelector('.weread-journal-day-list') && getComputedStyle(today).maxHeight === 'none' && getComputedStyle(today).overflowY === 'visible', 'Today notes retain their existing unbounded layout');
    journal.publish({...state, notes: baseNotes});
    await view.onClose(); view.contentEl.remove(); view = undefined;
  },
  async behavior() {
    const many = Array.from({length: 105}, (_, i) => note('page-' + i, 'a', 'thought', 'PAGE FIXTURE ' + i, '2026-11-06T03:00:00Z'));
    journal.publish({ ...state, notes: many, syncing: false });
    let search = document.querySelector('input[type=search]'); search.value = 'PAGE FIXTURE'; search.dispatchEvent(new Event('input'));
    check(cards(results()).length === 100, 'Search initially bounds rendered notes to 100');
    click('再看 5 条'); check(cards(results()).length === 105, 'Show more renders remaining notes');
    journal.publish({ ...state, notes: baseNotes, failedBooks: 0, error: '' });
    const oldShelf = gate(); const oldStats = gate();
    let account = 'old';
    const accountApi = {
      async getShelf() { return account === 'old' ? oldShelf.promise : { books: [{ bookId: 'new', title: 'New account book', readUpdateTime: NOW / 1000 }] }; },
      async getReadingStats() { return account === 'old' ? oldStats.promise : { readTimes: { [NOW / 1000]: 120 } }; }
    };
    await mount('today', journal, accountApi);
    account = 'new'; settingsStore.set(settings('account-b')); await tick();
    oldShelf.resolve({ books: [{bookId: 'old', title: 'OLD ACCOUNT SENTINEL', readUpdateTime: NOW / 1000}] });
    oldStats.resolve({ readTimes: { [NOW / 1000]: 9 * 3600 } }); await tick();
    check(document.body.textContent.includes('New account book') && !document.body.textContent.includes('OLD ACCOUNT SENTINEL'), 'Late old-account shelf response is ignored');
    check(document.querySelector('.weread-journal-summary').textContent.includes('0小时2分钟'), 'Late old-account reading stats are ignored');
    await view.onClose(); view.contentEl.remove(); view = undefined;
    check(intervals.size === 0 && listeners.size === 0 && settingsStore.listenerCount() === 0, 'Close removes timer and journal/settings subscriptions');
    const hydration = gate();
    const slowCache = { ...journal, load: () => hydration.promise };
    view = new WereadJournalView({}, plugin, slowCache, accountApi, 'today');
    const opening = view.onOpen(); await tick(); await view.onClose(); hydration.resolve(state); await opening;
    check(intervals.size === 0 && listeners.size === 0 && settingsStore.listenerCount() === 0, 'Close during hydration cannot install later timer or subscriptions');
    view.contentEl.remove(); view = undefined;
    return assertions;
  }
};
`;

async function browserBundle() {
	const output = await build({
		stdin: { contents: fixture, resolveDir: process.cwd(), loader: 'ts' },
		bundle: true,
		platform: 'browser',
		format: 'iife',
		write: false,
		plugins: [
			{
				name: 'journal-view-fixtures',
				setup(builder) {
					builder.onResolve({ filter: /^obsidian$/ }, () => ({
						path: 'obsidian',
						namespace: 'mock'
					}));
					builder.onResolve({ filter: /(?:^|\/)settings$/ }, () => ({
						path: 'settings',
						namespace: 'mock'
					}));
					builder.onLoad({ filter: /.*/, namespace: 'mock' }, ({ path: name }) => ({
						contents:
							name === 'obsidian'
								? `export class Component { constructor() { this.children = new Set(); } addChild(child) { this.children.add(child); return child; } removeChild(child) { if (this.children.delete(child)) child.onunload?.(); return child; } } export class ItemView extends Component { constructor() { super(); this.contentEl = document.createElement('main'); document.body.append(this.contentEl); } } export class Notice { constructor(text) { (window.journalNotices ||= []).push(text); } } export function setIcon(element, name) { const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('fill', 'none'); svg.setAttribute('stroke', 'currentColor'); svg.setAttribute('stroke-width', '2'); const path = document.createElementNS(svg.namespaceURI, 'path'); path.setAttribute('d', name === 'star' ? 'm12 3 2.8 5.7 6.3.9-4.5 4.4 1.1 6.2-5.7-3-5.7 3 1.1-6.2L3.2 9.6l6.3-.9Z' : name === 'copy' ? 'M9 9h12v12H9z M5 15H3V3h12v2' : 'M15 3h6v6 M10 14 21 3 M21 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h6'); svg.append(path); element.append(svg); } export class WorkspaceLeaf {}`
								: `let value; const listeners = new Set(); const set = (next) => { value = next; for (const fn of listeners) fn(value); }; export const settingsStore = { subscribe(fn) { listeners.add(fn); fn(value); return () => listeners.delete(fn); }, set, current: () => value, actions: { setJournalExcludedBookIds(ids) { set({...value, journalExcludedBookIds: ids}); }, setFavoritesViewMode(mode) { set({...value, favoritesViewMode: mode}); } }, listenerCount: () => listeners.size };`
					}));
					builder.onLoad({ filter: /\.css$/ }, async ({ path: filename }) => ({
						contents: `const style = document.createElement('style'); style.textContent = ${JSON.stringify(await readFile(filename, 'utf8'))}; document.head.append(style);`,
						loader: 'js'
					}));
				}
			}
		]
	});
	return output.outputFiles[0].text;
}

function cdpClient(chrome) {
	let id = 0;
	let buffer = '';
	const pending = new Map();
	chrome.stdio[4].on('data', (chunk) => {
		buffer += chunk.toString();
		for (;;) {
			const delimiter = buffer.indexOf('\0');
			if (delimiter < 0) break;
			const message = JSON.parse(buffer.slice(0, delimiter));
			buffer = buffer.slice(delimiter + 1);
			const request = pending.get(message.id);
			if (!request) continue;
			pending.delete(message.id);
			clearTimeout(request.timer);
			if (message.error) request.reject(new Error(JSON.stringify(message.error)));
			else request.resolve(message.result);
		}
	});
	return (method, params = {}, sessionId) =>
		new Promise((resolve, reject) => {
			const requestId = ++id;
			const timer = setTimeout(() => {
				pending.delete(requestId);
				reject(new Error(`CDP timeout: ${method}`));
			}, 15000);
			pending.set(requestId, { resolve, reject, timer });
			chrome.stdio[3].write(
				JSON.stringify({
					id: requestId,
					method,
					params,
					...(sessionId ? { sessionId } : {})
				}) + '\0'
			);
		});
}

test(
	'production Today and Review views work in Chrome with local fixtures',
	{ skip: !available, timeout: 60000 },
	async (t) => {
		const directory = await mkdtemp(path.join(tmpdir(), 'journal-view-chrome-'));
		const chrome = spawn(
			chromeBin,
			[
				'--headless=new',
				'--disable-gpu',
				'--no-first-run',
				'--no-default-browser-check',
				'--disable-background-networking',
				'--remote-debugging-pipe',
				`--user-data-dir=${directory}`,
				'about:blank'
			],
			{ stdio: ['ignore', 'ignore', 'pipe', 'pipe', 'pipe'] }
		);
		let chromeErrors = '';
		chrome.stderr.on('data', (chunk) => {
			chromeErrors += chunk.toString();
		});
		const exited = new Promise((resolve) => chrome.once('exit', resolve));
		t.after(async () => {
			chrome.kill('SIGTERM');
			await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 2000))]);
			if (chrome.exitCode === null && chrome.signalCode === null) {
				chrome.kill('SIGKILL');
				await exited;
			}
			const resolved = path.resolve(directory);
			assert.equal(path.dirname(resolved), path.resolve(tmpdir()));
			assert(path.basename(resolved).startsWith('journal-view-chrome-'));
			// Chromium helpers may finish profile writes just after the browser exits.
			await rm(resolved, { recursive: true, force: true, maxRetries: 5, retryDelay: 150 });
		});
		const cdp = cdpClient(chrome);
		let sessionId;
		try {
			const target = await cdp('Target.createTarget', { url: 'about:blank' });
			({ sessionId } = await cdp('Target.attachToTarget', {
				targetId: target.targetId,
				flatten: true
			}));
		} catch (error) {
			throw new Error(`${error.message}\n${chromeErrors}`);
		}
		const send = (method, params) => cdp(method, params, sessionId);
		await send('Page.enable');
		await send('Runtime.enable');
		await send('Network.enable');
		await send('Network.setBlockedURLs', { urls: ['http://*', 'https://*'] });
		await send('Emulation.setTimezoneOverride', { timezoneId: 'Asia/Shanghai' });
		await send('Emulation.setDeviceMetricsOverride', {
			width: 1180,
			height: 1000,
			deviceScaleFactor: 1,
			mobile: false
		});
		// No page/resource is fetched: all markup comes from the actual production view.
		await send('Page.setDocumentContent', {
			frameId: (await send('Page.getFrameTree')).frameTree.frame.id,
			html: '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head><body></body></html>'
		});
		const evaluate = async (expression) => {
			const result = await send('Runtime.evaluate', {
				expression,
				awaitPromise: true,
				returnByValue: true
			});
			if (result.exceptionDetails)
				throw new Error(
					result.exceptionDetails.exception?.description || result.exceptionDetails.text
				);
			return result.result.value;
		};
		await evaluate(await browserBundle());
		await evaluate(
			`(() => { const style = document.createElement('style'); style.textContent = 'body { margin: 0; padding: 24px; font-family: -apple-system, BlinkMacSystemFont, sans-serif; background: #f8f7f4; color: #292d29; --background-primary: #fff; --background-secondary: #f3f1ec; --background-modifier-border: #dddcd5; --text-normal: #292d29; --text-muted: #72756d; --interactive-accent: #5f765c; } main { max-width: 1050px; margin: auto; } button, input, select { font: inherit; padding: 7px 11px; border: 1px solid #d8d9d0; background: #fff; border-radius: 6px; color: inherit; } button { cursor: pointer; } button.mod-cta { background: #e0e8d9; } button:disabled { opacity: .45; }'; document.head.append(style); })()`
		);
		await evaluate('smoke.today()');
		await evaluate(
			'Promise.all([...document.images].map(image => image.decode().catch(() => {})))'
		);
		let screenshot = await send('Page.captureScreenshot', {
			format: 'png',
			captureBeyondViewport: true
		});
		await writeFile('/tmp/obsidian-weread-today.png', Buffer.from(screenshot.data, 'base64'));
		await evaluate('smoke.review()');
		await evaluate('smoke.layout()');
		screenshot = await send('Page.captureScreenshot', {
			format: 'png',
			captureBeyondViewport: true
		});
		await writeFile('/tmp/obsidian-weread-review.png', Buffer.from(screenshot.data, 'base64'));
		await evaluate('document.querySelector("main").style.width = "500px"');
		assert(
			await evaluate(
				'document.querySelector(".weread-journal-calendar").getBoundingClientRect().width <= 261 && document.querySelector(".weread-journal-day-notes").getBoundingClientRect().top >= document.querySelector(".weread-journal-calendar").getBoundingClientRect().bottom'
			),
			'Narrow pane stacks the compact calendar inside a wide window'
		);
		await evaluate('document.querySelector("main").style.width = ""');
		await send('Emulation.setDeviceMetricsOverride', {
			width: 390,
			height: 844,
			deviceScaleFactor: 1,
			mobile: true
		});
		assert(
			await evaluate('document.documentElement.scrollWidth <= 390'),
			'Review fits narrow viewport: ' +
				JSON.stringify(
					await evaluate(
						'({width:innerWidth,scroll:document.documentElement.scrollWidth,overflow:[...document.querySelectorAll("*")].filter(e=>e.getBoundingClientRect().right>390).slice(0,8).map(e=>({tag:e.tagName,cls:e.className,right:e.getBoundingClientRect().right}))})'
					)
				)
		);
		assert(
			await evaluate(
				'document.querySelector(".weread-journal-calendar").getBoundingClientRect().width <= 261 && document.querySelector(".weread-journal-day-notes").getBoundingClientRect().top >= document.querySelector(".weread-journal-calendar").getBoundingClientRect().bottom'
			),
			'Mobile retains a compact calendar above notes'
		);
		screenshot = await send('Page.captureScreenshot', {
			format: 'png',
			captureBeyondViewport: true
		});
		await writeFile(
			'/tmp/obsidian-weread-review-mobile.png',
			Buffer.from(screenshot.data, 'base64')
		);
		await evaluate('smoke.today()');
		assert(
			await evaluate('document.documentElement.scrollWidth <= 390'),
			'Today fits narrow viewport'
		);
		assert.equal(
			await evaluate(
				'getComputedStyle(document.querySelector(".weread-journal-summary")).gridTemplateColumns.split(" ").length'
			),
			1,
			'Today summary stacks on narrow screens'
		);
		await evaluate(
			'Promise.all([...document.images].map(image => image.decode().catch(() => {})))'
		);
		screenshot = await send('Page.captureScreenshot', {
			format: 'png',
			captureBeyondViewport: true
		});
		await writeFile(
			'/tmp/obsidian-weread-today-mobile.png',
			Buffer.from(screenshot.data, 'base64')
		);
		await evaluate('smoke.review()');
		await evaluate('smoke.behavior()');
		await evaluate('smoke.exclusions()');
		for (const width of [1180, 375]) {
			await send('Emulation.setDeviceMetricsOverride', {
				width,
				height: width === 375 ? 667 : 1000,
				deviceScaleFactor: 1,
				mobile: width === 375
			});
			await evaluate('smoke.scrollNotesSetup()');
			await send('Input.dispatchKeyEvent', {
				type: 'keyDown',
				key: 'PageDown',
				code: 'PageDown',
				windowsVirtualKeyCode: 34
			});
			await send('Input.dispatchKeyEvent', {
				type: 'keyUp',
				key: 'PageDown',
				code: 'PageDown',
				windowsVirtualKeyCode: 34
			});
			await evaluate('new Promise(resolve => setTimeout(resolve, 180))');
			await evaluate('smoke.scrollNotesAfterKey()');
		}
		const assertions = await evaluate('smoke.favorites()');
		assert(assertions.length >= 20);
		await send('Emulation.setDeviceMetricsOverride', {
			width: 1180,
			height: 1000,
			deviceScaleFactor: 1,
			mobile: false
		});
		await evaluate('smoke.favoritesPreview("cards")');
		await evaluate(
			'Promise.all([...document.images].map(image => image.decode().catch(() => {})))'
		);
		screenshot = await send('Page.captureScreenshot', {
			format: 'png',
			captureBeyondViewport: true
		});
		await writeFile(
			'/tmp/obsidian-weread-favorites.png',
			Buffer.from(screenshot.data, 'base64')
		);
		await send('Emulation.setDeviceMetricsOverride', {
			width: 390,
			height: 844,
			deviceScaleFactor: 1,
			mobile: true
		});
		await evaluate('smoke.favoritesPreview("list")');
		screenshot = await send('Page.captureScreenshot', {
			format: 'png',
			captureBeyondViewport: true
		});
		await writeFile(
			'/tmp/obsidian-weread-favorites-mobile.png',
			Buffer.from(screenshot.data, 'base64')
		);
		await evaluate('smoke.closeFavoritesPreview()');
		t.diagnostic(
			`${await evaluate('smoke.assertions.length')} browser assertions passed; screenshots: /tmp/obsidian-weread-today.png, /tmp/obsidian-weread-review.png, /tmp/obsidian-weread-favorites.png, /tmp/obsidian-weread-favorites-mobile.png`
		);
	}
);
