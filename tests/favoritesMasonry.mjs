// Run: node --test tests/favoritesMasonry.mjs; CHROME_BIN overrides Chrome.
// Production panel/CSS, synthetic data, no vault or network access.
import assert from 'node:assert/strict';
import test from 'node:test';
import { browserHarness, bundleFixture, chromeAvailable } from './helpers/detailBrowserHarness.mjs';

const fixture = String.raw`
import { WereadFavoritesPanel } from './src/components/wereadFavorites';
import { settingsStore } from './src/settings';
const create = function(tag, options = {}) {
  if (typeof options === 'string') options = {cls: options};
  const node = document.createElement(tag);
  if (options.cls) node.className = options.cls;
  if (options.text !== undefined) node.textContent = options.text;
  for (const key of ['type', 'href', 'value']) if (options[key] !== undefined) node[key] = options[key];
  for (const [key, value] of Object.entries(options.attr || {})) {
    if (tag === 'img' && key === 'src') node.src = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="64" height="90"><rect width="64" height="90" fill="#718562"/></svg>');
    else node.setAttribute(key, value);
  }
  this.append(node); return node;
};
HTMLElement.prototype.createEl = create;
HTMLElement.prototype.createDiv = function(options) { return create.call(this, 'div', options); };
HTMLElement.prototype.createSpan = function(options) { return create.call(this, 'span', options); };
HTMLElement.prototype.empty = function() { this.replaceChildren(); };
HTMLElement.prototype.addClass = function(...names) { this.classList.add(...names); };
HTMLElement.prototype.setText = function(text) { this.textContent = text; };
window.detailNotices = [];
const style = document.createElement('style');
style.textContent = ':root{--text-normal:#222;--text-muted:#666;--background-primary:#fff;--background-modifier-border:#ddd}body{margin:0;font-family:Arial,sans-serif;font-size:14px}';
document.head.append(style);
// Track ownership while preserving native Chrome observer delivery and layout.
const observers = [], NativeObserver = window.ResizeObserver;
let closeOnResize;
window.ResizeObserver = class {
  targets = new Set(); callbacks = 0;
  constructor(callback) {
    observers.push(this);
    this.native = new NativeObserver((entries) => {
      this.callbacks++; callback(entries, this);
      if (closeOnResize) { const close = closeOnResize; closeOnResize = undefined; close(); }
    });
  }
  observe(target, options) { this.targets.add(target); this.native.observe(target, options); }
  unobserve(target) { this.targets.delete(target); this.native.unobserve(target); }
  disconnect() { this.targets.clear(); this.native.disconnect(); }
};
const nativeFrame = window.requestAnimationFrame.bind(window), nativeCancel = window.cancelAnimationFrame.bind(window);
const frames = new Set();
window.requestAnimationFrame = (callback) => {
  const id = nativeFrame((time) => { frames.delete(id); callback(time); }); frames.add(id); return id;
};
window.cancelAnimationFrame = (id) => { frames.delete(id); nativeCancel(id); };
const settle = async () => { for (let i = 0; i < 8; i++) await new Promise(nativeFrame); };
const entries = Array.from({length: 35}, (_, index) => {
  const id = 'favorite-' + String(index).padStart(2, '0');
  const text = index === 0 ? '高卡片。阅读让时间留下痕迹。'.repeat(22)
    : index === 1 ? '短句。' : ('第' + index + '段阅读。').repeat(2 + index % 7);
  return {id, favoritedAt: 2000000 - index * 1000, updatedAt: 2000000, note: {
    id, bookId: 'book-' + index, kind: 'highlight', text, createTime: 1000000,
    bookTitle: index % 2 ? '林间散步' : '城市记忆', author: '作者',
    cover: index === 0 ? 'https://fixture.invalid/cover.svg' : ''
  }};
});
let state = {favorites: entries, loaded: true, loading: false, writable: true, error: '', warning: '', pendingIds: []};
const listeners = new Set();
const service = {
  getSnapshot: () => state,
  subscribe(fn) { listeners.add(fn); fn(state); return () => listeners.delete(fn); },
  async load() { return state; },
  publish(patch) { state = {...state, ...patch}; for (const fn of listeners) fn(state); }
};
const root = document.body.createDiv();
settingsStore.set({favoritesViewMode: 'cards'});
const panel = new WereadFavoritesPanel(root, {app: {}, async activateBookDetailView() {}}, service);
const cards = () => [...root.querySelectorAll('article')];
const rect = (node) => {
  const r = node.getBoundingClientRect();
  return {id: node.dataset.favoriteId, left: r.left, right: r.right, top: r.top, bottom: r.bottom, height: r.height, width: r.width};
};
window.masonry = {
  async open() { await panel.onOpen(); await settle(); },
  settle,
  geometry() { return cards().map(rect); },
  ids() { return cards().map(card => card.dataset.favoriteId); },
  expected(ascending = false, query = '', limit = 30) {
    return [...entries].filter(entry => (entry.note.text + ' ' + entry.note.bookTitle + ' ' + entry.note.author).includes(query))
      .sort((a, b) => ascending ? a.favoritedAt - b.favoritedAt : b.favoritedAt - a.favoritedAt)
      .slice(0, limit).map(entry => entry.id);
  },
  async nineFavorites() {
    service.publish({favorites: entries.slice(0, 9).map(entry => ({...entry, note: {...entry.note, bookId: entry.note.bookTitle === '林间散步' ? 'forest' : 'city'}}))});
    await settle();
  },
  counts() {
    return [...root.querySelectorAll('.weread-favorites-count')].map(node => ({text: node.textContent.trim(), icons: node.querySelectorAll('svg').length}));
  },
  searchGeometry() {
    return {input: rect(root.querySelector('input')), actions: rect(root.querySelector('.weread-favorites-toolbar-actions')),
      viewport: innerWidth, scrollWidth: document.documentElement.scrollWidth};
  },
  async search(value) {
    const input = root.querySelector('input'); input.value = value;
    input.dispatchEvent(new Event('input')); await settle();
  },
  async sort() { root.querySelector('.weread-favorites-sort').click(); await settle(); },
  async mode(mode) { root.querySelector('[aria-label="' + (mode === 'list' ? '列表视图' : '卡片视图') + '"]').click(); await settle(); },
  async more() { root.querySelector('.weread-favorites-more').click(); await settle(); },
  async grow() {
    cards()[1].querySelector('.weread-favorites-text').textContent += '展开后的长正文，需要重新排列后续卡片。'.repeat(30); await settle();
  },
  async removeCover() { root.querySelector('img').dispatchEvent(new Event('error')); await settle(); },
  async expand() { cards()[0].querySelector('.weread-favorites-summary').click(); await settle(); },
  auxiliary(selector) { return rect(root.querySelector(selector)); },
  grid() { return rect(root.querySelector('.weread-favorites-results')); },
  colors() {
    return cards().map(card => {
      const style = getComputedStyle(card);
      return {id: card.dataset.favoriteId, hue: style.getPropertyValue('--weread-favorite-hue').trim(), background: style.backgroundImage};
    });
  },
  async reopen() { await panel.onClose(); await panel.onOpen(); await settle(); },
  listStyles() { return cards().map(card => ({row: card.style.gridRowEnd, align: card.style.alignSelf, margin: getComputedStyle(card).marginBottom})); },
  lifetime() {
    return {detached: observers.reduce((sum, observer) => sum + [...observer.targets].filter(target => !target.isConnected).length, 0),
      targets: observers.reduce((sum, observer) => sum + observer.targets.size, 0),
      callbacks: observers.reduce((sum, observer) => sum + observer.callbacks, 0), frames: frames.size, listeners: listeners.size};
  },
  async resizeAndClose() {
    return await new Promise((resolve) => {
      closeOnResize = async () => {
        const queued = frames.size;
        await panel.onClose();
        resolve(queued);
      };
      root.style.width = '650px';
    });
  },
  async publishAfterClose() { service.publish({warning: 'fixture refresh'}); root.style.width = ''; await settle(); }
};
`;
const bundled = await bundleFixture(fixture);
async function mount(t, width = 900) {
	const browser = await browserHarness(t);
	await browser.viewport(width);
	await browser.evaluate(bundled);
	await browser.evaluate('masonry.open()');
	return browser;
}
function assertNoOverlaps(rects) {
	for (let i = 0; i < rects.length; i++) {
		assert(rects[i].height > 0, `${rects[i].id} has natural height`);
		for (let j = i + 1; j < rects.length; j++) {
			const a = rects[i],
				b = rects[j];
			assert(
				a.right <= b.left + 1 ||
					b.right <= a.left + 1 ||
					a.bottom <= b.top + 1 ||
					b.bottom <= a.top + 1,
				`${a.id} overlaps ${b.id}`
			);
		}
	}
}
function assertMasonry(rects, columns) {
	assertNoOverlaps(rects);
	const lefts = [...new Set(rects.map((rect) => Math.round(rect.left)))];
	assert.equal(lefts.length, columns, `expected ${columns} actual columns`);
	for (const left of lefts) {
		const column = rects
			.filter((rect) => Math.abs(rect.left - left) <= 1)
			.sort((a, b) => a.top - b.top);
		for (let i = 1; i < column.length; i++) {
			const gap = column[i].top - column[i - 1].bottom;
			assert(
				Math.abs(gap - 20) <= 2,
				`${column[i - 1].id} → ${column[i].id}: actual gap ${gap.toFixed(2)}px, expected 20±2px`
			);
		}
	}
}
async function assertOrder(browser, ascending = false, query = '', limit = 30) {
	assert.deepEqual(
		await browser.evaluate('masonry.ids()'),
		await browser.evaluate(
			`masonry.expected(${ascending}, ${JSON.stringify(query)}, ${limit})`
		),
		'DOM remains in chronological order'
	);
}
async function assertFullWidth(browser, selector) {
	const { grid, element, cards } = await browser.evaluate(
		`({grid: masonry.grid(), element: masonry.auxiliary(${JSON.stringify(selector)}), cards: masonry.geometry()})`
	);
	assert(Math.abs(element.left - grid.left) <= 1);
	assert(Math.abs(element.right - grid.right) <= 1, `${selector} spans every column`);
	if (cards.length)
		assert(
			element.top >= Math.max(...cards.map((card) => card.bottom)),
			'load more follows all cards'
		);
}

