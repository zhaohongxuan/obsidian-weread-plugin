// Run all: node --test tests/journal*.mjs
// Run one: node --test --test-name-pattern='partial failures' tests/journal.mjs
// esbuild bundles the production modules with only settings mocked; no Obsidian runtime or API calls.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';
import { build } from 'esbuild';

const require = createRequire(import.meta.url);
const compiled = await build({
	stdin: {
		contents: `export * from './src/journal'; export * from './src/journalHelpers'; export { settingsStore as testSettings } from './src/settings';`,
		resolveDir: process.cwd(),
		loader: 'ts'
	},
	bundle: true,
	platform: 'node',
	format: 'cjs',
	write: false,
	plugins: [
		{
			name: 'journal-settings',
			setup(builder) {
				builder.onResolve({ filter: /(?:^|\/)settings$/ }, () => ({
					path: 'settings',
					namespace: 'journal-mock'
				}));
				builder.onLoad({ filter: /.*/, namespace: 'journal-mock' }, () => ({
					contents: `import { writable } from 'svelte/store'; export const settingsStore = writable({cookies:[],wereadApiKey:'',userVid:'',journalRefreshHours:24,isCookieValid:true});`,
					resolveDir: process.cwd()
				}));
			}
		}
	]
});
const module = { exports: {} };
new Function('require', 'module', 'exports', compiled.outputFiles[0].text)(
	require,
	module,
	module.exports
);
const {
	WereadJournalService,
	testSettings,
	parseJournalNotes,
	journalSourceComplete,
	isJournalArticle,
	validJournalNote
} = module.exports;

const book = (bookId = 'one', overrides = {}) => ({
	bookId,
	book: { bookId, title: `Book ${bookId}`, author: 'Author' },
	noteCount: 1,
	reviewCount: 1,
	bookmarkCount: 0,
	sort: 1700000000,
	...overrides
});
const highlight = (bookId = 'one', markText = 'Highlight') => ({
	updated: [
		{
			bookmarkId: `${bookId}-h`,
			markText,
			createTime: 1700000000,
			type: 1,
			chapterUid: 2,
			range: '10-20'
		}
	],
	chapters: [{ chapterUid: 2, title: 'Chapter' }]
});
const reviews = (bookId = 'one', content = 'Thought') => ({
	reviews: [{ review: { reviewId: `${bookId}-r`, content, createTime: 1700000001 } }]
});
function deferred() {
	let resolve;
	const promise = new Promise((done) => {
		resolve = done;
	});
	return { promise, resolve };
}
function fixture(t, overrides = {}, files = new Map()) {
	testSettings.set({
		cookies: [],
		wereadApiKey: 'test-key-a',
		userVid: '',
		journalRefreshHours: 24,
		isCookieValid: true
	});
	const counts = { books: 0, highlights: 0, reviews: 0, writes: 0 };
	let listed = [book()];
	const api = {
		async getNotebooksWithRetry() {
			counts.books++;
			return listed;
		},
		async getNotebookHighlights(id) {
			counts.highlights++;
			return highlight(id);
		},
		async getNotebookReviews(id) {
			counts.reviews++;
			return reviews(id);
		},
		...overrides
	};
	const adapter = {
		async exists(path) {
			return files.has(path);
		},
		async read(path) {
			return files.get(path);
		},
		async mkdir(path) {
			files.set(path, 'directory');
		},
		async write(path, value) {
			counts.writes++;
			files.set(path, value);
		}
	};
	const plugin = { manifest: { dir: '.obsidian/plugins/weread' }, app: { vault: { adapter } } };
	const service = new WereadJournalService(plugin, api);
	t.after(() => service.dispose());
	const result = { service, api, counts, files, plugin };
	return Object.assign(result, {
		list(books) {
			listed = books;
		}
	});
}
async function settled(service) {
	// Flush only local async fake adapter/API work; never poll the network.
	for (let i = 0; i < 60; i++) await new Promise((resolve) => setImmediate(resolve));
	assert.equal(service.getSnapshot().syncing, false);
	return service.getSnapshot();
}

