// Run: node --test tests/apiKeyValidation.mjs
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

function fixture(response, apiKey = 'synthetic-key') {
	const settings = {
		value: {
			wereadApiKey: apiKey,
			cookies: [{ name: 'wr_vid', value: 'synthetic-user' }],
			isCookieValid: true
		}
	};
	const calls = [];
	let cookieCalls = 0;
	const protocol = load('src/wereadProtocol.ts', {});
	const common = {
		'./wereadProtocol': protocol,
		obsidian: {
			async requestUrl(request) {
				calls.push(request);
				if (response instanceof Error) throw response;
				return { status: 200, json: response };
			}
		},
		'./settings': { settingsStore: settings },
		'svelte/store': { get: (store) => store.value }
	};
	const V2 = load('src/api-v2.ts', common);
	const Router = load('src/api-router.ts', {
		...common,
		'./api-v2': V2,
		'./api': class {
			async verifyCookieValidity() {
				cookieCalls++;
				return true;
			}
		},
		'./utils/cookiesUtil': { getCookieString: () => 'wr_vid=synthetic-user' }
	});
	return {
		api: new V2(),
		router: new Router(),
		calls,
		cookieCalls: () => cookieCalls,
		protocol
	};
}

test('a failed gateway request cannot validate the configured API key', async () => {
	const f = fixture(new Error('synthetic HTTP 499 request failure'));
	assert.deepEqual(await f.api.validateApiKey(), { valid: false });
	assert.equal(f.calls.length, 1);
});

for (const response of [undefined, null]) {
	test(`a ${response} gateway payload cannot validate the API key`, async () => {
		assert.deepEqual(await fixture(response).api.validateApiKey(), { valid: false });
	});
}

test('gateway authentication errors cannot validate the API key', async () => {
	for (const errcode of [-1, 499, '499']) {
		const f = fixture({ errcode, errmsg: 'synthetic authentication failure' });
		assert.deepEqual(await f.api.validateApiKey(), { valid: false });
	}
});

test('successful objects retain the existing absent or numeric zero errcode semantics', async () => {
	// /_list is an API catalog, not a shelf. Its fields are deliberately opaque here:
	// validation must not add a books requirement or invent a catalog schema.
	for (const response of [{}, { errcode: 0 }, { errcode: 0, books: [] }]) {
		const f = fixture(response);
		assert.deepEqual(await f.api.validateApiKey(), { valid: true });
		assert.equal(f.calls.length, 1);
		assert.equal(f.calls[0].url, 'https://i.weread.qq.com/api/agent/gateway');
		assert.equal(f.calls[0].method, 'POST');
		assert.equal(f.calls[0].headers.Authorization, 'Bearer synthetic-key');
		assert.deepEqual(JSON.parse(f.calls[0].body), {
			api_name: '/_list',
			skill_version: f.protocol.WEREAD_SKILL_VERSION
		});
	}
});

test('string zero and null errcodes retain their existing invalid result', async () => {
	for (const errcode of ['0', null]) {
		assert.deepEqual(await fixture({ errcode }).api.validateApiKey(), { valid: false });
	}
});

test('direct V2 validation without an API key is false and makes no request', async () => {
	const f = fixture({}, '');
	assert.deepEqual(await f.api.validateApiKey(), { valid: false });
	assert.equal(f.calls.length, 0);
});

test('a required gateway upgrade still rejects with plugin-specific guidance', async () => {
	const f = fixture({
		upgrade_info: { latest_version: '1.0.6', message: 'download SKILL.md' }
	});
	await assert.rejects(f.router.validateApiKey(), (error) => {
		assert.ok(error instanceof f.protocol.WereadUpgradeRequiredError);
		assert.match(error.message, /1\.0\.6/);
		assert.match(error.message, /更新微信读书插件/);
		assert.doesNotMatch(error.message, /SKILL\.md/);
		return true;
	});
	assert.equal(f.cookieCalls(), 0);
});

test('configured API key failures cannot be hidden by a valid Cookie', async () => {
	for (const response of [
		new Error('synthetic network failure'),
		{ errcode: 499, errmsg: 'synthetic authentication failure' },
		undefined,
		null
	]) {
		const f = fixture(response);
		assert.deepEqual(await f.router.validateApiKey(), { valid: false });
		assert.equal(f.calls.length, 1);
		assert.equal(f.cookieCalls(), 0);
	}
});

test('the router retains Cookie validation when no API key is configured', async () => {
	const f = fixture(undefined, '');
	assert.deepEqual(await f.router.validateApiKey(), { valid: true });
	assert.equal(f.calls.length, 0);
	assert.equal(f.cookieCalls(), 1);
});