test(
	'favorites cards use varied light colors that remain stable across view changes',
	{ skip: !chromeAvailable },
	async (t) => {
		const browser = await mount(t);
		await browser.evaluate('masonry.more()');
		const colors = await browser.evaluate('masonry.colors()');
		assert.equal(colors.length, 35);
		assert(
			new Set(colors.map((card) => card.hue)).size > 1,
			'favorite identities receive varied hues'
		);
		assert(
			new Set(colors.map((card) => card.background)).size > 1,
			'varied hues produce different rendered gradients'
		);
		const original = new Map(colors.map((card) => [card.id, card]));
		for (const card of colors) {
			const alphas = [...card.background.matchAll(/rgba\([^)]*,\s*([\d.]+)\)/g)].map(
				(match) => Number(match[1])
			);
			assert.equal(alphas.length, 2, 'computed gradient has two translucent stops');
			assert(
				alphas.every((alpha) => alpha > 0 && alpha <= 0.03),
				`lighter gradient opacity: ${card.background}`
			);
		}
		const assertStable = async () => {
			for (const card of await browser.evaluate('masonry.colors()'))
				assert.deepEqual(
					card,
					original.get(card.id),
					`${card.id} retains its rendered color`
				);
		};
		await browser.evaluate('masonry.search("林间散步")');
		await assertStable();
		await browser.evaluate('masonry.search("")');
		await browser.evaluate('masonry.sort()');
		await assertStable();
		await browser.evaluate('masonry.mode("list")');
		for (const card of await browser.evaluate('masonry.colors()')) {
			assert.equal(card.background, 'none', 'list rows have a flat background');
			assert.equal(card.hue, '', 'list rows receive no card hue');
		}
		await browser.evaluate('masonry.mode("cards")');
		await assertStable();
		await browser.evaluate('masonry.reopen()');
		await assertStable();
	}
);

