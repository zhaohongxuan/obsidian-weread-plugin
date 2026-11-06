// Run: node --test tests/bookshelf.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { transformSync } from 'esbuild';

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
const settings = { value: { wereadApiKey: 'key-a', cookies: [], isCookieValid: false } };
const mocks = {
	'svelte/store': { get: (store) => store.value },
	'./settings': { settingsStore: settings },
	'./parser/parseResponse': {
		parseMetadata: (entry) => ({
			...entry.book,
			noteCount: entry.noteCount,
			reviewCount: entry.reviewCount
		})
	},
	'./syncFilter': {
		createSyncFilterContext: () => ({}),
		evaluateMetadataSyncFilter: () => ({ includedByCurrentSettings: true })
	},
	'./utils/dateUtil': {
		formatTimestampToDate: (time) => new Date(time * 1000).toISOString().slice(0, 10)
	}
};
const Service = load('src/bookshelf.ts', mocks).default;
const local = (id) => ({
	bookId: id,
	title: `Local ${id}`,
	file: { basename: id, path: `${id}.md` },
	noteCount: 2,
	reviewCount: 1
});
const raw = {
	books: [
		{
			bookId: 'a',
			title: 'A',
			author: 'Author A',
			finishReading: 1,
			readUpdateTime: 1700000000,
			cover: 'a.jpg'
		},
		{ bookId: 'b', title: 'B', author: 'Author B', cover: 'b.jpg' },
		{ bookId: 'c', title: 'C', author: 'Author C' }
	],
	archive: [{ name: 'Folder', bookIds: ['a', 'b', 'a', 'missing'] }],
	albums: [
		{ albumInfo: { albumId: 1, name: 'Audio 1', authorName: 'Narrator', trackCount: 10 } },
		{ albumInfo: { albumId: 2, name: 'Audio 2' } }
	],
	mp: { enabled: true },
	bookCount: 999
};
function service(overrides = {}) {
	return new Service(
		{
			getNotebookFilesByBookId: async () =>
				new Map([
					['a', local('a')],
					['local', local('local')]
				])
		},
		{
			getShelf: async () => raw,
			getNotebooksWithRetry: async () => [
				{
					book: { bookId: 'a', title: 'Notebook A', author: 'Author' },
					noteCount: 7,
					reviewCount: 3
				}
			],
			...overrides
		}
	);
}

test('real shelf includes audio and article entry in count and preserves local-only notes', async () => {
	const collection = await service().getCollection('bookshelf');
	assert.equal(collection.remoteEntryCount, 6);
	assert.equal(collection.albums.length, 2);
	assert.equal(collection.hasArticleCollection, true);
	assert.equal(collection.books.length, 4);
	assert.equal(collection.books.find((book) => book.bookId === 'local').isLocalOnly, true);
	assert.equal(collection.books[0].hasLocalFile, true);
	assert.deepEqual(collection.folders[0].bookIds, ['a', 'b', 'missing']);
	assert.equal(collection.books[0].lastReadDate, '2023-11-14');
	assert.equal(collection.books[0].finished, true);
	assert.equal(collection.books[0].progress.readingProgress, undefined);
	assert.equal(collection.books[1].countsKnown, false);
});

test('empty mp does not count as an entry and notebook source preserves notebook counts', async () => {
	const collection = await service({
		getShelf: async () => ({ books: raw.books, albums: [], mp: {} })
	}).getCollection('bookshelf');
	assert.equal(collection.remoteEntryCount, 3);
	assert.equal(collection.hasArticleCollection, false);
	const notebooks = await service().getCollection('notebooks');
	assert.equal(notebooks.books[0].noteCount, 7);
	assert.equal(notebooks.books[0].reviewCount, 3);
	assert.equal(
		notebooks.books.some((book) => book.bookId === 'local'),
		true
	);
	assert.equal(notebooks.folders.length, 0);
});

test('local collection works independently of failed remote requests', async () => {
	const shelf = service({
		getShelf: async () => {
			throw new Error('offline');
		}
	});
	await assert.rejects(shelf.getCollection('bookshelf'));
	assert.equal((await shelf.getLocalCollection()).books.length, 2);
});

test('progress credential changes discard cached data and stale in-flight results', async () => {
	settings.value.wereadApiKey = 'key-a';
	let resolve;
	const shelf = service({
		getProgress: () =>
			new Promise((done) => {
				resolve = done;
			})
	});
	const pending = shelf.loadProgressForBooks(['a']);
	settings.value.wereadApiKey = 'key-b';
	resolve({ book: { progress: 75 } });
	await pending;
	assert.equal(shelf.getProgress('a').readingProgress, undefined);
	assert.equal(shelf.getProgress('a').state, 'idle');
});

