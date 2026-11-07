// Run: node --test tests/syncResults.mjs
// Real orchestration -> FileManager -> frontmatter -> synthetic vault; no credentials/network.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve, dirname } from 'node:path';
import test from 'node:test';
import { transformSync } from 'esbuild';
import { writable } from 'svelte/store';
import * as stores from 'svelte/store';

const require = createRequire(import.meta.url);
const yaml = require('yaml');
class Element {
	constructor(options = {}) {
		this.text = options.text || '';
		this.children = [];
		this.style = {};
	}
	createDiv(options) {
		const el = new Element(options);
		this.children.push(el);
		return el;
	}
	createSpan(options) {
		return this.createDiv(options);
	}
	createEl(tag, options) {
		return this.createDiv(options);
	}
	setText(text) {
		this.text = text;
	}
	empty() {
		this.children = [];
	}
	get textContent() {
		return this.text + this.children.map((el) => el.textContent).join(' ');
	}
}
const notices = [];
class Notice {
	constructor(message) {
		this.message = message;
		notices.push(this);
	}
	setMessage(message) {
		this.message = message;
	}
	hide() {}
}
class TFile {
	constructor(path) {
		this.path = path;
	}
}
class Dummy {}
function fixture({
	books = [{ bookId: '42', title: 'Fixture book', noteCount: 1, reviewCount: 0 }],
	fault,
	local = []
} = {}) {
	notices.length = 0;
	const logs = [],
		writes = [],
		diagnostics = [];
	const store = writable({
		noteLocation: 'Notes',
		fileNameType: 'BOOK_NAME',
		template:
			fault === 'render'
				? '{% if %}'
				: fault === 'yaml'
					? '---\nlastReadDate: 2024-11-09\nprogress:17\n---\nbody'
					: 'fixture note',
		dailyNotesToggle: false,
		notesBlacklist: '',
		notesWhitelist: '',
		noteCountLimit: 0,
		syncMode: 'blacklist'
	});
	store.actions = {
		addSyncLog: (log) => logs.push(log),
		updateLastSyncInfo() {},
		getSyncLogs: () => logs
	};
	const obsidian = {
		ItemView: Dummy,
		Notice,
		TFile,
		TFolder: class {},
		Platform: { isDesktopApp: true },
		setIcon() {},
		Modal: class {
			constructor() {
				this.contentEl = new Element();
			}
		},
		parseYaml: yaml.parse,
		stringifyYaml: yaml.stringify,
		Plugin: class {
			commands = [];
			events = new Map();
			addCommand(command) {
				this.commands.push(command);
			}
			registerView() {}
			addRibbonIcon() {
				return { addEventListener() {} };
			}
			registerEvent() {}
			addSettingTab() {}
		}
	};
	const api = {
		async getNotebooksWithRetry() {
			return books.map((book) => ({ ...book }));
		},
		async getBook() {
			if (fault === 'api') throw new Error('fixture API unavailable');
			return {};
		},
		async getProgress() {},
		async getNotebookHighlights() {
			return {};
		},
		async getNotebookReviews() {
			return {};
		},
		async getChapters() {
			return {};
		}
	};
	const vault = {
		adapter: {
			async exists() {
				return true;
			}
		},
		getMarkdownFiles: () => local.map((item) => item.file),
		async create(path, content) {
			if (fault === 'create') throw new Error('fixture disk full');
			writes.push({ path, content });
			return new TFile(path);
		},
		async modify(file, content) {
			if (fault === 'modify') throw new Error('fixture write denied');
			writes.push({ path: file.path, content });
		}
	};
	const metadataCache = {
		getFileCache: (file) => ({
			frontmatter: {
				doc_type: 'weread-highlights-reviews',
				...local.find((item) => item.file === file)
			}
		})
	};
	const app = {
		vault,
		metadataCache,
		workspace: {
			on(name, callback) {
				this.events.set(name, callback);
				return {};
			},
			events: new Map()
		}
	};
	const cache = new Map();
	const load = (filename) => {
		filename = resolve(filename);
		if (cache.has(filename)) return cache.get(filename).exports;
		const module = { exports: {} };
		cache.set(filename, module);
		const code = transformSync(readFileSync(filename, 'utf8'), {
			loader: 'ts',
			format: 'cjs',
			target: 'es2020'
		}).code;
		new Function(
			'require',
			'module',
			'exports',
			'document',
			'window',
			'setTimeout',
			'console',
			code
		)(
			(name) => {
				if (name === 'obsidian') return obsidian;
				if (name.endsWith('.css')) return {};
				if (
					/weread(BookDetailPanel|Bookshelf)\.ts$/.test(filename) &&
					!['../settings', 'svelte/store'].includes(name)
				)
					return { WereadPanel: Dummy, SyncLogModal: Dummy, FavoritesUndoToast: Dummy };
				if (name === 'svelte/store') return stores;
				if (name === 'nunjucks') return require(name);
				if (name.endsWith('/settings') || name === './settings')
					return { settingsStore: store };
				if (name.includes('parseResponse'))
					return {
						parseMetadata: (item) => item,
						parseHighlights: () => [],
						parseReviews: () => [],
						parseChapterResp: () => [],
						parseChapterHighlightReview: () => [],
						parseChapterReviews: () => [],
						parseDailyNoteReferences: () => []
					};
				if (name.includes('popularHighlightsCache'))
					return { __esModule: true, default: Dummy };
				if (name === './api-router' || name === './src/api-router')
					return {
						__esModule: true,
						default: class {
							constructor() {
								return api;
							}
						}
					};
				if (name.endsWith('dateUtil'))
					return { formatTimeDuration: String, formatTimestampToDate: String };
				if (name === 'sanitize-filename') return { default: (value) => value };
				if (name.endsWith('fileUtils'))
					return { getLinesInString: (value) => value.split('\n') };
				if (name.endsWith('sanitizeTitle')) return { sanitizeTitle: (value) => value };
				if (
					filename.endsWith('/main.ts') &&
					!['./src/fileManager', './src/syncNotebooks'].includes(name)
				)
					return {
						__esModule: true,
						default: Dummy,
						...Object.fromEntries(
							[
								'WereadSettingsTab',
								'WereadReadingView',
								'WereadBookDetailView',
								'WereadJournalService',
								'WereadFavoritesService',
								'WereadLibraryView'
							].map((name) => [name, Dummy])
						)
					};
				if (name.startsWith('.')) return load(resolve(dirname(filename), name + '.ts'));
				throw new Error('Unexpected dependency: ' + name);
			},
			module,
			module.exports,
			{ createDocumentFragment: () => new Element() },
			{ moment: () => ({ format: () => '2026-11-07' }) },
			() => 0,
			{
				log() {},
				warn() {},
				info() {},
				debug() {},
				error: (...args) => diagnostics.push(args)
			}
		);
		return module.exports;
	};
	const FileManager = load('src/fileManager.ts').default;
	const Sync = load('src/syncNotebooks.ts').default;
	const files = new FileManager(vault, metadataCache, app);
	const sync = new Sync(files, api, vault);
	const Plugin = load('main.ts').default;
	const plugin = new Plugin();
	Object.assign(plugin, { app, syncNotebooks: sync });
	return { sync, files, logs, writes, diagnostics, api, plugin, load, store, app, vault };
}
for (const fault of ['render', 'yaml', 'create', 'modify'])
	test(`bulk ${fault} failure reaches actual save boundary and is never success`, async () => {
		const local =
			fault === 'modify'
				? [
						{
							file: new TFile('Notes/Fixture book.md'),
							bookId: '42',
							noteCount: 0,
							reviewCount: 0
						}
					]
				: [];
		const f = fixture({ fault, local });
		assert.equal(await f.sync.syncNotebooks(false, '2026-11-07'), 0);
		const log = f.logs.at(-1);
		assert.equal(log.success, false);
		assert.equal(log.syncedBooks, 0);
		assert.equal(log.failedBooks, 1);
		assert.equal(log.skippedBooks, 0);
		assert.equal(log.notes.length, 0);
		assert.equal(log.failures[0].bookId, '42');
		assert.equal(log.failures[0].title, 'Fixture book');
		assert.match(log.errorMessage, /Fixture book.*42/);
		assert.match(log.errorMessage, /render|frontmatter|create|modify/);
		assert.equal(f.writes.length, 0);
	});
