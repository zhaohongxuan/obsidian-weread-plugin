// Exercise production favorites against real, isolated temporary files; never a user vault.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';
import * as fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join, dirname, basename, sep } from 'node:path';
import { build } from 'esbuild';

const compiled = await build({
	stdin: {
		contents: "export * from './src/favorites'; export * from './src/favoritesRepository';",
		resolveDir: process.cwd(),
		loader: 'ts'
	},
	bundle: true,
	platform: 'node',
	format: 'cjs',
	write: false
});
const module = { exports: {} };
new Function('require', 'module', 'exports', compiled.outputFiles[0].text)(
	createRequire(import.meta.url),
	module,
	module.exports
);
const { WereadFavoritesService, FAVORITES_PATH, FAVORITES_BACKUP_PATH, parseFavorites } =
	module.exports;

async function fixture(t, { nativeVault = false, nativeViews = [], storageOptions = {} } = {}) {
	const parent = await fs.realpath(tmpdir());
	const root = await fs.mkdtemp(join(parent, 'weread-favorites-'));
	const services = [];
	const path = (relative) => {
		const result = resolve(root, relative);
		assert(
			result.startsWith(root + sep),
			'All test paths remain inside the isolated directory'
		);
		return result;
	};
	const adapter = {
		async exists(p) {
			try {
				await fs.access(path(p));
				return true;
			} catch (e) {
				if (e.code === 'ENOENT') return false;
				throw e;
			}
		},
		async list(p) {
			const entries = await fs.readdir(p ? path(p) : root, { withFileTypes: true });
			return { files: entries.filter((entry) => entry.isFile()).map((entry) => p ? p + '/' + entry.name : entry.name), folders: [] };
		},
		async mkdir(p) {
			await fs.mkdir(path(p));
		},
		async read(p) {
			return fs.readFile(path(p), 'utf8');
		},
		async write(p, value) {
			await fs.writeFile(path(p), value, 'utf8');
		}
	};
	const listeners = new Map();
	const files = new Map();
	const emit = (event, ...args) => {
		for (const callback of listeners.get(event) || []) callback(...args);
	};
	const metadata = new Map();
	let markdownScans = 0;
	const vault = {
		adapter,
		getMarkdownFiles() {
			markdownScans += 1;
			return [...files.values()].filter((file) => file.extension === 'md');
		}
	};
	const metadataCache = { getFileCache: (file) => metadata.get(file) || null };
	if (nativeVault)
		Object.assign(vault, {
			getAbstractFileByPath(p) {
				return files.get(p) || null;
			},
			async createFolder(p) {
				await adapter.mkdir(p);
				files.set(p, { path: p, children: [] });
			},
			async create(p, raw) {
				await adapter.write(p, raw);
				const file = { path: p, extension: p.split('.').at(-1) };
				files.set(p, file);
				emit('create', file);
				return file;
			},
			async modify(file, raw) {
				await adapter.write(file.path, raw);
				emit('modify', file);
			},
			async rename(file, newPath) {
				const oldPath = file.path;
				await fs.rename(path(oldPath), path(newPath));
				for (const [p, entry] of [...files]) {
					if (p === oldPath || p.startsWith(oldPath + '/')) {
						files.delete(p);
						entry.path = newPath + p.slice(oldPath.length);
						files.set(entry.path, entry);
					}
				}
				emit('rename', file, oldPath);
			},
			async delete(file) {
				await fs.rm(path(file.path), { recursive: true });
				for (const p of [...files.keys()]) {
					if (p === file.path || p.startsWith(file.path + '/')) files.delete(p);
				}
				emit('delete', file);
			},
			on(event, callback) {
				if (!listeners.has(event)) listeners.set(event, new Set());
				listeners.get(event).add(callback);
				return { event, callback };
			},
			offref(ref) {
				listeners.get(ref.event)?.delete(ref.callback);
			}
		});
	const restart = () => {
		const service = new WereadFavoritesService({
			app: {
				vault,
				metadataCache,
				workspace: {
					getLeavesOfType(type) {
						assert.equal(type, 'canvas');
						return nativeViews.map((view) => ({ view }));
					}
				}
			}
		}, storageOptions);
		services.push(service);
		return service;
	};
	await fs.writeFile(path('existing-book.md'), 'Original synced Markdown remains unchanged.');
	t.after(async () => {
		services.forEach((s) => s.dispose());
		const info = await fs.lstat(root);
		assert.equal(dirname(root), parent);
		assert(
			basename(root).startsWith('weread-favorites-') &&
				info.isDirectory() &&
				!info.isSymbolicLink()
		);
		await fs.rm(root, { recursive: true });
	});
	return {
		root,
		path,
		restart,
		adapter,
		vault,
		listeners,
		setBookId(file, bookId) {
			metadata.set(file, { frontmatter: { doc_type: 'weread-highlights-reviews', bookId } });
		},
		markdownScans: () => markdownScans
	};
}
const note = (id = 'one') => ({
	id: `42:highlight:${id}`,
	bookId: '42',
	bookTitle: '临时测试书',
	author: '测试作者',
	kind: 'highlight',
	text: '第一行句子。\n第二行句子。',
	createTime: 1700000000000,
	chapterTitle: '第一章',
	sourceUrl: 'weread://reading?bId=42'
});