class Element {
	constructor(parent = null, options = {}) {
		this.parent = parent;
		this.children = [];
		this.options = options;
	}
	createDiv(options = {}) {
		const element = new Element(this, options);
		this.children.push(element);
		return element;
	}
	createEl(tag, options = {}) {
		const element = this.createDiv(options);
		element.tag = tag;
		return element;
	}
	setAttr(name, value) {
		this.options.attr = { ...this.options.attr, [name]: value };
	}
	addClass(name) {
		this.options.cls = `${this.options.cls ?? ''} ${name}`;
	}
	setText(text) {
		this.options.text = text;
	}
	get childElementCount() {
		return this.children.length;
	}
	remove() {
		this.parent.children = this.parent.children.filter((child) => child !== this);
	}
}
const Panel = load('src/components/wereadBookshelf.ts', {
	obsidian: {
		ItemView: class {},
		Modal: class {},
		setIcon: () => {},
		Platform: { isDesktopApp: false }
	},
	'./wereadBookshelf.css': {},
	'../settings': { settingsStore: settings },
	'./wereadPanel': { WereadPanel: class {} },
	'svelte/store': mocks['svelte/store'],
	'./syncLogModal': { SyncLogModal: class {} },
	'../parser/parseResponse': {}
}).WereadBookshelfPanel;

function panelFixture(collection) {
	const view = Object.create(Panel.prototype);
	Object.assign(view, {
		collection,
		shelfBooks: collection.books,
		gridEl: new Element(),
		emptyStateEl: new Element(),
		activeFolderId: null,
		categoryFilter: 'all',
		syncStatusFilter: 'all',
		readingStatusFilter: 'all',
		searchKeyword: '',
		sourceMode: 'bookshelf',
		sortMode: 'title',
		viewMode: 'list',
		getRecentValue: (book) => Date.parse(book.lastReadDate ?? '') || 0
	});
	return view;
}

test('folders and loose books share one grid while grouped books and hidden entries are omitted', async () => {
	const collection = await service().getCollection('bookshelf');
	collection.folders[0].name = 'B folder';
	collection.books.find((book) => book.bookId === 'c').title = 'A book';
	collection.books.find((book) => book.bookId === 'local').title = 'C local';
	const view = panelFixture(collection);
	const items = view.getShelfItems(view.getFilteredBooks());
	assert.deepEqual(
		items.map((item) => (item.kind === 'folder' ? item.folder.name : item.book.title)),
		['A book', 'B folder', 'C local']
	);
	view.renderShelfNavigation(view.getFilteredBooks());
	assert.equal(view.gridEl.children.length, 1);
	const grid = view.gridEl.children[0];
	assert.match(grid.options.cls, /mixed-grid/);
	assert.deepEqual(
		grid.children.map((node) => node.options.cls),
		[
			'weread-bookshelf-card is-clickable',
			'weread-bookshelf-folder-card',
			'weread-bookshelf-card is-clickable'
		]
	);
	assert.equal(
		grid.children[1].children.some((node) => node.options.cls?.includes('folder-covers')),
		true
	);
	const allText = (node) => [node.options.text ?? '', ...node.children.map(allText)].join(' ');
	assert.doesNotMatch(allText(view.gridEl), /Audio|有声书|文章收藏/);
	view.activeFolderId = collection.folders[0].id;
	view.gridEl = new Element();
	view.renderShelfNavigation(view.getFilteredBooks());
	assert.equal(view.gridEl.children[0].children[0].options.text, '← 全部书架');
	assert.equal(view.gridEl.children[1].children.length, 2);
});

test('recent sort interleaves folders using their latest member rather than forcing folders first', async () => {
	const collection = await service().getCollection('bookshelf');
	const view = panelFixture(collection);
	view.sortMode = 'recent';
	collection.books.find((book) => book.bookId === 'c').lastReadDate = '2025-01-01';
	collection.books.find((book) => book.bookId === 'local').lastReadDate = '2020-01-01';
	assert.deepEqual(
		view
			.getShelfItems(view.getFilteredBooks())
			.map((item) => (item.kind === 'folder' ? 'folder' : item.book.bookId)),
		['c', 'folder', 'local']
	);
	collection.books.find((book) => book.bookId === 'b').lastReadDate = '2026-01-01';
	assert.deepEqual(
		view
			.getShelfItems(view.getFilteredBooks())
			.map((item) => (item.kind === 'folder' ? 'folder' : item.book.bookId)),
		['folder', 'c', 'local']
	);
});

test('mixed grid supports folder-name searches, member searches, status filters and cover mode', async () => {
	const collection = await service().getCollection('bookshelf');
	const view = panelFixture(collection);
	view.searchKeyword = 'folder';
	assert.deepEqual(
		view.getShelfItems(view.getFilteredBooks()).map((item) => item.kind),
		['folder']
	);
	view.activeFolderId = collection.folders[0].id;
	view.viewMode = 'cover';
	view.renderShelfNavigation(view.getFilteredBooks());
	assert.equal(view.gridEl.children[1].children.length, 2);
	assert.ok(
		view.gridEl.children[1].children.every(
			(node) => node.options.cls === 'weread-bookshelf-cover-card'
		)
	);
	view.activeFolderId = null;
	view.searchKeyword = 'author b';
	assert.deepEqual(
		view.getShelfItems(view.getFilteredBooks()).map((item) => item.kind),
		['folder']
	);
	view.searchKeyword = '';
	view.syncStatusFilter = 'localOnly';
	assert.deepEqual(
		view
			.getShelfItems(view.getFilteredBooks())
			.map((item) => (item.kind === 'book' ? item.book.bookId : 'folder')),
		['local']
	);
});