test('null from real unchanged FileManager path is a skip rather than success', async () => {
	const f = fixture();
	const meta = {
		bookId: '42',
		title: 'Fixture book',
		file: { file: new TFile('unchanged.md'), new: false }
	};
	f.sync.filterNoteMetas = async () => [meta];
	assert.equal(await f.sync.syncNotebooks(false, '2026-11-07'), 0);
	assert.equal(f.logs[0].skippedBooks, 1);
	assert.equal(f.logs[0].success, true);
	assert.equal(f.writes.length, 0);
});
test('single missing metadata rejects with book ID, without undefined dereference or mutation', async () => {
	const f = fixture({ books: [] });
	const note = { bookId: 'missing', title: 'Missing book', new: false };
	await assert.rejects(f.sync.syncNotebook(note), /missing.*metadata|metadata.*missing/);
	assert.equal(note.new, false);
	await assert.rejects(f.sync.syncBookById('missing'), /missing/);
});
test('single plugin wrapper propagates save failure and busy rejection to awaiting UI callers', async () => {
	const f = fixture({ fault: 'create' });
	await assert.rejects(
		f.plugin.syncBookById('42'),
		/Fixture book.*42.*create.*fixture disk full/
	);
	assert.equal(f.plugin.syncing, false);
	f.plugin.syncing = true;
	await assert.rejects(f.plugin.syncBookById('42'), /正在同步/);
});
test('successful bulk save counts only persisted paths; cancelled run is not successful', async () => {
	const f = fixture();
	assert.equal(await f.sync.syncNotebooks(false, '2026-11-07'), 1);
	assert.equal(f.logs[0].notes[0].filePath, 'Notes//Fixture book.md');
	assert.equal(f.logs[0].success, true);
	const cancelled = fixture();
	assert.equal(await cancelled.sync.syncNotebooks(false, '2026-11-07', { cancelled: true }), 0);
	assert.equal(cancelled.logs[0].success, false);
	assert.equal(cancelled.logs[0].cancelled, true);
	assert.equal(cancelled.logs[0].skippedBooks, 1);
});

