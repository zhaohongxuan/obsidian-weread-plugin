// Run: node --test tests/journalExclusionSettings.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { transformSync } from 'esbuild';
import * as stores from 'svelte/store';

function loadSettings() {
	const module = { exports: {} };
	const code = transformSync(readFileSync('src/settings.ts', 'utf8'), {
		loader: 'ts',
		format: 'cjs',
		target: 'es2020'
	}).code;
	new Function('require', 'module', 'exports', code)(
		(name) => {
			if (name === 'svelte/store') return stores;
			if (name === 'obsidian') return { Platform: { isDesktopApp: false } };
			if (name.endsWith('.njk')) return { default: 'synthetic template' };
			throw new Error(`Unexpected dependency: ${name}`);
		},
		module,
		module.exports
	);
	return module.exports;
}

test('exclusion ID normalization accepts finite numbers/strings and rejects malformed values', () => {
	const { normalizeJournalExcludedBookIds: normalize } = loadSettings();
	for (const value of [undefined, null, 'a,b', {}, 42, true])
		assert.deepEqual(normalize(value), []);
	assert.deepEqual(
		normalize([
			' a ',
			42,
			'42',
			'',
			'  ',
			null,
			{},
			false,
			NaN,
			Infinity,
			-Infinity,
			0,
			'a',
			'b'
		]),
		['a', '42', '0', 'b']
	);
});

test('settings load and action normalize IDs and persist through the existing pipeline without losing other data', async () => {
	const { settingsStore } = loadSettings();
	const saved = [];
	await settingsStore.initialise({
		async loadData() {
			return {
				journalExcludedBookIds: [123, ' 123 ', ' missing ', null],
				journalRefreshHours: 12,
				noteLocation: 'Synthetic',
				customData: { retained: true }
			};
		},
		async saveData(data) {
			saved.push(structuredClone(data));
		}
	});
	assert.deepEqual(stores.get(settingsStore).journalExcludedBookIds, ['123', 'missing']);
	assert.deepEqual(saved.at(-1).journalExcludedBookIds, ['123', 'missing']);
	const supplied = [' b ', 7, '7', null];
	settingsStore.actions.setJournalExcludedBookIds(supplied);
	supplied.push('late-mutation');
	assert.deepEqual(stores.get(settingsStore).journalExcludedBookIds, ['b', '7']);
	assert.deepEqual(saved.at(-1).journalExcludedBookIds, ['b', '7']);
	assert.equal(saved.at(-1).journalRefreshHours, 12);
	assert.equal(saved.at(-1).noteLocation, 'Synthetic');
	assert.deepEqual(saved.at(-1).customData, { retained: true });
	settingsStore.actions.setJournalExcludedBookIds({ malformed: true });
	await new Promise(setImmediate);
	assert.deepEqual(saved.at(-1).journalExcludedBookIds, []);
});

test('new and malformed persisted settings default to empty exclusions and include articles', async () => {
	for (const data of [
		{},
		{ journalExcludedBookIds: 'wrong' },
		...[undefined, null, 'false', 'true', 0, 1, [], {}].map((journalIncludeArticles) => ({
			journalIncludeArticles
		}))
	]) {
		const { settingsStore } = loadSettings();
		const saved = [];
		assert.equal(stores.get(settingsStore).journalIncludeArticles, true);
		await settingsStore.initialise({
			async loadData() {
				return data;
			},
			async saveData(data) {
				saved.push(structuredClone(data));
			}
		});
		assert.deepEqual(stores.get(settingsStore).journalExcludedBookIds, []);
		assert.equal(stores.get(settingsStore).journalIncludeArticles, true);
		assert.equal(saved.at(-1).journalIncludeArticles, true);
	}
});

test('persisted article inclusion retains strict booleans independently of note sync', async () => {
	for (const journalIncludeArticles of [true, false]) {
		for (const saveArticleToggle of [true, false]) {
			const { settingsStore } = loadSettings();
			const saved = [];
			await settingsStore.initialise({
				async loadData() {
					return {
						journalIncludeArticles,
						saveArticleToggle,
						journalExcludedBookIds: [42, ' book '],
						customData: { retained: true }
					};
				},
				async saveData(data) {
					saved.push(structuredClone(data));
				}
			});
			assert.equal(stores.get(settingsStore).journalIncludeArticles, journalIncludeArticles);
			assert.equal(saved.at(-1).journalIncludeArticles, journalIncludeArticles);
			assert.equal(saved.at(-1).saveArticleToggle, saveArticleToggle);
			assert.deepEqual(saved.at(-1).journalExcludedBookIds, ['42', 'book']);
			assert.deepEqual(saved.at(-1).customData, { retained: true });
		}
	}
});

test('article inclusion actions persist independently and false survives reload without losing other data', async () => {
	const { settingsStore } = loadSettings();
	const saved = [];
	await settingsStore.initialise({
		async loadData() {
			return {
				saveArticleToggle: false,
				journalExcludedBookIds: ['book', 'channel'],
				journalRefreshHours: 12,
				customData: { retained: true }
			};
		},
		async saveData(data) {
			saved.push(structuredClone(data));
		}
	});
	for (const value of [false, true, false]) {
		settingsStore.actions.setJournalIncludeArticles(value);
		assert.equal(stores.get(settingsStore).journalIncludeArticles, value);
		await new Promise(setImmediate);
		assert.equal(saved.at(-1).journalIncludeArticles, value);
		assert.equal(saved.at(-1).saveArticleToggle, false);
		assert.deepEqual(saved.at(-1).journalExcludedBookIds, ['book', 'channel']);
		assert.deepEqual(saved.at(-1).customData, { retained: true });
	}
	for (const value of [true, false]) {
		settingsStore.actions.setSaveArticleToggle(value);
		await new Promise(setImmediate);
		assert.equal(saved.at(-1).saveArticleToggle, value);
		assert.equal(saved.at(-1).journalIncludeArticles, false);
	}
	const persisted = structuredClone(saved.at(-1));
	const { settingsStore: reloaded } = loadSettings();
	const reloadedSaves = [];
	await reloaded.initialise({
		async loadData() {
			return persisted;
		},
		async saveData(data) {
			reloadedSaves.push(structuredClone(data));
		}
	});
	assert.equal(stores.get(reloaded).journalIncludeArticles, false);
	assert.equal(reloadedSaves.at(-1).journalIncludeArticles, false);
	assert.equal(reloadedSaves.at(-1).saveArticleToggle, false);
	assert.equal(reloadedSaves.at(-1).journalRefreshHours, 12);
	assert.deepEqual(reloadedSaves.at(-1).journalExcludedBookIds, ['book', 'channel']);
	assert.deepEqual(reloadedSaves.at(-1).customData, { retained: true });
});
