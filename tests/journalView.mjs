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
  async load() { return state; },
  publish(next = state) { state = next; for (const listener of listeners) listener(state); }
};
const settings = (key) => ({ wereadApiKey: key, userVid: '', cookies: [], journalRefreshHours: 24 });
settingsStore.set(settings('account-a'));
const plugin = {
  async activateJournalView() {}, async activateBookshelfView() {}, async activateReadingStatsView() {},
  async activateBookDetailView() {}
};
let api = {
  async getShelf() { return {books: [
    { bookId: 'older', title: 'OLDER BOOK SENTINEL', author: '旧书', readUpdateTime: NOW / 1000 - 400 },
    { bookId: 'a', title: '山间的阅读', author: '林间', readUpdateTime: NOW / 1000 - 60 },
    { bookId: 'third', title: '第三本今日书', author: '作者三', readUpdateTime: NOW / 1000 - 120 },
    { bookId: 'latest', title: '新书', author: '作者一', readUpdateTime: NOW / 1000 - 30 },
    { bookId: 'fourth', title: 'FOURTH BOOK SENTINEL', author: '作者四', readUpdateTime: NOW / 1000 - 300 },
    { bookId: 'b', title: 'YESTERDAY BOOK SENTINEL', readUpdateTime: RealDate.parse('2026-11-05T15:59:00Z') / 1000 }
  ].map((book) => ({...book, cover: 'https://fixture.invalid/' + book.bookId + '.svg'}))}; },
  async getReadingStats() { return { readTimes: { [RealDate.parse('2026-11-05T16:00:00Z') / 1000]: 3660 } }; }
};
let view;
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
  async today() {
    await mount('today');
    check(document.body.textContent.includes('1小时1分钟'), 'Today reads local-day duration');
    check(document.querySelector('.weread-journal-summary').textContent.includes('今日划线1 条'), 'Today counts highlight after UTC midnight boundary');
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
								? `export class Component { constructor() { this.children = new Set(); } addChild(child) { this.children.add(child); return child; } removeChild(child) { if (this.children.delete(child)) child.onunload?.(); return child; } } export class ItemView extends Component { constructor() { super(); this.contentEl = document.createElement('main'); document.body.append(this.contentEl); } } export class Notice { constructor(text) { (window.journalNotices ||= []).push(text); } } export function setIcon(element, name) { const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('fill', 'none'); svg.setAttribute('stroke', 'currentColor'); svg.setAttribute('stroke-width', '2'); const path = document.createElementNS(svg.namespaceURI, 'path'); path.setAttribute('d', name === 'copy' ? 'M9 9h12v12H9z M5 15H3V3h12v2' : 'M15 3h6v6 M10 14 21 3 M21 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h6'); svg.append(path); element.append(svg); } export class WorkspaceLeaf {}`
								: `let value; const listeners = new Set(); export const settingsStore = { subscribe(fn) { listeners.add(fn); fn(value); return () => listeners.delete(fn); }, set(next) { value = next; for (const fn of listeners) fn(value); }, listenerCount: () => listeners.size };`
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
			const resolved = path.resolve(directory);
			assert.equal(path.dirname(resolved), path.resolve(tmpdir()));
			assert(path.basename(resolved).startsWith('journal-view-chrome-'));
			await rm(resolved, { recursive: true, force: true });
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
		const assertions = await evaluate('smoke.behavior()');
		assert(assertions.length >= 20);
		t.diagnostic(
			`${assertions.length} browser assertions passed; screenshots: /tmp/obsidian-weread-today.png, /tmp/obsidian-weread-review.png`
		);
	}
);