test('real filesystem preserves Canvas snapshots across restart, cancel/undo and native opening', async (t) => {
	const f = await fixture(t);
	const service = f.restart();
	await service.load();
	assert.equal(
		await f.adapter.exists(FAVORITES_PATH),
		false,
		'Opening an empty collection does not create data files'
	);
	const original = note();
	await service.setFavorite(original, true);
	const saved = service.getSnapshot().favorites[0];
	original.text = 'Caller mutation must not modify the saved snapshot';
	const restarted = f.restart();
	await restarted.load();
	assert.deepEqual(restarted.getSnapshot().favorites, [saved]);
	await restarted.remove(saved.id);
	const removed = f.restart();
	await removed.load();
	assert.equal(removed.getSnapshot().favorites.length, 0);
	assert.equal(
		parseFavorites(await f.adapter.read(FAVORITES_PATH)).records[0].deletedAt > 0,
		true
	);
	await removed.restore(saved);
	assert.deepEqual(removed.getSnapshot().favorites[0].note, saved.note);
	const beforeOpen = await f.adapter.read(FAVORITES_PATH);
	assert.equal(await removed.ensureCanvas(), FAVORITES_PATH);
	assert.equal(await f.adapter.read(FAVORITES_PATH), beforeOpen);
	assert(Array.isArray(JSON.parse(beforeOpen).nodes));
	assert(Array.isArray(JSON.parse(beforeOpen).edges));
	assert.equal(
		await fs.readFile(f.path('existing-book.md'), 'utf8'),
		'Original synced Markdown remains unchanged.'
	);
});

test('real truncated file recovery preserves damaged bytes; a future schema is never overwritten', async (t) => {
	const f = await fixture(t);
	const service = f.restart();
	await service.setFavorite(note('one'), true);
	await service.setFavorite(note('two'), true);
	const previous = await f.adapter.read(FAVORITES_BACKUP_PATH);
	const damaged = '{"schemaVersion":1,"records":[';
	await f.adapter.write(FAVORITES_PATH, damaged);
	const recovered = f.restart();
	const state = await recovered.load();
	assert.equal(state.writable, true);
	assert(state.warning.includes('备份'));
	assert.equal(await f.adapter.read(FAVORITES_PATH), previous);
	const entries = await fs.readdir(f.root);
	const quarantine = entries.find((name) => name.startsWith('favorites.corrupt.'));
	assert(quarantine);
	assert.equal(await fs.readFile(f.path(quarantine), 'utf8'), damaged);
	const futureCanvas = JSON.parse(previous);
	let changed = false;
	for (const node of futureCanvas.nodes) {
		if (node.type === 'text' && node.text.includes('<!-- weread-favorites:')) {
			const oldText = node.text;
			node.text = node.text.replace(
				encodeURIComponent('"schemaVersion":2'),
				encodeURIComponent('"schemaVersion":3')
			);
			changed ||= oldText !== node.text;
		}
	}
	assert(changed, 'Future-version fixture changes the managed Canvas header');
	const future = JSON.stringify(futureCanvas);
	await f.adapter.write(FAVORITES_PATH, future);
	const futureReader = f.restart();
	assert.equal((await futureReader.load()).writable, false);
	await assert.rejects(futureReader.setFavorite(note('three'), true));
	assert.equal(await f.adapter.read(FAVORITES_PATH), future);
	assert.equal(
		await fs.readFile(f.path('existing-book.md'), 'utf8'),
		'Original synced Markdown remains unchanged.'
	);
});

function waitForSnapshot(service, predicate) {
	let unsubscribe = () => {};
	let timer;
	const result = new Promise((resolve, reject) => {
		timer = setTimeout(
			() => reject(new Error('Native Canvas change did not reach favorites')),
			2000
		);
		unsubscribe = service.subscribe((state) => {
			if (predicate(state)) resolve(state);
		});
	});
	return result.finally(() => {
		clearTimeout(timer);
		unsubscribe();
	});
}

