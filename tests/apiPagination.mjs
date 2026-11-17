// Run: node --test tests/apiPagination.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { transformSync } from 'esbuild';

function load(path, mocks) {
	const module = { exports: {} };
	const code = transformSync(readFileSync(path, 'utf8'), {
		loader: 'ts',
		format: 'cjs',
		target: 'es2020'
	}).code;
	new Function('require', 'module', 'exports', code)(
		(name) => {
			if (!(name in mocks)) throw new Error(`Unexpected dependency: ${name}`);
			return mocks[name];
		},
		module,
		module.exports
	);
	return module.exports.default ?? module.exports;
}

function fixture(pages) {
	const settings = { value: { wereadApiKey: 'key-a', cookies: [], isCookieValid: false } };
	const calls = [];
	let cookieCalls = 0;
	const obsidian = {
		Platform: { isDesktopApp: true },
		async requestUrl(request) {
			calls.push(request.body ? JSON.parse(request.body) : request);
			const page = pages.shift();
			if (page instanceof Error) throw page;
			if (typeof page === 'function') return page(request);
			if (page === undefined) throw new Error('No mocked response');
			return { status: 200, json: page };
		}
	};
	const common = {
		'./wereadProtocol': load('src/wereadProtocol.ts', {}),
		obsidian,
		'./settings': { settingsStore: settings },
		'svelte/store': { get: (store) => store.value }
	};
	const V2 = load('src/api-v2.ts', common);
	class V1 {
		async getNotebooksWithRetry() {
			cookieCalls++;
			return [];
		}
		async getNotebooks() {
			cookieCalls++;
			return [];
		}
		async getNotebookHighlights() {
			cookieCalls++;
			return { updated: [] };
		}
		async getNotebookReviews() {
			cookieCalls++;
			return { reviews: [] };
		}
		async getProgress() {
			cookieCalls++;
			return {};
		}
		async refreshCookie() {
			return false;
		}
	}
	const Router = load('src/api-router.ts', {
		...common,
		'./api': V1,
		'./api-v2': V2,
		'./utils/cookiesUtil': { getCookieString: () => 'wr_vid=7' }
	});
	const legacyGateway = load('src/api.ts', {
		...common,
		'./utils/cookiesUtil': { getCookieString: () => '' },
		'set-cookie-parser': {},
		'./cookieCloud': class {}
	});
	return {
		api: new V2(),
		router: new Router(),
		legacyGateway: new legacyGateway(),
		settings,
		calls,
		cookieCalls: () => cookieCalls
	};
}
const notebook = (id, sort) => ({ bookId: id, book: { bookId: id }, sort });
const review = (id) => ({ review: { reviewId: id, content: id } });

test('both gateway paths report verified skill version 1.0.5', async () => {
	const f = fixture([{ books: [] }, { readTimes: {} }]);
	await f.api.getShelf();
	await f.legacyGateway.callAgentGateway('/readdata/detail', { mode: 'monthly' });
	assert.deepEqual(
		f.calls.map((call) => call.skill_version),
		['1.0.5', '1.0.5']
	);
});

test('future upgrades give plugin-specific guidance and are not swallowed as empty stats', async () => {
	const response = {
		books: [],
		upgrade_info: {
			current_version: '1.0.5',
			latest_version: '1.0.6',
			message: 'download SKILL.md from upgrade_url'
		}
	};
	const f = fixture([response, response, response]);
	for (const call of [
		() => f.api.getShelf(),
		() => f.api.getReadingStats('monthly'),
		() => f.legacyGateway.callAgentGateway('/readdata/detail')
	]) {
		await assert.rejects(
			call(),
			(error) =>
				error.message.includes('1.0.6') &&
				error.message.includes('更新微信读书插件') &&
				!error.message.includes('SKILL.md')
		);
	}
});

test('notebooks flatten cursors, deduplicate IDs, and accept string/boolean hasMore', async () => {
	const f = fixture([
		{ books: [notebook('a', 30), notebook('b', 20)], hasMore: '1' },
		{ books: [notebook('b', 20), notebook('c', 10)], hasMore: true },
		{ books: [notebook('d', 5)], hasMore: 0 }
	]);
	assert.deepEqual(
		(await f.api.getNotebooks()).books.map((book) => book.bookId),
		['a', 'b', 'c', 'd']
	);
	assert.deepEqual(
		f.calls.map((call) => call.lastSort),
		[undefined, 20, 10]
	);
	assert.ok(f.calls.every((call) => call.count === 300 && !call.params && call.skill_version));
});

