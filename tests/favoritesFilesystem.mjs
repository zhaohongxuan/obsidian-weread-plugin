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
const { WereadFavoritesService, FAVORITES_PATH, FAVORITES_BACKUP_PATH } = module.exports;

async function fixture(t) {
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
	const restart = () => {
		const service = new WereadFavoritesService({ app: { vault: { adapter } } });
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
	return { root, path, restart, adapter };
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

test('real filesystem preserves snapshots across restart, cancel/undo and JSON export', async (t) => {
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
	assert.equal(JSON.parse(await f.adapter.read(FAVORITES_PATH)).records[0].deletedAt > 0, true);
	await removed.restore(saved);
	assert.deepEqual(removed.getSnapshot().favorites[0].note, saved.note);
	const exportPath = await removed.exportBackup();
	assert.deepEqual(
		JSON.parse(await f.adapter.read(exportPath)),
		JSON.parse(await f.adapter.read(FAVORITES_PATH))
	);
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
	const future = JSON.stringify({
		schemaVersion: 2,
		revision: 100,
		records: [],
		futureField: 'keep me'
	});
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