test('parser keeps both kinds, numeric IDs, milliseconds, chapters, source links and filters bookmarks', () => {
	const notes = parseJournalNotes(
		book(42),
		{
			updated: [
				{
					bookmarkId: 5,
					markText: ' text ',
					createTime: '1700000000',
					chapterUid: 2,
					range: '10-20',
					type: 1
				},
				{ bookmarkId: 6, markText: 'bookmark', createTime: 1700000000, type: 0 },
				{ bookmarkId: 7, markText: 'unknown date', createTime: 0 },
				{ bookmarkId: 8, markText: 'wrong book', createTime: 1700000000, bookId: 'other' }
			],
			chapters: [{ chapterUid: 2, title: 'Chapter' }]
		},
		{
			reviews: [
				{
					reviewId: 9,
					review: {
						content: 'Thought',
						createTime: 1700000001,
						chapterName: 'Review chapter'
					}
				}
			]
		}
	);
	assert.equal(notes.length, 2);
	assert.equal(notes[0].id, '42:thought:9');
	assert.equal(notes[0].createTime, 1700000001000);
	assert.equal(notes[1].chapterTitle, 'Chapter');
	assert.match(notes[1].sourceUrl, /rangeStart=10&rangeEnd=20/);
	assert.equal(notes[1].text, 'text');
	assert.equal(journalSourceComplete({ reviews: [], hasMore: 1 }, 'thought', 0), false);
	assert.equal(journalSourceComplete({ reviews: [] }, 'thought', 1), false);
});

test('article metadata preserves note identity, content, dates and source links for both kinds', () => {
	const original = parseJournalNotes(book(), highlight(), reviews());
	for (const notebook of [
		book('one', { book: { ...book().book, type: 3 } }),
		book('one', { type: 3 })
	]) {
		const notes = parseJournalNotes(notebook, highlight(), reviews());
		assert.equal(notes.length, original.length);
		assert(notes.every((note) => note.bookType === 3 && isJournalArticle(note)));
		assert.deepEqual(
			notes.map(({ bookType, ...note }) => note),
			original
		);
	}
	const ordinary = parseJournalNotes(
		book('one', { type: 3, book: { ...book().book, type: 1 } }),
		highlight(),
		reviews()
	);
	assert(ordinary.every((note) => note.bookType === 1 && !isJournalArticle(note)));
	for (const type of ['3', null, -1, 3.5, NaN, Infinity]) {
		const notes = parseJournalNotes(book('one', { type }), highlight(), reviews());
		assert(notes.every((note) => note.bookType === undefined && !isJournalArticle(note)));
	}
});

test('article classification uses exact WeChat URL host and never title or ID guesses', () => {
	const [note] = parseJournalNotes(book(), highlight(), reviews());
	assert.equal(isJournalArticle({ ...note, bookType: 3 }), true);
	for (const sourceUrl of [
		'https://mp.weixin.qq.com/s/example',
		'http://mp.weixin.qq.com/s?__biz=example',
		'https://MP.WEIXIN.QQ.COM/s/example'
	]) {
		assert.equal(isJournalArticle({ ...note, sourceUrl }), true, sourceUrl);
	}
	for (const sourceUrl of [
		undefined,
		'',
		'not a URL',
		'//mp.weixin.qq.com/s/example',
		'https://mp.weixin.qq.com.evil.example/s',
		'https://evilmp.weixin.qq.com/s',
		'https://mp.weixin.qq.com@evil.example/s',
		'https://evil.example/mp.weixin.qq.com',
		'javascript://mp.weixin.qq.com/s',
		note.sourceUrl
	]) {
		assert.equal(isJournalArticle({ ...note, sourceUrl }), false, String(sourceUrl));
	}
	assert.equal(
		isJournalArticle({ ...note, bookId: 'MP_WXS_unverified', bookTitle: '公众号文章' }),
		false
	);
});

