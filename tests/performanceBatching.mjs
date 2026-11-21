// Run: node --test tests/performanceBatching.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { transformSync } from 'esbuild';
import { browserHarness, bundleFixture, chromeAvailable } from './helpers/detailBrowserHarness.mjs';

function load(path, mocks) {
	const module = { exports: {} };
	const code = transformSync(readFileSync(path, 'utf8'), {
		loader: 'ts',
		format: 'cjs',
		target: 'es2020'
	}).code;
	new Function('require', 'module', 'exports', code)(
		(name) => {
			if (!(name in mocks)) throw new Error(`Unexpected dependency: ${name}`);
			return mocks[name];
		},
		module,
		module.exports
	);
	return module.exports;
}

class Element {
	constructor(parent = null, options = {}) {
		this.parent = parent;
		this.children = [];
		this.options = options;
		this.tag = 'div';
		this.onclick = null;
	}
	createDiv(options = {}) {
		if (typeof options === 'string') options = { cls: options };
		const element = new Element(this, options);
		this.children.push(element);
		return element;
	}
	createEl(tag, options = {}) {
		const element = this.createDiv(options);
		element.tag = tag;
		return element;
	}
	createSpan(options = {}) {
		return this.createEl('span', options);
	}
	empty() {
		this.children = [];
	}
	setAttr(name, value) {
		this.options.attr = { ...this.options.attr, [name]: value };
	}
	addClass(name) {
		this.options.cls = `${this.options.cls ?? ''} ${name}`.trim();
	}
	setText(text) {
		this.options.text = text;
	}
	get childElementCount() {
		return this.children.length;
	}
	remove() {
		if (!this.parent) return;
		this.parent.children = this.parent.children.filter((child) => child !== this);
	}
}

const findAll = (root, predicate) => {
	const matches = [];
	const walk = (node) => {
		if (predicate(node)) matches.push(node);
		for (const child of node.children || []) walk(child);
	};
	walk(root);
	return matches;
};
const hasCls = (node, cls) => String(node.options?.cls ?? '').split(/\s+/).includes(cls);

const settings = {
	value: {
		wereadApiKey: 'key-a',
		cookies: [],
		isCookieValid: false,
		bookshelfSourceMode: 'bookshelf',
		bookshelfDefaultSyncStatusFilter: 'all',
		bookshelfViewMode: 'list',
		bookshelfSortMode: 'recent',
		bookshelfGroupByYear: true,
		lastSyncTime: 0,
		lastSyncBookCount: 0
	}
};

const { getBookshelfCategory } = load('src/bookshelf.ts', {
	'svelte/store': { get: (store) => store.value },
	'./settings': { settingsStore: settings },
	'./parser/parseResponse': { parseMetadata: (entry) => entry.book },
	'./syncFilter': {
		createSyncFilterContext: () => ({}),
		evaluateMetadataSyncFilter: () => ({ includedByCurrentSettings: true })
	},
	'./utils/dateUtil': {
		formatTimestampToDate: (time) => new Date(time * 1000).toISOString().slice(0, 10)
	}
});

const Panel = load('src/components/wereadBookshelf.ts', {
	obsidian: {
		ItemView: class {},
		Modal: class {},
		setIcon: () => {},
		setTooltip: (el, text) => el.setAttr('aria-label', text),
		moment: (value) => {
			const valid = typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
			return {
				isValid: () => valid,
				unix: () => (valid ? Math.floor(Date.parse(value) / 1000) : 0),
				format: () => (valid ? value.slice(0, 4) : '')
			};
		},
		Platform: { isDesktopApp: false }
	},
	'./wereadBookshelf.css': {},
	'../bookshelf': { default: class {}, getBookshelfCategory },
	'../settings': { settingsStore: settings },
	'./wereadPanel': { WereadPanel: class {} },
	'svelte/store': { get: (store) => store.value },
	'./syncLogModal': { SyncLogModal: class {} },
	'../utils/tooltip': { applyTooltip: () => {} },
	'../parser/parseResponse': {}
}).WereadBookshelfPanel;