test(
	'favorites counters show icons and count unique books across filtered entries',
	{ skip: !chromeAvailable },
	async (t) => {
		const browser = await mount(t);
		await browser.evaluate('masonry.nineFavorites()');
		assert.equal((await browser.evaluate('masonry.ids()')).length, 9);
		assert.deepEqual(await browser.evaluate('masonry.counts()'), [
			{ text: '9 条收藏', icons: 1 },
			{ text: '2 本书', icons: 1 }
		]);
		await browser.evaluate('masonry.search("林间散步")');
		assert.equal((await browser.evaluate('masonry.ids()')).length, 4);
		assert.deepEqual(await browser.evaluate('masonry.counts()'), [
			{ text: '4 条收藏', icons: 1 },
			{ text: '1 本书', icons: 1 }
		]);
		await browser.evaluate('masonry.search("no such favorite")');
		assert.deepEqual(await browser.evaluate('masonry.counts()'), [
			{ text: '0 条收藏', icons: 1 },
			{ text: '0 本书', icons: 1 }
		]);
		await browser.evaluate('masonry.search("")');
		assert.deepEqual(await browser.evaluate('masonry.counts()'), [
			{ text: '9 条收藏', icons: 1 },
			{ text: '2 本书', icons: 1 }
		]);
	}
);
test(
	'favorites search is wider on desktop and remains usable in a narrow pane',
	{ skip: !chromeAvailable },
	async (t) => {
		const browser = await mount(t, 1220);
		const desktop = await browser.evaluate('masonry.searchGeometry()');
		assert(
			desktop.input.width >= 350 && desktop.input.width <= 430,
			`desktop search width ${desktop.input.width}`
		);
		assert(
			desktop.input.right <= desktop.actions.left,
			'desktop search and actions share a row without overlapping'
		);
		await browser.viewport(390);
		await browser.evaluate('masonry.settle()');
		const narrow = await browser.evaluate('masonry.searchGeometry()');
		assert(narrow.input.width >= 200, 'narrow search retains usable text width');
		for (const rect of [narrow.input, narrow.actions]) {
			assert(
				rect.left >= 0 && rect.right <= narrow.viewport + 1,
				'narrow controls remain inside viewport'
			);
		}
		assert(
			narrow.scrollWidth <= narrow.viewport,
			'narrow toolbar causes no horizontal overflow'
		);
		assert(
			narrow.input.right <= narrow.actions.left || narrow.input.bottom <= narrow.actions.top,
			'wrapped narrow controls do not overlap'
		);
		await browser.evaluate('masonry.search("林间散步")');
		await assertOrder(browser, false, '林间散步');
		assertMasonry(await browser.evaluate('masonry.geometry()'), 1);
	}
);