test('old journal note schema remains valid with optional verified type', () => {
	const notes = parseJournalNotes(book(), highlight(), reviews());
	for (const note of notes) {
		assert.equal(Object.hasOwn(note, 'bookType'), false);
		assert.equal(validJournalNote(note, 'one'), true);
		assert.equal(validJournalNote({ ...note, bookType: 3 }, 'one'), true);
		assert.equal(validJournalNote({ ...note, bookType: 1 }, 'one'), true);
		for (const bookType of ['3', null, -1, NaN, Infinity]) {
			assert.equal(validJournalNote({ ...note, bookType }, 'one'), false);
		}
	}
});

test('load returns immediately, single flight emits progress and persists notes with counts but no credentials', async (t) => {
	const gate = deferred();
	const { service, counts, files } = fixture(t, {
		async getNotebooksWithRetry() {
			counts.books++;
			return gate.promise;
		}
	});
	const emissions = [];
	service.subscribe((state) => emissions.push(state));
	const states = await Promise.all([service.load(), service.load(true), service.load()]);
	assert(states.every((state) => state.syncing && !state.hasCache));
	assert.equal(counts.books, 1);
	gate.resolve([book(), book()]);
	const state = await settled(service);
	assert.equal(state.totalBooks, 1);
	assert.equal(state.notes.length, 2);
	assert.equal(state.scannedBooks, 1);
	assert.equal(state.failedBooks, 0);
	assert(state.hasCache && state.updatedAt > 0);
	const [[path, json]] = [...files].filter(([path]) => path.endsWith('.json'));
	assert.match(path, /^\.obsidian\/plugins\/weread\/journal-cache\/[a-f0-9]{64}\.json$/);
	assert(!json.includes('test-key-a'));
	const record = JSON.parse(json);
	assert.equal(record.books[0].revision.noteCount, 1);
	assert.equal(record.books[0].notes.length, 2);
	assert.equal(record.books[0].complete, true);
	assert(emissions.some((state) => state.scannedBooks === 1));
	state.notes[0].text = 'mutated';
	assert.notEqual(service.getSnapshot().notes[0].text, 'mutated');
});

test('fresh persisted cache hydrates after restart and forced listing skips unchanged details', async (t) => {
	const first = fixture(t);
	await first.service.load();
	await settled(first.service);
	first.service.dispose();
	const second = fixture(t, {}, first.files);
	const state = await second.service.load();
	assert.equal(state.hasCache, true);
	assert.equal(state.syncing, false);
	assert.equal(second.counts.books, 0);
	await second.service.load(true);
	await settled(second.service);
	assert.equal(second.counts.books, 1);
	assert.equal(second.counts.highlights, 0);
	assert.equal(second.counts.reviews, 0);
});

test('old cached notes gain overview article type without detail calls or changing note data', async (t) => {
	const first = fixture(t);
	await first.service.load();
	const original = await settled(first.service);
	assert(original.notes.every((note) => !Object.hasOwn(note, 'bookType')));
	first.service.dispose();
	const second = fixture(
		t,
		{
			async getNotebooksWithRetry() {
				second.counts.books++;
				return [book('one', { book: { ...book().book, type: 3 } })];
			}
		},
		first.files
	);
	const hydrated = await second.service.load();
	assert.equal(hydrated.hasCache, true);
	assert.equal(hydrated.syncing, false);
	assert.deepEqual(hydrated.notes, original.notes);
	assert.deepEqual(second.counts, { books: 0, highlights: 0, reviews: 0, writes: 0 });
	await second.service.load(true);
	const enriched = await settled(second.service);
	assert.equal(enriched.failedBooks, 0);
	assert.equal(enriched.totalBooks, original.totalBooks);
	assert.equal(enriched.scannedBooks, original.scannedBooks);
	assert(enriched.notes.every((note) => note.bookType === 3 && isJournalArticle(note)));
	assert.deepEqual(
		enriched.notes.map(({ bookType, ...note }) => note),
		original.notes
	);
	assert.deepEqual(second.counts, { books: 1, highlights: 0, reviews: 0, writes: 1 });
	const record = JSON.parse([...first.files].find(([path]) => path.endsWith('.json'))[1]);
	assert.equal(record.version, 1);
	assert(record.books[0].notes.every((note) => note.bookType === 3));

	// A later overview lacking type must not erase established type or any notes.
	second.api.getNotebooksWithRetry = async () => [book()];
	await second.service.load(true);
	assert.deepEqual((await settled(second.service)).notes, enriched.notes);
	assert.equal(second.counts.highlights, 0);
	assert.equal(second.counts.reviews, 0);
	second.service.dispose();
	const third = fixture(t, {}, first.files);
	const restarted = await third.service.load();
	assert.deepEqual(restarted.notes, enriched.notes);
	assert.deepEqual(third.counts, { books: 0, highlights: 0, reviews: 0, writes: 0 });
});

