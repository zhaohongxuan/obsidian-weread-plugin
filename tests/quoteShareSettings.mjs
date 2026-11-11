// Run: node --test tests/quoteShareSettings.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { transformSync } from 'esbuild';
import * as stores from 'svelte/store';

function loadSettings() {
	const module = { exports: {} };
	const code = transformSync(readFileSync('src/settings.ts', 'utf8'), {
		loader: 'ts', format: 'cjs', target: 'es2020'
	}).code;
	new Function('require', 'module', 'exports', code)(
		(name) => {
			if (name === 'svelte/store') return stores;
			if (name === 'obsidian') return { Platform: { isDesktopApp: false } };
			if (name.endsWith('.njk')) return { default: 'synthetic template' };
			throw new Error(`Unexpected dependency: ${name}`);
		}, module, module.exports
	);
	return module.exports.settingsStore;
}

async function initialise(data = {}) {
	const store = loadSettings();
	const saved = [];
	await store.initialise({
		async loadData() { return structuredClone(data); },
		async saveData(next) { saved.push(structuredClone(next)); }
	});
	return { store, saved };
}

function deferred() {
	let resolve;
	const promise = new Promise((done) => { resolve = done; });
	return { promise, resolve };
}

test('nickname receipt waits for its write and queued changes save once each in order', async () => {
	const store = loadSettings();
	const saved = [];
	const started = [];
	const gates = [deferred(), deferred(), deferred()];
	let gateIndex = 0;
	let active = 0;
	let maxActive = 0;
	let gated = false;
	await store.initialise({
		async loadData() { return structuredClone(retained); },
		async saveData(next) {
			active++;
			maxActive = Math.max(maxActive, active);
			const snapshot = structuredClone(next);
			started.push(snapshot);
			if (gated) await gates[gateIndex++].promise;
			saved.push(snapshot);
			active--;
		}
	});
	saved.length = 0;
	started.length = 0;
	gated = true;
	let firstResolved = false;
	let lastResolved = false;
	const first = store.actions.setQuoteShareUsername(' first ');
	assert.ok(first instanceof Promise);
	void first.then(() => { firstResolved = true; });
	const second = store.actions.setQuoteShareUsername(' second ');
	const last = store.actions.setQuoteShareUsername(' last ');
	void last.then(() => { lastResolved = true; });
	await new Promise(setImmediate);
	assert.equal(firstResolved, false, 'receipt must wait for actual save completion');
	assert.equal(lastResolved, false);
	assert.equal(started.length, 1);
	assert.equal(saved.length, 0);
	gates[0].resolve();
	await first;
	await new Promise(setImmediate);
	assert.equal(firstResolved, true);
	assert.equal(lastResolved, false);
	assert.equal(started.length, 2);
	assert.equal(saved.length, 1);
	gates[1].resolve();
	await second;
	await new Promise(setImmediate);
	assert.equal(lastResolved, false);
	assert.equal(started.length, 3);
	gates[2].resolve();
	await last;
	assert.equal(maxActive, 1);
	assert.deepEqual(saved.map((value) => value.quoteShareUsername), ['first', 'second', 'last']);
	for (const value of saved) assertRetained(value);
	const { store: reloaded } = await initialise(saved.at(-1));
	assert.equal(stores.get(reloaded).quoteShareUsername, 'last');
});

test('failed nickname save rejects and retrying the same value persists successfully', async () => {
	const store = loadSettings();
	const saved = [];
	const failure = new Error('synthetic disk failure');
	let fail = false;
	let attempts = 0;
	await store.initialise({
		async loadData() { return structuredClone(retained); },
		async saveData(next) {
			attempts++;
			if (fail) throw failure;
			saved.push(structuredClone(next));
		}
	});
	const before = attempts;
	fail = true;
	await assert.rejects(store.actions.setQuoteShareUsername(' retry name '), (error) => error === failure);
	assert.equal(attempts, before + 1);
	assert.equal(saved.at(-1).quoteShareUsername, '');
	fail = false;
	await store.actions.setQuoteShareUsername(' retry name ');
	assert.equal(attempts, before + 2, 'each setter must enqueue exactly one save');
	assert.equal(saved.at(-1).quoteShareUsername, 'retry name');
	assertRetained(saved.at(-1));
	const { store: reloaded } = await initialise(saved.at(-1));
	assert.equal(stores.get(reloaded).quoteShareUsername, 'retry name');
});

