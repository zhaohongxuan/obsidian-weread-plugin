// Bundle production persistence/service code; every vault operation uses this in-memory adapter.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';
import { build } from 'esbuild';

const compiled = await build({
	stdin: {
		contents: `export * from './src/favorites'; export * from './src/favoritesRepository'; export * from './src/favoritesCanvas';`,
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
const {
	WereadFavoritesService,
	FAVORITES_PATH: MAIN,
	FAVORITES_BACKUP_PATH: BACKUP,
	FAVORITES_STAGING_PATH: STAGE,
	LEGACY_FAVORITES_PATH: LEGACY,
	LEGACY_FAVORITES_BACKUP_PATH: LEGACY_BACKUP,
	parseFavorites,
	serializeFavoritesCanvas
} = module.exports;
const note = (source = 'one', extra = {}) => ({
	id: `book:highlight:${source}`,
	bookId: 'book',
	bookTitle: 'A book',
	author: 'Author',
	kind: 'highlight',
	text: 'Frozen highlight',
	createTime: 1700000000000,
	chapterTitle: 'Chapter',
	sourceUrl: 'weread://bestbookmark?bookId=book',
	...extra
});
const record = (extra = {}) => ({
	id: note().id,
	note: note(),
	favoritedAt: 1700000000001,
	updatedAt: 1700000000001,
	...extra
});
const document = (records = [record()], revision = 1, schemaVersion = 1) => {
	const marker = (kind, value) => `<!-- ${kind}:${encodeURIComponent(JSON.stringify(value))} -->`;
	const nodes = [
		{
			id: 'header',
			type: 'text',
			x: 0,
			y: 0,
			width: 400,
			height: 200,
			text: marker('weread-favorites', {
				schemaVersion,
				revision,
				tombstones: records.filter((entry) => entry.deletedAt !== undefined)
			})
		}
	];
	for (const [i, entry] of records.filter((entry) => entry.deletedAt === undefined).entries()) {
		nodes.push({
			id: `card-${i}`,
			type: 'text',
			x: 0,
			y: 250 + i * 350,
			width: 400,
			height: 300,
			text: `${entry.note.text}\n\n<!-- weread-favorite-footer -->\n\nSource\n\n${marker('weread-favorite', { schemaVersion: 1, record: entry })}`
		});
	}
	return JSON.stringify({ nodes, edges: [] });
};
function fixture(t, initial = []) {
	const files = new Map(initial);
	const operations = [];
	const faults = {};
	const adapter = {
		async exists(path) {
			operations.push(['exists', path]);
			return files.has(path);
		},
		async mkdir(path) {
			operations.push(['mkdir', path]);
			files.set(path, '<directory>');
		},
		async read(path) {
			operations.push(['read', path]);
			if (faults.read) return faults.read(path, files);
			if (!files.has(path)) throw new Error('missing');
			return files.get(path);
		},
		async write(path, text) {
			operations.push(['write', path]);
			if (faults.write) return faults.write(path, text, files);
			files.set(path, text);
		}
	};
	const plugin = { app: { vault: { adapter } } };
	const service = new WereadFavoritesService(plugin);
	t.after(() => service.dispose());
	return {
		service,
		files,
		faults,
		operations,
		restart() {
			const restarted = new WereadFavoritesService(plugin);
			t.after(() => restarted.dispose());
			return restarted;
		}
	};
}

test('hydrate before mutation; frozen snapshots survive restart, source deletion and auth-independent lifecycle', async (t) => {
	const f = fixture(t);
	const source = note();
	const adding = f.service.setFavorite(source, true);
	source.text = 'mutated after acceptance';
	await adding;
	assert.equal(f.service.getSnapshot().favorites[0].note.text, 'Frozen highlight');
	const snapshot = f.service.getSnapshot();
	snapshot.favorites[0].note.text = 'tampered';
	snapshot.favorites.push(record());
	snapshot.pendingIds.push('tampered');
	assert.equal(f.service.getSnapshot().favorites.length, 1);
	assert.equal(f.service.getSnapshot().favorites[0].note.text, 'Frozen highlight');
	const restarted = f.restart();
	await restarted.setFavorite(note('two'), true);
	assert.equal(restarted.getSnapshot().favorites.length, 2);
	assert.equal(parseFavorites(f.files.get(MAIN)).revision, 2);
	const last = await f.restart().load();
	assert.equal(last.loaded, true);
	assert.equal(last.writable, true);
	assert.equal(last.favorites.length, 2);
	assert(
		f.operations.every(
			([, path]) => path === 'WereadData' || path.startsWith('WereadData/favorites')
		)
	);
	assert(![...f.files.values()].join('').includes('cookies'));
});

test('rapid duplicate adds are idempotent; remove, repeat removal and restore persist tombstones and original snapshots', async (t) => {
	const f = fixture(t);
	await Promise.all(Array.from({ length: 15 }, () => f.service.setFavorite(note(), true)));
	assert.equal(parseFavorites(f.files.get(MAIN)).revision, 1);
	const original = f.service.getSnapshot().favorites[0];
	await Promise.all([f.service.remove(original.id), f.service.remove(original.id)]);
	let disk = parseFavorites(f.files.get(MAIN));
	assert.equal(disk.revision, 2);
	assert(disk.records[0].deletedAt > original.updatedAt);
	assert.equal(f.service.isFavorite(original.id), false);
	assert.equal(f.service.getSnapshot().favorites.length, 0);
	await f.service.setFavorite(note('one', { text: 'Source changed' }), true);
	assert.deepEqual(f.service.getSnapshot().favorites[0].note, original.note);
	await f.service.setFavorite(note(), false);
	await f.service.restore(original);
	disk = parseFavorites(f.files.get(MAIN));
	assert.equal(disk.records.length, 1);
	assert.equal(disk.records[0].deletedAt, undefined);
	assert.equal(disk.records[0].favoritedAt, original.favoritedAt);
	assert.deepEqual(disk.records[0].note, original.note);
});

test('subscriber snapshots are isolated and throwing/reentrant subscribers cannot break the write queue', async (t) => {
	const f = fixture(t);
	let reentered = false;
	let nested;
	f.service.subscribe((state) => {
		state.favorites.forEach((entry) => {
			entry.note.text = 'tampered';
		});
		if (state.pendingIds.length && !reentered) {
			reentered = true;
			nested = f.service.setFavorite(note('two'), true);
		}
		throw new Error('view failure');
	});
	await f.service.setFavorite(note(), true);
	await nested;
	assert.equal(f.service.getSnapshot().favorites.length, 2);
	assert(
		f.service.getSnapshot().favorites.every((entry) => entry.note.text === 'Frozen highlight')
	);
	assert.equal(parseFavorites(f.files.get(MAIN)).revision, 2);
});

test('valid previous backup recovers corruption only after preserving original exact bytes', async (t) => {
	const corrupt = '{ broken original';
	const f = fixture(t, [
		[MAIN, corrupt],
		[BACKUP, document()]
	]);
	const state = await f.service.load();
	assert.equal(state.writable, true);
	assert.equal(state.favorites.length, 1);
	assert(state.warning);
	const preserved = [...f.files].find(([path]) => path.includes('favorites.corrupt.'));
	assert.equal(preserved[1], corrupt);
	assert.equal(f.files.get(MAIN), document());
	assert(
		f.operations.findIndex(([kind, path]) => kind === 'write' && path === preserved[0]) <
			f.operations.findIndex(([kind, path]) => kind === 'write' && path === MAIN)
	);
	await f.service.setFavorite(note('two'), true);
	assert.equal(parseFavorites(f.files.get(MAIN)).revision, 2);
});

test('future schema stays read-only despite valid older backup and is never changed', async (t) => {
	const future = document([], 99, 3);
	const f = fixture(t, [
		[MAIN, future],
		[BACKUP, document()]
	]);
	const state = await f.service.load();
	assert.equal(state.writable, false);
	assert.match(state.error, /更新版本/);
	await assert.rejects(f.service.setFavorite(note(), true));
	assert.equal(f.files.get(MAIN), future);
	assert.equal(f.operations.filter(([kind]) => kind === 'write').length, 0);
});

test('unreadable main, corrupt backup and orphan staging cannot bootstrap empty or overwrite originals', async (t) => {
	for (const initial of [
		[[MAIN, 'bad']],
		[
			[MAIN, 'bad'],
			[BACKUP, 'bad backup']
		],
		[[STAGE, 'bad stage']]
	]) {
		const f = fixture(t, initial);
		const before = [...f.files];
		assert.equal((await f.service.load()).writable, false);
		await assert.rejects(f.service.remove(note().id));
		assert.deepEqual([...f.files], before);
	}
	const f = fixture(t, [
		[MAIN, document()],
		[BACKUP, document()]
	]);
	f.faults.read = () => {
		throw new Error('permission denied: secret');
	};
	assert.equal((await f.service.load()).writable, false);
	await assert.rejects(f.service.setFavorite(note(), true));
	assert.equal(f.operations.filter(([kind]) => kind === 'write').length, 0);
	assert(!f.service.getSnapshot().error.includes('secret'));
});

test('failed quarantine preservation never replaces corrupt original', async (t) => {
	const f = fixture(t, [
		[MAIN, 'broken'],
		[BACKUP, document()]
	]);
	f.faults.write = (path, text, files) => {
		files.set(path, text.slice(0, 2));
	};
	assert.equal((await f.service.load()).writable, false);
	assert.equal(f.files.get(MAIN), 'broken');
	assert(!f.operations.some(([kind, path]) => kind === 'write' && path === MAIN));
});

test('strict validation rejects bad kinds, mismatched identity, suffixes, timestamps, duplicates and unexpected fields', async (t) => {
	for (const bad of [
		record({ note: note('one', { kind: 'thought' }) }),
		record({ id: 'other:highlight:one' }),
		record({ note: note('one', { bookId: 'wrong' }) }),
		record({ id: 'book:highlight:', note: note('', {}) }),
		record({ updatedAt: -1 }),
		record({ deletedAt: 1 }),
		record({ note: note('one', { createTime: Infinity }) }),
		record({ credentials: 'not allowed' })
	]) {
		const f = fixture(t, [[MAIN, document([bad])]]);
		assert.equal((await f.service.load()).writable, false);
		assert.equal(f.operations.filter(([kind]) => kind === 'write').length, 0);
	}
	const duplicate = fixture(t, [[MAIN, document([record(), record()])]]);
	assert.equal((await duplicate.service.load()).writable, false);
	const f = fixture(t);
	await assert.rejects(f.service.setFavorite(note('one', { kind: 'thought' }), true));
	assert(f.service.getSnapshot().error);
	assert(!f.files.has(MAIN));
});

test('staging and backup failures reject without false success, then queue retries correctly', async (t) => {
	for (const failAt of [STAGE, BACKUP]) {
		const f = fixture(t, [[MAIN, document()]]);
		await f.service.load();
		let failed = false;
		f.faults.write = (path, text, files) => {
			if (path === failAt && !failed) {
				failed = true;
				throw new Error('disk full secret');
			}
			files.set(path, text);
		};
		const first = f.service.setFavorite(note('two'), true);
		const second = f.service.setFavorite(note('three'), true);
		await assert.rejects(first);
		assert.equal(f.service.isFavorite(note('two').id), false);
		await second;
		assert.equal(f.service.isFavorite(note('three').id), true);
		assert.equal(f.service.getSnapshot().error, '');
		assert.deepEqual(f.service.getSnapshot().pendingIds, []);
	}
});

test('partial main write is not acknowledged; restart recovers last valid document and retains corrupt bytes', async (t) => {
	const f = fixture(t, [[MAIN, document()]]);
	await f.service.load();
	f.faults.write = (path, text, files) => files.set(path, path === MAIN ? '{ partial' : text);
	await assert.rejects(f.service.setFavorite(note('two'), true));
	assert.equal(f.service.getSnapshot().favorites.length, 1);
	assert.equal(f.service.isFavorite(note('two').id), false);
	assert(f.service.getSnapshot().error);
	delete f.faults.write;
	const state = await f.restart().load();
	assert.equal(state.favorites.length, 1);
	assert(state.warning);
	assert([...f.files].some(([path, text]) => path.includes('.corrupt.') && text === '{ partial'));
});

test('main read-back mismatch rejects, preserving previous UI state and a valid previous backup', async (t) => {
	const f = fixture(t, [[MAIN, document()]]);
	await f.service.load();
	let mainWritten = false;
	f.faults.write = (path, text, files) => {
		files.set(path, text);
		if (path === MAIN) mainWritten = true;
	};
	f.faults.read = (path, files) =>
		path === MAIN && mainWritten ? 'different bytes' : files.get(path);
	await assert.rejects(f.service.setFavorite(note('two'), true));
	assert.equal(f.service.getSnapshot().favorites.length, 1);
	assert.equal(f.files.get(BACKUP), document());
});

test('external valid edit and external future-schema edit are rejected without clobber and reload current data', async (t) => {
	for (const future of [false, true]) {
		const f = fixture(t, [[MAIN, document()]]);
		await f.service.load();
		const external = document(
			[record({ id: note('external').id, note: note('external') })],
			5,
			future ? 3 : 1
		);
		f.files.set(MAIN, external);
		await assert.rejects(f.service.setFavorite(note('two'), true), /外部修改/);
		assert.equal(f.files.get(MAIN), external);
		assert.equal(f.service.getSnapshot().writable, !future);
		if (!future) {
			assert.equal(f.service.isFavorite(note('external').id), true);
			await f.service.setFavorite(note('two'), true);
			assert.equal(parseFavorites(f.files.get(MAIN)).revision, 6);
		}
	}
});

test('external edit during staging is detected before backup or main overwrite', async (t) => {
	const f = fixture(t, [[MAIN, document()]]);
	await f.service.load();
	const external = document([record()], 20);
	f.faults.write = (path, text, files) => {
		files.set(path, text);
		if (path === STAGE) files.set(MAIN, external);
	};
	await assert.rejects(f.service.setFavorite(note('two'), true), /外部修改/);
	assert.equal(f.files.get(MAIN), external);
	assert(!f.files.has(BACKUP));
});

test('missing or renamed primary never resurrects a canceled favorite from its predecessor', async (t) => {
	for (const renamed of [false, true]) {
		const f = fixture(t);
		await f.service.setFavorite(note(), true);
		await f.service.remove(note().id);
		const canceled = f.files.get(MAIN);
		assert.equal(parseFavorites(f.files.get(BACKUP)).records[0].deletedAt, undefined);
		if (renamed) f.files.set('WereadData/favorites/renamed.canvas', canceled);
		f.files.delete(MAIN);
		const before = [...f.files];
		const state = await f.service.load(true);
		assert.equal(state.writable, false);
		assert.match(state.error, /移走或删除/);
		assert.equal(f.service.isFavorite(note().id), false);
		await assert.rejects(f.service.setFavorite(note('blocked'), true));
		await assert.rejects(f.service.ensureCanvas());
		const restarted = f.restart();
		assert.equal((await restarted.load()).writable, false);
		assert.deepEqual([...f.files], before, 'No recovery, migration or mutation writes');
		f.files.set(MAIN, canceled);
		assert.equal((await restarted.load(true)).writable, true);
		assert.equal(restarted.isFavorite(note().id), false);
		await restarted.setFavorite(note('new'), true);
		assert.equal(restarted.isFavorite(note('new').id), true);
		assert.equal(restarted.isFavorite(note().id), false);
	}
});

test('missing primary with any Canvas recovery artifact blocks legacy reimport without writes', async (t) => {
	for (const path of [BACKUP, STAGE]) {
		const legacy = JSON.stringify({ schemaVersion: 1, revision: 1, records: [record()] });
		const f = fixture(t, [
			[path, document()],
			[LEGACY, legacy]
		]);
		const before = [...f.files];
		assert.equal((await f.service.load()).writable, false);
		await assert.rejects(f.service.ensureCanvas());
		assert.deepEqual([...f.files], before);
		assert.equal(f.operations.filter(([kind]) => kind === 'write').length, 0);
	}
});

test('valid empty primary remains empty even with an active predecessor backup', async (t) => {
	const empty = '{"nodes":[],"edges":[]}';
	const f = fixture(t, [
		[MAIN, empty],
		[BACKUP, document()]
	]);
	const state = await f.service.load();
	assert.equal(state.writable, true);
	assert.deepEqual(state.favorites, []);
	assert.equal(state.warning, '');
	assert.equal(f.files.get(MAIN), empty);
	assert.equal(f.operations.filter(([kind]) => kind === 'write').length, 0);
});

test('a previously loaded native Canvas cannot disappear into a writable first-use state', async (t) => {
	const f = fixture(t, [[MAIN, document()]]);
	await f.service.load();
	f.files.delete(MAIN);
	assert.equal((await f.service.load(true)).writable, false);
	await assert.rejects(f.service.ensureCanvas());
	assert.equal(f.files.has(MAIN), false);
	assert.equal(f.operations.filter(([kind]) => kind === 'write').length, 0);
});

test('automatic previous backup stays bounded and export API is absent', async (t) => {
	const f = fixture(t);
	assert.equal(f.service.exportBackup, undefined);
	await f.service.setFavorite(note(), true);
	for (let i = 0; i < 10; i++) await f.service.setFavorite(note(String(i)), true);
	assert.equal([...f.files.keys()].filter((path) => path.includes('previous')).length, 1);
	assert.equal(parseFavorites(f.files.get(BACKUP)).revision, 10);
});

test('first-save partial main write recovers the valid empty predecessor, then retries successfully', async (t) => {
	const f = fixture(t);
	let fail = true;
	f.faults.write = (path, text, files) => {
		files.set(path, path === MAIN && fail ? '{ partial first save' : text);
	};
	await assert.rejects(f.service.setFavorite(note(), true));
	assert.equal(f.service.isFavorite(note().id), false);
	assert.equal(f.service.getSnapshot().favorites.length, 0);
	assert.equal(parseFavorites(f.files.get(BACKUP)).revision, 0);
	fail = false;
	await f.service.setFavorite(note('two'), true);
	assert.equal(f.service.isFavorite(note().id), false);
	assert.equal(f.service.isFavorite(note('two').id), true);
	assert.equal(parseFavorites(f.files.get(MAIN)).revision, 1);
});

test('no-op duplicate mutation still detects and reloads an external edit', async (t) => {
	const f = fixture(t, [[MAIN, document()]]);
	await f.service.load();
	f.files.set(MAIN, document([], 2));
	await assert.rejects(f.service.setFavorite(note(), true), /外部修改/);
	assert.equal(f.service.isFavorite(note().id), false);
	assert.equal(f.service.getSnapshot().favorites.length, 0);
	assert.equal(parseFavorites(f.files.get(MAIN)).revision, 2);
});

test('hydration reentry shares one load and always publishes isolated active state', async (t) => {
	const f = fixture(t, [[MAIN, document()]]);
	const nested = [];
	const unsubscribe = f.service.subscribe((state) => {
		if (state.loading) nested.push(f.service.load());
	});
	await Promise.all([f.service.load(), f.service.load()]);
	await Promise.all(nested);
	unsubscribe();
	assert.equal(f.operations.filter(([kind, path]) => kind === 'read' && path === MAIN).length, 1);
	assert.equal(f.service.isFavorite(note().id), true);
	assert.equal(f.service.getSnapshot().writable, true);
});

test('invalid public mutation arguments reject asynchronously, set state error and never persist', async (t) => {
	const f = fixture(t);
	for (const work of [
		() => f.service.setFavorite(null, true),
		() => f.service.setFavorite(note(), undefined),
		() => f.service.restore(null),
		() => f.service.remove(''),
		() => f.service.restore(record({ updatedAt: NaN }))
	]) {
		const result = work();
		assert(result instanceof Promise);
		await assert.rejects(result);
		assert(f.service.getSnapshot().error);
	}
	assert(!f.files.has(MAIN));
});

test('dispose blocks new work while all accepted writes finish consistently', async (t) => {
	const f = fixture(t);
	const accepted = [
		f.service.setFavorite(note(), true),
		f.service.setFavorite(note('two'), true)
	];
	f.service.dispose();
	await assert.rejects(f.service.setFavorite(note('three'), true), /关闭/);
	await assert.rejects(f.service.load(), /关闭/);
	await Promise.all(accepted);
	assert.equal(parseFavorites(f.files.get(MAIN)).records.length, 2);
	assert.equal((await f.restart().load()).favorites.length, 2);
});
