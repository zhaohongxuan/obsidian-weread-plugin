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

async function fixture(t, { nativeVault = false, nativeViews = [] } = {}) {
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
	const emit = (event, file) => {
		for (const callback of listeners.get(event) || []) callback(file);
	};
	const vault = { adapter };
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
				const file = { path: p, extension: 'canvas' };
				files.set(p, file);
				emit('create', file);
				return file;
			},
			async modify(file, raw) {
				await adapter.write(file.path, raw);
				emit('modify', file);
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
				workspace: {
					getLeavesOfType(type) {
						assert.equal(type, 'canvas');
						return nativeViews.map((view) => ({ view }));
					}
				}
			}
		});
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
	return { root, path, restart, adapter, vault, listeners };
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
	const entries = await fs.readdir(f.path('WereadData/favorites'));
	const quarantine = entries.find((name) => name.startsWith('favorites.corrupt.'));
	assert(quarantine);
	assert.equal(await fs.readFile(f.path('WereadData/favorites/' + quarantine), 'utf8'), damaged);
	const futureCanvas = JSON.parse(previous);
	let changed = false;
	for (const node of futureCanvas.nodes) {
		if (node.type === 'text' && node.text.includes('<!-- weread-favorites:')) {
			const oldText = node.text;
			node.text = node.text.replace(
				encodeURIComponent('"schemaVersion":1'),
				encodeURIComponent('"schemaVersion":2')
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
			if (saves === 1) await f.vault.modify(file, JSON.stringify(draft));
		}
	});
	await service.setFavorite(note('new-favorite'), true);
	assert.equal(saves, 1);
	const saved = JSON.parse(await f.adapter.read(FAVORITES_PATH));
	assert.equal(saved.nodes.find((n) => n.id === card.id).x, -142);
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

test('opening an existing Canvas fills missing covers without moving cards or changing the quote', async (t) => {
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
	assert(upgraded.text.includes('https://covers.example/42.jpg'));
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
		'Reopening must not duplicate covers or rewrite the file'
	);
});