test('API conversion failures identify the book and fetch/parse stage', async () => {
	const f = fixture({ fault: 'api' });
	assert.equal(await f.sync.syncNotebooks(false, '2026-11-07'), 0);
	assert.equal(f.logs[0].failures[0].stage, 'fetch/parse');
	assert.match(f.logs[0].errorMessage, /Fixture book.*42.*fetch\/parse.*fixture API unavailable/);
});
test('unchanged counts and existing blacklist/count filters retain their rules', async () => {
	const books = [
		{ bookId: 'same', title: 'Unchanged', noteCount: 1, reviewCount: 0 },
		{ bookId: 'blocked', title: 'Blocked', noteCount: 2, reviewCount: 0 },
		{ bookId: 'empty', title: 'Empty', noteCount: 0, reviewCount: 0 },
		{ bookId: 'new', title: 'New', noteCount: 2, reviewCount: 0 }
	];
	const f = fixture({
		books,
		local: [{ file: new TFile('same.md'), bookId: 'same', noteCount: 1, reviewCount: 0 }]
	});
	f.store.update((s) => ({ ...s, notesBlacklist: 'blocked', noteCountLimit: 1 }));
	assert.equal(await f.sync.syncNotebooks(false, '2026-11-07'), 1);
	assert.deepEqual(
		f.logs[0].notes.map((n) => n.bookId),
		['new']
	);
	assert.equal(f.logs[0].skippedBooks, 0);
});
test('Daily Note write remains awaited; failure keeps saved book results and marks log failed', async () => {
	const f = fixture();
	f.store.update((s) => ({
		...s,
		dailyNotesToggle: true,
		insertAfter: 'START',
		insertBefore: 'END',
		dailyNotesLocation: 'Daily'
	}));
	f.vault.getAbstractFileByPath = (path) => new TFile(path);
	f.vault.cachedRead = async () => 'START\nplaceholder\nEND';
	let rejectWrite;
	const gate = new Promise((_, reject) => {
		rejectWrite = reject;
	});
	let entered = false;
	f.vault.modify = async () => {
		entered = true;
		await gate;
	};
	let finished = false;
	const run = f.sync.syncNotebooks(false, '2026-11-07').then((result) => {
		finished = true;
		return result;
	});
	for (let i = 0; i < 30 && !entered; i++) await new Promise((resolve) => setImmediate(resolve));
	assert.equal(entered, true);
	assert.equal(finished, false);
	assert.equal(f.logs.length, 0);
	rejectWrite(new Error('fixture daily write failed'));
	assert.equal(await run, 1);
	assert.equal(f.logs[0].success, false);
	assert.equal(f.logs[0].syncedBooks, 1);
	assert.equal(f.logs[0].failedBooks, 0);
	assert.match(f.logs[0].errorMessage, /Daily Notes.*fixture daily write failed/);
});
test('disabled Daily Notes performs no additional journal conversion', async () => {
	const f = fixture({
		books: [
			{
				bookId: '42',
				title: 'Fixture book',
				noteCount: 1,
				reviewCount: 0,
				lastReadDate: '2026-11-07'
			}
		]
	});
	let calls = 0;
	f.api.getBook = async () => {
		calls++;
		return {};
	};
	await f.sync.syncNotebooks(false, '2026-11-07');
	assert.equal(calls, 1);
});
test('real command and editor context menu callbacks consume failures without success notices', async () => {
	for (const mode of ['command', 'editor']) {
		const file = new TFile('Notes/Fixture book.md');
		const f = fixture({
			fault: mode === 'editor' ? 'modify' : 'create',
			local:
				mode === 'editor'
					? [{ file, bookId: '42', title: 'Fixture book', noteCount: 0, reviewCount: 0 }]
					: []
		});
		Object.assign(f.plugin, {
			syncCookiesToPartition() {},
			setupFloatingPanel() {},
			setupScheduledSync() {}
		});
		f.plugin.initializePlugin();
		if (mode === 'command')
			f.plugin.commands
				.find((command) => command.id === 'sync-weread-notes-command')
				.callback();
		else {
			let click;
			const item = {
				setIcon() {
					return this;
				},
				setTitle() {
					return this;
				},
				onClick(callback) {
					click = callback;
					return this;
				}
			};
			f.app.workspace.events.get('editor-menu')(
				{
					addSeparator() {},
					addItem(callback) {
						callback(item);
					}
				},
				null,
				{ file }
			);
			click();
		}
		for (let i = 0; i < 30 && (mode === 'command' ? !f.logs.length : !notices.length); i++)
			await new Promise((resolve) => setImmediate(resolve));
		await new Promise((resolve) => setImmediate(resolve));
		assert.equal(f.writes.length, 0);
		assert.ok(
			!notices.some(
				(notice) =>
					String(notice.message).includes('同步成功') ||
					String(notice.message).includes('已同步到本地')
			)
		);
		if (mode === 'editor')
			assert.ok(
				notices.some((notice) => String(notice.message).includes('fixture write denied'))
			);
		else assert.equal(f.logs[0].success, false);
	}
});