function makeBook(index, extra = {}) {
	return {
		bookId: `book-${index}`,
		title: `书籍 ${String(index).padStart(3, '0')}`,
		author: `作者 ${index}`,
		cover: `https://fixture.invalid/t7_${index}.jpg`,
		remoteExists: true,
		hasLocalFile: false,
		isLocalOnly: false,
		isArticle: false,
		noteCount: 1,
		reviewCount: 0,
		countsKnown: true,
		finished: false,
		progress: { state: 'loaded', readingProgress: 40 },
		lastReadDate: index <= 80 ? '2026-05-01' : '2025-05-01',
		...extra
	};
}

function bookshelfFixture(books, folders = [], extra = {}) {
	const view = Object.create(Panel.prototype);
	Object.assign(view, {
		collection: {
			books,
			folders,
			albums: [],
			hasArticleCollection: false,
			remoteEntryCount: books.length
		},
		shelfBooks: books,
		contentEl: new Element(),
		summaryEl: new Element(),
		gridEl: new Element(),
		emptyStateEl: new Element(),
		activeFolderId: null,
		categoryFilter: 'all',
		genreFilter: 'all',
		syncStatusFilter: 'all',
		readingStatusFilter: 'all',
		searchKeyword: '',
		sourceMode: 'bookshelf',
		sortMode: 'recent',
		viewMode: 'list',
		groupByYear: true,
		loading: false,
		closed: false,
		getLastReadDateText: (book) => book.lastReadDate ?? '暂无',
		...extra
	});
	return view;
}

test('bookshelf batches 150 items by 60, preserves folder counts, and enables lazy async images', () => {
	const books = Array.from({ length: 150 }, (_, index) => makeBook(index + 1));
	// Put book-149 inside folder-1 and book-150 inside folder-2 => 148 loose books + 2 folders = 150 grid items.
	const folders = [
		{ id: 'f-1', name: '哲学书架', bookIds: ['book-149'] },
		{ id: 'f-2', name: '文学书架', bookIds: ['book-150'] }
	];
	const view = bookshelfFixture(books, folders);
	view.renderBooks();

	const summaryValues = findAll(view.summaryEl, (n) => hasCls(n, 'weread-bookshelf-summary-value'));
	assert.equal(summaryValues[0].options.text, '书籍 150 本');

	const mixedGrid = findAll(view.gridEl, (n) => hasCls(n, 'weread-bookshelf-mixed-grid'))[0];
	assert.ok(mixedGrid);
	assert.equal(mixedGrid.children.length, 60);

	const images = findAll(mixedGrid, (n) => n.tag === 'img' && hasCls(n, 'weread-bookshelf-card-cover'));
	assert.ok(images.length > 0);
	for (const img of images) {
		assert.equal(img.loading, 'lazy');
		assert.equal(img.decoding, 'async');
	}

	const moreBtns = findAll(view.gridEl, (n) => hasCls(n, 'weread-bookshelf-more-btn'));
	assert.equal(moreBtns.length, 1);
	assert.equal(moreBtns[0].options.text, '加载更多（剩余 90 项）');

	moreBtns[0].onclick();
	assert.equal(mixedGrid.children.length, 120);
	const secondBtns = findAll(view.gridEl, (n) => hasCls(n, 'weread-bookshelf-more-btn'));
	assert.equal(secondBtns[0].options.text, '加载更多（剩余 30 项）');

	secondBtns[0].onclick();
	assert.equal(mixedGrid.children.length, 150);
	assert.equal(findAll(view.gridEl, (n) => hasCls(n, 'weread-bookshelf-more-bar')).length, 0);
});