test('excluding articles enriches fresh legacy caches once through the existing overview', async (t) => {
	const first = fixture(t, {
		async getNotebooksWithRetry() {
			return [book('one'), book('two')];
		}
	});
	await first.service.load();
	const original = await settled(first.service);
	first.service.dispose();
	const gate = deferred();
	const second = fixture(
		t,
		{
			async getNotebooksWithRetry() {
				second.counts.books++;
				return gate.promise;
			}
		},
		first.files
	);
	// The default fresh-cache path must still perform no requests.
	await second.service.load();
	assert.equal(second.counts.books, 0);
	testSettings.update((settings) => ({ ...settings, journalIncludeArticles: false }));
	await Promise.all([second.service.load(), second.service.load(), second.service.load()]);
	assert.equal(second.counts.books, 1);
	gate.resolve([
		book('one', { book: { ...book('one').book, type: 0 } }),
		book('two', { book: { ...book('two').book, type: 3 } })
	]);
	const enriched = await settled(second.service);
	assert.deepEqual(
		enriched.notes.map(({ bookType, ...note }) => note),
		original.notes
	);
	assert(
		enriched.notes
			.filter((note) => note.bookId === 'one')
			.every((note) => note.bookType === 0 && !isJournalArticle(note))
	);
	assert(enriched.notes.filter((note) => note.bookId === 'two').every(isJournalArticle));
	await second.service.load();
	await second.service.load();
	assert.deepEqual(second.counts, { books: 1, highlights: 0, reviews: 0, writes: 1 });
});

test('legacy metadata attempts with missing types or errors do not loop and reset with account lineage', async (t) => {
	for (const fails of [false, true]) {
		const first = fixture(t);
		await first.service.load();
		const original = await settled(first.service);
		first.service.dispose();
		const second = fixture(
			t,
			{
				async getNotebooksWithRetry() {
					second.counts.books++;
					if (fails) throw new Error('synthetic overview failure');
					return [book()];
				}
			},
			first.files
		);
		testSettings.update((settings) => ({ ...settings, journalIncludeArticles: false }));
		await second.service.load();
		assert.deepEqual((await settled(second.service)).notes, original.notes);
		await second.service.load();
		await settled(second.service);
		assert.equal(second.counts.books, 1);
		assert.equal(second.counts.highlights, 0);
		assert.equal(second.counts.reviews, 0);
		// Preference flips alone cannot turn the once-only attempt into a loop.
		testSettings.update((settings) => ({ ...settings, journalIncludeArticles: true }));
		await second.service.load();
		testSettings.update((settings) => ({ ...settings, journalIncludeArticles: false }));
		await second.service.load();
		assert.equal(second.counts.books, 1);
		// Explicit refresh remains available after either missing metadata or failure.
		await second.service.load(true);
		await settled(second.service);
		assert.equal(second.counts.books, 2);
		testSettings.update((settings) => ({ ...settings, wereadApiKey: 'test-key-b' }));
		testSettings.update((settings) => ({ ...settings, wereadApiKey: 'test-key-a' }));
		await second.service.load();
		await settled(second.service);
		assert.equal(second.counts.books, 3);
		assert.equal(second.counts.highlights, 0);
		assert.equal(second.counts.reviews, 0);
		second.service.dispose();
	}
});

