import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';
import { build } from 'esbuild';

const compiled = await build({
	stdin: {
		contents: `export * from './src/favoritesCanvas'; export * from './src/favoritesRepository';`,
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
	serializeFavoritesCanvas: encode,
	parseFavorites: decode,
	hasMissingFavoriteCovers,
	parseLegacyFavorites,
	FavoritesRepository,
	FAVORITES_PATH: MAIN,
	FAVORITES_BACKUP_PATH: BACKUP,
	FAVORITES_STAGING_PATH: STAGE,
	LEGACY_FAVORITES_PATH: LEGACY,
	LEGACY_FAVORITES_BACKUP_PATH: OLD_BACKUP
} = module.exports;
const entry = (id = 'one', text = 'A quotation') => ({
	id: `book:highlight:${id}`,
	note: {
		id: `book:highlight:${id}`,
		bookId: 'book',
		bookTitle: 'A book',
		author: 'Author',
		kind: 'highlight',
		text,
		createTime: 1700000000000
	},
	favoritedAt: 1700000000001,
	updatedAt: 1700000000001
});
const doc = (records = [entry()], revision = 1) => ({ schemaVersion: 1, revision, records });
const card = (root) => root.nodes.find((node) => node.text?.includes('<!-- weread-favorite:'));
const header = (root) => root.nodes.find((node) => node.text?.includes('<!-- weread-favorites:'));
const free = (id = 'free', type = 'text') => ({
	id,
	type,
	x: -500,
	y: 700,
	width: 450,
	height: 250,
	...(type === 'text'
		? { text: 'Personal annotation' }
		: type === 'file'
			? { file: 'notes/own.md' }
			: type === 'link'
				? { url: 'https://example.test' }
				: { label: 'Group' })
});
const metadata = (prefix, value) =>
	`<!-- ${prefix}:${encodeURIComponent(JSON.stringify(value))} -->`;

function fixture(initial = []) {
	const files = new Map(initial);
	const writes = [];
	const adapter = {
		exists: async (path) => files.has(path),
		mkdir: async (path) => files.set(path, ''),
		read: async (path) => files.get(path),
		write: async (path, text) => {
			writes.push(path);
			files.set(path, text);
		}
	};
	return { files, writes, repository: new FavoritesRepository(adapter) };
}

const COVER_START = '<!-- weread-favorite-cover -->';
const COVER_END = '<!-- /weread-favorite-cover -->';
const withCover = (url = 'https://images.example.test/book.jpg', text = 'A quotation') => {
	const record = entry('one', text);
	record.note.cover = url;
	return record;
};
function oldCoverCanvas(record) {
	const withoutCover = { ...record, note: { ...record.note, cover: undefined } };
	const root = JSON.parse(encode(doc([withoutCover])));
	card(root).text =
		`${record.note.text}\n\n<!-- weread-favorite-footer -->\n\nNative custom footer\n\n${metadata('weread-favorite', { schemaVersion: 1, record })}`;
	return root;
}

test('native cover is bounded at card top and never enters exact quotation snapshots', () => {
	for (const url of [
		'https://images.example.test/a.jpg?size=80',
		'http://images.example.test/a.jpg',
		'//images.example.test/a.jpg'
	]) {
		const record = withCover(url, '![own image](https://example.test/own.png)\n\nQuote body');
		const raw = encode(doc([record]));
		const node = card(JSON.parse(raw));
		assert(node.text.startsWith(`${COVER_START}\n\n![封面|80](<http`));
		assert.equal(node.height, 400);
		assert.deepEqual(decode(raw), doc([record]));
		assert.equal(hasMissingFavoriteCovers(raw), false);
		const saved = encode(doc([record], 2), raw);
		assert.deepEqual(card(JSON.parse(saved)), node);
		assert.equal(node.text.split('![封面|80]').length - 1, 1);
	}
});

test('unsafe or absent cover URLs render no generated image and need no presentation update', () => {
	for (const url of [
		undefined,
		'',
		'javascript:alert(1)',
		'data:image/png;base64,AAAA',
		'file:///tmp/a.png',
		'obsidian://open',
		'ftp://example.test/a.jpg',
		'/local.jpg',
		'https://user:password@example.test/a.jpg',
		'https://example.test/a>image',
		'https://example.test/a\nimage',
		'https://example.test/a image',
		'https://example.test/\\unsafe',
		'https://'
	]) {
		const record = withCover(url);
		if (url === undefined) delete record.note.cover;
		const raw = encode(doc([record]));
		assert(!card(JSON.parse(raw)).text.includes(COVER_START));
		assert.deepEqual(decode(raw), doc([record]));
		assert.equal(hasMissingFavoriteCovers(raw), false);
		assert.equal(hasMissingFavoriteCovers(JSON.stringify(oldCoverCanvas(record))), false);
	}
});

test('owned cover stripping never removes a quote beginning with literal image or marker text', () => {
	const quote = `${COVER_START}\n\n![封面|80](<https://example.test/literal.jpg>)\n\n${COVER_END}\n\nLiteral quote after markers`;
	for (const cover of [undefined, 'https://images.example.test/book.jpg']) {
		const record = withCover(cover, quote);
		if (cover === undefined) delete record.note.cover;
		const old = JSON.stringify(oldCoverCanvas(record));
		assert.equal(decode(old).records[0].note.text, quote);
		const upgraded = encode(doc([record], 2), old);
		assert.equal(decode(upgraded).records[0].note.text, quote);
		assert.equal(decode(encode(doc([record], 3), upgraded)).records[0].note.text, quote);
	}
});

test('old-card cover retrofit preserves native body/footer, geometry, color, free nodes and edges', () => {
	const root = oldCoverCanvas(withCover());
	Object.assign(card(root), { x: -532, y: 81, width: 702, height: 177, color: '5' });
	card(root).text = card(root).text.replace('A quotation', '**Edited native quote**');
	root.nodes.push(free());
	root.edges.push({ id: 'own-edge', fromNode: card(root).id, toNode: 'free' });
	const before = JSON.stringify(root);
	assert.equal(hasMissingFavoriteCovers(before), true);
	const document = decode(before);
	const upgraded = encode({ ...document, revision: 2 }, before);
	const next = JSON.parse(upgraded);
	for (const key of ['id', 'x', 'y', 'width', 'height', 'color'])
		assert.equal(card(next)[key], card(root)[key]);
	assert(card(next).text.includes('Native custom footer'));
	assert(card(next).text.includes('**Edited native quote**'));
	assert.deepEqual(
		next.nodes.find((node) => node.id === 'free'),
		free()
	);
	assert.deepEqual(next.edges, root.edges);
	assert.equal(decode(upgraded).records[0].note.text, '**Edited native quote**');
	assert.equal(hasMissingFavoriteCovers(upgraded), false);
	assert.deepEqual(card(JSON.parse(encode({ ...document, revision: 3 }, upgraded))), card(next));
});

test('native cover width/image edits survive unrelated saves while quote edits still update plugin text', () => {
	const root = JSON.parse(encode(doc([withCover()])));
	card(root).text = card(root)
		.text.replace('![封面|80]', '![封面|124]')
		.replace('A quotation', 'Edited body\n![own](https://example.test/own.jpg)');
	card(root).text = card(root).text.replace(
		'https://images.example.test/book.jpg',
		'https://images.example.test/custom.jpg'
	);
	const raw = JSON.stringify(root);
	const decoded = decode(raw);
	assert.equal(decoded.records[0].note.text, 'Edited body\n![own](https://example.test/own.jpg)');
	const saved = encode(
		{ ...decoded, revision: 2, records: [...decoded.records, entry('two')] },
		raw
	);
	assert.deepEqual(card(JSON.parse(saved)), card(root));
	assert.equal(hasMissingFavoriteCovers(saved), false);
});

test('malformed cover envelope flags and damaged owned wrappers stay protected read-only', async () => {
	for (const flag of ['true', 1, null, true]) {
		const root = oldCoverCanvas(withCover());
		card(root).text =
			card(root).text.slice(0, card(root).text.lastIndexOf('<!-- weread-favorite:')) +
			metadata('weread-favorite', { schemaVersion: 1, record: withCover(), cover: flag });
		const raw = JSON.stringify(root);
		const f = fixture([
			[MAIN, raw],
			[BACKUP, encode(doc())]
		]);
		await assert.rejects(f.repository.load());
		assert.equal(f.files.get(MAIN), raw);
		assert.equal(f.writes.length, 0);
	}
});

test('repository detects cover retrofit once and preserves its exact predecessor backup', async () => {
	const old = JSON.stringify(oldCoverCanvas(withCover()));
	const f = fixture([[MAIN, old]]);
	assert.equal(f.repository.needsPresentationUpdate(), false);
	const loaded = await f.repository.load();
	assert.equal(f.repository.needsPresentationUpdate(), true);
	assert.equal(f.writes.length, 0);
	await f.repository.save({ ...loaded.document, revision: loaded.document.revision + 1 });
	assert.equal(f.repository.needsPresentationUpdate(), false);
	assert.equal(f.files.get(BACKUP), old);
	assert.deepEqual(decode(f.files.get(MAIN)).records, loaded.document.records);
});

test('legacy conversion, removal and restore include covers without reintroducing inactive cards', async () => {
	const record = withCover();
	const f = fixture([[LEGACY, JSON.stringify(doc([record]))]]);
	await f.repository.load();
	assert(card(JSON.parse(f.files.get(MAIN))).text.startsWith(COVER_START));
	assert.equal(f.repository.needsPresentationUpdate(), false);
	const deleted = { ...record, updatedAt: record.updatedAt + 1, deletedAt: record.updatedAt + 1 };
	await f.repository.save(doc([deleted], 2));
	assert.equal(card(JSON.parse(f.files.get(MAIN))), undefined);
	assert.equal(f.repository.needsPresentationUpdate(), false);
	await f.repository.save(doc([record], 3));
	const restored = card(JSON.parse(f.files.get(MAIN)));
	assert.equal(restored.text.split('![封面|80]').length - 1, 1);
	assert.equal(decode(f.files.get(MAIN)).records[0].note.text, record.note.text);
});

test('optional native nodes and edges normalize to empty arrays without relying on extensions', () => {
	for (const root of [{}, { nodes: [] }, { edges: [] }]) {
		assert.deepEqual(decode(JSON.stringify(root)), doc([], 0));
		assert.deepEqual(decode(encode(doc([], 1), JSON.stringify(root))), doc([], 1));
	}
	const ownNode = free();
	const raw = JSON.stringify({ nodes: [ownNode] });
	assert.deepEqual(decode(raw), doc([], 0));
	const saved = JSON.parse(encode(doc([entry()], 1), raw));
	assert.deepEqual(
		saved.nodes.find((node) => node.id === ownNode.id),
		ownNode
	);
	assert.deepEqual(saved.edges, []);
	assert.equal(decode(JSON.stringify(saved)).records.length, 1);
	for (const key of ['nodes', 'edges']) {
		for (const value of [null, false, 0, '', {}, '[]']) {
			const invalid = JSON.stringify({ [key]: value });
			assert.throws(() => decode(invalid));
			assert.throws(() => encode(doc([], 1), invalid));
		}
	}
});

test('native JSON Canvas has only standard root/nodes/edges and roundtrips exact favorite metadata', () => {
	const raw = encode(doc());
	const root = JSON.parse(raw);
	assert.deepEqual(Object.keys(root).sort(), ['edges', 'nodes']);
	for (const node of root.nodes) {
		assert.deepEqual(Object.keys(node).sort(), [
			'height',
			'id',
			'text',
			'type',
			'width',
			'x',
			'y'
		]);
		assert.equal(node.type, 'text');
		assert(Number.isFinite(node.x) && Number.isFinite(node.y));
	}
	assert.deepEqual(decode(raw), doc());
	assert.equal(card(root).text.split('A quotation').length - 1, 1);
	assert(!card(root).text.includes('"schemaVersion"'));
	assert.deepEqual(decode(encode(doc(), raw)), doc());
});

test('native move/resize/color, unknown properties, free node kinds and edges survive an unrelated addition', () => {
	const root = JSON.parse(encode(doc()));
	Object.assign(card(root), {
		x: -100,
		y: 45,
		width: 900,
		height: 180,
		color: '#aabbcc',
		custom: { own: true }
	});
	root.nodes.push(free(), free('file', 'file'), free('link', 'link'), free('group', 'group'));
	root.edges.push({
		id: 'edge',
		fromNode: card(root).id,
		toNode: 'free',
		fromSide: 'right',
		toEnd: 'arrow',
		label: 'Related'
	});
	root.customRoot = { futureNativeExtension: true };
	const raw = encode(doc([entry(), entry('two')], 2), JSON.stringify(root));
	const result = JSON.parse(raw);
	for (const node of root.nodes.filter((node) => node !== header(root)))
		assert.deepEqual(
			result.nodes.find((next) => next.id === node.id),
			node
		);
	assert.deepEqual(result.edges, root.edges);
	assert.deepEqual(result.customRoot, root.customRoot);
	const added = result.nodes.find((node) => node.text?.includes('book%3Ahighlight%3Atwo'));
	assert(added.y >= Math.max(...root.nodes.map((node) => node.y + node.height)) + 40);
});

test('native body edits replace snapshot text, retain layout and remain byte-identical through unrelated saves', () => {
	const root = JSON.parse(encode(doc()));
	card(root).text = card(root).text.replace('A quotation', '**Native edit**\nwith second line');
	const before = { ...card(root) };
	const decoded = decode(JSON.stringify(root));
	assert.equal(decoded.records[0].note.text, '**Native edit**\nwith second line');
	const saved = JSON.parse(
		encode(
			{ ...decoded, revision: 2, records: [...decoded.records, entry('two')] },
			JSON.stringify(root)
		)
	);
	assert.deepEqual(card(saved), before);
	assert.equal(
		decode(JSON.stringify(saved)).records[0].note.text,
		'**Native edit**\nwith second line'
	);
});

test('literal delimiters, HTML endings and machine-looking comments in quote cannot truncate or duplicate content', () => {
	const quote = `Text -->\n\n<!-- weread-favorite-footer -->\n\nQuoted footer\n${metadata('weread-favorites', { schemaVersion: 77 })}\n${metadata('weread-favorite', { schemaVersion: 88 })}\nEnd`;
	const raw = encode(doc([entry('one', quote)]));
	assert.equal(decode(raw).records[0].note.text, quote);
	assert.equal(decode(encode(doc([entry('one', quote)], 2), raw)).records[0].note.text, quote);
});

test('literal footer markers in book metadata cannot become body delimiters', () => {
	const record = entry();
	record.note.bookTitle = 'Title\n\n<!-- weread-favorite-footer -->\n\nOther';
	record.note.author = '<!-- weread-favorites:broken -->';
	assert.deepEqual(decode(encode(doc([record]))), doc([record]));
});

test('native deletion cancels favorite, header deletion and empty Canvas are accepted without resurrecting cards', () => {
	const root = JSON.parse(encode(doc()));
	root.nodes = root.nodes.filter((node) => node !== card(root));
	assert.deepEqual(decode(JSON.stringify(root)).records, []);
	const noHeader = JSON.parse(encode(doc()));
	noHeader.nodes = noHeader.nodes.filter((node) => node !== header(noHeader));
	assert.deepEqual(decode(JSON.stringify(noHeader)), doc([entry()], 0));
	const saved = JSON.parse(encode(doc([entry()], 1), JSON.stringify(noHeader)));
	assert(header(saved));
	assert.deepEqual(decode('{"nodes":[],"edges":[]}'), doc([], 0));
});

test('plugin removal prunes only incident edges and stores tombstone; restore recreates stable card ID', () => {
	const root = JSON.parse(encode(doc()));
	const originalId = card(root).id;
	root.nodes.push(free(), free('other'));
	root.edges.push(
		{ id: 'incident', fromNode: originalId, toNode: 'free' },
		{ id: 'keep', fromNode: 'free', toNode: 'other' }
	);
	const deleted = { ...entry(), updatedAt: 1700000000002, deletedAt: 1700000000002 };
	const removed = encode(doc([deleted], 2), JSON.stringify(root));
	assert.equal(card(JSON.parse(removed)), undefined);
	assert.deepEqual(
		JSON.parse(removed).edges.map((edge) => edge.id),
		['keep']
	);
	assert.deepEqual(decode(removed).records, [deleted]);
	const restored = encode(doc([entry()], 3), removed);
	assert.equal(card(JSON.parse(restored)).id, originalId);
	assert.equal(decode(restored).records[0].deletedAt, undefined);
});

test('damaged managed metadata, future metadata and invalid native structures are rejected', () => {
	const valid = JSON.parse(encode(doc()));
	for (const mutate of [
		(root) => {
			card(root).text += 'broken trailing bytes';
		},
		(root) => {
			card(root).text = '<!-- weread-favorite:broken -->';
		},
		(root) => {
			card(root).text = metadata('weread-favorite', { schemaVersion: 2, record: entry() });
		},
		(root) => {
			header(root).text = metadata('weread-favorites', {
				schemaVersion: 2,
				revision: 1,
				tombstones: []
			});
		},
		(root) => {
			card(root).width = -1;
		},
		(root) => {
			card(root).x = null;
		},
		(root) => {
			root.nodes.push({ ...card(root) });
		},
		(root) => {
			root.edges.push({ id: 'bad', fromNode: 'missing', toNode: card(root).id });
		},
		(root) => {
			header(root).text = metadata('weread-favorites', {
				schemaVersion: 1,
				revision: 1,
				tombstones: [entry()]
			});
		}
	]) {
		const root = structuredClone(valid);
		mutate(root);
		assert.throws(() => decode(JSON.stringify(root)));
	}
	assert.throws(() => parseLegacyFavorites(encode(doc())));
	assert.throws(() => decode(JSON.stringify(doc())));
});

test('valid JSON with unsupported native structure stays read-only without replacing newer user Canvas', async () => {
	const previous = encode(doc([entry('older')], 1));
	for (const mutate of [
		(root) => {
			card(root).width = null;
		},
		(root) => {
			root.nodes = null;
		},
		(root) => {
			root.nodes.find((node) => node.id === 'free').type = 'future-native-node';
		},
		(root) => {
			root.edges.push({ id: 'dangling', fromNode: 'free', toNode: 'missing' });
		}
	]) {
		const latest = JSON.parse(encode(doc([entry('newer')], 2)));
		card(latest).x = 712;
		latest.nodes.push(free());
		mutate(latest);
		const raw = JSON.stringify(latest);
		const f = fixture([
			[MAIN, raw],
			[BACKUP, previous]
		]);
		const before = [...f.files];
		await assert.rejects(f.repository.load());
		await assert.rejects(f.repository.verifyCurrent());
		assert.deepEqual([...f.files], before);
		assert.equal(f.writes.length, 0);
	}
});

test('damaged or future native metadata stays untouched despite a valid backup', async () => {
	for (const future of [false, true]) {
		const root = JSON.parse(encode(doc()));
		card(root).text = future
			? metadata('weread-favorite', { schemaVersion: 2, record: entry() })
			: '<!-- weread-favorite:broken -->';
		const raw = JSON.stringify(root);
		const f = fixture([
			[MAIN, raw],
			[BACKUP, encode(doc())]
		]);
		await assert.rejects(f.repository.load());
		assert.equal(f.files.get(MAIN), raw);
		assert.equal(f.writes.length, 0);
	}
});

test('legacy migration verifies Canvas and never changes original JSON bytes, including corrupt source recovered from backup', async () => {
	for (const corrupt of [false, true]) {
		const original = corrupt ? 'corrupt original bytes' : JSON.stringify(doc(), null, 4);
		const f = fixture([
			[LEGACY, original],
			[OLD_BACKUP, JSON.stringify(doc())]
		]);
		const result = await f.repository.load();
		assert.deepEqual(result.document, doc());
		assert(result.warning);
		assert.deepEqual(decode(f.files.get(MAIN)), doc());
		assert.equal(f.files.get(LEGACY), original);
		assert.equal(f.files.get(OLD_BACKUP), JSON.stringify(doc()));
		assert(!f.writes.includes(LEGACY));
		assert(f.writes.indexOf(STAGE) < f.writes.indexOf(MAIN));
	}
});

test('empty existing Canvas prevents legacy reimport; invalid/future Canvas and orphan staging block migration', async () => {
	const f = fixture([
		[LEGACY, JSON.stringify(doc())],
		[MAIN, '{"nodes":[],"edges":[]}']
	]);
	assert.deepEqual((await f.repository.load()).document.records, []);
	assert.equal(f.writes.length, 0);
	for (const initial of [[[MAIN, 'broken']], [[STAGE, 'partial']], [[BACKUP, 'broken']]]) {
		const f = fixture([[LEGACY, JSON.stringify(doc())], ...initial]);
		await assert.rejects(f.repository.load());
		assert.equal(f.writes.length, 0);
	}
});

test('legacy future/corrupt without valid backup stays read-only; empty load does not write', async () => {
	for (const original of ['broken', JSON.stringify({ ...doc(), schemaVersion: 2 })]) {
		const f = fixture([[LEGACY, original]]);
		await assert.rejects(f.repository.load());
		assert.equal(f.writes.length, 0);
	}
	const future = fixture([
		[LEGACY, JSON.stringify({ ...doc(), schemaVersion: 2 })],
		[OLD_BACKUP, JSON.stringify(doc())]
	]);
	await assert.rejects(future.repository.load(), /更新版本/);
	assert.equal(future.writes.length, 0);
	const empty = fixture();
	assert.deepEqual((await empty.repository.load()).document, doc([], 0));
	assert.equal(await empty.repository.hasPrimary(), false);
	assert.equal(empty.writes.length, 0);
	await empty.repository.save(doc([], 1));
	assert.equal(await empty.repository.hasPrimary(), true);
	assert.deepEqual(decode(empty.files.get(MAIN)), doc([], 1));
});