test(
	'favorites masonry fills the short column and responds to one/three-column resizes',
	{ skip: !chromeAvailable },
	async (t) => {
		const browser = await mount(t);
		const rects = await browser.evaluate('masonry.geometry()');
		assert(
			rects[0].height > rects[1].height + 150,
			'fixture presents materially unequal cards'
		);
		assertMasonry(rects, 2);
		assert(rects[2].top < rects[0].bottom, 'next card starts beside the tall card');
		await assertOrder(browser);
		for (const [width, columns] of [
			[620, 1],
			[1220, 3],
			[900, 2]
		]) {
			await browser.viewport(width);
			await browser.evaluate('masonry.settle()');
			assertMasonry(await browser.evaluate('masonry.geometry()'), columns);
			await assertOrder(browser);
		}
	}
);
test(
	'favorites masonry retains visual spacing at fractional browser zoom',
	{ skip: !chromeAvailable },
	async (t) => {
		const browser = await mount(t);
		const zoom = 0.9128709291752769;
		await browser.evaluate(`document.body.style.zoom = ${zoom}; masonry.settle()`);
		const tracks = await browser.evaluate(`(() => {
		const style = getComputedStyle(document.querySelector('.weread-favorites-results'));
		return {declared: parseFloat(style.gridAutoRows), resolved: parseFloat(style.gridTemplateRows)};
	})()`);
		assert.equal(tracks.declared, 1, 'declared row remains one CSS pixel');
		assert(
			tracks.resolved > 0 && tracks.resolved < 0.999,
			`Chrome resolves fractional rows: ${tracks.resolved}`
		);
		const rects = await browser.evaluate('masonry.geometry()');
		// Rectangles are visual pixels under CSS zoom; normalize distances to CSS pixels.
		const normalized = rects.map((rect) =>
			Object.fromEntries(
				Object.entries(rect).map(([key, value]) => [
					key,
					typeof value === 'number' ? value / zoom : value
				])
			)
		);
		assertMasonry(normalized, 2);
		await assertOrder(browser);
	}
);