test('partial failures preserve cached book, persist incomplete marker and retry even at same revision', async (t) => {
	const { service, api, files, counts } = fixture(t);
	await service.load();
	const original = await settled(service);
	api.getNotebooksWithRetry = async () => [
		book('one', { noteCount: 2, sort: 1700000100 }),
		book('two')
	];
	api.getNotebookHighlights = async (id) => {
		counts.highlights++;
		return highlight(id, 'New highlight');
	};
	api.getNotebookReviews = async (id) => {
		counts.reviews++;
		return id === 'one' ? { reviews: [], hasMore: 1 } : reviews(id);
	};
	await service.load(true);
	const failed = await settled(service);
	assert.equal(failed.failedBooks, 1);
	assert.equal(failed.updatedAt, original.updatedAt);
	assert.equal(failed.notes.find((note) => note.id === 'one:highlight:one-h').text, 'Highlight');
	assert.equal(failed.notes.filter((note) => note.bookId === 'two').length, 2);
	const record = JSON.parse([...files].find(([path]) => path.endsWith('.json'))[1]);
	assert.equal(record.books.find((entry) => entry.bookId === 'one').complete, false);
	api.getNotebookHighlights = async (id) => {
		counts.highlights++;
		const result = highlight(id, 'Recovered');
		if (id === 'one') result.updated.push({ ...result.updated[0], bookmarkId: 'extra' });
		return result;
	};
	api.getNotebookReviews = async (id) => {
		counts.reviews++;
		return reviews(id);
	};
	const calls = counts.highlights;
	await service.load(true);
	const recovered = await settled(service);
	assert.equal(recovered.failedBooks, 0);
	assert.equal(counts.highlights, calls + 1);
	assert.equal(
		recovered.notes.find((note) => note.id === 'one:highlight:one-h').text,
		'Recovered'
	);
});

test('changed sort alone skips details; zero-count and deleted books clear old notes', async (t) => {
	const { service, api, counts, list } = fixture(t);
	await service.load();
	await settled(service);
	list([book('one', { sort: 1700000100 })]);
	await service.load(true);
	await settled(service);
	assert.equal(counts.highlights, 1, 'sort-only change must reuse cached details');
	list([book('one', { noteCount: 0, reviewCount: 0, sort: 1700000200 })]);
	await service.load(true);
	assert.equal((await settled(service)).notes.length, 0);
	assert.equal(counts.highlights, 1);
	list([]);
	await service.load(true);
	const empty = await settled(service);
	assert.equal(empty.totalBooks, 0);
	assert.equal(empty.hasCache, true);
});

test('first-load partial results retain successful content and are never considered complete', async (t) => {
	const { service, files } = fixture(t, {
		async getNotebookReviews() {
			throw new Error('private credential');
		}
	});
	await service.load();
	const state = await settled(service);
	assert.equal(state.notes.length, 1);
	assert.equal(state.notes[0].kind, 'highlight');
	assert.equal(state.failedBooks, 1);
	assert.equal(state.hasCache, true);
	assert.equal(state.updatedAt, 0);
	assert(!state.error.includes('private'));
	const record = JSON.parse([...files].find(([path]) => path.endsWith('.json'))[1]);
	assert.equal(record.books[0].complete, false);
});

test('corrupt cache recovers and disk write failures retain usable memory', async (t) => {
	const { service, plugin } = fixture(t);
	plugin.app.vault.adapter.exists = async () => true;
	plugin.app.vault.adapter.read = async () => '{broken';
	plugin.app.vault.adapter.write = async () => {
		throw new Error('private path or credential');
	};
	await service.load();
	const state = await settled(service);
	assert.equal(state.notes.length, 2);
	assert.equal(state.hasCache, true);
	assert.match(state.error, /缓存写入失败/);
	assert(!state.error.includes('private'));
});