test('actual bookshelf/sidebar and retained detail callers catch propagated failures and do not refresh as success', async () => {
	for (const kind of ['shelf', 'detail']) {
		const f = fixture({ fault: 'create' });
		let refreshed = 0;
		if (kind === 'shelf') {
			const { WereadBookshelfPanel } = f.load('src/components/wereadBookshelf.ts');
			const panel = Object.create(WereadBookshelfPanel.prototype);
			Object.assign(panel, {
				plugin: f.plugin,
				loadBookshelf: async () => {
					refreshed++;
				}
			});
			const container = new Element();
			panel.renderActionIcons(
				{ bookId: '42', title: 'Fixture book', remoteExists: true, hasLocalFile: false },
				container
			);
			const button = container.children[0];
			await button.onclick({ stopPropagation() {} });
			assert.equal(button.disabled, false);
		} else {
			const { WereadBookDetailPanel } = f.load('src/components/wereadBookDetailPanel.ts');
			const panel = Object.create(WereadBookDetailPanel.prototype);
			Object.assign(panel, {
				plugin: f.plugin,
				active: true,
				syncing: false,
				loading: false,
				bookId: '42',
				generation: 1,
				header: new Element(),
				renderHeader() {},
				loadData: async () => {
					refreshed++;
				}
			});
			await panel.syncNotes();
			assert.equal(panel.syncing, false);
		}
		assert.equal(refreshed, 0);
		assert.equal(f.plugin.syncing, false);
		assert.ok(
			notices.some(
				(notice) =>
					String(notice.message).includes('Fixture book') &&
					String(notice.message).includes('fixture disk full')
			)
		);
	}
});
test('failure-only logs remain visible by default with per-book diagnostics; older logs still render', async () => {
	const f = fixture({ fault: 'create' });
	await f.sync.syncNotebooks(false, '2026-11-07');
	f.logs.push({
		id: 'old',
		timestamp: 0,
		totalBooks: 1,
		syncedBooks: 1,
		skippedBooks: 0,
		duration: 0,
		notes: [],
		success: true
	});
	const { SyncLogModal } = f.load('src/components/syncLogModal.ts');
	const modal = Object.create(SyncLogModal.prototype);
	const contentEl = new Element();
	contentEl.querySelector = () => new Element();
	Object.assign(modal, { showAll: false, contentEl, logsContainer: new Element() });
	modal.renderLogs();
	const text = modal.logsContainer.textContent;
	assert.match(text, /失败 1 本/);
	assert.match(text, /Fixture book/);
	assert.match(text, /42/);
	assert.match(text, /create/);
	assert.match(text, /fixture disk full/);
	assert.equal(modal.logsContainer.children.length, 2);
});

