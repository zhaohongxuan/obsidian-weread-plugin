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
	needsFavoriteGraphUpdate,
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
const headerValue = (root) =>
	JSON.parse(
		decodeURIComponent(
			header(root).text.split('<!-- weread-favorites:').at(-1).split(' -->')[0]
		)
	);
const book = (root, bookId = 'book') =>
	root.nodes.find((node) => node.id === headerValue(root).bookNodes[bookId]);
const bookPath = (root, bookId = 'book') => {
	const target = book(root, bookId).text.match(/\[打开本地笔记\]\(<([^>]+)>\)/)?.[1];
	return target === undefined ? undefined : decodeURIComponent(target);
};
const customEdges = (root) =>
	root.edges.filter((edge) => !headerValue(root).managedEdges.includes(edge.id));
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
	root.nodes = root.nodes.filter((node) => node === card(root) || node === header(root));
	root.edges = [];
	header(root).text =
		`# 我的收藏\n\n${metadata('weread-favorites', { schemaVersion: 1, revision: 1, tombstones: [] })}`;
	card(root).text =
		`${record.note.text}\n\n<!-- weread-favorite-footer -->\n\nNative custom footer\n\n${metadata('weread-favorite', { schemaVersion: 1, record })}`;
	return root;
}

test('fallback book owns one safe cover while quotes remain plaintext', () => {
	for (const url of [
		'https://images.example.test/a.jpg?size=80',
		'http://images.example.test/a.jpg',
		'//images.example.test/a.jpg'
	]) {
		const record = withCover(url, '![own image](https://example.test/own.png)\n\nQuote body');
		const raw = encode(doc([record]));
		const node = card(JSON.parse(raw));
		assert(!node.text.includes(COVER_START));
		assert(book(JSON.parse(raw)).text.startsWith('![封面|80](<http'));
		assert.equal(book(JSON.parse(raw)).text.split('![封面|80]').length - 1, 1);
		assert.equal(node.height, 400);
		assert.deepEqual(decode(raw), doc([record]));
		assert.equal(needsFavoriteGraphUpdate(raw), false);
		const saved = encode(doc([record], 2), raw);
		assert.deepEqual(card(JSON.parse(saved)), node);
		assert.equal(node.text.split('![封面|80]').length - 1, 0);
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
		assert.equal(needsFavoriteGraphUpdate(raw), false);
		assert(!book(JSON.parse(raw)).text.includes('![封面|80]'));
		assert.equal(needsFavoriteGraphUpdate(JSON.stringify(oldCoverCanvas(record))), true);
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
	assert.equal(needsFavoriteGraphUpdate(before), true);
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
	assert.deepEqual(customEdges(next), root.edges);
	assert.equal(decode(upgraded).records[0].note.text, '**Edited native quote**');
	assert.equal(needsFavoriteGraphUpdate(upgraded), false);
	assert.deepEqual(card(JSON.parse(encode({ ...document, revision: 3 }, upgraded))), card(next));
});

test('owned cover migration preserves manual body, footer, width, images and trailing whitespace', () => {
	const record = withCover();
	const root = oldCoverCanvas(record);
	const ownCover = `${COVER_START}\n\n![封面|124](<https://images.example.test/custom.jpg>)\n\n${COVER_END}\n\n`;
	card(root).text =
		ownCover +
		card(root).text.replace('A quotation', 'Edited body\n![own](https://example.test/own.jpg)');
	card(root).text =
		card(root).text.slice(0, card(root).text.lastIndexOf('<!-- weread-favorite:')) +
		metadata('weread-favorite', { schemaVersion: 1, record, cover: true }) +
		' \n\t';
	Object.assign(card(root), {
		x: -321,
		y: 101,
		width: 777,
		height: 180,
		color: '3',
		custom: { retained: true }
	});
	const raw = JSON.stringify(root);
	const decoded = decode(raw);
	assert.equal(decoded.records[0].note.text, 'Edited body\n![own](https://example.test/own.jpg)');
	const saved = encode({ ...decoded, revision: 2 }, raw);
	const next = card(JSON.parse(saved));
	assert(!next.text.includes(COVER_START));
	assert(next.text.includes('Native custom footer'));
	assert(next.text.endsWith(' \n\t'));
	for (const key of ['id', 'x', 'y', 'width', 'height', 'color', 'custom'])
		assert.deepEqual(next[key], card(root)[key]);
	assert.equal(needsFavoriteGraphUpdate(saved), false);
	assert.deepEqual(card(JSON.parse(encode({ ...decoded, revision: 3 }, saved))), next);
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
	assert(!card(JSON.parse(f.files.get(MAIN))).text.includes(COVER_START));
	assert(book(JSON.parse(f.files.get(MAIN))).text.includes('![封面|80]'));
	assert.equal(f.repository.needsPresentationUpdate(), false);
	const deleted = { ...record, updatedAt: record.updatedAt + 1, deletedAt: record.updatedAt + 1 };
	await f.repository.save(doc([deleted], 2));
	assert.equal(card(JSON.parse(f.files.get(MAIN))), undefined);
	assert.equal(f.repository.needsPresentationUpdate(), false);
	await f.repository.save(doc([record], 3));
	const restored = card(JSON.parse(f.files.get(MAIN)));
	assert.equal(restored.text.split('![封面|80]').length - 1, 0);
	assert.equal(book(JSON.parse(f.files.get(MAIN))).text.split('![封面|80]').length - 1, 1);
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
	assert.equal(saved.edges.length, 2);
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
	for (const edge of root.edges)
		assert.deepEqual(
			result.edges.find((next) => next.id === edge.id),
			edge
		);
	assert.deepEqual(result.customRoot, root.customRoot);
	const added = result.nodes.find((node) => node.text?.includes('book%3Ahighlight%3Atwo'));
	assert(added.y >= book(result).y + book(result).height + 40);
	for (const node of root.nodes) {
		assert(
			added.x + added.width <= node.x ||
				added.x >= node.x + node.width ||
				added.y + added.height <= node.y ||
				added.y >= node.y + node.height
		);
	}
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
	const headerId = header(noHeader).id;
	noHeader.nodes = noHeader.nodes.filter((node) => node.id !== headerId);
	noHeader.edges = noHeader.edges.filter(
		(edge) => edge.fromNode !== headerId && edge.toNode !== headerId
	);
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
				schemaVersion: 3,
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

const otherBookEntry = (bookId = 'other', id = 'one') => {
	const record = entry(id);
	record.id = record.note.id = `${bookId}:highlight:${id}`;
	record.note.bookId = bookId;
	return record;
};
const rewriteHeader = (root, change) => {
	const value = headerValue(root);
	change(value);
	header(root).text = `# 我的收藏\n\n${metadata('weread-favorites', value)}`;
};
const overlaps = (a, b) =>
	a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;

test('graph creates one book per bookId, separate duplicate titles, linked text cards and readable hierarchy', () => {
	const records = [withCover(), entry('two'), otherBookEntry()];
	const files = { book: 'Library/A book.md', other: 'Library/Duplicate title.md' };
	const raw = encode(doc(records), undefined, files);
	const root = JSON.parse(raw);
	const value = headerValue(root);
	assert.equal(value.schemaVersion, 2);
	assert.equal(Object.keys(value.bookNodes).length, 2);
	assert.equal(root.nodes.length, 6);
	assert.equal(root.edges.length, 5);
	for (const [bookId, path] of Object.entries(files)) {
		const node = book(root, bookId);
		assert.equal(node.type, 'text');
		assert.equal(bookPath(root, bookId), path);
		assert(!('file' in node));
		assert.deepEqual(Object.keys(node).sort(), [
			'height',
			'id',
			'text',
			'type',
			'width',
			'x',
			'y'
		]);
		assert(header(root).y + header(root).height <= node.y);
		assert(
			root.edges.some((edge) => edge.fromNode === header(root).id && edge.toNode === node.id)
		);
		for (const quote of root.nodes.filter((candidate) =>
			candidate.text?.includes('<!-- weread-favorite:')
		)) {
			const record = decode(JSON.stringify({ nodes: [quote], edges: [] })).records[0];
			if (record.note.bookId !== bookId) continue;
			assert(quote.y >= node.y + node.height + 40);
			assert(
				root.edges.some((edge) => edge.fromNode === node.id && edge.toNode === quote.id)
			);
			assert(!quote.text.includes(COVER_START));
		}
	}
	for (const a of root.nodes) for (const b of root.nodes) if (a !== b) assert(!overlaps(a, b));
	assert.equal(needsFavoriteGraphUpdate(raw, files), false);
	assert.equal(encode(doc(records), raw, files), raw);
});

test('file association survives omitted mapping, changes by bookId, and explicit missing mapping restores fallback cover', () => {
	const raw = encode(doc([withCover()]), undefined, { book: 'Library/A.md' });
	assert.equal(bookPath(JSON.parse(encode(doc([withCover()]), raw))), 'Library/A.md');
	assert.deepEqual(book(JSON.parse(encode(doc([withCover()]), raw))), book(JSON.parse(raw)));
	assert.equal(needsFavoriteGraphUpdate(raw), false);
	assert.equal(needsFavoriteGraphUpdate(raw, { book: 'Library/Renamed.md' }), true);
	const renamed = encode(doc([withCover()]), raw, { book: 'Library/Renamed.md' });
	assert.equal(bookPath(JSON.parse(renamed)), 'Library/Renamed.md');
	assert.equal(book(JSON.parse(renamed)).id, book(JSON.parse(raw)).id);
	const deleted = encode(doc([withCover()]), renamed, {});
	assert.equal(book(JSON.parse(deleted)).type, 'text');
	assert(!('file' in book(JSON.parse(deleted))));
	assert.equal(bookPath(JSON.parse(deleted)), undefined);
	assert(!book(JSON.parse(deleted)).text.includes('打开本地笔记'));
	assert(book(JSON.parse(deleted)).text.includes('![封面|80]'));
	assert.equal(needsFavoriteGraphUpdate(deleted, {}), false);
	assert.deepEqual(decode(deleted).records, [withCover()]);
});

test('native book deletion never cancels quotes with or without remaining incident edges and is repaired only on save', () => {
	for (const removeEdges of [false, true]) {
		const root = JSON.parse(
			encode(doc([entry(), entry('two')]), undefined, { book: 'Library/A.md' })
		);
		const original = book(root);
		root.nodes = root.nodes.filter((node) => node.id !== original.id);
		if (removeEdges)
			root.edges = root.edges.filter(
				(edge) => edge.fromNode !== original.id && edge.toNode !== original.id
			);
		const raw = JSON.stringify(root);
		const parsed = decode(raw);
		assert.deepEqual(parsed.records, [entry(), entry('two')]);
		assert.equal(needsFavoriteGraphUpdate(raw, { book: 'Library/A.md' }), true);
		assert(!JSON.parse(raw).nodes.some((node) => node.id === original.id));
		const repaired = encode(parsed, raw, { book: 'Library/A.md' });
		assert.equal(book(JSON.parse(repaired)).id, original.id);
		assert.deepEqual(decode(repaired), parsed);
		assert.equal(needsFavoriteGraphUpdate(repaired, { book: 'Library/A.md' }), false);
	}
});

test('native quote deletion cancels only that quote and never recreates it during graph repair', () => {
	const root = JSON.parse(encode(doc([entry(), entry('two')])));
	const removed = card(root).id;
	root.nodes = root.nodes.filter((node) => node.id !== removed);
	root.edges = root.edges.filter((edge) => edge.fromNode !== removed && edge.toNode !== removed);
	const parsed = decode(JSON.stringify(root));
	assert.deepEqual(parsed.records, [entry('two')]);
	const repaired = JSON.parse(encode(parsed, JSON.stringify(root)));
	assert(!repaired.nodes.some((node) => node.id === removed));
	assert.equal(
		repaired.nodes.filter((node) => node.text?.includes('<!-- weread-favorite:')).length,
		1
	);
});

test('malformed, duplicate and incompatible root book references are protected read-only', () => {
	const source = JSON.parse(encode(doc([entry(), otherBookEntry()])));
	for (const mutate of [
		(value) => {
			value.bookNodes = [];
		},
		(value) => {
			value.bookNodes.book = 7;
		},
		(value) => {
			value.bookNodes.book = '';
		},
		(value) => {
			value.bookNodes.other = value.bookNodes.book;
		},
		(value) => {
			value.bookNodes.book = card(source).id;
		},
		(value) => {
			value.bookNodes.book = header(source).id;
		},
		(value) => {
			value.managedEdges = ['same', 'same'];
		},
		(value) => {
			value.managedEdges = [null];
		},
		(value) => {
			value.managedEdges = {};
		},
		(value) => {
			value.schemaVersion = 3;
		}
	]) {
		const root = structuredClone(source);
		rewriteHeader(root, mutate);
		const raw = JSON.stringify(root);
		assert.throws(() => decode(raw));
		assert.throws(() => needsFavoriteGraphUpdate(raw));
		assert.throws(() => encode(doc(), raw));
	}
});

test('book file map rejects external paths and traversal while native free file paths stay unmanaged', () => {
	for (const path of [
		'/tmp/a.md',
		'../a.md',
		'Library/../a.md',
		'./a.md',
		'Library//a.md',
		'C:\\a.md',
		'C:/a.md',
		'file:///tmp/a.md',
		'https://example.test/a.md',
		'obsidian://a.md',
		'\\server\\a.md',
		'a\n.md',
		'~/a.md',
		'book.pdf'
	]) {
		assert.throws(() => encode(doc(), undefined, { book: path }));
		assert.throws(() => needsFavoriteGraphUpdate(encode(doc()), { book: path }));
	}
	for (const path of ['读书/书名 #1.md', 'Library/C#?.MD', 'Library/A book.Md']) {
		const mapped = encode(doc(), undefined, { book: path });
		assert.equal(bookPath(JSON.parse(mapped)), path);
		assert.equal(needsFavoriteGraphUpdate(mapped, { book: path }), false);
	}
	const root = JSON.parse(encode(doc(), undefined, { book: '读书/书名 #1.md' }));
	root.nodes.push({ ...free('outside', 'file'), file: '/old/unmanaged.md' });
	const raw = encode(doc(), JSON.stringify(root));
	assert.equal(
		JSON.parse(raw).nodes.find((node) => node.id === 'outside').file,
		'/old/unmanaged.md'
	);
	assert.equal(bookPath(JSON.parse(raw)), '读书/书名 #1.md');
});

test('stable managed node and edge IDs avoid free IDs and remain idempotent after unrelated additions', () => {
	const baseline = JSON.parse(encode(doc()));
	const collisionNodes = baseline.nodes.map((node) => ({ ...free(node.id), x: 2000 }));
	const collisionEdges = baseline.edges.map((edge) => ({
		id: edge.id,
		fromNode: collisionNodes[0].id,
		toNode: collisionNodes[1].id
	}));
	const raw = encode(doc(), JSON.stringify({ nodes: collisionNodes, edges: collisionEdges }));
	const root = JSON.parse(raw);
	const ids = [...root.nodes, ...root.edges].map((item) => item.id);
	assert.equal(new Set(ids).size, ids.length);
	for (const node of collisionNodes)
		assert.deepEqual(
			root.nodes.find((candidate) => candidate.id === node.id),
			node
		);
	for (const edge of collisionEdges)
		assert.deepEqual(
			root.edges.find((candidate) => candidate.id === edge.id),
			edge
		);
	assert.equal(needsFavoriteGraphUpdate(raw), false);
	assert.equal(encode(doc(), raw), raw);
	const expanded = encode(doc([entry(), entry('two')], 2), raw);
	const next = JSON.parse(expanded);
	assert.equal(card(next).id, card(root).id);
	assert.equal(book(next).id, book(root).id);
	assert.equal(encode(doc([entry(), entry('two')], 2), expanded), expanded);
});

test('schema1 migration leaves all old quote positions, custom group edges and managed edge extensions intact', () => {
	const root = oldCoverCanvas(withCover());
	Object.assign(card(root), { x: -200, y: -300, width: 950, height: 170, color: '4' });
	root.nodes.push(free('group', 'group'), free('annotation'));
	root.edges.push({
		id: 'group-edge',
		fromNode: 'group',
		toNode: card(root).id,
		label: 'manual',
		customEdge: { yes: true }
	});
	root.extension = { version: 44 };
	const before = structuredClone(card(root));
	const raw = encode(decode(JSON.stringify(root)), JSON.stringify(root), {
		book: 'Library/A.md'
	});
	const result = JSON.parse(raw);
	assert.deepEqual(card(result), before);
	assert.deepEqual(result.extension, root.extension);
	assert.deepEqual(customEdges(result), root.edges);
	assert(!overlaps(book(result), card(result)));
	assert(book(result).y + book(result).height < card(result).y);
	Object.assign(
		result.edges.find((edge) => headerValue(result).managedEdges.includes(edge.id)),
		{ label: 'edited', customEdge: [1, 2] }
	);
	const changed = JSON.stringify(result);
	const again = JSON.parse(encode(decode(changed), changed));
	assert.deepEqual(again.edges, result.edges);
	assert.equal(needsFavoriteGraphUpdate(changed), false);
});

test('empty native Canvas requires no graph update and migration detector validates header versions', () => {
	const { isLegacyFavoritesCanvas } = module.exports;
	for (const raw of ['{}', '{"nodes":[]}', '{"nodes":[],"edges":[]}']) {
		assert.equal(needsFavoriteGraphUpdate(raw), false);
		assert.equal(isLegacyFavoritesCanvas(raw), true);
		assert.deepEqual(decode(raw), doc([], 0));
	}
	const old = JSON.stringify(oldCoverCanvas(entry()));
	assert.equal(isLegacyFavoritesCanvas(old), true);
	assert.equal(isLegacyFavoritesCanvas(encode(doc())), false);
	assert.throws(() => isLegacyFavoritesCanvas('{broken'));
	const future = JSON.parse(encode(doc()));
	rewriteHeader(future, (value) => {
		value.schemaVersion = 3;
	});
	assert.throws(() => isLegacyFavoritesCanvas(JSON.stringify(future)));
});

test('legacy two-book anchors and new quotes reserve native header and free-card bounds with margins', () => {
	const records = [entry(), otherBookEntry()];
	const root = JSON.parse(encode(doc(records)));
	const quoteNodes = root.nodes.filter((node) => node.text?.includes('<!-- weread-favorite:'));
	root.nodes = [header(root), ...quoteNodes, free('old-free')];
	root.edges = [];
	header(root).text =
		`# 我的收藏\n\n${metadata('weread-favorites', { schemaVersion: 1, revision: 1, tombstones: [] })}`;
	Object.assign(header(root), {
		x: 0,
		y: 0,
		width: 440,
		height: 400,
		color: '2',
		customRoot: true
	});
	Object.assign(quoteNodes[0], { x: 520, y: 480, width: 440, height: 400 });
	Object.assign(quoteNodes[1], { x: 0, y: 480, width: 440, height: 400 });
	const raw = encode(doc([...records, entry('new')], 2), JSON.stringify(root));
	const result = JSON.parse(raw);
	const expanded = (node) => ({
		...node,
		x: node.x - 40,
		y: node.y - 40,
		width: node.width + 80,
		height: node.height + 80
	});
	for (const bookId of ['book', 'other']) {
		for (const old of root.nodes) assert(!overlaps(book(result, bookId), expanded(old)));
	}
	for (const quote of quoteNodes)
		assert.deepEqual(
			result.nodes.find((node) => node.id === quote.id),
			quote
		);
	for (const key of ['id', 'x', 'y', 'width', 'height', 'color', 'customRoot']) {
		assert.equal(header(result)[key], header(root)[key]);
	}
	const newQuote = result.nodes.find((node) => node.text?.includes('book%3Ahighlight%3Anew'));
	for (const old of root.nodes) assert(!overlaps(newQuote, expanded(old)));
	assert.equal(needsFavoriteGraphUpdate(raw), false);
	assert.equal(encode(doc([...records, entry('new')], 2), raw), raw);
});

test('schema2 managed file books migrate in place to covered text cards without changing quotes or edges', () => {
	for (const context of [undefined, { book: 'Library/A book.md' }, {}]) {
		const root = JSON.parse(encode(doc([withCover(), entry('two')])));
		const oldBook = book(root);
		delete oldBook.text;
		Object.assign(oldBook, {
			type: 'file',
			file: 'Library/A book.md',
			subpath: '#old-preview',
			x: -712,
			y: 89,
			width: 713,
			height: 245,
			color: '5',
			extension: { retained: true }
		});
		card(root).text = card(root).text.replace(
			'A quotation',
			'**Native quote edit**\n![own](https://example.test/manual.png)'
		);
		root.nodes.push(free('unmanaged-file', 'file'));
		root.edges.push({
			id: 'manual-book-edge',
			fromNode: oldBook.id,
			toNode: 'unmanaged-file',
			label: 'retain'
		});
		const quotes = root.nodes.filter((node) => node.text?.includes('<!-- weread-favorite:'));
		const old = JSON.stringify(root);
		const document = decode(old);
		assert.equal(needsFavoriteGraphUpdate(old, context), true);
		const saved = encode(document, old, context);
		const next = JSON.parse(saved);
		const newBook = book(next);
		assert.equal(newBook.type, 'text');
		assert(!('file' in newBook));
		assert(!('subpath' in newBook));
		assert(newBook.text.includes('![封面|80]'));
		assert(newBook.text.includes('## A book\n\nAuthor'));
		assert.equal(
			bookPath(next),
			context === undefined || context.book ? 'Library/A book.md' : undefined
		);
		for (const key of ['id', 'x', 'y', 'width', 'height', 'color', 'extension'])
			assert.deepEqual(newBook[key], oldBook[key]);
		for (const quote of quotes) {
			assert.deepEqual(
				next.nodes.find((node) => node.id === quote.id),
				quote
			);
			assert(!quote.text.includes(COVER_START));
		}
		assert.deepEqual(next.edges, root.edges);
		assert.deepEqual(
			next.nodes.find((node) => node.id === 'unmanaged-file'),
			free('unmanaged-file', 'file')
		);
		assert.deepEqual(decode(saved), document);
		assert.equal(needsFavoriteGraphUpdate(saved, context), false);
		assert.equal(encode(document, saved, context), saved);
	}
});

test('book links encode literal punctuation and Unicode as vault-relative Markdown targets', () => {
	const path = "读书/C#? [book](one) 100% 'quoted'.MD";
	const raw = encode(doc([withCover()]), undefined, { book: path });
	const root = JSON.parse(raw);
	const text = book(root).text;
	assert(
		text.endsWith(
			'[打开本地笔记](<%E8%AF%BB%E4%B9%A6/C%23%3F%20%5Bbook%5D%28one%29%20100%25%20%27quoted%27.MD>)'
		)
	);
	assert.equal(bookPath(root), path);
	assert(!text.includes('obsidian://'));
	assert(!text.includes('file://'));
	assert.equal(text.match(/\[打开本地笔记\]/g).length, 1);
	assert.equal(text.match(/!\[封面\|80\]/g).length, 1);
	assert(!card(root).text.includes('打开本地笔记'));
	assert(!card(root).text.includes('![封面|80]'));
	assert.equal(needsFavoriteGraphUpdate(raw, { book: path }), false);
	assert.equal(encode(doc([withCover()]), raw), raw);
});

test('missing local notes omit the entire link and absent covers show only known title and author', () => {
	const raw = encode(doc(), undefined, {});
	const root = JSON.parse(raw);
	assert.equal(book(root).type, 'text');
	assert.equal(book(root).text, '## A book\n\nAuthor');
	assert(!book(root).text.includes('打开本地笔记'));
	assert.equal(bookPath(root), undefined);
	const linked = encode(doc(), raw, { book: 'Library/A.md' });
	assert.equal(bookPath(JSON.parse(linked)), 'Library/A.md');
	const missing = encode(doc(), linked, {});
	assert.equal(book(JSON.parse(missing)).text, '## A book\n\nAuthor');
	assert.equal(needsFavoriteGraphUpdate(missing, {}), false);
});

test('omitted local context preserves existing text book link and native text exactly without duplicates', () => {
	const root = JSON.parse(encode(doc([withCover()]), undefined, { book: 'Library/A.md' }));
	book(root).text += '\n\nPersonal book annotation';
	const old = JSON.stringify(root);
	const saved = encode(doc([withCover()], 2), old);
	assert.deepEqual(book(JSON.parse(saved)), book(root));
	assert.equal(book(JSON.parse(saved)).text.match(/\[打开本地笔记\]/g).length, 1);
	assert.equal(needsFavoriteGraphUpdate(saved), false);
	const withoutLink = encode(doc([withCover()], 3), saved, {});
	assert(!book(JSON.parse(withoutLink)).text.includes('打开本地笔记'));
	assert(book(JSON.parse(withoutLink)).text.includes('![封面|80]'));
});