test('notebooks year grouping merges across batches without duplicate headings and cover images set decoding async', () => {
	const books = Array.from({ length: 150 }, (_, index) => makeBook(index + 1));
	const view = bookshelfFixture(books, [], { sourceMode: 'notebooks' });
	view.renderBooks();

	const initialGroups = findAll(view.gridEl, (n) => hasCls(n, 'weread-bookshelf-group'));
	assert.equal(initialGroups.length, 1);
	assert.equal(initialGroups[0].children[0].options.text, '2026 年');
	assert.equal(initialGroups[0].children[1].children.length, 60);

	findAll(view.gridEl, (n) => hasCls(n, 'weread-bookshelf-more-btn'))[0].onclick();
	const secondGroups = findAll(view.gridEl, (n) => hasCls(n, 'weread-bookshelf-group'));
	assert.equal(secondGroups.length, 2);
	assert.deepEqual(
		secondGroups.map((g) => g.children[0].options.text),
		['2026 年', '2025 年']
	);
	assert.equal(secondGroups[0].children[1].children.length, 80);
	assert.equal(secondGroups[1].children[1].children.length, 40);

	findAll(view.gridEl, (n) => hasCls(n, 'weread-bookshelf-more-btn'))[0].onclick();
	assert.equal(secondGroups.length, 2);
	assert.equal(secondGroups[1].children[1].children.length, 70);
	assert.equal(findAll(view.gridEl, (n) => hasCls(n, 'weread-bookshelf-more-bar')).length, 0);

	// Cover mode also batches by 60 and sets lazy + async on cover imgs.
	view.viewMode = 'cover';
	view.renderBooks();
	const coverGrid = findAll(view.gridEl, (n) => hasCls(n, 'weread-bookshelf-cover-grid'))[0];
	assert.equal(coverGrid.children.length, 60);
	const coverImgs = findAll(coverGrid, (n) => hasCls(n, 'weread-bookshelf-cover-card-img'));
	assert.equal(coverImgs.length, 60);
	assert.ok(coverImgs.every((img) => img.loading === 'lazy' && img.decoding === 'async'));

	// Small shelf (<= 60) emits no more bar.
	const small = bookshelfFixture(books.slice(0, 60), [], { sourceMode: 'notebooks', viewMode: 'cover' });
	small.renderBooks();
	assert.equal(findAll(small.gridEl, (n) => hasCls(n, 'weread-bookshelf-more-bar')).length, 0);
});

test('bookshelf onClose disconnects active IntersectionObserver', async () => {
	let disconnected = 0;
	let observed = 0;
	const previousObserver = globalThis.IntersectionObserver;
	globalThis.IntersectionObserver = class {
		observe() {
			observed++;
		}
		disconnect() {
			disconnected++;
		}
	};
	try {
		const books = Array.from({ length: 70 }, (_, index) => makeBook(index + 1));
		const view = bookshelfFixture(books, [], { sourceMode: 'notebooks' });
		view.renderBooks();
		assert.equal(observed, 1);
		assert.equal(disconnected, 0);
		await view.onClose();
		assert.equal(disconnected, 1);
	} finally {
		globalThis.IntersectionObserver = previousObserver;
	}
});

