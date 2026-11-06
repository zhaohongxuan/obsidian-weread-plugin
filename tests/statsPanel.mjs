// Run: node --test tests/statsPanel.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { transformSync } from 'esbuild';

class Component {
	children = [];
	addChild(child) { this.children.push(child); return child; }
	removeChild(child) {
		this.children = this.children.filter((entry) => entry !== child);
		child.onunload();
		return child;
	}
}
class ItemView extends Component {
	constructor(leaf) { super(); Object.assign(this, leaf); }
}
const settings = { value: { wereadApiKey: 'key' } };
function load(path, mocks) {
	const module = { exports: {} };
	const code = transformSync(readFileSync(path, 'utf8'), {
		loader: 'ts', format: 'cjs', target: 'es2020'
	}).code;
	new Function('require', 'module', 'exports', code)((name) => {
		if (!(name in mocks)) throw new Error(`Unexpected dependency: ${name}`);
		return mocks[name];
	}, module, module.exports);
	return module.exports;
}
const obsidian = { Component, ItemView, Modal: class {} };
const panelModule = load('src/components/wereadPanel.ts', { obsidian });
const { WereadReadingStatsPanel: Panel, WereadReadingStatsView: View } = load(
	'src/components/wereadReadingStats.ts', {
		obsidian,
		'./wereadPanel': panelModule,
		'./wereadReadingStats.css': {},
		'../statsInsights': load('src/statsInsights.ts', {}),
		'../settings': { settingsStore: settings },
		'svelte/store': { get: (store) => store.value }
	}
);
class StatsElement {
	children = [];
	attributes = {};
	listeners = {};
	style = {};
	clientWidth = 300;
	classList = { toggle: (name, active) => { this.attributes[name] = active; } };
	createDiv(options = {}) { return this.createEl('div', options); }
	createSpan(options = {}) { return this.createEl('span', options); }
	createSvg(tag, options = {}) { return this.createEl(tag, options); }
	createEl(tag, options = {}) {
		const child = new StatsElement();
		Object.assign(child, { tag, textContent: options.text, cls: options.cls });
		Object.assign(child.attributes, options.attr);
		this.children.push(child);
		return child;
	}
	setAttribute(name, value) { this.attributes[name] = value; }
	setText(value) { this.textContent = value; }
	addEventListener(name, listener) { this.listeners[name] = listener; }
	empty() { this.children = []; }
	focus() { this.listeners.focus?.(); }
}

test('responsive chart keeps every bar in bounds and preserves selection while resizing', async () => {
	const previous = globalThis.ResizeObserver;
	let observer;
	globalThis.ResizeObserver = class {
		disconnects = 0;
		constructor(callback) { this.callback = callback; observer = this; }
		observe(element) { this.element = element; }
		disconnect() { this.disconnects++; }
	};
	try {
		const { panel } = makePanel();
		const parent = new StatsElement();
		panel.renderBarChart(parent, [0, 60, 120, 180, 60, 0], ['1日', '2日', '3日', '4日', '5日', '6日']);
		const svg = parent.children[0].children[0];
		const bars = svg.children.filter(element => element.tag === 'rect');
		bars[4].listeners.click();
		const detail = parent.children[1].textContent;
		observer.element.clientWidth = 250;
		observer.callback();
		assert.equal(svg.attributes.viewBox, '0 0 250 176');
		for (const bar of bars) {
			assert.ok(Number(bar.attributes.x) >= 52);
			assert.ok(Number(bar.attributes.x) + Number(bar.attributes.width) <= 250);
		}
		assert.equal(bars[4].attributes['aria-pressed'], 'true');
		assert.equal(parent.children[1].textContent, detail);
		panel.statsEl = new StatsElement();
		Panel.prototype.render.call(panel);
		assert.equal(observer.disconnects, 1, 'period render disconnects prior observer');
		assert.equal(panel.chartResizeObserver, null);
		panel.chartResizeObserver = observer;
		await panel.onClose();
		assert.equal(observer.disconnects, 2, 'close disconnects remaining observer');
		assert.equal(panel.chartResizeObserver, null);
	} finally {
		if (previous === undefined) delete globalThis.ResizeObserver;
		else globalThis.ResizeObserver = previous;
	}
});