test('real Vault Canvas writes index the file and native edits refresh stars without losing layout', async (t) => {
	const f = await fixture(t, { nativeVault: true });
	const service = f.restart();
	assert.equal(await service.ensureCanvas(), FAVORITES_PATH);
	const file = f.vault.getAbstractFileByPath(FAVORITES_PATH);
	assert.equal(file.extension, 'canvas');
	await service.setFavorite(note(), true);
	const canvas = JSON.parse(await f.adapter.read(FAVORITES_PATH));
	const card = canvas.nodes.find((n) => n.type === 'text' && n.text.startsWith(note().text));
	assert(card);
	card.x = 612;
	card.y = -88;
	card.width = 480;
	card.color = '2';
	card.text = card.text.replace('第一行句子。', '在原生画布里修改过的句子。');
	canvas.nodes.push({
		id: 'my-free-note',
		type: 'text',
		x: 1600,
		y: 300,
		width: 320,
		height: 160,
		text: '手动整理的说明'
	});
	canvas.edges.push({ id: 'my-edge', fromNode: card.id, toNode: 'my-free-note' });
	const changed = waitForSnapshot(service, (state) =>
		state.favorites[0]?.note.text.includes('在原生画布里修改过')
	);
	await f.vault.modify(file, JSON.stringify(canvas));
	await changed;
	assert.equal(service.isFavorite(note().id), true);
	await service.setFavorite(note('second'), true);
	const saved = JSON.parse(await f.adapter.read(FAVORITES_PATH));
	const preserved = saved.nodes.find((n) => n.id === card.id);
	assert.equal(preserved.x, 612);
	assert.equal(preserved.y, -88);
	assert.equal(preserved.width, 480);
	assert.equal(preserved.color, '2');
	assert(saved.nodes.some((n) => n.id === 'my-free-note' && n.text === '手动整理的说明'));
	assert(saved.edges.some((e) => e.id === 'my-edge'));
	saved.nodes = saved.nodes.filter((n) => n.id !== card.id);
	saved.edges = saved.edges.filter((e) => e.fromNode !== card.id && e.toNode !== card.id);
	const deleted = waitForSnapshot(
		service,
		(state) => !state.favorites.some((e) => e.id === note().id)
	);
	await f.vault.modify(file, JSON.stringify(saved));
	await deleted;
	assert.equal(service.isFavorite(note().id), false);
	await service.setFavorite(note('third'), true);
	assert.equal(
		parseFavorites(await f.adapter.read(FAVORITES_PATH)).records.some(
			(e) => e.id === note().id
		),
		false
	);
	service.dispose();
	assert([...f.listeners.values()].every((set) => set.size === 0));
});

for (const action of ['delete', 'rename']) {
	test(`Vault ${action} makes live favorites read-only without reviving the canceled predecessor`, async (t) => {
		const f = await fixture(t, { nativeVault: true });
		const service = f.restart();
		await service.setFavorite(note('kept'), true);
		await service.setFavorite(note('canceled'), true);
		await service.remove(note('canceled').id);
		const newest = await f.adapter.read(FAVORITES_PATH);
		const backup = await f.adapter.read(FAVORITES_BACKUP_PATH);
		assert.equal(
			parseFavorites(backup).records.find((e) => e.id === note('canceled').id).deletedAt,
			undefined
		);
		const file = f.vault.getAbstractFileByPath(FAVORITES_PATH);
		const renamedPath = 'renamed.canvas';
		const unavailable = waitForSnapshot(
			service,
			(state) => !state.loading && !state.writable && state.error.includes('已保护备份')
		);
		if (action === 'rename') await f.vault.rename(file, renamedPath);
		else await f.vault.delete(file);
		assert.equal(service.getSnapshot().writable, false, 'Invalidate UI immediately');
		await unavailable;
		await assert.rejects(service.setFavorite(note('blocked'), true));
		await assert.rejects(service.ensureCanvas());
		assert.equal(await f.adapter.exists(FAVORITES_PATH), false);
		assert.equal(await f.adapter.read(FAVORITES_BACKUP_PATH), backup);
		const restarted = f.restart();
		assert.equal((await restarted.load()).writable, false);
		assert.equal(restarted.isFavorite(note('canceled').id), false);
		if (action === 'rename') assert.equal(await f.adapter.read(renamedPath), newest);
		const restored = waitForSnapshot(service, (state) => state.writable && !state.loading);
		const restartRestored = waitForSnapshot(
			restarted,
			(state) => state.writable && !state.loading
		);
		if (action === 'rename') await f.vault.rename(file, FAVORITES_PATH);
		else await f.vault.create(FAVORITES_PATH, newest);
		await Promise.all([restored, restartRestored]);
		assert.equal(service.isFavorite(note('kept').id), true);
		assert.equal(service.isFavorite(note('canceled').id), false);
		await service.setFavorite(note('after-restore'), true);
		assert.equal(service.isFavorite(note('after-restore').id), true);
		service.dispose();
		restarted.dispose();
		assert([...f.listeners.values()].every((set) => set.size === 0));
	});
}

for (const action of ['delete', 'rename']) {
	test(`parent directory ${action} invalidates a loaded Canvas without recreating its old path`, async (t) => {
		const f = await fixture(t, { nativeVault: true, storageOptions: { folder: 'WereadData/favorites' } });
		const service = f.restart();
		await service.setFavorite(note(), true);
		const folder = f.vault.getAbstractFileByPath('WereadData/favorites');
		const unavailable = waitForSnapshot(
			service,
			(state) => !state.loading && !state.writable && state.error.includes('已保护备份')
		);
		if (action === 'rename') await f.vault.rename(folder, 'WereadData/moved-favorites');
		else await f.vault.delete(folder);
		assert.equal(service.getSnapshot().writable, false);
		await unavailable;
		await assert.rejects(service.ensureCanvas());
		assert.equal(await f.adapter.exists('WereadData/favorites/favorites.canvas'), false);
		if (action === 'rename') {
			const restored = waitForSnapshot(service, (state) => state.writable && !state.loading);
			await f.vault.rename(folder, 'WereadData/favorites');
			await restored;
			assert.equal(service.isFavorite(note().id), true);
		}
	});
}