test('configured refresh hours control background expiry and failures use fixed messages', async (t) => {
	const { service, counts, api } = fixture(t);
	await service.load();
	const initial = await settled(service);
	const clock = Date.now;
	t.after(() => {
		Date.now = clock;
	});
	Date.now = () => initial.updatedAt + 2 * 60 * 60 * 1000;
	await service.load();
	assert.equal(counts.books, 1);
	testSettings.update((state) => ({ ...state, journalRefreshHours: 1 }));
	api.getNotebooksWithRetry = async () => {
		counts.books++;
		throw new Error('secret test-key-a');
	};
	await service.load();
	const state = await settled(service);
	assert.equal(counts.books, 2);
	assert.equal(state.notes.length, 2);
	assert(!state.error.includes('test-key-a'));
	await service.load();
	assert.equal(counts.books, 2);
});

test('credential change clears visible cache and discards stale requests and writes', async (t) => {
	const gate = deferred();
	const { service, api, files } = fixture(t, {
		async getNotebookHighlights() {
			return gate.promise;
		}
	});
	await service.load();
	testSettings.update((state) => ({ ...state, wereadApiKey: 'test-key-b' }));
	assert.equal(service.getSnapshot().notes.length, 0);
	assert.equal(service.getSnapshot().syncing, false);
	api.getNotebooksWithRetry = async () => [book('two')];
	api.getNotebookHighlights = async (id) => highlight(id);
	await service.load();
	await settled(service);
	gate.resolve(highlight('one'));
	const state = await settled(service);
	assert(state.notes.every((note) => note.bookId === 'two'));
	assert.equal([...files.keys()].filter((path) => path.endsWith('.json')).length, 1);
	testSettings.update((settings) => ({
		...settings,
		cookies: [{ name: 'wr_vid', value: 'new-account' }]
	}));
	assert.equal(service.getSnapshot().hasCache, false);
});

test('a started old write cannot overwrite newer data after A to B to A account changes', async (t) => {
	const { service, plugin, files, api } = fixture(t);
	const gate = deferred();
	const started = deferred();
	const originalWrite = plugin.app.vault.adapter.write;
	let calls = 0;
	plugin.app.vault.adapter.write = async (path, value) => {
		calls++;
		if (calls === 1) {
			started.resolve();
			await gate.promise;
		}
		await originalWrite(path, value);
	};
	await service.load();
	await started.promise;
	testSettings.update((state) => ({ ...state, wereadApiKey: 'test-key-b' }));
	testSettings.update((state) => ({ ...state, wereadApiKey: 'test-key-a' }));
	api.getNotebookHighlights = async (id) => highlight(id, 'Latest account A content');
	await service.load();
	await settled(service);
	assert.equal(calls, 1);
	gate.resolve();
	await settled(service);
	assert.equal(calls, 2);
	const record = JSON.parse([...files].find(([path]) => path.endsWith('.json'))[1]);
	assert.equal(
		record.books[0].notes.find((note) => note.kind === 'highlight').text,
		'Latest account A content'
	);
});

test('bounded concurrency, missing counts never skip details, disposed service stops publication', async (t) => {
	let active = 0;
	let maximum = 0;
	const gates = [];
	const { service, api } = fixture(t, {
		async getNotebooksWithRetry() {
			return Array.from({ length: 6 }, (_, i) => book(String(i), { noteCount: undefined }));
		},
		async getNotebookHighlights(id) {
			active++;
			maximum = Math.max(maximum, active);
			const gate = deferred();
			gates.push(gate);
			await gate.promise;
			active--;
			return highlight(id);
		}
	});
	await service.load();
	await new Promise((resolve) => setImmediate(resolve));
	assert.equal(maximum, 2);
	for (let i = 0; i < 6; i++) {
		if (gates[i]) gates[i].resolve();
		await new Promise((resolve) => setImmediate(resolve));
	}
	await settled(service);
	let calls = 0;
	api.getNotebookHighlights = async (id) => {
		calls++;
		return highlight(id);
	};
	await service.load(true);
	await settled(service);
	assert.equal(calls, 6);
	let emissions = 0;
	service.subscribe(() => emissions++);
	service.dispose();
	testSettings.update((state) => ({ ...state, wereadApiKey: 'other' }));
	await service.load(true);
	assert.equal(emissions, 1);
});