test(
	'favorites masonry reflows after content grows and a failed cover is removed',
	{ skip: !chromeAvailable },
	async (t) => {
		const browser = await mount(t);
		const before = await browser.evaluate('masonry.geometry()');
		await browser.evaluate('masonry.grow()');
		const grown = await browser.evaluate('masonry.geometry()');
		assert(grown[1].height > before[1].height + 100, 'long text grows an existing card');
		assertMasonry(grown, 2);
		await browser.evaluate('masonry.removeCover()');
		const removed = await browser.evaluate('masonry.geometry()');
		assert(
			removed[0].height < grown[0].height - 20,
			'cover removal changes actual wrapping and height'
		);
		assertMasonry(removed, 2);
		await assertOrder(browser);
	}
);
test(
	'favorites filtering, sorting, empty state and load more preserve masonry and DOM chronology',
	{ skip: !chromeAvailable },
	async (t) => {
		const browser = await mount(t);
		await assertFullWidth(browser, '.weread-favorites-more');
		await browser.evaluate('masonry.more()');
		assert.equal((await browser.evaluate('masonry.ids()')).length, 35);
		assertMasonry(await browser.evaluate('masonry.geometry()'), 2);
		await assertOrder(browser, false, '', 35);
		await browser.evaluate('masonry.sort()');
		await assertOrder(browser, true);
		assertMasonry(await browser.evaluate('masonry.geometry()'), 2);
		await browser.evaluate('masonry.search("林间散步")');
		await assertOrder(browser, true, '林间散步');
		assertMasonry(await browser.evaluate('masonry.geometry()'), 2);
		await browser.evaluate('masonry.search("no such favorite")');
		assert.deepEqual(await browser.evaluate('masonry.ids()'), []);
		await assertFullWidth(browser, '.weread-favorites-empty');
		await browser.evaluate('masonry.search("")');
		assertMasonry(await browser.evaluate('masonry.geometry()'), 2);
		await assertOrder(browser, true);
	}
);
test(
	'favorites list expansion and cards/list switches release masonry styles and observers',
	{ skip: !chromeAvailable },
	async (t) => {
		const browser = await mount(t);
		await browser.evaluate('masonry.mode("list")');
		for (const style of await browser.evaluate('masonry.listStyles()'))
			assert.deepEqual(style, { row: '', align: '', margin: '0px' });
		assert.equal(
			(await browser.evaluate('masonry.lifetime()')).targets,
			0,
			'list mode has no masonry observers'
		);
		const before = await browser.evaluate('masonry.geometry()');
		await browser.evaluate('masonry.expand()');
		const expanded = await browser.evaluate('masonry.geometry()');
		assert(expanded[0].height > before[0].height + 100, 'list summary expands real long text');
		assertNoOverlaps(expanded);
		await assertOrder(browser);
		await browser.evaluate('masonry.mode("cards")');
		assertMasonry(await browser.evaluate('masonry.geometry()'), 2);
		await assertOrder(browser);
		const lifetime = await browser.evaluate('masonry.lifetime()');
		assert(lifetime.targets > 0, 'card observers resume');
		assert.equal(lifetime.detached, 0, 'rerender drops detached targets');
	}
);
test(
	'favorites close cancels observers and queued frames; reopening observes only current cards',
	{ skip: !chromeAvailable },
	async (t) => {
		const browser = await mount(t);
		for (let cycle = 0; cycle < 2; cycle++) {
			assert(
				(await browser.evaluate('masonry.resizeAndClose()')) > 0,
				'native resize queued a real animation frame before close'
			);
			const closed = await browser.evaluate('masonry.lifetime()');
			assert.equal(closed.targets, 0, 'close disconnects observers');
			assert.equal(closed.frames, 0, 'close cancels frames');
			assert.equal(closed.listeners, 0, 'close unsubscribes service');
			await browser.evaluate('masonry.publishAfterClose()');
			const settled = await browser.evaluate('masonry.lifetime()');
			assert.equal(
				settled.callbacks,
				closed.callbacks,
				'closed panel receives no delayed resize callbacks'
			);
			assert.equal(settled.frames, 0);
			await browser.evaluate('masonry.open()');
			const opened = await browser.evaluate('masonry.lifetime()');
			assert.equal(opened.listeners, 1);
			assert(opened.targets > 0);
			assert.equal(opened.detached, 0);
			assertMasonry(await browser.evaluate('masonry.geometry()'), 2);
			await assertOrder(browser);
		}
	}
);