test('notebooks reject failed pages, repeated cursors, and missing cursors', async () => {
	for (const tail of [
		new Error('network failed'),
		{ books: [notebook('b', 20)], hasMore: 1 },
		{ books: [notebook('b', undefined)], hasMore: 1 },
		{ books: [], hasMore: 1 }
	]) {
		const f = fixture([{ books: [notebook('a', 20)], hasMore: 1 }, tail]);
		await assert.rejects(f.api.getNotebooks());
	}
});

test('reviews fetch all pages using returned synckey and deduplicate review IDs', async () => {
	const f = fixture([
		{ reviews: [review('r1'), review('r2')], hasMore: true, synckey: 45, totalCount: 3 },
		{ reviews: [review('r2'), review('r3')], hasMore: '0', synckey: 50, totalCount: 3 }
	]);
	assert.deepEqual(
		(await f.api.getNotebookReviews('book')).reviews.map((entry) => entry.review.reviewId),
		['r1', 'r2', 'r3']
	);
	assert.deepEqual(
		f.calls.map((call) => call.synckey),
		[0, 45]
	);
	assert.ok(f.calls.every((call) => call.count === undefined && call.bookid === 'book'));
});

test('reviews reject truncation, failed pages and cycling cursors', async () => {
	await assert.rejects(
		fixture([{ reviews: [review('r1')], hasMore: 0, totalCount: 2 }]).api.getNotebookReviews(
			'book'
		)
	);
	for (const tail of [
		new Error('failed'),
		{ reviews: [review('r2')], hasMore: 1, synckey: 45 },
		{ reviews: [], hasMore: 1, synckey: 60 },
		{ reviews: [review('r2')], hasMore: 1 }
	]) {
		await assert.rejects(
			fixture([
				{ reviews: [review('r1')], hasMore: 1, synckey: 45 },
				tail
			]).api.getNotebookReviews('book')
		);
	}
});

test('personal API failures keep configured API key authoritative; articles retain explicit Cookie route', async () => {
	for (const method of [
		'getNotebooks',
		'getNotebooksWithRetry',
		'getNotebookHighlights',
		'getNotebookReviews',
		'getProgress'
	]) {
		const f = fixture([new Error('API key failed')]);
		await assert.rejects(f.router[method]('book'));
		assert.equal(f.cookieCalls(), 0);
	}
	const f = fixture([]);
	await f.router.getNotebookHighlights('article', true);
	await f.router.getNotebookReviews('article', true);
	assert.equal(f.cookieCalls(), 2);
});

test('highlight payload validation rejects malformed updated without Cookie fallback and accepts empty arrays', async () => {
	for (const response of [{}, { updated: null }, { updated: {} }]) {
		const f = fixture([response]);
		await assert.rejects(f.router.getNotebookHighlights('book'), /划线数据不完整/);
		assert.equal(f.cookieCalls(), 0);
		assert.equal(f.calls.length, 1);
	}
	const f = fixture([{ updated: [] }]);
	assert.deepEqual(await f.router.getNotebookHighlights('book'), { updated: [] });
	assert.equal(f.cookieCalls(), 0);
	assert.equal(f.calls.length, 1);
});

test('shelf cache expires, force refreshes, coalesces requests, and invalidates credentials', async () => {
	const f = fixture([
		{ books: [] },
		{ books: [notebook('b', 1)] },
		{ books: [notebook('c', 1)] },
		{ books: [] }
	]);
	const [first, same] = await Promise.all([f.router.getShelf(), f.router.getShelf()]);
	assert.equal(first, same);
	assert.equal(f.calls.length, 1);
	assert.equal(await f.router.getShelf(), first);
	await f.router.getShelf(true);
	assert.equal(f.calls.length, 2);
	f.settings.value.wereadApiKey = 'key-b';
	await f.router.getShelf();
	assert.equal(f.calls.length, 3);
	f.router.shelfCache.expiresAt = 0;
	await f.router.getShelf();
	assert.equal(f.calls.length, 4);
});

test('shelf failures and required upgrades surface instead of empty successful shelves', async () => {
	for (const response of [
		{ errcode: -1, errmsg: 'expired' },
		{ upgrade_info: { message: 'Upgrade required' } },
		{ books: null }
	]) {
		await assert.rejects(fixture([response]).router.getShelf());
	}
});

test('Cookie shelf compatibility requests a full sync with user identity', async () => {
	const f = fixture([{ books: [], albums: [], mp: {} }]);
	f.settings.value = {
		wereadApiKey: '',
		cookies: [{ name: 'wr_vid', value: '7' }],
		isCookieValid: true,
		userVid: '7'
	};
	await f.router.getShelf();
	assert.match(f.calls[0].url, /\/shelf\/sync\?userVid=7&synckey=0&lectureSynckey=0/);
	assert.equal(f.calls[0].headers.Cookie, 'wr_vid=7');
});