test('unchanged noteCount/reviewCount/bookmarkCount reuse cache even when only sort moves', async (t) => {
	const { service, counts, list } = fixture(t);
	await service.load();
	await settled(service);
	assert.equal(counts.highlights, 1);
	assert.equal(counts.reviews, 1);
	// New reading activity bumps sort, but no highlight/review was added or removed.
	list([book('one', { sort: 1700009999 })]);
	await service.load(true);
	const state = await settled(service);
	assert.equal(counts.highlights, 1, 'unchanged counts must not refetch highlights');
	assert.equal(counts.reviews, 1, 'unchanged counts must not refetch reviews');
	assert.equal(state.notes.length, 2);
	assert.equal(state.failedBooks, 0);
});

test('counts-only comparison skips refetch when only updatedAt moves, but count changes still refetch', async (t) => {
	const { service, counts, list } = fixture(t);
	await service.load();
	await settled(service);
	assert.equal(counts.highlights, 1);
	// An edit that keeps the same number of highlights/thoughts is not detected:
	// this is the deliberate cost of avoiding a full-detail refresh every read.
	list([book('one', { updatedAt: 1700000999 })]);
	await service.load(true);
	await settled(service);
	assert.equal(counts.highlights, 1, 'unchanged counts keep the cached details');
	// Adding one highlight changes noteCount, which must trigger a refetch.
	list([book('one', { noteCount: 2, updatedAt: 1700001999 })]);
	await service.load(true);
	await settled(service);
	assert.equal(counts.highlights, 2, 'a changed noteCount invalidates the cache');
});

test('failure reasons explain which source failed and why, per book', async (t) => {
	const { service, api, list } = fixture(t);
	await service.load();
	await settled(service);
	list([book('one', { noteCount: 2, reviewCount: 1 })]);
	api.getNotebookHighlights = async () => ({ updated: [], hasMore: 1 });
	api.getNotebookReviews = async () => {
		throw new Error('network down');
	};
	await service.load(true);
	const state = await settled(service);
	assert.equal(state.failedBooks, 1);
	assert.equal(state.failures.length, 1);
	const [failure] = state.failures;
	assert.equal(failure.bookId, 'one');
	assert.equal(failure.title, 'Book one');
	assert.match(failure.reason, /划线分页未取完/);
	assert.match(failure.reason, /想法请求失败/);
});

test('articles are skipped (not fetched, not failed) when only an API key is available', async (t) => {
	testSettings.set({ cookies: [], wereadApiKey: 'k', userVid: '', journalRefreshHours: 24, isCookieValid: false });
	const counts = { books: 0, highlights: 0, reviews: 0, writes: 0 };
	const api = {
		async getNotebooksWithRetry() {
			counts.books++;
			return [
				book('one'),
				book('MP_WXS_123', {
					book: { bookId: 'MP_WXS_123', title: '某公众号', author: '', type: 3 },
					noteCount: 5,
					reviewCount: 0,
					sort: 1700000001
				})
			];
		},
		async getNotebookHighlights(id) {
			counts.highlights++;
			return highlight(id);
		},
		async getNotebookReviews(id) {
			counts.reviews++;
			return reviews(id);
		}
	};
	const files = new Map();
	const adapter = {
		async exists(p) {
			return files.has(p);
		},
		async read(p) {
			return files.get(p);
		},
		async mkdir(p) {
			files.set(p, 'directory');
		},
		async write(p, v) {
			counts.writes++;
			files.set(p, v);
		}
	};
	const plugin = { manifest: { dir: '.obsidian/plugins/weread' }, app: { vault: { adapter } } };
	const service = new WereadJournalService(plugin, api);
	t.after(() => service.dispose());
	await service.load();
	const state = await settled(service);
	// Only the ordinary book is fetched; the article is skipped entirely.
	assert.equal(counts.highlights, 1, 'only the non-article book requests highlights');
	assert.equal(counts.reviews, 1);
	assert.equal(state.failedBooks, 0, 'skipped articles are not counted as failures');
	assert.equal(state.failures.length, 0);
	assert.equal(state.notes.every((note) => note.bookId === 'one'), true);
	const record = JSON.parse([...files].find(([path]) => path.endsWith('.json'))[1]);
	assert.equal(record.books.length, 1, 'the skipped article is not persisted as a cached book');
});

