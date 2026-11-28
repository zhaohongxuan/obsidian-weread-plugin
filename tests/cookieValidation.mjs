// Regression tests for stale-cookie login failures (扫码登录窗口无声关闭 / Cookie 误判有效).
// The weread API reports login-expiry inconsistently across endpoints: errCode (camel)
// vs errcode (snake), -2010 vs -2012. The old code only matched lowercase errcode === -2012
// and fell back to the current isCookieValid flag, which setCookies had just set to true —
// so stale cookies were validated as "valid" and the login window closed itself silently.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { transformSync } from 'esbuild';
import { get, writable } from 'svelte/store';

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

function fixture({ resp, throwErr, desktop = true } = {}) {
	const settingsStore = writable({
		wereadApiKey: 'wrk-fixture', // set so verify() skips fetchAndSaveApiKey on the valid path
		cookies: [{ name: 'wr_vid', value: 'stale-user' }],
		isCookieValid: false
	});
	const calls = { setValid: [], requests: 0, refreshed: 0 };
	settingsStore.actions = {
		setIsCookieValid(valid) { calls.setValid.push(valid); },
		clearCookies() {},
		markCookiesInvalid() {}
	};
	const Api = load('src/api.ts', {
		'./settings': { settingsStore },
		'svelte/store': { get },
		obsidian: {
			Platform: { isDesktopApp: desktop },
			Notice: class {},
			requestUrl: async () => {
				calls.requests++;
				if (throwErr) { throw throwErr; }
				return resp;
			}
		},
		'./wereadProtocol': load('src/wereadProtocol.ts', {}),
		'./utils/cookiesUtil': { getCookieString: () => 'wr_vid=stale-user' },
		'set-cookie-parser': {},
		'./cookieCloud': class {}
	}).default;
	const api = new Api();
	api.refreshCookie = async () => { calls.refreshed++; return true; };
	return { api, calls, settingsStore };
}

test('valid response with books marks cookie valid', async () => {
	const { api, calls } = fixture({ resp: { status: 200, headers: {}, json: { books: [{ bookId: 'b1' }] } } });
	assert.equal(await api.verifyCookieValidity(), true);
	assert.deepEqual(calls.setValid, [true]);
});

test('stale cookie: errCode -2010 (camelCase) is invalid, not "preserve state"', async () => {
	// This is the exact shape weread returns for /api/user/notebook with a dead session.
	const { api, calls } = fixture({ resp: { status: 401, headers: {}, json: { errCode: -2010 } } });
	assert.equal(await api.verifyCookieValidity(), false);
	assert.deepEqual(calls.setValid, [false]);
});

test('stale cookie: errcode -2012 (snake_case) still invalid', async () => {
	const { api, calls } = fixture({ resp: { status: 401, headers: {}, json: { errcode: -2012 } } });
	assert.equal(await api.verifyCookieValidity(), false);
	assert.deepEqual(calls.setValid, [false]);
});

test('response without books and without error code is invalid too', async () => {
	// Ambiguous 200 body: must not fall back to the pre-set isCookieValid=true flag.
	const { api, calls } = fixture({ resp: { status: 200, headers: {}, json: {} } });
	assert.equal(await api.verifyCookieValidity(), false);
	assert.deepEqual(calls.setValid, [false]);
});

test('401 throw is invalid', async () => {
	const { api, calls } = fixture({ throwErr: Object.assign(new Error('Request failed, 401'), { status: 401 }) });
	assert.equal(await api.verifyCookieValidity(), false);
	assert.deepEqual(calls.setValid, [false]);
});

test('network exception (no status) preserves current state', async () => {
	// Genuine connectivity failure must keep the previous verdict — that fallback is intended.
	const { api } = fixture({ throwErr: new Error('ECONNREFUSED') });
	assert.equal(await api.verifyCookieValidity(), false);
	// isCookieValid was false before, stays untouched: no setValid calls at all.
	const { api: apiTrue } = (() => {
		const f = fixture({ throwErr: new Error('ECONNREFUSED') });
		f.settingsStore.update((s) => { s.isCookieValid = true; return s; });
		return f;
	})();
	assert.equal(await apiTrue.verifyCookieValidity(), true);
});

test('getNotebooks refreshes cookie on errCode -2012 (camelCase)', async () => {
	const { api, calls } = fixture({ resp: { status: 401, headers: {}, json: { errCode: -2012 } } });
	// getNotebooks returns undefined when the body has no books; refresh must have run.
	await api.getNotebooks();
	assert.equal(calls.refreshed, 1);
});

test('getNotebooks refreshes cookie on errcode -2010 (snake_case)', async () => {
	const { api, calls } = fixture({ resp: { status: 200, headers: {}, json: { errcode: -2010 } } });
	await api.getNotebooks();
	assert.equal(calls.refreshed, 1);
});
