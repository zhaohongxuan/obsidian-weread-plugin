// All persistence is synthetic and in memory; never connect to an installed vault.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';
import { build } from 'esbuild';

const compiled = await build({
	stdin: {
		contents:
			"export * from './src/favorites'; export * from './src/favoritesRepository'; export * from './src/favoritesCanvas';",
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
	FavoritesRepository,
	favoritesPaths,
	validateFavoritesCanvasFolder,
	serializeFavoritesCanvas,
	parseFavorites,
	LEGACY_CANVAS_PATH
} = module.exports;
const oldFolder = 'WereadData/favorites';
const old = favoritesPaths(oldFolder);
const root = favoritesPaths();
const note = (id = 'one') => ({
	id: `42:highlight:${id}`,
	bookId: '42',
	bookTitle: 'Synthetic book',
	author: 'Author',
	kind: 'highlight',
	text: `Quote ${id}`,
	createTime: 1700000000000
});
const record = (id = 'one', deleted = false) => ({
	id: note(id).id,
	note: note(id),
	favoritedAt: 1700000000001,
	updatedAt: 1700000000002,
	...(deleted ? { deletedAt: 1700000000002 } : {})
});
const rawCanvas = () => {
	const value = JSON.parse(
		serializeFavoritesCanvas({
			schemaVersion: 1,
			revision: 4,
			records: [record(), record('canceled', true)]
		})
	);
	value.nodes.push({
		id: 'my-free-node',
		type: 'text',
		x: -567,
		y: 888,
		width: 321,
		height: 222,
		text: 'Exact personal text\n'
	});
	value.edges.push({
		id: 'my-free-edge',
		fromNode: value.nodes[0].id,
		toNode: 'my-free-node',
		label: 'My relation'
	});
	return JSON.stringify(value, null, 3) + '\n';
};
function fixture(t, initial = [], settings = { folder: '', locationVersion: 0 }) {
	const files = new Map(initial);
	const dirs = new Set();
	for (const [path] of initial) {
		const parts = path.split('/');
		for (let i = 1; i < parts.length; i++) dirs.add(parts.slice(0, i).join('/'));
	}
	const operations = [],
		commits = [],
		faults = {},
		views = [],
		services = [];
	const events = new Map();
	const adapter = {
		async exists(path) {
			operations.push(['exists', path]);
			return files.has(path) || dirs.has(path);
		},
		async list(folder) {
			operations.push(['list', folder]);
			const prefix = folder ? folder + '/' : '';
			return {
				files: [...files.keys()].filter(
					(p) => p.startsWith(prefix) && !p.slice(prefix.length).includes('/')
				),
				folders: []
			};
		},
		async mkdir(path) {
			operations.push(['mkdir', path]);
			dirs.add(path);
		},
		async read(path) {
			operations.push(['read', path]);
			if (faults.read) return faults.read(path, files);
			if (!files.has(path)) throw new Error('missing synthetic file');
			return files.get(path);
		},
		async write(path, raw) {
			operations.push(['write', path]);
			if (faults.write) return faults.write(path, raw, files);
			files.set(path, raw);
		}
	};
	const emit = (event, ...args) => {
		for (const fn of events.get(event) || []) fn(...args);
	};
	const vault = {
		adapter,
		on(event, fn) {
			if (!events.has(event)) events.set(event, new Set());
			events.get(event).add(fn);
			return { event, fn };
		},
		offref(ref) {
			events.get(ref.event).delete(ref.fn);
		}
	};
	const plugin = {
		app: { vault, workspace: { getLeavesOfType: () => views.map((view) => ({ view })) } }
	};
	const commitLocation = async (folder, version) => {
		commits.push([folder, version]);
		if (faults.commit) await faults.commit(folder);
		settings.folder = folder;
		settings.locationVersion = version;
	};
	const restart = (override = {}) => {
		const service = new WereadFavoritesService(plugin, {
			...settings,
			commitLocation,
			...override
		});
		services.push(service);
		return service;
	};
	t.after(() => services.forEach((s) => s.dispose()));
	return { files, dirs, operations, commits, faults, views, restart, adapter, emit, settings };
}

test('folder contract joins root/nested paths and rejects unsafe values before any I/O', async (t) => {
	assert.equal(root.primary, 'favorites.canvas');
	assert.equal(favoritesPaths(' Books/收藏 ').primary, 'Books/收藏/favorites.canvas');
	for (const folder of [
		null,
		42,
		'/absolute',
		'/',
		'../escape',
		'a/../b',
		'a/./b',
		'a//b',
		'a/',
		'C:/escape',
		'file:///tmp',
		'\\server',
		'a\\b',
		'~home',
		'a\0b',
		'a\nb'
	]) {
		assert.throws(() => validateFavoritesCanvasFolder(folder));
		const f = fixture(t);
		const service = f.restart({ folder, locationVersion: 1 });
		assert.equal((await service.load()).writable, false);
		assert.equal(f.operations.length, 0);
	}
	const f = fixture(t);
	await assert.rejects(f.restart().changeCanvasFolder('../escape'));
	assert.equal(f.operations.length, 0);
});

test('first empty load selects root without creating folders or Canvas files', async (t) => {
	const f = fixture(t);
	assert.equal((await f.restart().load()).writable, true);
	assert.deepEqual(f.commits, [['', 1]]);
	assert.equal(f.files.size, 0);
	assert.equal(f.dirs.size, 0);
});

test('default upgrade copies exact native bytes, tombstones, recovery files and immutable history', async (t) => {
	const raw = rawCanvas();
	const initial = [
		[old.primary, raw],
		[old.backup, '{invalid predecessor bytes'],
		[old.staging, 'unfinished staging'],
		[old.legacy, 'original JSON bytes'],
		[`${oldFolder}/favorites.before-book-graph.123.0.canvas`, 'archived original bytes'],
		[`${oldFolder}/favorites.corrupt.124.0.canvas`, 'corrupt quarantine']
	];
	const f = fixture(t, initial);
	const service = f.restart();
	const state = await service.load();
	assert.equal(state.writable, true);
	assert.equal(state.favorites.length, 1);
	assert.equal(service.isFavorite(note('canceled').id), false);
	for (const [path, bytes] of initial) {
		assert.equal(f.files.get(path), bytes, 'source stays exact');
		assert.equal(
			f.files.get(path.slice(oldFolder.length + 1)),
			bytes,
			'every recognized artifact follows folder'
		);
	}
	const baseline = [...f.files].find(([p]) => p.startsWith('favorites.before-location-change.'));
	assert.equal(baseline[1], raw);
	assert.equal(service.getCanvasPath(), root.primary);
	assert.deepEqual(f.commits, [['', 1]]);
	await service.setFavorite(note('later'), true);
	assert.equal(f.files.get(baseline[0]), raw, 'baseline survives rotating backups');
	assert.equal(f.files.get(old.primary), raw);
	assert.equal((await f.restart().load()).favorites.length, 2);
	f.files.delete(root.primary);
	const before = new Map(f.files);
	assert.equal((await f.restart().load()).writable, false);
	assert.deepEqual(f.files, before, 'missing primary never reimports preserved old source');
});

test('default upgrade refuses conflicts, missing old primary artifacts and unsupported old Canvas', async (t) => {
	const invalid = JSON.parse(rawCanvas());
	invalid.nodes[0].width = null;
	for (const initial of [
		[
			[old.primary, rawCanvas()],
			[root.primary, rawCanvas()]
		],
		[
			[old.primary, rawCanvas()],
			[root.staging, 'partial']
		],
		[
			[old.backup, rawCanvas()],
			[old.legacy, JSON.stringify({ schemaVersion: 1, revision: 1, records: [record()] })]
		],
		[[old.staging, 'partial']],
		[
			[old.primary, JSON.stringify(invalid)],
			[old.backup, rawCanvas()]
		],
		[[`${oldFolder}/favorites.before-location-change.1.0.canvas`, rawCanvas()]]
	]) {
		const f = fixture(t, initial),
			before = new Map(f.files);
		assert.equal((await f.restart().load()).writable, false);
		assert.deepEqual(f.files, before);
		assert.equal(f.commits.length, 0);
		assert.equal(
			f.operations.some(([op]) => op === 'write'),
			false
		);
	}
});

test('old JSON migrates through guarded legacy pipeline and is preserved at both locations', async (t) => {
	const original = JSON.stringify(
		{ schemaVersion: 1, revision: 1, records: [record()] },
		null,
		4
	);
	const f = fixture(t, [[old.legacy, original]]);
	const service = f.restart();
	assert.equal((await service.load()).writable, true);
	assert.equal(f.files.get(old.legacy), original);
	assert.equal(f.files.get(root.legacy), original);
	assert.equal(f.files.get(root.primary), f.files.get(old.primary));
});

test('native draft is flushed before migration and open source editors block copying until closed', async (t) => {
	const f = fixture(t, [[old.primary, rawCanvas()]]);
	let saves = 0;
	const draft = JSON.parse(rawCanvas());
	draft.nodes.find((n) => n.id === 'my-free-node').text = 'Saved native draft';
	const raw = JSON.stringify(draft);
	f.views.push({
		file: { path: old.primary },
		async save() {
			saves++;
			f.files.set(old.primary, raw);
		}
	});
	const service = f.restart();
	assert.equal((await service.load()).writable, false);
	assert.equal(saves, 1);
	assert.equal(f.files.get(old.primary), raw);
	assert.equal(f.files.has(root.primary), false);
	f.views.length = 0;
	assert.equal((await service.load(true)).writable, true);
	assert.equal(f.files.get(root.primary), raw);
});

test('folder changes serialize with mutations and retain the same subscribers and old bytes', async (t) => {
	const initial = rawCanvas();
	const f = fixture(t, [[root.primary, initial]], { folder: '', locationVersion: 1 });
	const service = f.restart();
	await service.load();
	const snapshots = [];
	service.subscribe((state) => snapshots.push(state));
	const first = service.setFavorite(note('before'), true);
	const moving = service.changeCanvasFolder('New/Nested');
	const last = service.setFavorite(note('after'), true);
	await Promise.all([first, moving, last]);
	const destination = favoritesPaths('New/Nested');
	assert.equal(service.getCanvasPath(), destination.primary);
	assert.equal(
		parseFavorites(f.files.get(root.primary)).records.some((r) => r.id === note('before').id),
		true
	);
	assert.equal(
		parseFavorites(f.files.get(root.primary)).records.some((r) => r.id === note('after').id),
		false
	);
	assert.equal(service.isFavorite(note('after').id), true);
	assert(snapshots.at(-1).favorites.some((r) => r.id === note('after').id));
	assert(f.dirs.has('New') && f.dirs.has('New/Nested'));
	assert.equal(await service.ensureCanvas(), destination.primary);
	assert.equal((await f.restart().load()).favorites.length, 3);
});

test('folder changes never overwrite occupied destination primary, recovery, legacy or historical bytes', async (t) => {
	for (const name of [
		'favorites.canvas',
		'favorites.canvas.previous.json',
		'favorites.canvas.staging.json',
		'favorites.json',
		'favorites.before-book-graph.1.0.canvas'
	]) {
		const f = fixture(
			t,
			[
				[root.primary, rawCanvas()],
				[`New/${name}`, 'do not overwrite']
			],
			{ folder: '', locationVersion: 1 }
		);
		const service = f.restart();
		await service.load();
		const before = new Map(f.files);
		await assert.rejects(service.changeCanvasFolder('New'));
		assert.deepEqual(f.files, before);
		assert.equal(service.getCanvasPath(), root.primary);
		assert.equal(f.commits.length, 0);
	}
});

test('copy/readback/settings failures retain old effective path and every old byte', async (t) => {
	for (const failure of ['backup', 'staging', 'baseline', 'primary', 'readback', 'settings']) {
		const raw = rawCanvas();
		const f = fixture(t, [[root.primary, raw]], { folder: '', locationVersion: 1 });
		const service = f.restart();
		await service.load();
		if (failure === 'settings')
			f.faults.commit = async () => {
				throw new Error('synthetic settings failure');
			};
		else
			f.faults.write = (path, bytes, files) => {
				const fail =
					path.startsWith('New/') &&
					((failure === 'backup' && path.includes('previous')) ||
						(failure === 'staging' && path.includes('staging')) ||
						(failure === 'baseline' && path.includes('before-location-change')) ||
						(failure === 'primary' && path === 'New/favorites.canvas') ||
						(failure === 'readback' && path === 'New/favorites.canvas'));
				if (fail && failure !== 'readback') throw new Error('synthetic disk failure');
				files.set(path, fail ? '{truncated' : bytes);
			};
		await assert.rejects(service.changeCanvasFolder('New'));
		assert.equal(f.files.get(root.primary), raw);
		assert.equal(service.getCanvasPath(), root.primary);
		assert.equal(f.settings.folder, '');
		assert.equal((await f.restart().load()).writable, true);
		delete f.faults.write;
		delete f.faults.commit;
		await service.setFavorite(note('retry'), true);
		assert.equal(service.isFavorite(note('retry').id), true);
	}
});

test('transient initial settings failure retries only the intact transfer owned by this session', async (t) => {
	for (const changed of [false, true]) {
		const original = rawCanvas();
		const f = fixture(t, [[old.primary, original]]);
		f.faults.commit = async () => {
			throw new Error('temporary settings failure');
		};
		const service = f.restart();
		assert.equal((await service.load()).writable, false);
		assert.equal(f.files.get(root.primary), original);
		const writes = f.operations.filter(([op]) => op === 'write').length;
		delete f.faults.commit;
		if (changed) f.files.set(root.primary, 'external destination bytes');
		const state = await service.load(true);
		assert.equal(state.writable, !changed);
		assert.equal(f.files.get(old.primary), original);
		assert.equal(f.files.get(root.primary), changed ? 'external destination bytes' : original);
		assert.equal(
			f.operations.filter(([op]) => op === 'write').length,
			writes,
			'retry never rewrites copies'
		);
		assert.equal(f.commits.length, changed ? 1 : 2);
	}
});

test('restart resumes a fully copied initial migration only with an intact owned transfer receipt', async (t) => {
	for (const damage of ['none', 'destination', 'source', 'extra', 'receipt']) {
		const original = rawCanvas();
		const f = fixture(t, [[old.primary, original]]);
		f.faults.commit = async () => {
			throw new Error('temporary settings failure');
		};
		assert.equal((await f.restart().load()).writable, false);
		assert.equal(f.files.get(root.primary), original);
		const receipt = [...f.files.keys()].find((p) =>
			p.startsWith('favorites.location-transfer.')
		);
		assert(receipt);
		assert(
			!f.files.get(receipt).includes('Exact personal text'),
			'receipt stores digests, not content copies'
		);
		if (damage === 'destination') f.files.set(root.primary, 'external new bytes');
		if (damage === 'source') f.files.set(old.primary, original + ' ');
		if (damage === 'extra')
			f.files.set('favorites.corrupt.external.canvas', 'external artifact');
		if (damage === 'receipt') f.files.set(receipt, '{}');
		delete f.faults.commit;
		const before = new Map(f.files);
		const writes = f.operations.filter(([op]) => op === 'write').length;
		const state = await f.restart().load();
		assert.equal(state.writable, damage === 'none');
		assert.deepEqual(
			f.files,
			before,
			'restart recovery commits settings without rewriting files'
		);
		assert.equal(f.operations.filter(([op]) => op === 'write').length, writes);
		assert.equal(f.settings.locationVersion, damage === 'none' ? 1 : 0);
	}
});

test('restart can finish an explicit folder transfer after settings persistence failed', async (t) => {
	const f = fixture(t, [[root.primary, rawCanvas()]], { folder: '', locationVersion: 1 });
	const service = f.restart();
	await service.load();
	f.faults.commit = async () => {
		throw new Error('temporary settings failure');
	};
	await assert.rejects(service.changeCanvasFolder('New'));
	delete f.faults.commit;
	const restarted = f.restart();
	await restarted.load();
	assert.equal(await restarted.changeCanvasFolder('New'), 'New/favorites.canvas');
	assert.equal(f.settings.folder, 'New');
});

test('explicit folder settings failure can retry its exact copies without a second migration', async (t) => {
	const f = fixture(t, [[root.primary, rawCanvas()]], { folder: '', locationVersion: 1 });
	const service = f.restart();
	await service.load();
	f.faults.commit = async () => {
		throw new Error('temporary settings failure');
	};
	await assert.rejects(service.changeCanvasFolder('New'));
	delete f.faults.commit;
	const writes = f.operations.filter(([op]) => op === 'write').length;
	assert.equal(await service.changeCanvasFolder('New'), 'New/favorites.canvas');
	assert.equal(f.operations.filter(([op]) => op === 'write').length, writes);
});

test('destination appearing during copy is detected without overwriting the external bytes', async (t) => {
	const f = fixture(t, [[root.primary, rawCanvas()]], { folder: '', locationVersion: 1 });
	const service = f.restart();
	await service.load();
	f.faults.write = (path, raw, files) => {
		files.set(path, raw);
		if (path.includes('before-location-change'))
			files.set('New/favorites.canvas', 'external destination');
	};
	await assert.rejects(service.changeCanvasFolder('New'));
	assert.equal(f.files.get('New/favorites.canvas'), 'external destination');
	assert.equal(f.commits.length, 0);
});

test('events follow new primary and ancestor paths while old-location events are ignored', async (t) => {
	const f = fixture(t, [[root.primary, rawCanvas()]], { folder: '', locationVersion: 1 });
	const service = f.restart();
	await service.load();
	await service.changeCanvasFolder('New/Nested');
	f.emit('delete', { path: root.primary });
	assert.equal(service.getSnapshot().writable, true);
	f.emit('rename', { path: 'Elsewhere' }, 'New');
	assert.equal(service.getSnapshot().writable, false);
});

test('an immutable location baseline alone blocks empty bootstrap after primary removal', async () => {
	const files = new Map([['favorites.before-location-change.1.0.canvas', rawCanvas()]]);
	const adapter = {
		exists: async (p) => files.has(p),
		read: async (p) => files.get(p),
		list: async () => ({ files: [...files.keys()], folders: [] })
	};
	await assert.rejects(new FavoritesRepository(adapter, '', false).load(), /已保护备份/);
});