test('category bars rank all categories and retain remainder in percentage denominator', () => {
	const { panel } = makePanel();
	const parent = new StatsElement();
	panel.renderCategoryBars(parent, Array.from({ length: 8 }, (_, index) => ({ label: `分类${index + 1}`, value: (index + 1) * 60 })));
	const rows = parent.children[0].children;
	assert.equal(rows.length, 7);
	assert.equal(rows[0].children[0].textContent, '分类8');
	assert.equal(rows[0].children[1].textContent, '8分钟 · 22.2%');
	assert.equal(rows[6].children[0].textContent, '其他');
	assert.equal(rows[6].children[1].textContent, '3分钟 · 8.3%');
	assert.ok(Math.abs(parseFloat(rows[0].children[2].children[0].style.width) - 8 / 36 * 100) < 0.001);
});

function deferred() {
	let resolve;
	const promise = new Promise((done) => { resolve = done; });
	return { promise, resolve };
}
function makePanel(api = {}, app = {}) {
	let clears = 0;
	const panel = new Panel({ empty() { clears++; } }, app, api, {});
	panel.renderLoading = () => {};
	panel.render = () => { panel.renders = (panel.renders || 0) + 1; };
	return { panel, clears: () => clears };
}

test('closing stats discards a pending response and closes idempotently', async () => {
	const response = deferred();
	const { panel, clears } = makePanel({ getReadingStats: () => response.promise });
	const pending = panel.loadData();
	await panel.onClose();
	await panel.onClose();
	response.resolve({ totalReadTime: 3600 });
	await pending;
	assert.equal(panel.data, null);
	assert.equal(panel.renders || 0, 0);
	assert.equal(clears(), 1);
});

test('only the newest stats period request updates panel state', async () => {
	const first = deferred();
	const second = deferred();
	let calls = 0;
	const { panel } = makePanel({ getReadingStats: () => (++calls === 1 ? first : second).promise });
	const pendingFirst = panel.loadData();
	panel.currentMode = 'weekly';
	const pendingSecond = panel.loadData();
	const newestData = { totalReadTime: 60 };
	second.resolve(newestData);
	await pendingSecond;
	first.resolve({ totalReadTime: 3600 });
	await pendingFirst;
	assert.equal(panel.data, newestData);
	assert.equal(panel.renders, 1);
});

test('closing stats while reading daily cache prevents heatmap rendering and API requests', async () => {
	for (const method of ['loadAnnualDailyData', 'loadOverallDailyData']) {
		const exists = deferred();
		let requests = 0;
		const { panel } = makePanel({ getReadingStats: () => { requests++; } }, {
			vault: { adapter: { exists: () => exists.promise } }
		});
		const data = { readDays: 1 };
		panel.data = data;
		const pending = panel[method](data);
		await panel.onClose();
		exists.resolve(false);
		await pending;
		assert.equal(panel.renders || 0, 0);
		assert.equal(requests, 0);
	}
});

test('legacy stats view opens one child panel and unloads it exactly once', async () => {
	const originalOpen = Panel.prototype.onOpen;
	const originalClose = Panel.prototype.onClose;
	let opens = 0;
	let closes = 0;
	Panel.prototype.onOpen = async () => { opens++; };
	Panel.prototype.onClose = async () => { closes++; };
	try {
		const view = new View({ contentEl: {}, app: {} }, {}, {});
		await view.onOpen();
		await view.onOpen();
		assert.equal(view.children.length, 1);
		await view.onClose();
		await view.onClose();
		assert.equal(view.children.length, 0);
		assert.equal(opens, 1);
		assert.equal(closes, 1);
	} finally {
		Panel.prototype.onOpen = originalOpen;
		Panel.prototype.onClose = originalClose;
	}
});
