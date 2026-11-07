// Settings-only synthetic persistence, with no installed vault or native application.
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
	return module.exports.settingsStore;
}
const turn = () => new Promise(setImmediate);

test('favorites location defaults to empty root and preserves a pending upgrade marker across unrelated changes', async () => {
	const settings = loadSettings(),
		saved = [];
	await settings.initialise({
		loadData: async () => ({ customData: { retained: true } }),
		saveData: async (data) => saved.push(structuredClone(data))
	});
	assert.equal(stores.get(settings).favoritesCanvasFolder, '');
	assert.equal(stores.get(settings).favoritesCanvasLocationVersion, 0);
	settings.actions.setFavoritesViewMode('list');
	await turn();
	assert.equal(saved.at(-1).favoritesCanvasFolder, '');
	assert.equal(saved.at(-1).favoritesCanvasLocationVersion, 0);
	assert.deepEqual(saved.at(-1).customData, { retained: true });
});

test('location commit publishes only after awaited persistence and retains unrelated settings', async () => {
	const settings = loadSettings(),
		saved = [];
	let release;
	await settings.initialise({
		loadData: async () => ({
			noteLocation: 'Books',
			favoritesCanvasFolder: '',
			favoritesCanvasLocationVersion: 1
		}),
		saveData: async (data) => {
			if (data.favoritesCanvasFolder === 'Collection')
				await new Promise((resolve) => {
					release = resolve;
				});
			saved.push(structuredClone(data));
		}
	});
	const commit = settings.actions.commitFavoritesCanvasLocation('Collection', 1);
	await turn();
	assert.equal(stores.get(settings).favoritesCanvasFolder, '', 'not optimistic');
	release();
	await commit;
	assert.equal(stores.get(settings).favoritesCanvasFolder, 'Collection');
	assert.equal(saved.at(-1).noteLocation, 'Books');
	assert.equal(saved.at(-1).favoritesCanvasLocationVersion, 1);
});

test('settings failure leaves the effective location unchanged and subsequent commits work', async () => {
	const settings = loadSettings();
	let fail = false;
	await settings.initialise({
		loadData: async () => ({ favoritesCanvasFolder: 'Old', favoritesCanvasLocationVersion: 1 }),
		saveData: async () => {
			if (fail) throw new Error('synthetic persistence failure');
		}
	});
	fail = true;
	await assert.rejects(settings.actions.commitFavoritesCanvasLocation('New', 1));
	assert.equal(stores.get(settings).favoritesCanvasFolder, 'Old');
	fail = false;
	await settings.actions.commitFavoritesCanvasLocation('New', 1);
	assert.equal(stores.get(settings).favoritesCanvasFolder, 'New');
});

test('ordinary settings changed during location persistence cannot restore the old directory on disk', async () => {
	const settings = loadSettings(),
		saved = [];
	let release;
	await settings.initialise({
		loadData: async () => ({ favoritesCanvasFolder: 'Old', favoritesCanvasLocationVersion: 1 }),
		saveData: async (data) => {
			if (data.favoritesCanvasFolder === 'New' && !release)
				await new Promise((resolve) => {
					release = resolve;
				});
			saved.push(structuredClone(data));
		}
	});
	const commit = settings.actions.commitFavoritesCanvasLocation('New', 1);
	await turn();
	settings.actions.setFavoritesViewMode('list');
	release();
	await commit;
	await turn();
	assert.equal(saved.at(-1).favoritesCanvasFolder, 'New');
	assert.equal(saved.at(-1).favoritesViewMode, 'list');
	assert.equal(stores.get(settings).favoritesViewMode, 'list');
});

test('malformed persisted paths are retained for service validation instead of silently choosing root', async () => {
	for (const folder of ['../outside', '/absolute', 42]) {
		const settings = loadSettings();
		await settings.initialise({
			loadData: async () => ({ favoritesCanvasFolder: folder }),
			saveData: async () => {}
		});
		assert.equal(stores.get(settings).favoritesCanvasFolder, folder);
	}
});