test('plugin mutation flushes a pending native Canvas save before merging a new favorite', async (t) => {
	const views = [];
	const f = await fixture(t, { nativeVault: true, nativeViews: views });
	const service = f.restart();
	await service.setFavorite(note(), true);
	const file = f.vault.getAbstractFileByPath(FAVORITES_PATH);
	const draft = JSON.parse(await f.adapter.read(FAVORITES_PATH));
	const card = draft.nodes.find((n) => n.type === 'text' && n.text.startsWith(note().text));
	card.x = -142;
	card.text = card.text.replace('第一行句子。', '原生画布尚未自动保存的编辑。');
	let saves = 0;
	views.push({
		file: { path: 'existing-book.md' },
		async save() {
			throw new Error('Unrelated files must not be saved');
		}
	});
	views.push({
		file,
		async save() {
			saves += 1;
			if (saves === 1) {
				await f.vault.modify(file, JSON.stringify(draft));
				const markdown = await f.vault.create(
					'Newly synced book.md',
					'Synced during editor save'
				);
				f.setBookId(markdown, 42);
			}
		}
	});
	await service.setFavorite(note('new-favorite'), true);
	assert.equal(saves, 1);
	const saved = JSON.parse(await f.adapter.read(FAVORITES_PATH));
	assert.equal(saved.nodes.find((n) => n.id === card.id).x, -142);
	assertBookLink(
		bookForQuote(
			saved,
			saved.nodes.find((n) => n.id === card.id)
		),
		'Newly synced book.md'
	);
	assert.equal(
		f.markdownScans(),
		2,
		'Each accepted write resolves once, after the native draft flush'
	);
	const records = parseFavorites(await f.adapter.read(FAVORITES_PATH)).records;
	assert.equal(records.length, 2);
	assert(records.find((e) => e.id === note().id).note.text.includes('尚未自动保存'));
	assert(records.some((e) => e.id === note('new-favorite').id));
});

test('external disk changes are checked before saving a pending native Canvas draft', async (t) => {
	const views = [];
	const f = await fixture(t, { nativeViews: views });
	const service = f.restart();
	await service.setFavorite(note(), true);
	const old = await f.adapter.read(FAVORITES_PATH);
	let saves = 0;
	views.push({
		file: { path: FAVORITES_PATH },
		async save() {
			saves += 1;
			await f.adapter.write(FAVORITES_PATH, old);
		}
	});
	const external = JSON.parse(old);
	external.externalOwnerNote = 'external update must survive';
	const raw = JSON.stringify(external);
	await f.adapter.write(FAVORITES_PATH, raw);
	await assert.rejects(service.setFavorite(note('blocked'), true));
	assert.equal(saves, 0);
	assert.equal(await f.adapter.read(FAVORITES_PATH), raw);
});

test('opening an existing Canvas preserves graph, quote edits and layout without automatic covers', async (t) => {
	const f = await fixture(t, { nativeVault: true });
	const service = f.restart();
	const original = { ...note(), cover: 'https://covers.example/42.jpg' };
	await service.setFavorite(original, true);
	const entry = service.getSnapshot().favorites[0];
	const canvas = JSON.parse(await f.adapter.read(FAVORITES_PATH));
	const card = canvas.nodes.find(
		(n) => n.type === 'text' && n.text.includes('<!-- weread-favorite:')
	);
	card.x = 840;
	card.y = -170;
	card.width = 333;
	card.height = 271;
	card.color = '3';
	card.text = `${entry.note.text}\n\n<!-- weread-favorite-footer -->\n\n手动补充的来源说明\n\n<!-- weread-favorite:${encodeURIComponent(JSON.stringify({ schemaVersion: 1, record: entry }))} -->`;
	await f.vault.modify(f.vault.getAbstractFileByPath(FAVORITES_PATH), JSON.stringify(canvas));
	await service.load(true);
	await service.ensureCanvas();
	const upgradedRaw = await f.adapter.read(FAVORITES_PATH);
	const upgraded = JSON.parse(upgradedRaw).nodes.find((n) => n.id === card.id);
	assert(!upgraded.text.includes('![封面]'));
	assert(!upgraded.text.includes('<!-- weread-favorite-cover -->'));
	const graph = JSON.parse(upgradedRaw);
	assert.equal(graph.edges.length, 1, 'Only the book-to-quote edge is managed');
	assert.equal(bookForQuote(graph, upgraded).id, bookForQuote(canvas, card).id);
	assert(upgraded.text.includes('手动补充的来源说明'));
	assert.equal(upgraded.x, 840);
	assert.equal(upgraded.y, -170);
	assert.equal(upgraded.width, 333);
	assert.equal(upgraded.height, 271);
	assert.equal(upgraded.color, '3');
	assert.equal(parseFavorites(upgradedRaw).records[0].note.text, original.text);
	assert.equal(service.getSnapshot().favorites[0].note.text, original.text);
	await service.ensureCanvas();
	assert.equal(
		await f.adapter.read(FAVORITES_PATH),
		upgradedRaw,
		'Reopening must not duplicate graph nodes or rewrite the file'
	);
});

