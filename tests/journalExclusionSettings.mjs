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
	assert.deepEqual(saved.at(-1).journalExcludedBookIds, []);
});

test('new and malformed persisted settings default to empty exclusions', async () => {
	for (const data of [{}, { journalExcludedBookIds: 'wrong' }]) {
		const { settingsStore } = loadSettings();
		await settingsStore.initialise({
			async loadData() {
				return data;
			},
			async saveData() {}
		});
		assert.deepEqual(stores.get(settingsStore).journalExcludedBookIds, []);
	}
});
