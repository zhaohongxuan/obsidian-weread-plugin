// Real journal DTOs cross the production favorite service and Canvas persistence boundary.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';
import { build } from 'esbuild';

const compiled = await build({
	stdin: {
		contents: `export { WereadFavoritesService } from './src/favorites'; export { parseJournalNotes } from './src/journalHelpers'; export { parseFavorites } from './src/favoritesRepository';`,
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
const { WereadFavoritesService, parseJournalNotes, parseFavorites } = module.exports;

function fixture(t) {
	const files = new Map();
	const writes = [];
	const adapter = {
		async exists(path) {
			return files.has(path);
		},
		async read(path) {
			if (!files.has(path)) throw Error('missing');
			return files.get(path);
		},
		async write(path, raw) {
			writes.push(path);
			files.set(path, raw);
		},
		async mkdir(path) {
			files.set(path, '<directory>');
		}
	};
	const create = () => {
		const service = new WereadFavoritesService({ app: { vault: { adapter } } });
		t.after(() => service.dispose());
		return service;
	};
	return { service: create(), create, files, writes };
}
function anniversaryNote(bookType) {
	const [note] = parseJournalNotes(
		{
			bookId: 'typed-book',
			book: { title: 'Synthetic book', author: 'Synthetic author', type: bookType }
		},
		{
			chapters: [{ chapterUid: 9, title: 'Synthetic chapter' }],
			updated: [
				{
					bookmarkId: 'anniversary-highlight',
					markText: 'Synthetic anniversary highlight',
					createTime: Date.UTC(2024, 10, 9, 12) / 1000,
					chapterUid: 9,
					range: '10-24'
				}
			]
		},
		{ reviews: [] }
	);
	assert(note && note.kind === 'highlight');
	assert.equal(note.bookType, bookType);
	return note;
}

for (const bookType of [0, 3]) {
	test(`anniversary journal metadata type ${bookType} survives favorite add, restart, remove and undo without changing storage schema`, async (t) => {
		const f = fixture(t),
			source = anniversaryNote(bookType);
		await f.service.setFavorite(source, true);
		const saved = f.service.getSnapshot().favorites[0];
		assert.equal(saved.note.id, source.id);
		assert.equal(saved.note.sourceUrl, source.sourceUrl);
		assert.equal(
			source.bookType,
			bookType,
			'Favoriting cannot remove metadata from the journal cache'
		);
		assert(
			!Object.hasOwn(saved.note, 'bookType'),
			'Runtime-only book classification is not part of the durable favorite snapshot'
		);
		const raw = f.files.get('favorites.canvas');
		assert.equal(parseFavorites(raw).schemaVersion, 1);
		assert(!raw.includes('bookType'));
		const restarted = f.create();
		const state = await restarted.load();
		assert.equal(state.writable, true);
		assert.equal(state.favorites.length, 1);
		assert.deepEqual(state.favorites[0], saved);
		await restarted.setFavorite(source, false);
		assert.equal(restarted.getSnapshot().favorites.length, 0);
		await restarted.restore(saved);
		assert.deepEqual(restarted.getSnapshot().favorites[0].note, saved.note);
		assert(!f.files.get('favorites.canvas').includes('bookType'));
	});
}

test('runtime metadata normalization keeps arbitrary-field rejection and existing native Canvas content intact', async (t) => {
	const f = fixture(t),
		source = anniversaryNote(0);
	const { bookType, ...oldSnapshot } = source;
	await f.service.setFavorite(oldSnapshot, true);
	const graph = JSON.parse(f.files.get('favorites.canvas'));
	graph.nodes.push({
		id: 'manual-content',
		type: 'text',
		x: 900,
		y: 500,
		width: 200,
		height: 100,
		text: 'Preserve manually authored content'
	});
	const existing = graph.nodes.find((n) => n.id !== 'manual-content');
	graph.edges.push({ id: 'manual-edge', fromNode: 'manual-content', toNode: existing.id });
	f.files.set('favorites.canvas', JSON.stringify(graph));
	await f.service.load(true);
	const before = f.files.get('favorites.canvas'),
		writes = f.writes.length;
	for (const field of ['credentials', 'cookie', 'unexpected']) {
		await assert.rejects(
			f.service.setFavorite({ ...source, [field]: 'must-not-persist' }, true),
			/收藏数据包含不支持的字段/
		);
		assert.equal(f.files.get('favorites.canvas'), before);
		assert.equal(f.writes.length, writes);
	}
	await f.service.setFavorite({ ...source, id: 'typed-book:highlight:second' }, true);
	const persisted = JSON.parse(f.files.get('favorites.canvas'));
	assert.deepEqual(
		persisted.nodes.find((n) => n.id === 'manual-content'),
		graph.nodes.at(-1)
	);
	assert.deepEqual(
		persisted.edges.find((e) => e.id === 'manual-edge'),
		graph.edges.at(-1)
	);
	assert.equal(
		parseFavorites(f.files.get('favorites.canvas')).records.filter(
			(r) => r.deletedAt === undefined
		).length,
		2
	);
});