test('nickname autosaves preserve favorites location published by an earlier queued commit', async () => {
	const store = loadSettings();
	const saved = [];
	const locationGate = deferred();
	let gate = false;
	await store.initialise({
		async loadData() { return structuredClone(retained); },
		async saveData(next) {
			if (gate && next.favoritesCanvasFolder === 'NewFavorites') {
				gate = false;
				await locationGate.promise;
			}
			saved.push(structuredClone(next));
		}
	});
	gate = true;
	const location = store.actions.commitFavoritesCanvasLocation('NewFavorites', 1);
	const nickname = store.actions.setQuoteShareUsername(' new name ');
	await new Promise(setImmediate);
	assert.equal(stores.get(store).favoritesCanvasFolder, '');
	locationGate.resolve();
	await location;
	await nickname;
	assert.equal(saved.at(-1).favoritesCanvasFolder, 'NewFavorites');
	assert.equal(saved.at(-1).favoritesCanvasLocationVersion, 1);
	assert.equal(saved.at(-1).quoteShareUsername, 'new name');
	assertRetained(saved.at(-1));
});

test('nickname setter rejects clearly before settings are loaded', async () => {
	const store = loadSettings();
	await assert.rejects(store.actions.setQuoteShareUsername('name'), /分享署名设置尚未加载/);
	assert.equal(stores.get(store).quoteShareUsername, '');
});

const retained = {
	user: '微信读书原名', userVid: '', journalIncludeArticles: false,
	journalExcludedBookIds: ['book', 'channel'], saveArticleToggle: false,
	customData: { retained: true }, syncMode: 'whitelist'
};

function assertRetained(settings) {
	assert.equal(settings.user, retained.user);
	assert.equal(settings.userVid, retained.userVid);
	assert.equal(settings.journalIncludeArticles, false);
	assert.equal(settings.saveArticleToggle, false);
	assert.deepEqual(settings.journalExcludedBookIds, retained.journalExcludedBookIds);
	assert.deepEqual(settings.customData, retained.customData);
	assert.equal(settings.syncMode, 'whitelist');
}

test('share settings default to paper and an empty override without resetting existing preferences', async () => {
	const fresh = loadSettings();
	assert.equal(stores.get(fresh).quoteShareTemplate, 'paper');
	assert.equal(stores.get(fresh).quoteShareUsername, '');
	const { store, saved } = await initialise(retained);
	assert.equal(stores.get(store).quoteShareTemplate, 'paper');
	assert.equal(stores.get(store).quoteShareUsername, '');
	assertRetained(saved.at(-1));
});

test('all templates and trimmed nickname overrides persist and survive reload', async () => {
	const { store, saved } = await initialise(retained);
	for (const template of ['paper', 'cover', 'night']) {
		store.actions.setQuoteShareTemplate(template);
		await store.actions.setQuoteShareUsername('  分享昵称  ');
		assert.equal(stores.get(store).quoteShareTemplate, template);
		assert.equal(stores.get(store).quoteShareUsername, '分享昵称');
		assert.equal(saved.at(-1).quoteShareTemplate, template);
		assert.equal(saved.at(-1).quoteShareUsername, '分享昵称');
		assertRetained(saved.at(-1));
		const { store: reloaded } = await initialise(saved.at(-1));
		assert.equal(stores.get(reloaded).quoteShareTemplate, template);
		assert.equal(stores.get(reloaded).quoteShareUsername, '分享昵称');
		assertRetained(stores.get(reloaded));
	}
	await store.actions.setQuoteShareUsername('   ');
	assert.equal(saved.at(-1).quoteShareUsername, '');
	assert.equal(saved.at(-1).user, retained.user);
	const { store: reloaded } = await initialise(saved.at(-1));
	assert.equal(stores.get(reloaded).quoteShareUsername, '');
	assertRetained(stores.get(reloaded));
});

test('malformed saved share values fall back safely and preserve unknown configuration fields', async () => {
	for (const value of [undefined, null, '', 'unknown', 'COVER', 1, {}, []]) {
		const { store, saved } = await initialise({ ...retained, quoteShareTemplate: value, quoteShareUsername: value });
		assert.equal(stores.get(store).quoteShareTemplate, 'paper');
		assert.equal(stores.get(store).quoteShareUsername, typeof value === 'string' ? value.trim() : '');
		assertRetained(saved.at(-1));
		store.actions.setQuoteShareTemplate(value);
		await new Promise(setImmediate);
		assert.equal(saved.at(-1).quoteShareTemplate, 'paper');
		assertRetained(saved.at(-1));
	}
});
