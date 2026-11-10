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
		store.actions.setQuoteShareUsername('  分享昵称  ');
		await new Promise(setImmediate);
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
	store.actions.setQuoteShareUsername('   ');
	await new Promise(setImmediate);
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