test('opening schema2 removes managed root links once and preserves custom root relations and Markdown', async (t) => {
	const f = await fixture(t, { nativeVault: true });
	const service = f.restart();
	const markdown = await f.vault.create('Book.md', 'Exact synced Markdown bytes.\n');
	f.setBookId(markdown, 42);
	await service.setFavorite({ ...note(), cover: 'https://covers.example/42.jpg' }, true);
	const favorites = service.getSnapshot().favorites;
	const canvas = JSON.parse(await f.adapter.read(FAVORITES_PATH));
	const quote = quoteCard(canvas);
	const book = bookForQuote(canvas, quote);
	const header = canvas.nodes.find((node) => node.text?.includes('<!-- weread-favorites:'));
	Object.assign(quote, { x: -456, y: 789, width: 501, height: 333, color: '4' });
	Object.assign(book, { x: 901, y: -123, width: 591, height: 271, color: '2' });
	Object.assign(canvas.edges[0], {
		fromSide: 'left',
		toSide: 'right',
		toEnd: 'none',
		color: '3',
		label: 'Native quote edge'
	});
	const oldRootEdge = { id: 'old-managed-root', fromNode: header.id, toNode: book.id };
	const customRootEdge = {
		id: 'custom-root-relation',
		fromNode: header.id,
		toNode: book.id,
		fromSide: 'right',
		toSide: 'left',
		color: '6',
		label: 'My root relation'
	};
	canvas.edges.unshift(oldRootEdge);
	canvas.edges.push(customRootEdge);
	const prefix = '<!-- weread-favorites:';
	const value = JSON.parse(decodeURIComponent(header.text.split(prefix).at(-1).split(' -->')[0]));
	assert.equal(value.schemaVersion, 2);
	value.managedEdges.unshift(oldRootEdge.id);
	header.text =
		header.text.slice(0, header.text.lastIndexOf(prefix)) +
		`${prefix}${encodeURIComponent(JSON.stringify(value))} -->`;
	const originalRaw = JSON.stringify(canvas);
	await f.vault.modify(f.vault.getAbstractFileByPath(FAVORITES_PATH), originalRaw);
	await service.load(true);
	assert.equal(await f.adapter.read(FAVORITES_PATH), originalRaw, 'Loading does not migrate');
	await service.ensureCanvas();
	const migratedRaw = await f.adapter.read(FAVORITES_PATH);
	const migrated = JSON.parse(migratedRaw);
	assert.deepEqual(
		migrated.edges,
		canvas.edges.filter((edge) => edge.id !== oldRootEdge.id)
	);
	assert.deepEqual(
		migrated.nodes.find((node) => node.id === quote.id),
		quote
	);
	assert.deepEqual(
		migrated.nodes.find((node) => node.id === book.id),
		book
	);
	assertBookLink(bookForQuote(migrated, quoteCard(migrated)), 'Book.md');
	assert(book.text.includes('https://covers.example/42.jpg'));
	assert.deepEqual(service.getSnapshot().favorites, favorites);
	assert.equal(await f.adapter.read('Book.md'), 'Exact synced Markdown bytes.\n');
	assert.equal(
		await f.adapter.read('existing-book.md'),
		'Original synced Markdown remains unchanged.'
	);
	assert.equal(await f.adapter.read(FAVORITES_BACKUP_PATH), originalRaw);
	await service.ensureCanvas();
	assert.equal(await f.adapter.read(FAVORITES_PATH), migratedRaw, 'Cleanup runs only once');
	assert.deepEqual((await f.restart().load()).favorites, favorites);
});

function quoteCard(canvas, text = note().text) {
	return canvas.nodes.find((node) => node.type === 'text' && node.text.startsWith(text));
}
function assertBookLink(book, path) {
	assert.equal(book.type, 'text', 'Managed books always use text cards');
	assert(!('file' in book), 'Book cards never embed native Markdown file previews');
	if (path) {
		assert(book.text.includes('打开本地笔记'));
		assert(decodeURIComponent(book.text).includes(path), `Local-note link resolves to ${path}`);
	} else {
		assert(!book.text.includes('打开本地笔记'), 'No local match omits the link entirely');
	}
}

function bookForQuote(canvas, quote) {
	const edge = canvas.edges.find((candidate) => candidate.toNode === quote.id);
	assert(edge, 'Quote has a book parent');
	return canvas.nodes.find((node) => node.id === edge.fromNode);
}

