// Run: node --test tests/libraryView.mjs
// Executes the production shell with panel fixtures and the small DOM API it uses.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { transformSync } from 'esbuild';

const TABS = ['today', 'bookshelf', 'review', 'favorites', 'stats'];
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
	const obsidian = { Component, ItemView, Notice: class {} };
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
		constructor(element, plugin, bookshelf, navigate) {
			super(element, plugin.app, 'bookshelf');
			this.navigate = navigate;
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
	const { WereadLibraryView } = load('src/components/wereadLibrary.ts', {
		obsidian,
		'./wereadJournal': { WereadJournalPanel: JournalPanel },
		'./wereadBookshelf': { WereadBookshelfPanel: BookshelfPanel },
		'./wereadReadingStats': { WereadReadingStatsPanel: StatsPanel },
		'./wereadFavorites': { WereadFavoritesPanel: FavoritesPanel },
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