test('invalid existing notebook annotation cannot fall back to creating a new note', async () => {
	const f = fixture();
	await assert.rejects(
		f.files.saveNotebook({
			metaData: { bookId: '42', title: 'Fixture book', file: { new: true } }
		}),
		/Existing notebook file is missing/
	);
	assert.equal(f.writes.length, 0);
});

test('one failed book does not prevent later saves or collapse per-book attribution', async () => {
	const f = fixture({
		books: [
			{ bookId: 'bad', title: 'Failed book', noteCount: 1, reviewCount: 0 },
			{ bookId: 'good', title: 'Saved book', noteCount: 1, reviewCount: 0 }
		]
	});
	f.api.getBook = async (id) => {
		if (id === 'bad') throw new Error('fixture upstream failed');
		return {};
	};
	assert.equal(await f.sync.syncNotebooks(false, '2026-11-07'), 1);
	assert.equal(f.logs[0].success, false);
	assert.equal(f.logs[0].failedBooks, 1);
	assert.equal(f.logs[0].skippedBooks, 0);
	assert.deepEqual(
		f.logs[0].notes.map((note) => note.bookId),
		['good']
	);
	assert.equal(f.logs[0].failures[0].bookId, 'bad');
});
test('missing Daily Note keeps its existing notice/skip without creating a file', async () => {
	const f = fixture();
	f.vault.adapter.exists = async () => false;
	await f.files.saveDailyNotes('Daily/missing.md', []);
	assert.equal(f.writes.length, 0);
	assert.ok(notices.some((notice) => String(notice.message).includes('没有找到Daily Note')));
});

test('cancellation during journal fetching stops the journal write and is not logged as success', async () => {
	const f = fixture({
		books: [
			{
				bookId: '42',
				title: 'Fixture book',
				noteCount: 1,
				reviewCount: 0,
				lastReadDate: '2026-11-07'
			}
		]
	});
	f.store.update((settings) => ({ ...settings, dailyNotesToggle: true }));
	const signal = { cancelled: false };
	let bookRequests = 0;
	let journalWrites = 0;
	f.api.getBook = async () => {
		if (++bookRequests === 2) signal.cancelled = true;
		return {};
	};
	f.files.saveDailyNotes = async () => {
		journalWrites++;
	};
	assert.equal(await f.sync.syncNotebooks(false, '2026-11-07', signal), 1);
	assert.equal(f.writes.length, 1);
	assert.equal(journalWrites, 0);
	assert.equal(f.logs[0].cancelled, true);
	assert.equal(f.logs[0].success, false);
});