test('cached local book references appear after sync and follow Markdown file and folder changes', async (t) => {
	const f = await fixture(t, { nativeVault: true });
	const service = f.restart();
	await service.setFavorite({ ...note(), cover: 'https://covers.example/42.jpg' }, true);
	let canvas = JSON.parse(await f.adapter.read(FAVORITES_PATH));
	const quote = quoteCard(canvas);
	const placeholder = bookForQuote(canvas, quote);
	assertBookLink(placeholder);
	assert(placeholder.text.includes('https://covers.example/42.jpg'));
	assert(placeholder.text.includes(note().bookTitle));
	assert(placeholder.text.includes(note().author));
	assert(!quote.text.includes('<!-- weread-favorite-cover -->'));
	const beforeSync = await f.adapter.read(FAVORITES_PATH);
	await f.vault.createFolder('Books');
	const markdown = await f.vault.create(
		'Books/Shared title.md',
		'Synced note content must stay exact.'
	);
	f.setBookId(markdown, 42);
	assert.equal(
		await f.adapter.read(FAVORITES_PATH),
		beforeSync,
		'File events do not rewrite favorites'
	);
	assert.equal(service.isFavorite(note().id), true);
	const scans = f.markdownScans();
	await service.ensureCanvas();
	assert.equal(f.markdownScans(), scans + 1, 'One Markdown enumeration per transaction');
	canvas = JSON.parse(await f.adapter.read(FAVORITES_PATH));
	assertBookLink(bookForQuote(canvas, quoteCard(canvas)), markdown.path);
	assert.equal(await f.adapter.read(markdown.path), 'Synced note content must stay exact.');
	const linkedRaw = await f.adapter.read(FAVORITES_PATH);
	await service.ensureCanvas();
	assert.equal(await f.adapter.read(FAVORITES_PATH), linkedRaw, 'Unchanged graph does not write');
	const originalBookNodeId = bookForQuote(canvas, quoteCard(canvas)).id;
	await f.vault.rename(markdown, 'Books/Renamed.md');
	assert.equal(
		await f.adapter.read(FAVORITES_PATH),
		linkedRaw,
		'Markdown rename alone does not force a Canvas save'
	);
	await service.ensureCanvas();
	canvas = JSON.parse(await f.adapter.read(FAVORITES_PATH));
	assert.equal(bookForQuote(canvas, quoteCard(canvas)).id, originalBookNodeId);
	assertBookLink(bookForQuote(canvas, quoteCard(canvas)), 'Books/Renamed.md');
	assert(!bookForQuote(canvas, quoteCard(canvas)).text.includes('Shared%20title.md'));
	await f.vault.rename(f.vault.getAbstractFileByPath('Books'), 'RenamedBooks');
	await service.setFavorite(note('second'), true);
	canvas = JSON.parse(await f.adapter.read(FAVORITES_PATH));
	assertBookLink(bookForQuote(canvas, quoteCard(canvas)), 'RenamedBooks/Renamed.md');
	assert.equal(service.getSnapshot().favorites.length, 2);
	await f.vault.delete(f.vault.getAbstractFileByPath('RenamedBooks'));
	await service.ensureCanvas();
	canvas = JSON.parse(await f.adapter.read(FAVORITES_PATH));
	assertBookLink(bookForQuote(canvas, quoteCard(canvas)));
	assert(bookForQuote(canvas, quoteCard(canvas)).text.includes('https://covers.example/42.jpg'));
	assert(bookForQuote(canvas, quoteCard(canvas)).text.includes(note().bookTitle));
	assert(bookForQuote(canvas, quoteCard(canvas)).text.includes(note().author));
	assert.deepEqual(quoteCard(canvas), quote, 'Link changes never modify the existing quote node');
	assert.equal(
		service.getSnapshot().favorites.length,
		2,
		'Source folder deletion never cancels quotes'
	);
});

test('same titles do not conflate book IDs and ambiguous cached IDs fall back without quote loss', async (t) => {
	const f = await fixture(t, { nativeVault: true });
	const service = f.restart();
	const one = await f.vault.create('One.md', 'First synced note');
	const two = await f.vault.create('Two.md', 'Second synced note');
	f.setBookId(one, 42);
	f.setBookId(two, '43');
	await service.setFavorite(note(), true);
	const other = {
		...note('other'),
		id: '43:highlight:other',
		bookId: '43',
		text: 'Other book quote'
	};
	await service.setFavorite(other, true);
	let canvas = JSON.parse(await f.adapter.read(FAVORITES_PATH));
	assertBookLink(bookForQuote(canvas, quoteCard(canvas)), 'One.md');
	assertBookLink(bookForQuote(canvas, quoteCard(canvas, other.text)), 'Two.md');
	const duplicate = await f.vault.create('Duplicate.md', 'Conflicting cached identity');
	f.setBookId(duplicate, '42');
	await service.ensureCanvas();
	canvas = JSON.parse(await f.adapter.read(FAVORITES_PATH));
	assertBookLink(bookForQuote(canvas, quoteCard(canvas)));
	assertBookLink(bookForQuote(canvas, quoteCard(canvas, other.text)), 'Two.md');
	assert.equal(service.getSnapshot().favorites.length, 2);
	await f.vault.delete(duplicate);
	await service.ensureCanvas();
	canvas = JSON.parse(await f.adapter.read(FAVORITES_PATH));
	assertBookLink(bookForQuote(canvas, quoteCard(canvas)), 'One.md');
});

test('native book-card removal cannot cancel quotes and opening repairs only graph presentation', async (t) => {
	const f = await fixture(t, { nativeVault: true });
	const service = f.restart();
	const markdown = await f.vault.create('Book.md', 'Unmodified synced content');
	f.setBookId(markdown, '42');
	await service.setFavorite(note(), true);
	const canvas = JSON.parse(await f.adapter.read(FAVORITES_PATH));
	const book = bookForQuote(canvas, quoteCard(canvas));
	canvas.nodes = canvas.nodes.filter((node) => node.id !== book.id);
	canvas.edges = canvas.edges.filter(
		(edge) => edge.fromNode !== book.id && edge.toNode !== book.id
	);
	const raw = JSON.stringify(canvas);
	await f.vault.modify(f.vault.getAbstractFileByPath(FAVORITES_PATH), raw);
	await service.load(true);
	assert.equal(service.isFavorite(note().id), true);
	assert.equal(await f.adapter.read(FAVORITES_PATH), raw, 'Reload alone never forces a save');
	await service.ensureCanvas();
	const repaired = JSON.parse(await f.adapter.read(FAVORITES_PATH));
	assertBookLink(bookForQuote(repaired, quoteCard(repaired)), 'Book.md');
	assert.equal(service.getSnapshot().favorites.length, 1);
	assert.equal(parseFavorites(await f.adapter.read(FAVORITES_PATH)).records[0].id, note().id);
	assert.equal(await f.adapter.read('Book.md'), 'Unmodified synced content');
});