const chromeFixture = String.raw`
import { WereadBookDetailPanel } from './src/components/wereadBookDetailPanel';
import { WereadFavoritesService } from './src/favorites';
import { settingsStore } from './src/settings';
import { TFile } from 'obsidian';

window.detailNotices = [];
const browserErrors = [];
window.addEventListener('error', (event) => browserErrors.push(event.message));
window.addEventListener('unhandledrejection', (event) => browserErrors.push(String(event.reason)));

const assertions = [];
const check = (value, message) => {
	if (!value) throw new Error(message);
	assertions.push(message);
};
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
const until = async (predicate, label) => {
	for (let n = 0; n < 100; n++) {
		if (predicate()) return;
		await tick();
	}
	throw new Error('Fixture did not settle: ' + label);
};

const create = function (tag, options = {}) {
	if (typeof options === 'string') options = { cls: options };
	const node = document.createElement(tag);
	if (options.cls) node.className = options.cls;
	if (options.text !== undefined) node.textContent = options.text;
	for (const key of ['type', 'href', 'value']) {
		if (options[key] !== undefined) node[key] = options[key];
	}
	for (const [key, value] of Object.entries(options.attr || {})) node.setAttribute(key, value);
	this.append(node);
	return node;
};
HTMLElement.prototype.createEl = create;
HTMLElement.prototype.createDiv = function (options) {
	return create.call(this, 'div', options);
};
HTMLElement.prototype.createSpan = function (options) {
	return create.call(this, 'span', options);
};
HTMLElement.prototype.empty = function () {
	this.replaceChildren();
};
HTMLElement.prototype.addClass = function (...names) {
	this.classList.add(...names);
};
HTMLElement.prototype.removeClass = function (...names) {
	this.classList.remove(...names);
};
HTMLElement.prototype.toggleClass = function (name, enabled) {
	this.classList.toggle(name, enabled);
};
HTMLElement.prototype.setText = function (text) {
	this.textContent = text;
};
HTMLElement.prototype.setAttr = function (name, value) {
	this.setAttribute(name, value);
};

const style = document.createElement('style');
style.textContent =
	'*{box-sizing:border-box}body{margin:0;padding:16px;background:#fff;color:#222;font-family:sans-serif;--background-primary:#fff;--background-secondary:#f3f1ec;--background-modifier-border:#dddcd5;--text-normal:#222;--text-muted:#666;--text-faint:#888;--interactive-accent:#5f765c;--text-accent:#5f765c;--background-modifier-hover:#e8eddf}main{max-width:1050px;margin:auto}';
document.head.append(style);

function makePlugin() {
	const files = new Map();
	const adapter = {
		async exists(p) {
			return files.has(p);
		},
		async mkdir(p) {
			files.set(p, '<dir>');
		},
		async read(p) {
			if (!files.has(p)) throw new Error('missing');
			return files.get(p);
		},
		async write(p, raw) {
			files.set(p, raw);
		}
	};
	const plugin = {
		app: {
			vault: {
				adapter,
				getAbstractFileByPath: () => null,
				async read() {
					return '';
				}
			},
			workspace: { getLeavesOfType: () => [], requestSaveLayout() {} }
		},
		async openPreferredReadingView() {},
		shareJournalNote() {},
		async syncBookById() {}
	};
	const service = new WereadFavoritesService(plugin);
	plugin.favoritesService = service;
	return { plugin, service };
}

function makeLargeData(bookId) {
	const chapters = [
		{ chapterUid: 1, chapterIdx: 1, title: '第一章' },
		{ chapterUid: 2, chapterIdx: 2, title: '第二章' }
	];
	const updated = Array.from({ length: 120 }, (_, i) => ({
		bookmarkId: 'h-' + (i + 1),
		bookId,
		type: 1,
		colorStyle: 1,
		markText: '划线内容 ' + (i + 1),
		chapterUid: i < 70 ? 1 : 2,
		range: String((i + 1) * 10) + '-' + String((i + 1) * 10 + 5),
		createTime: 1793923200 + i
	}));
	const reviews = [
		...Array.from({ length: 120 }, (_, i) => ({
			reviewId: 'r-' + (i + 1),
			review: {
				reviewId: 'r-' + (i + 1),
				type: 1,
				abstract: '摘录 ' + (i + 1),
				content: '想法 ' + (i + 1),
				chapterUid: i < 70 ? 1 : 2,
				range: '10-20',
				createTime: 1793923200 + i,
				htmlContent: '<p>huge html bloat</p>',
				book: { bookId, title: '冗余书名', intro: 'redundant'.repeat(50) },
				author: { name: '读者甲', avatar: 'https://invalid/avatar.png', medalInfo: { id: 'm' } }
			}
		})),
		{
			reviewId: 'pub-mine',
			review: {
				reviewId: 'pub-mine',
				type: 4,
				title: '我的书评标题',
				content: '我的书评正文',
				createTime: 1793923200,
				book: { bookId, title: '冗余书名' },
				author: { name: '我自己的昵称', avatar: 'x', medalInfo: { title: 'm' } }
			}
		}
	];
	return {
		detail: { bookId, title: '测试长书 ' + bookId, author: '测试作者', cover: '', intro: '简介' },
		progress: { book: { progress: 50, readingTime: 3600 } },
		highlights: {
			book: { bookId, title: '测试长书 ' + bookId, author: '测试作者', cover: '', coverBoxInfo: { blurhash: 'x' } },
			chapters,
			updated,
			removed: []
		},
		reviews: { reviews },
		popular: { items: [], chapters },
		publicReviews: {
			reviews: [
				{
					reviewId: 'comm-1',
					review: {
						title: '社区标题',
						content: '社区正文',
						createTime: 1793923200,
						book: { bookId, title: '冗余书名' },
						author: { name: '社区读者', avatar: 'huge-url', medalInfo: { id: '1' } }
					}
				}
			]
		}
	};
}

function makeCountingApi(failBookPopularOnce = false) {
	const calls = new Map();
	let failedOnce = false;
	const bump = (id, method) => {
		if (!calls.has(id)) calls.set(id, {});
		const entry = calls.get(id);
		entry[method] = (entry[method] || 0) + 1;
	};
	const api = {
		calls,
		async getBook(id) {
			bump(id, 'getBook');
			return makeLargeData(id).detail;
		},
		async getProgress(id) {
			bump(id, 'getProgress');
			return makeLargeData(id).progress;
		},
		async getNotebookHighlights(id) {
			bump(id, 'getNotebookHighlights');
			return makeLargeData(id).highlights;
		},
		async getNotebookReviews(id) {
			bump(id, 'getNotebookReviews');
			return makeLargeData(id).reviews;
		},
		async getBestBookmarks(id) {
			bump(id, 'getBestBookmarks');
			if (failBookPopularOnce && id === 'fail-book' && !failedOnce) {
				failedOnce = true;
				throw new Error('POPULAR FAIL SENTINEL');
			}
			return makeLargeData(id).popular;
		},
		async getPublicReviews(id) {
			bump(id, 'getPublicReviews');
			return makeLargeData(id).publicReviews;
		}
	};
	return api;
}

const findBtn = (root, prefix) =>
	[...root.querySelectorAll('button')].find((b) => b.textContent.startsWith(prefix));

window.perfSmoke = {
	assertions,
	async largeDetailBatching() {
		const { plugin, service } = makePlugin();
		const root = document.createElement('main');
		document.body.append(root);
		const api = makeCountingApi();
		const panel = new WereadBookDetailPanel(root, api, plugin);
		await panel.onOpen();
		await service.load();
		await panel.setState({ bookId: 'big-1', currentTab: 'highlights' });
		await tick();

		const counts = root.querySelector('.weread-detail-counts').textContent;
		check(
			counts.includes('120 条划线') && counts.includes('120 条笔记'),
			'Header displays full 120 highlight and 120 note counts immediately'
		);
		check(
			root.querySelectorAll('.weread-detail-highlight').length === 50,
			'Initial render mounts 50 highlights'
		);
		check(
			[...root.querySelectorAll('.weread-detail-chapter-title')].map((n) => n.textContent).join('|') === '第一章',
			'Only 第一章 header rendered in batch 1'
		);
		const moreBtn = findBtn(root, '加载更多');
		check(moreBtn?.textContent === '加载更多（剩余 70 条）', 'More button reports 70 remaining');

		// Favorite an item in batch 1 before appending batch 2.
		const firstCard = root.querySelector('[data-bookmark-id="h-1"]');
		const firstStar = root.querySelector('[data-favorite-id="big-1:highlight:h-1"]');
		firstStar.click();
		await until(() => service.getSnapshot().pendingIds.length === 0, 'favorite h-1');
		check(firstStar.getAttribute('aria-pressed') === 'true', 'Batch 1 star persists');

		moreBtn.click();
		await tick();
		check(
			root.querySelectorAll('.weread-detail-highlight').length === 100,
			'Clicking load more mounts next 50 highlights'
		);
		check(
			[...root.querySelectorAll('.weread-detail-chapter-title')].map((n) => n.textContent).join('|') === '第一章|第二章',
			'Appending across chapter boundary creates 第二章 without duplicating 第一章 header'
		);
		check(
			root.querySelector('[data-bookmark-id="h-1"]') === firstCard &&
				firstStar.getAttribute('aria-pressed') === 'true',
			'Batch 1 highlight DOM node and favorite state remain intact after batch 2 append'
		);
		check(
			findBtn(root, '加载更多')?.textContent === '加载更多（剩余 20 条）',
			'More button updates remaining count to 20'
		);

		const secondBatchStar = root.querySelector('[data-favorite-id="big-1:highlight:h-51"]');
		check(!!secondBatchStar, 'Batch 2 highlight exposes favorite star');
		secondBatchStar.click();
		await until(() => service.getSnapshot().pendingIds.length === 0, 'favorite h-51');
		check(
			secondBatchStar.getAttribute('aria-pressed') === 'true' &&
				firstStar.getAttribute('aria-pressed') === 'true',
			'Newly appended batch 2 highlight can be favorited and stays synced'
		);

		findBtn(root, '显示全部').click();
		await tick();
		check(
			root.querySelectorAll('.weread-detail-highlight').length === 120,
			'Show all mounts all 120 highlights'
		);
		check(!root.querySelector('.weread-detail-more-bar'), 'More bar removed once all mounted');

		// Check responsive fit with more bar visible on notes tab.
		root.querySelector('[data-tab="notes"]').click();
		await tick();
		check(
			root.querySelectorAll('.weread-detail-note').length === 50,
			'Notes tab initially mounts 50 entries'
		);
		check(
			root.querySelector('.weread-detail-note .weread-detail-entry-meta').textContent.includes('第二章'),
			'Note chapter title resolves via prebuilt chapter Map'
		);
		check(
			document.documentElement.scrollWidth <= innerWidth,
			'More bar fits desktop viewport without horizontal overflow'
		);
		findBtn(root, '加载更多').click();
		check(root.querySelectorAll('.weread-detail-note').length === 100, 'Notes load more appends 50');
		findBtn(root, '显示全部').click();
		check(root.querySelectorAll('.weread-detail-note').length === 120, 'Notes show all renders 120');

		await panel.onClose();
		root.remove();
		service.dispose();
	},
	async checkMobileOverflowOnMoreBar() {
		const { plugin, service } = makePlugin();
		const root = document.createElement('main');
		document.body.append(root);
		const panel = new WereadBookDetailPanel(root, makeCountingApi(), plugin);
		await panel.onOpen();
		await service.load();
		await panel.setState({ bookId: 'mobile-book', currentTab: 'highlights' });
		await tick();
		check(
			document.documentElement.scrollWidth <= innerWidth,
			'More bar fits narrow viewport ' + innerWidth + ' without horizontal overflow'
		);
		await panel.onClose();
		root.remove();
		service.dispose();
	},
	async detailCacheAndCompaction() {
		const { plugin, service } = makePlugin();
		const root = document.createElement('main');
		document.body.append(root);
		const api = makeCountingApi(true);
		settingsStore.set({
			favoritesViewMode: 'cards',
			bookOpenMode: 'web',
			wereadApiKey: 'key-1',
			cookies: [],
			isCookieValid: false
		});
		const panel = new WereadBookDetailPanel(root, api, plugin);
		await panel.onOpen();
		await service.load();

		await panel.setState({ bookId: '42', currentTab: 'highlights' });
		check(api.calls.get('42')?.getNotebookHighlights === 1, 'Initial open fetches book 42');
		root.querySelector('[data-tab="reviews"]').click();
		check(
			root.textContent.includes('我自己的昵称') && root.textContent.includes('社区读者'),
			'Compacted reviews preserve author.name for own and community reviews'
		);

		await panel.setState({ bookId: '43', currentTab: 'highlights' });
		await panel.setState({ bookId: '42', currentTab: 'highlights' });
		check(
			api.calls.get('42')?.getNotebookHighlights === 1 &&
				api.calls.get('42')?.getBook === 1,
			'Reopening cached book 42 on same api makes 0 extra API calls'
		);

		findBtn(root, '刷新').click();
		await until(
			() =>
				api.calls.get('42')?.getNotebookHighlights === 2 &&
				Boolean(findBtn(root, '刷新')) &&
				!findBtn(root, '刷新').disabled,
			'explicit refresh'
		);
		check(
			api.calls.get('42')?.getNotebookHighlights === 2,
			'Clicking refresh bypasses cache'
		);

		settingsStore.set({
			favoritesViewMode: 'cards',
			bookOpenMode: 'web',
			wereadApiKey: 'key-2',
			cookies: [],
			isCookieValid: false
		});
		await panel.setState({ bookId: '43', currentTab: 'highlights' });
		await panel.setState({ bookId: '42', currentTab: 'highlights' });
		check(
			api.calls.get('42')?.getNotebookHighlights === 3,
			'Credential change invalidates cache'
		);

		// Partial failure should NOT be cached.
		await panel.setState({ bookId: 'fail-book', currentTab: 'popular' });
		check(
			root.textContent.includes('此项远程数据暂不可用'),
			'Partial failure displays retry warning'
		);
		await panel.setState({ bookId: '42', currentTab: 'highlights' });
		await panel.setState({ bookId: 'fail-book', currentTab: 'popular' });
		check(
			api.calls.get('fail-book')?.getBestBookmarks === 2 &&
				!root.textContent.includes('此项远程数据暂不可用'),
			'Failed response is not cached and succeeds on reopen'
		);

		// LRU max 5 eviction on fresh counting api.
		const lruApi = makeCountingApi();
		const lruPanel = new WereadBookDetailPanel(root, lruApi, plugin);
		await panel.onClose();
		await lruPanel.onOpen();
		for (const id of ['b1', 'b2', 'b3', 'b4', 'b5', 'b6']) {
			await lruPanel.setState({ bookId: id, currentTab: 'highlights' });
		}
		await lruPanel.setState({ bookId: 'b5', currentTab: 'highlights' });
		check(lruApi.calls.get('b5')?.getBook === 1, 'LRU retains recent book b5');
		await lruPanel.setState({ bookId: 'b1', currentTab: 'highlights' });
		check(lruApi.calls.get('b1')?.getBook === 2, 'LRU evicts oldest book b1 after 6 loads');

		await lruPanel.onClose();
		root.remove();
		service.dispose();
		settingsStore.set({ favoritesViewMode: 'cards', bookOpenMode: 'web' });
		check(browserErrors.length === 0, 'No uncaught browser errors: ' + browserErrors.join('|'));
	}
};
`;

test(
	'book detail batch rendering, favorite sync on appended batches, and LRU cache in Chrome',
	{ skip: !chromeAvailable, timeout: 60000 },
	async (t) => {
		const browser = await browserHarness(t);
		await browser.viewport(1180, 600);
		await browser.evaluate(await bundleFixture(chromeFixture));
		await browser.evaluate('perfSmoke.largeDetailBatching()');
		for (const width of [375, 320]) {
			await browser.viewport(width, 600);
			await browser.evaluate('perfSmoke.checkMobileOverflowOnMoreBar()');
		}
		await browser.viewport(1180, 600);
		await browser.evaluate('perfSmoke.detailCacheAndCompaction()');
		const count = await browser.evaluate('perfSmoke.assertions.length');
		assert(count >= 20, `Expected comprehensive assertions, got ${count}`);
		t.diagnostic(`${count} book detail batch/cache Chrome assertions passed`);
	}
);
