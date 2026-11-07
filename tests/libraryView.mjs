// Run: node --test tests/libraryView.mjs
// Executes the production shell with panel fixtures and the small DOM API it uses.
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import { build, transformSync } from 'esbuild';

const TABS = ['today', 'bookshelf', 'review', 'favorites', 'stats'];
const chromeBin =
	process.env.CHROME_BIN || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

test(
	'production Library fills its Obsidian view despite late host padding styles in Chrome',
	{ skip: !existsSync(chromeBin), timeout: 30000 },
	async (t) => {
		const bundle = await build({
			stdin: {
				resolveDir: process.cwd(),
				loader: 'ts',
				contents: `
      import { WereadLibraryView } from './src/components/wereadLibrary';
      HTMLElement.prototype.createEl = function(tag, options = {}) {
        const node = document.createElement(tag); if (options.cls) node.className = options.cls;
        if (options.text !== undefined) node.textContent = options.text;
        for (const [key, value] of Object.entries(options.attr || {})) node.setAttribute(key, value);
        this.append(node); return node;
      };
      HTMLElement.prototype.createDiv = function(options) { return this.createEl('div', options); };
      HTMLElement.prototype.empty = function() { this.replaceChildren(); };
      HTMLElement.prototype.addClass = function(...names) { this.classList.add(...names); };
      const style = document.createElement('style');
      style.textContent = '* {box-sizing:border-box} body {margin:0} .view-content {height:600px; padding-bottom:32px!important; overflow:auto!important}';
      document.head.append(style);
      const plugin = {app: {workspace: {requestSaveLayout() {}}}};
      (async () => {
        const view = new WereadLibraryView({}, plugin, {}, {}, {}, {}); await view.onOpen();
        const root = view.contentEl;
        const first = root.querySelector('[role=tabpanel]'); first.scrollTop = 140;
        const heightBefore = first.clientHeight;
        await view.selectTab('review'); await view.selectTab('today');
        const measured = {paddingBottom: getComputedStyle(root).paddingBottom, overflowY: getComputedStyle(root).overflowY,
          gap: root.getBoundingClientRect().bottom - first.getBoundingClientRect().bottom,
          retainedScroll: first.scrollTop, samePanel: root.querySelector('[role=tabpanel]') === first,
          sameHeight: first.clientHeight === heightBefore, panelHeight: first.clientHeight};
        await view.onClose(); measured.closed = root.children.length === 0;
        const output = document.createElement('pre'); output.id = 'library-result'; output.textContent = JSON.stringify(measured); document.body.append(output);
      })().catch(error => { const output = document.createElement('pre'); output.id = 'library-error'; output.textContent = error.stack; document.body.append(output); });
    `
			},
			bundle: true,
			platform: 'browser',
			format: 'iife',
			write: false,
			plugins: [
				{
					name: 'library-host-style-fixtures',
					setup(builder) {
						builder.onResolve({ filter: /^obsidian$/ }, () => ({
							path: 'obsidian',
							namespace: 'mock'
						}));
						builder.onResolve(
							{
								filter: /\/(?:journalHelpers|wereadJournal|wereadBookshelf|wereadReadingStats|wereadFavorites|wereadBookDetailPanel)$/
							},
							({ path: filename }) => ({ path: filename, namespace: 'mock' })
						);
						builder.onLoad(
							{ filter: /.*/, namespace: 'mock' },
							({ path: filename }) => ({
								contents:
									filename === 'obsidian'
										? `
        export class ItemView { constructor() { this.children = new Set(); this.app = {workspace: {requestSaveLayout() {}}}; this.contentEl = document.createElement('div'); this.contentEl.className = 'view-content'; document.body.append(this.contentEl); }
          addChild(child) {this.children.add(child); return child;} removeChild(child) {this.children.delete(child); child.onClose();} }
        export class Notice {}
        export function setIcon(element, name) { const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); svg.setAttribute('data-icon', name); element.append(svg); }
      `
										: filename.endsWith('journalHelpers')
											? 'export const journalId = value => String(value ?? "");'
											: `
        class Panel { constructor(element) {this.contentEl = element;} async onOpen() {const inner = document.createElement('div'); inner.style.height = '1800px'; this.contentEl.append(inner);} async onClose() {this.contentEl.empty();} }
        export {Panel as WereadJournalPanel, Panel as WereadBookshelfPanel, Panel as WereadReadingStatsPanel, Panel as WereadFavoritesPanel, Panel as WereadBookDetailPanel};
      `
							})
						);
						builder.onLoad({ filter: /\.css$/ }, ({ path: filename }) => ({
							contents:
								'const style = document.createElement("style"); style.textContent = ' +
								JSON.stringify(readFileSync(filename, 'utf8')) +
								'; document.head.append(style);',
							loader: 'js'
						}));
					}
				}
			]
		});
		const directory = await mkdtemp(path.join(tmpdir(), 'library-view-chrome-'));
		const filename = path.join(directory, 'fixture.html');
		await writeFile(
			filename,
			'<!doctype html><html><head></head><body><script>' +
				bundle.outputFiles[0].text.replaceAll('</script', '<\\/script') +
				'</script></body></html>'
		);
		const chrome = spawn(chromeBin, [
			'--headless=new',
			'--disable-gpu',
			'--no-first-run',
			'--no-default-browser-check',
			'--disable-background-networking',
			'--user-data-dir=' + path.join(directory, 'profile'),
			'--virtual-time-budget=1000',
			'--dump-dom',
			pathToFileURL(filename).href
		]);
		let stdout = '',
			stderr = '';
		chrome.stdout.on('data', (chunk) => {
			stdout += chunk;
		});
		chrome.stderr.on('data', (chunk) => {
			stderr += chunk;
		});
		const exited = new Promise((resolve, reject) => {
			chrome.once('error', reject);
			chrome.once('exit', resolve);
		});
		t.after(async () => {
			if (chrome.exitCode === null && chrome.signalCode === null) {
				chrome.kill('SIGKILL');
				await exited;
			}
			const resolved = path.resolve(directory);
			assert.equal(path.dirname(resolved), path.resolve(tmpdir()));
			assert(path.basename(resolved).startsWith('library-view-chrome-'));
			await rm(resolved, { recursive: true, force: true, maxRetries: 5, retryDelay: 150 });
		});
		assert.equal(await exited, 0, stderr);
		const result = stdout.match(/<pre id="library-result">(.*?)<\/pre>/s);
		assert(result, stdout.match(/<pre id="library-error">(.*?)<\/pre>/s)?.[1] || stderr);
		const measured = JSON.parse(result[1].replaceAll('&quot;', '"').replaceAll('&amp;', '&'));
		assert.equal(
			measured.paddingBottom,
			'0px',
			'Library must override late host padding-bottom:32px!important to remove the white strip'
		);
		assert.equal(
			measured.overflowY,
			'hidden',
			'Library root keeps scrolling inside its active panel'
		);
		assert(
			Math.abs(measured.gap) < 1,
			'Active Library panel bottom must be flush with the host view bottom'
		);
		assert.equal(measured.retainedScroll, 140);
		assert(measured.samePanel);
		assert(measured.sameHeight);
		assert(measured.panelHeight > 0);
		assert(measured.closed);
	}
);
function load(filename, mocks) {
	const module = { exports: {} };
	const code = transformSync(readFileSync(filename, 'utf8'), {
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
function deferred() {
	let resolve;
	const promise = new Promise((done) => {
		resolve = done;
	});
	return { promise, resolve };
}
const tick = async () => {
	await Promise.resolve();
	await Promise.resolve();
};

class Element {
	constructor(tag = 'div', owner = { activeElement: null }) {
		this.tag = tag;
		this.owner = owner;
		this.ownerDocument = owner;
		this.children = [];
		this.attributes = {};
		this.hidden = false;
		this.scrollTop = 0;
		this.classes = new Set();
		this.classList = {
			toggle: (name, selected) =>
				selected ? this.classes.add(name) : this.classes.delete(name)
		};
	}
	createEl(tag, options = {}) {
		const child = new Element(tag, this.owner);
		child.parent = this;
		child.textContent = options.text || '';
		child.addClass(...(options.cls || '').split(' ').filter(Boolean));
		for (const [key, value] of Object.entries(options.attr || {}))
			child.setAttribute(key, value);
		this.children.push(child);
		return child;
	}
	createDiv(options) {
		return this.createEl('div', options);
	}
	addClass(...names) {
		names.forEach((name) => this.classes.add(name));
	}
	setAttribute(key, value) {
		this.attributes[key] = String(value);
	}
	getAttribute(key) {
		return this.attributes[key] ?? null;
	}
	empty() {
		this.children = [];
	}
	remove() {
		this.parent.children = this.parent.children.filter((child) => child !== this);
	}
	contains(element) {
		return this === element || this.children.some((child) => child.contains(element));
	}
	focus() {
		this.owner.activeElement = this;
	}
	click() {
		this.onclick?.({ target: this });
	}
	key(key) {
		const event = {
			key,
			prevented: false,
			preventDefault() {
				this.prevented = true;
			}
		};
		this.onkeydown?.(event);
		return event;
	}
	all(predicate) {
		return this.children.flatMap((child) => [
			...(predicate(child) ? [child] : []),
			...child.all(predicate)
		]);
	}
}

function fixture({ initialTab = 'today', viewType, gates = {} } = {}) {
	const created = new Map();
	const calls = { getLeaf: 0, setViewState: 0, save: 0, removeChild: 0 };
	class Component {
		children = [];
		addChild(child) {
			this.children.push(child);
			return child;
		}
		removeChild(child) {
			calls.removeChild++;
			this.children = this.children.filter((entry) => entry !== child);
			child.onunload();
			return child;
		}
	}
	class ItemView extends Component {
		constructor(leaf) {
			super();
			Object.assign(this, leaf);
		}
		async setState(state, result) {
			this.baseState = { state, result };
		}
	}
	const obsidian = { Component, ItemView, Notice: class {}, setIcon: () => {} };
	const { WereadPanel } = load('src/components/wereadPanel.ts', { obsidian });
	class Panel extends WereadPanel {
		constructor(element, app, tab) {
			super(element, app);
			this.tab = tab;
			this.opens = 0;
			this.closes = 0;
			created.set(tab, [...(created.get(tab) || []), this]);
		}
		async onOpen() {
			this.opens++;
			this.filter = this.contentEl.createEl('input');
			this.filter.value = '';
			if (gates[this.tab]) await gates[this.tab].promise;
			this.ready = true;
		}
		async onClose() {
			this.closes++;
		}
		onMoreOptionsMenu(menu) {
			this.menu = menu;
		}
	}
	class JournalPanel extends Panel {
		constructor(element, plugin, journal, api, tab) {
			super(element, plugin.app, tab);
		}
	}
	class BookshelfPanel extends Panel {
		constructor(element, plugin, bookshelf, navigate, openBook) {
			super(element, plugin.app, 'bookshelf');
			this.navigate = navigate;
			this.openBook = openBook;
		}
	}
	class StatsPanel extends Panel {
		constructor(element, app) {
			super(element, app, 'stats');
		}
	}
	class FavoritesPanel extends Panel {
		constructor(element, plugin) {
			super(element, plugin.app, 'favorites');
		}
	}
	class DetailPanel extends Panel {
		constructor(element, api, plugin, options) {
			super(element, plugin.app, 'detail');
			this.options = options;
			this.state = {};
			this.generation = 0;
		}
		async onOpen() {
			this.opens++;
			this.back = this.contentEl.createEl('button', { text: this.options.breadcrumbLabel });
			this.back.onclick = this.options.onBack;
			if (gates.detailOpen) await gates.detailOpen.promise;
		}
		getState() {
			return this.state;
		}
		async setState(state) {
			this.state = { ...state };
			const generation = ++this.generation;
			if (gates[state.bookId]) await gates[state.bookId].promise;
			if (this.closes || generation !== this.generation) return;
			this.contentEl.createEl('p', { text: state.bookId });
		}
		async onClose() {
			this.closes++;
			this.generation++;
			this.contentEl.empty();
		}
	}
	const { WereadLibraryView } = load('src/components/wereadLibrary.ts', {
		obsidian,
		'../journalHelpers': load('src/journalHelpers.ts', {}),
		'./wereadJournal': { WereadJournalPanel: JournalPanel },
		'./wereadBookshelf': { WereadBookshelfPanel: BookshelfPanel },
		'./wereadReadingStats': { WereadReadingStatsPanel: StatsPanel },
		'./wereadFavorites': { WereadFavoritesPanel: FavoritesPanel },
		'./wereadBookDetailPanel': { WereadBookDetailPanel: DetailPanel },
		'./wereadLibrary.css': {}
	});
	const app = {
		workspace: {
			getLeaf() {
				calls.getLeaf++;
				throw new Error('Internal tabs must stay in their leaf');
			},
			setViewState() {
				calls.setViewState++;
				throw new Error('Internal tabs must not replace views');
			},
			requestSaveLayout() {
				calls.save++;
			}
		}
	};
	const contentEl = new Element('main');
	const leaf = {
		contentEl,
		app,
		setViewState() {
			calls.setViewState++;
			throw new Error('Internal tabs must not replace views');
		}
	};
	const plugin = { app };
	const view = new WereadLibraryView(leaf, plugin, {}, {}, {}, {}, initialTab, viewType);
	const buttons = () => contentEl.all((node) => node.getAttribute('role') === 'tab');
	const tabbar = () => contentEl.all((node) => node.getAttribute('role') === 'tablist');
	const panels = () => contentEl.all((node) => node.getAttribute('role') === 'tabpanel');
	const button = (tab) => buttons()[TABS.indexOf(tab)];
	const panel = (tab) => created.get(tab)?.[0];
	const visible = () => panels().filter((node) => !node.hidden);
	const assertSelected = (tab) => {
		assert.deepEqual(view.getState(), { tab });
		assert.deepEqual(visible(), [panel(tab).contentEl]);
		for (const name of TABS) {
			assert.equal(button(name).getAttribute('aria-selected'), String(name === tab));
			assert.equal(button(name).tabIndex, name === tab ? 0 : -1);
		}
	};
	return {
		view,
		contentEl,
		calls,
		created,
		button,
		panel,
		panels,
		tabbar,
		visible,
		assertSelected
	};
}

test('all five tabs navigate within one leaf and lazily open each retained panel once', async () => {
	const f = fixture();
	await f.view.onOpen();
	assert.deepEqual([...f.created.keys()], ['today']);
	const tabbar = f.tabbar()[0];
	const today = f.panel('today');
	today.filter.value = 'retained search';
	today.contentEl.scrollTop = 173;
	const originalInput = today.filter;
	for (const tab of [
		'bookshelf',
		'review',
		'favorites',
		'stats',
		'today',
		'favorites',
		'review',
		'bookshelf',
		'stats'
	]) {
		f.button(tab).click();
		await tick();
		f.assertSelected(tab);
		assert.deepEqual(f.tabbar(), [tabbar]);
	}
	assert.equal(today.filter, originalInput);
	assert.equal(today.filter.value, 'retained search');
	assert.equal(today.contentEl.scrollTop, 173);
	for (const tab of TABS) {
		assert.equal(f.created.get(tab).length, 1);
		assert.equal(f.panel(tab).opens, 1);
		assert.equal(f.panel(tab).closes, 0);
	}
	await f.panel('bookshelf').navigate('stats');
	f.assertSelected('stats');
	assert.equal(f.calls.getLeaf, 0);
	assert.equal(f.calls.setViewState, 0);
	assert.ok(f.calls.save >= 4);
	const menu = {};
	f.view.onMoreOptionsMenu(menu);
	assert.equal(f.panel('stats').menu, menu);
});

test('a slow panel request does not block navigation readiness or later commands', async () => {
	const gate = deferred();
	const f = fixture({ gates: { bookshelf: gate } });
	await f.view.onOpen();
	let selected = false;
	const selection = f.view.selectTab('bookshelf').then(() => {
		selected = true;
	});
	await tick();
	assert.equal(selected, true, 'tab selection resolves before remote data');
	await f.view.selectTab('stats');
	f.assertSelected('stats');
	gate.resolve();
	await selection;
	await tick();
	f.assertSelected('stats');
});

test('late opening of a previous tab cannot reveal it after a rapid tab switch', async () => {
	const gate = deferred();
	const f = fixture({ gates: { today: gate } });
	const opening = f.view.onOpen();
	f.button('bookshelf').click();
	await tick();
	f.assertSelected('bookshelf');
	gate.resolve();
	await opening;
	f.assertSelected('bookshelf');
	assert.equal(f.panel('today').ready, true);
	assert.equal(f.panel('today').contentEl.hidden, true);
	assert.equal(f.tabbar().length, 1);
});

test('state restores internal tab before and after open without changing the registered view type', async () => {
	const f = fixture({ initialTab: 'stats', viewType: 'weread-bookshelf-view' });
	assert.equal(f.view.getViewType(), 'weread-bookshelf-view');
	const result = {};
	await f.view.setState({ tab: 'review' }, result);
	assert.equal(f.created.size, 0);
	await f.view.onOpen();
	f.assertSelected('review');
	assert.equal(f.created.has('stats'), false);
	await f.view.setState({ tab: 'bookshelf' }, result);
	f.assertSelected('bookshelf');
	assert.deepEqual(f.view.baseState, { state: { tab: 'bookshelf' }, result });
	await f.view.setState({ tab: 'unknown' }, result);
	await f.view.setState(null, result);
	f.assertSelected('bookshelf');
	assert.equal(f.view.getViewType(), 'weread-bookshelf-view');
	assert.equal(f.calls.getLeaf, 0);
	assert.equal(f.calls.setViewState, 0);
	assert.equal(fixture().view.getViewType(), 'weread-library-view');
});

test('keyboard arrows wrap and Home/End move selection and focus with roving tab stops', async () => {
	const f = fixture();
	await f.view.onOpen();
	for (const [from, key, to] of [
		['today', 'ArrowLeft', 'stats'],
		['stats', 'ArrowRight', 'today'],
		['today', 'End', 'stats'],
		['stats', 'Home', 'today'],
		['review', 'ArrowRight', 'favorites'],
		['favorites', 'ArrowRight', 'stats'],
		['today', 'ArrowRight', 'bookshelf']
	]) {
		const event = f.button(from).key(key);
		await tick();
		assert.equal(event.prevented, true);
		assert.equal(f.contentEl.owner.activeElement, f.button(to));
		f.assertSelected(to);
	}
	assert.equal(f.button('bookshelf').key('Escape').prevented, false);
	f.assertSelected('bookshelf');
	assert.equal(f.calls.getLeaf, 0);
	assert.equal(f.calls.setViewState, 0);
});

test('closing unloads every visited child exactly once, including a pending panel', async () => {
	const gate = deferred();
	const f = fixture({ gates: { review: gate } });
	await f.view.onOpen();
	await f.view.selectTab('bookshelf');
	const pending = f.view.selectTab('review');
	await f.view.selectTab('favorites');
	await f.view.selectTab('stats');
	await f.view.onClose();
	await f.view.onClose();
	gate.resolve();
	await pending;
	for (const tab of TABS) assert.equal(f.panel(tab).closes, 1);
	assert.equal(f.calls.removeChild, 5);
	assert.equal(f.view.children.length, 0);
	assert.equal(f.contentEl.children.length, 0);
	await f.view.selectTab('bookshelf');
	assert.equal(f.contentEl.children.length, 0);
	assert.equal(f.calls.getLeaf, 0);
	assert.equal(f.calls.setViewState, 0);
});

test('cold workspace restore normalizes numeric YAML book IDs before mounting details', async () => {
	const f = fixture();
	await f.view.setState(
		{
			tab: 'bookshelf',
			originTab: 'bookshelf',
			bookDetail: { bookId: 12345, bookTitle: 'Numeric metadata book' }
		},
		{}
	);
	assert.equal(f.created.size, 0);
	assert.deepEqual(f.view.getState().bookDetail, {
		bookId: '12345',
		bookTitle: 'Numeric metadata book'
	});
	await f.view.onOpen();
	await tick();
	assert.equal(f.panel('detail').getState().bookId, '12345');
	assert.deepEqual(f.visible(), [f.panel('detail').contentEl]);
	assert.equal(f.calls.getLeaf, 0);
	assert.equal(f.calls.setViewState, 0);
});

test('warm detail navigation normalizes numeric IDs while preserving exact string IDs', async () => {
	const f = fixture({ initialTab: 'bookshelf' });
	await f.view.onOpen();
	await f.view.openBookDetail({ bookId: 'previous-book' });
	await tick();
	let previous = f.panel('detail');
	for (const bookId of [12345, 0, '0012345', 'isbn:custom-book', ' 12345 ']) {
		await f.view.openBookDetail({ bookId });
		await tick();
		const latest = f.created.get('detail').at(-1);
		assert.equal(previous.closes, 1);
		assert.equal(f.view.getState().bookDetail.bookId, String(bookId));
		assert.equal(latest.getState().bookId, String(bookId));
		assert.deepEqual(f.visible(), [latest.contentEl]);
		previous = latest;
	}
	assert.equal(f.created.get('bookshelf').length, 1);
	assert.equal(f.calls.getLeaf, 0);
	assert.equal(f.calls.setViewState, 0);
});

test('empty, nonfinite and object IDs cannot replace a valid route or restore a detail', async () => {
	const f = fixture({ initialTab: 'bookshelf' });
	await f.view.onOpen();
	await f.view.openBookDetail({ bookId: 'keep-current' });
	await tick();
	const detail = f.panel('detail');
	for (const bookId of ['', '  ', NaN, Infinity, -Infinity, {}, [], null, undefined, true]) {
		await f.view.openBookDetail({ bookId });
		assert.equal(f.view.getState().bookDetail.bookId, 'keep-current');
		assert.equal(f.created.get('detail').length, 1);
		assert.equal(detail.closes, 0);
		const cold = fixture();
		await cold.view.setState({ tab: 'bookshelf', bookDetail: { bookId } }, {});
		await cold.view.onOpen();
		assert.equal(cold.created.has('detail'), false);
		cold.assertSelected('bookshelf');
	}
});

test('detail routes retain each originating tab and top-tab navigation retains other contexts', async () => {
	for (const origin of ['today', 'review', 'favorites']) {
		const f = fixture({ initialTab: origin });
		await f.view.onOpen();
		const original = f.panel(origin);
		original.filter.value = `${origin} filter`;
		original.contentEl.scrollTop = 250;
		await f.view.openBookDetail({ bookId: origin });
		await tick();
		const detail = f.panel('detail');
		assert.equal(f.view.getState().originTab, origin);
		f.button('stats').click();
		await tick();
		assert.equal(detail.contentEl.hidden, true);
		assert.deepEqual(f.visible(), [f.panel('stats').contentEl]);
		const menu = {};
		f.view.onMoreOptionsMenu(menu);
		assert.equal(f.panel('stats').menu, menu);
		f.button(origin).click();
		await tick();
		assert.deepEqual(f.visible(), [detail.contentEl]);
		assert.equal(detail.opens, 1);
		detail.back.click();
		await tick();
		f.assertSelected(origin);
		assert.equal(original.filter.value, `${origin} filter`);
		assert.equal(original.contentEl.scrollTop, 250);
		assert.equal(f.contentEl.owner.activeElement, f.button(origin));
		assert.equal(f.created.get(origin).length, 1);
		await f.view.onClose();
	}
});

test('detail state restores before open, preserves hidden origin and serializes selection only', async () => {
	const f = fixture();
	const selection = {
		bookId: 'persisted',
		bookTitle: 'Saved title',
		bookCover: 'cover',
		localFilePath: 'books/saved.md',
		currentTab: 'reviews'
	};
	await f.view.setState(
		{
			tab: 'stats',
			originTab: 'review',
			bookDetail: { ...selection, apiPayload: { secret: 'never persisted' } }
		},
		{}
	);
	assert.equal(f.created.size, 0);
	assert.deepEqual(f.view.getState(), {
		tab: 'stats',
		originTab: 'review',
		bookDetail: selection
	});
	await f.view.onOpen();
	await tick();
	const detail = f.panel('detail');
	assert.equal(detail.contentEl.hidden, true);
	assert.deepEqual(detail.getState(), selection);
	detail.state = { ...selection, currentTab: 'highlights', highlights: ['not navigation'] };
	assert.deepEqual(f.view.getState().bookDetail, { ...selection, currentTab: 'highlights' });
	await f.view.selectTab('review');
	assert.deepEqual(f.visible(), [detail.contentEl]);
	detail.back.click();
	await tick();
	f.assertSelected('review');
	await f.view.setState({ tab: 'bookshelf', bookDetail: { bookId: 'restored-after-open' } }, {});
	await tick();
	assert.equal(f.created.get('detail').length, 2);
	assert.equal(f.view.getState().bookDetail.bookId, 'restored-after-open');
	await f.view.setState({ tab: 'today' }, {});
	f.assertSelected('today');
	assert.equal(f.created.get('detail')[1].closes, 1);
});

test('replacing A with B and closing pending details unload each child exactly once', async () => {
	const a = deferred();
	const b = deferred();
	const f = fixture({ initialTab: 'bookshelf', gates: { a, b } });
	await f.view.onOpen();
	await f.view.openBookDetail({ bookId: 'a' });
	await tick();
	const first = f.panel('detail');
	await f.view.openBookDetail({ bookId: 'b' });
	await tick();
	const second = f.created.get('detail')[1];
	assert.equal(first.closes, 1);
	assert.equal(f.contentEl.contains(first.contentEl), false);
	first.options.onBack();
	assert.equal(
		f.view.getState().bookDetail.bookId,
		'b',
		'stale breadcrumb cannot clear newer route'
	);
	a.resolve();
	await tick();
	assert.equal(first.contentEl.children.length, 0);
	assert.deepEqual(f.visible(), [second.contentEl]);
	await f.view.onClose();
	await f.view.onClose();
	b.resolve();
	await tick();
	assert.equal(second.closes, 1);
	assert.equal(second.contentEl.children.length, 0);
	assert.equal(f.contentEl.children.length, 0);
	assert.equal(f.view.children.length, 0);
	assert.equal(f.calls.removeChild, 3);
});

test('closing a detail while its lifecycle opens prevents starting its obsolete selection', async () => {
	const gate = deferred();
	const f = fixture({ gates: { detailOpen: gate } });
	await f.view.onOpen();
	await f.view.openBookDetail({ bookId: 'never-started' });
	const detail = f.panel('detail');
	assert.deepEqual(detail.getState(), {});
	detail.back.click();
	await f.view.onClose();
	gate.resolve();
	await tick();
	assert.deepEqual(detail.getState(), {});
	assert.equal(detail.closes, 1);
	assert.equal(f.contentEl.children.length, 0);
});

test('bookshelf callbacks belong to their own library instance', async () => {
	const first = fixture({ initialTab: 'bookshelf' });
	const second = fixture({ initialTab: 'bookshelf' });
	await first.view.onOpen();
	await second.view.onOpen();
	await first.panel('bookshelf').openBook({ bookId: 'first-library' });
	await tick();
	assert.equal(first.view.getState().bookDetail.bookId, 'first-library');
	second.assertSelected('bookshelf');
	assert.equal(second.created.has('detail'), false);
});

test('bookshelf detail and breadcrumb preserve the owning leaf, DOM, filter, scroll and focus', async () => {
	const f = fixture({ initialTab: 'bookshelf' });
	await f.view.onOpen();
	const shelf = f.panel('bookshelf');
	const input = shelf.filter;
	input.value = 'retained shelf filter';
	shelf.contentEl.scrollTop = 489;
	input.focus();
	const nav = f.tabbar()[0];
	await shelf.openBook({ bookId: 'book-a', bookTitle: 'Book A' });
	await tick();
	const detail = f.panel('detail');
	assert.deepEqual(f.visible(), [detail.contentEl]);
	assert.equal(detail.options.breadcrumbLabel, '书架');
	assert.equal(shelf.closes, 0);
	assert.deepEqual(f.tabbar(), [nav]);
	assert.equal(f.button('bookshelf').getAttribute('aria-selected'), 'true');
	assert.equal(
		f.button('bookshelf').getAttribute('aria-controls'),
		detail.contentEl.getAttribute('id')
	);
	const menu = {};
	f.view.onMoreOptionsMenu(menu);
	assert.equal(detail.menu, menu);
	const saves = f.calls.save;
	detail.back.click();
	await tick();
	f.assertSelected('bookshelf');
	assert.equal(f.panel('bookshelf'), shelf);
	assert.equal(shelf.filter, input);
	assert.equal(input.value, 'retained shelf filter');
	assert.equal(shelf.contentEl.scrollTop, 489);
	assert.equal(f.contentEl.owner.activeElement, input);
	assert.equal(f.created.get('bookshelf').length, 1);
	assert.equal(detail.closes, 1);
	assert.equal(f.contentEl.contains(detail.contentEl), false);
	assert.ok(f.calls.save > saves);
	assert.equal(f.calls.getLeaf, 0);
	assert.equal(f.calls.setViewState, 0);
	await f.view.onClose();
	assert.equal(detail.closes, 1);
});