test('four existing native file book nodes become text cover cards without losing identity, layout or quotes', async (t) => {
	const f = await fixture(t, { nativeVault: true });
	const service = f.restart();
	const notes = Array.from({ length: 4 }, (_, index) => {
		const bookId = String(42 + index);
		return {
			...note(),
			id: `${bookId}:highlight:one`,
			bookId,
			bookTitle: `Migration book ${index}`,
			author: `Author ${index}`,
			text: `Original quote ${index}`,
			cover: `https://covers.example/${bookId}.jpg`
		};
	});
	for (const source of notes) {
		const markdown = await f.vault.create(
			`Book ${source.bookId}.md`,
			`Untouched note ${source.bookId}`
		);
		f.setBookId(markdown, Number(source.bookId));
		await service.setFavorite(source, true);
	}
	const originalFavorites = service.getSnapshot().favorites;
	const canvas = JSON.parse(await f.adapter.read(FAVORITES_PATH));
	const originals = notes.map((source, index) => {
		const quote = quoteCard(canvas, source.text);
		const book = bookForQuote(canvas, quote);
		delete book.text;
		Object.assign(book, {
			type: 'file',
			file: `Book ${source.bookId}.md`,
			subpath: '#Old heading',
			x: index * 600 - 900,
			y: -200 - index * 100,
			width: 350 + index,
			height: 280 + index,
			color: String(index + 1),
			customProperty: `native-book-${index}`
		});
		return { book: { ...book }, quote: { ...quote } };
	});
	canvas.nodes.push({
		id: 'free-migration-note',
		type: 'text',
		x: -1500,
		y: 900,
		width: 400,
		height: 180,
		text: 'Native free content must survive'
	});
	canvas.edges.push({
		id: 'free-migration-edge',
		fromNode: originals[0].book.id,
		toNode: 'free-migration-note'
	});
	const originalRaw = JSON.stringify(canvas);
	await f.vault.modify(f.vault.getAbstractFileByPath(FAVORITES_PATH), originalRaw);
	await service.load(true);
	assert.equal(service.getSnapshot().writable, true);
	assert.equal(
		await f.adapter.read(FAVORITES_PATH),
		originalRaw,
		'Loading existing file cards does not rewrite data'
	);
	await service.ensureCanvas();
	const migratedRaw = await f.adapter.read(FAVORITES_PATH);
	const migrated = JSON.parse(migratedRaw);
	assert.equal(migrated.nodes.filter((node) => node.type === 'file').length, 0);
	for (const [index, source] of notes.entries()) {
		const previous = originals[index];
		const book = migrated.nodes.find((node) => node.id === previous.book.id);
		assertBookLink(book, `Book ${source.bookId}.md`);
		assert(book.text.includes(source.cover));
		assert(book.text.includes(source.bookTitle));
		assert(book.text.includes(source.author));
		for (const key of ['x', 'y', 'width', 'height', 'color', 'customProperty']) {
			assert.equal(book[key], previous.book[key], `${key} survives native-file migration`);
		}
		assert(!('subpath' in book));
		assert.deepEqual(
			migrated.nodes.find((node) => node.id === previous.quote.id),
			previous.quote
		);
		assert.equal(bookForQuote(migrated, quoteCard(migrated, source.text)).id, previous.book.id);
		assert.equal(
			await f.adapter.read(`Book ${source.bookId}.md`),
			`Untouched note ${source.bookId}`
		);
	}
	assert.deepEqual(
		[...migrated.edges].sort((a, b) => a.id.localeCompare(b.id)),
		[...canvas.edges].sort((a, b) => a.id.localeCompare(b.id))
	);
	assert(
		migrated.nodes.some(
			(node) =>
				node.id === 'free-migration-note' &&
				node.text === 'Native free content must survive'
		)
	);
	assert.deepEqual(service.getSnapshot().favorites, originalFavorites);
	assert.equal(await f.adapter.read(FAVORITES_BACKUP_PATH), originalRaw);
	await service.ensureCanvas();
	assert.equal(await f.adapter.read(FAVORITES_PATH), migratedRaw, 'Migrating again is a no-op');
	assert.deepEqual((await f.restart().load()).favorites, originalFavorites);
});

function legacyCanvas(entry) {
	const marker = (name, value) => `<!-- ${name}:${encodeURIComponent(JSON.stringify(value))} -->`;
	return (
		JSON.stringify(
			{
				nodes: [
					{
						id: 'old-root',
						type: 'text',
						x: -200,
						y: 10,
						width: 400,
						height: 160,
						text: `Original root notes\n\n${marker('weread-favorites', { schemaVersion: 1, revision: 1, tombstones: [] })}`
					},
					{
						id: 'old-quote',
						type: 'text',
						x: 900,
						y: -230,
						width: 390,
						height: 300,
						text: `${entry.note.text}\n\n<!-- weread-favorite-footer -->\n\nOriginal custom source\n\n${marker('weread-favorite', { schemaVersion: 1, record: entry })}`
					}
				],
				edges: []
			},
			null,
			3
		) + '\n'
	);
}

