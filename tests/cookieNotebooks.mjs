// Production Cookie API + journal regression, with memory-only settings and adapter.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import { transformSync } from 'esbuild';
import { get, writable } from 'svelte/store';

const require = createRequire(import.meta.url);
function load(path, mocks) {
	const module = { exports: {} };
	const code = transformSync(readFileSync(path, 'utf8'), {
		loader: 'ts', format: 'cjs', target: 'es2020'
	}).code;
	new Function('require', 'module', 'exports', code)((name) => {
		if (!(name in mocks)) throw new Error(`Unexpected dependency: ${name}`);
		return mocks[name];
	}, module, module.exports);
	return module.exports;
}

const book = {
	bookId: 'fixture-book',
	book: { bookId: 'fixture-book', title: 'Fixture book', author: 'Fixture author' },
	noteCount: 1, reviewCount: 0, sort: 1
};
function fixture(t, desktop = true) {
	const settingsStore = writable({
		wereadApiKey: '', cookies: [{ name: 'wr_vid', value: 'fixture-user' }],
		userVid: 'fixture-user', journalRefreshHours: 24
	});
	const authentication = { cleared: 0, invalidated: 0, refreshed: 0 };
	settingsStore.actions = {
		clearCookies() { authentication.cleared++; },
		markCookiesInvalid() { authentication.invalidated++; }
	};
	let request = async () => ({ status: 200, headers: {}, json: { books: [book] } });
	let requests = 0;
	const common = { './settings': { settingsStore }, 'svelte/store': { get } };
	const Api = load('src/api.ts', {
		...common,
		obsidian: {
			Platform: { isDesktopApp: desktop }, Notice: class {},
			requestUrl: (...args) => { requests++; return request(...args); }
		},
		'./wereadProtocol': load('src/wereadProtocol.ts', {}),
		'./utils/cookiesUtil': { getCookieString: () => '' },
		'set-cookie-parser': {}, './cookieCloud': class {}
	}).default;
	const api = new Api();
	api.refreshCookie = async () => { authentication.refreshed++; return true; };
	const Service = load('src/journal.ts', {
		...common, 'crypto-js': require('crypto-js'),
		'./journalHelpers': load('src/journalHelpers.ts', {})
	}).WereadJournalService;
	const files = new Map();
	const adapter = {
		exists: async (path) => files.has(path), read: async (path) => files.get(path),
		mkdir: async (path) => { files.set(path, 'directory'); },
		write: async (path, value) => { files.set(path, value); }
	};
	const service = new Service({
		manifest: { dir: '.obsidian/plugins/fixture' }, app: { vault: { adapter } }
	}, {
		getNotebooksWithRetry: () => api.getNotebooksWithRetry(),
		getNotebookHighlights: async () => ({ updated: [{
			bookmarkId: 'fixture-highlight', markText: 'Keep this cached note',
			createTime: 1700000000, type: 1
		}] }),
		getNotebookReviews: async () => ({ reviews: [] })
	});
	t.after(() => service.dispose());
	return {
		api, service, files, authentication, requests: () => requests,
		setRequest: (next) => { request = next; }
	};
}
async function settle(service) {
	// All work is local promises; wait for publication and the fake adapter write.
	for (let i = 0; i < 30; i++) await new Promise(setImmediate);
	assert.equal(service.getSnapshot().syncing, false);
	return service.getSnapshot();
}

test('Cookie offline refresh preserves cached journal books, notes and disk and reports failure', async (t) => {
	const f = fixture(t);
	await f.service.load();
	const before = await settle(f.service);
	assert.equal(before.notes.length, 1);
	const disk = [...f.files];
	f.setRequest(async () => { throw new Error('Offline fixture'); });
	await f.service.load(true);
	const after = await settle(f.service);
	assert.deepEqual(after.notes, before.notes);
	assert.equal(after.totalBooks, 1);
	assert.equal(after.updatedAt, before.updatedAt);
	assert.equal(after.hasCache, true);
	assert.match(after.error, /同步失败.*保留缓存/);
	assert.deepEqual([...f.files], disk);
	assert.deepEqual(f.authentication, { cleared: 0, invalidated: 0, refreshed: 0 });
	assert.equal(f.requests(), 2, 'network failures are not retried as authentication failures');
});

test('a successful empty Cookie listing remains authoritative and clears removed journal books', async (t) => {
	const f = fixture(t);
	await f.service.load();
	await settle(f.service);
	f.setRequest(async () => ({ status: 200, headers: {}, json: { books: [] } }));
	assert.deepEqual(await f.api.getNotebooksWithRetry(), []);
	await f.service.load(true);
	const after = await settle(f.service);
	assert.equal(after.totalBooks, 0);
	assert.deepEqual(after.notes, []);
	assert.equal(after.error, '');
	assert.equal(after.hasCache, true);
	const [, json] = [...f.files].find(([path]) => path.endsWith('.json'));
	assert.deepEqual(JSON.parse(json).books, []);
});

test('Cookie HTTP 401 still refreshes and retries before invalidating desktop/mobile login', async (t) => {
	for (const desktop of [true, false]) {
		const f = fixture(t, desktop);
		let attempts = 0;
		f.setRequest(async () => {
			if (++attempts === 1) throw Object.assign(new Error('Unauthorized fixture'), { status: 401 });
			return { status: 200, headers: {}, json: { books: [] } };
		});
		assert.deepEqual(await f.api.getNotebooksWithRetry(), []);
		assert.equal(f.authentication.refreshed, 1);
		assert.equal(f.authentication.cleared, 0);
		assert.equal(f.authentication.invalidated, 0);
		f.setRequest(async () => { throw Object.assign(new Error('Unauthorized fixture'), { status: 401 }); });
		await assert.rejects(f.api.getNotebooksWithRetry(), /after retry/);
		assert.equal(f.authentication.cleared, desktop ? 1 : 0);
		assert.equal(f.authentication.invalidated, desktop ? 0 : 1);
	}
});