test('articles are fetched again once a valid cookie makes the V1 channel available', async (t) => {
	const { service, api, counts } = fixture(t);
	testSettings.update((s) => ({ ...s, isCookieValid: false }));
	// With no cookie only the article book is listed; it is skipped.
	api.getNotebooksWithRetry = async () => [
		book('one', { book: { ...book().book, type: 3 } })
	];
	await service.load();
	const skipped = await settled(service);
	assert.equal(counts.highlights, 0, 'article skipped while there is no cookie');
	assert.equal(skipped.notes.length, 0);
	assert.equal(skipped.failedBooks, 0);
	// After the user logs in with a cookie the same book resolves via V1.
	testSettings.update((s) => ({ ...s, isCookieValid: true }));
	await service.load(true);
	const state = await settled(service);
	assert.equal(state.failedBooks, 0);
	assert.equal(state.notes.length, 2);
	assert(state.notes.every((note) => note.bookType === 3));
	assert.equal(counts.highlights, 1);
});

test('successful refresh records a non-negative duration, hydration resets it to unknown', async (t) => {
	const first = fixture(t);
	await first.service.load();
	const state = await settled(first.service);
	assert.equal(typeof state.lastDurationMs, 'number');
	assert(state.lastDurationMs >= 0);
	first.service.dispose();
	const second = fixture(t, {}, first.files);
	await second.service.load();
	const hydrated = await settled(second.service);
	assert.equal(hydrated.lastDurationMs, 0, 'duration is not persisted; restored cache reports unknown');
});

test('refresh logs reuse/refetch/skip counts so duration can be explained', async (t) => {
	const { service, api, list } = fixture(t);
	await service.load();
	await settled(service);
	// Skip only happens without a cookie channel; exercise that path here.
	testSettings.update((s) => ({ ...s, isCookieValid: false }));
	// Second refresh: one unchanged book (reuse) + one article (skip) + one changed (refetch).
	list([
		book('one'),
		book('MP_WXS_1', {
			book: { bookId: 'MP_WXS_1', title: '公众号', author: '', type: 3 },
			noteCount: 2
		}),
		book('two', { noteCount: 1, reviewCount: 1 })
	]);
	const logs = [];
	const original = console.debug;
	console.debug = (...args) => logs.push(args.join(' '));
	try {
		await service.load(true);
		await settled(service);
	} finally {
		console.debug = original;
	}
	const line = logs.find((l) => l.includes('刷新完成'));
	assert(line, 'refresh logs a completion line');
	assert.match(line, /复用 1 本/, 'unchanged book reported as reused');
	assert.match(line, /跳过公众号 1 本/, 'article reported as skipped');
	assert.match(line, /重取 1 本/, 'changed book reported as refetched');
});

test('refresh emits progress at a bounded rate rather than once per book', async (t) => {
	// 300 unchanged books: previously each triggered a full note re-sort and emit.
	const many = Array.from({ length: 300 }, (_, i) => book('b' + i));
	const first = fixture(t, {
		async getNotebooksWithRetry() {
			return many;
		}
	});
	await first.service.load();
	await settled(first.service);
	let progressEmits = 0;
	first.service.subscribe(() => progressEmits++);
	// Second refresh: all unchanged, so 0 refetch; count how many emits happen.
	await first.service.load(true);
	await settled(first.service);
	assert(progressEmits < 50, `expected throttled emits, got ${progressEmits} for 300 books`);
	assert(progressEmits > 0, 'still emits at least the final completed state');
});