test('format-one upgrade archives original exact bytes beyond rotating previous backups', async (t) => {
	const f = await fixture(t, { nativeVault: true });
	const service = f.restart();
	await service.setFavorite(note(), true);
	const original = legacyCanvas(service.getSnapshot().favorites[0]);
	await f.vault.modify(f.vault.getAbstractFileByPath(FAVORITES_PATH), original);
	await service.load(true);
	assert.equal(
		await f.adapter.read(FAVORITES_PATH),
		original,
		'Loading legacy Canvas stays read-only'
	);
	await service.ensureCanvas();
	const entries = await fs.readdir(f.root);
	const archives = entries.filter((name) => name.startsWith('favorites.before-book-graph.'));
	assert.equal(archives.length, 1);
	const archive = archives[0];
	assert.equal(await f.adapter.read(archive), original);
	const upgradedRaw = await f.adapter.read(FAVORITES_PATH);
	const upgraded = JSON.parse(upgradedRaw);
	const quote = upgraded.nodes.find((node) => node.id === 'old-quote');
	assert.equal(quote.x, 900);
	assert.equal(quote.y, -230);
	assert(quote.text.includes('Original custom source'));
	assert(bookForQuote(upgraded, quote));
	await service.setFavorite(note('later'), true);
	assert.equal(await f.adapter.read(FAVORITES_BACKUP_PATH), upgradedRaw);
	assert.equal(await f.adapter.read(archive), original);
	assert.equal(
		(await fs.readdir(f.root)).filter((name) =>
			name.startsWith('favorites.before-book-graph.')
		).length,
		1
	);
});

test('real Vault folder change verifies exact copies, indexes the destination and follows only its events', async (t) => {
	const storageOptions = { folder: '', locationVersion: 1 };
	storageOptions.commitLocation = async (folder, version) => {
		storageOptions.folder = folder;
		storageOptions.locationVersion = version;
	};
	const f = await fixture(t, { nativeVault: true, storageOptions });
	const service = f.restart();
	await service.setFavorite(note(), true);
	const original = await f.adapter.read(FAVORITES_PATH);
	const previous = await f.adapter.read(FAVORITES_BACKUP_PATH);
	const target = 'Personal/Collection/favorites.canvas';
	assert.equal(await service.changeCanvasFolder('Personal/Collection'), target);
	assert.equal(await f.adapter.read(FAVORITES_PATH), original);
	assert.equal(await f.adapter.read(FAVORITES_BACKUP_PATH), previous);
	assert.equal(await f.adapter.read(target), original);
	assert.equal(await f.adapter.read('Personal/Collection/favorites.canvas.previous.json'), previous);
	const file = f.vault.getAbstractFileByPath(target);
	assert.equal(file.extension, 'canvas', 'destination is indexed through Vault.create');
	const baseline = (await fs.readdir(f.path('Personal/Collection'))).find((name) => name.startsWith('favorites.before-location-change.'));
	assert.equal(await f.adapter.read('Personal/Collection/' + baseline), original);
	await f.vault.modify(f.vault.getAbstractFileByPath(FAVORITES_PATH), '{stale old copy');
	assert.equal(service.getSnapshot().writable, true, 'old events cannot invalidate current favorites');
	const changed = JSON.parse(original);
	const quote = quoteCard(changed);
	quote.text = quote.text.replace('第一行句子。', '新目录里的原生编辑。');
	const updated = waitForSnapshot(service, (state) => state.favorites[0]?.note.text.includes('新目录'));
	await f.vault.modify(file, JSON.stringify(changed));
	await updated;
	await service.setFavorite(note('after-move'), true);
	assert.equal(await f.adapter.read('Personal/Collection/' + baseline), original);
	assert.equal((await f.restart().load()).favorites.length, 2);
	assert.equal(await service.ensureCanvas(), target);
});

test('failed original-byte archive verification blocks legacy graph upgrade before primary or backup writes', async (t) => {
	const f = await fixture(t, { nativeVault: true });
	const service = f.restart();
	await service.setFavorite(note(), true);
	const original = legacyCanvas(service.getSnapshot().favorites[0]);
	await f.vault.modify(f.vault.getAbstractFileByPath(FAVORITES_PATH), original);
	await service.load(true);
	const backup = await f.adapter.read(FAVORITES_BACKUP_PATH);
	const write = f.adapter.write;
	f.adapter.write = async (path, raw) =>
		write(path, path.includes('favorites.before-book-graph.') ? raw.slice(0, 10) : raw);
	await assert.rejects(service.ensureCanvas(), /校验失败/);
	assert.equal(await f.adapter.read(FAVORITES_PATH), original);
	assert.equal(await f.adapter.read(FAVORITES_BACKUP_PATH), backup);
	assert.equal(service.isFavorite(note().id), true);
	f.adapter.write = write;
	await service.ensureCanvas();
	assert.equal(parseFavorites(await f.adapter.read(FAVORITES_PATH)).records[0].id, note().id);
});
