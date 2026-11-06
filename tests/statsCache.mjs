// Run: node --test tests/statsCache.mjs
// Real cache/loader code with an isolated clock and in-memory Vault adapter.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { transformSync } from 'esbuild';

function fixture(initialCache, initialNow = new Date(2026, 10, 6, 12)) {
	let now = initialNow.getTime();
	class Clock extends Date {
		constructor(...args) {
			super(...(args.length ? args : [now]));
		}
		static now() {
			return now;
		}
	}
	const settings = { value: { statsStartYear: 2026 } };
	const module = { exports: {} };
	const mocks = {
		'./wereadReadingStats.css': {},
		'../statsInsights': {},
		obsidian: { ItemView: class {}, Modal: class {} },
		'./wereadPanel': { WereadPanel: class {} },
		'../settings': { settingsStore: settings },
		'svelte/store': { get: (store) => store.value }
	};
	const code = transformSync(
		readFileSync('src/components/wereadReadingStats.ts', 'utf8') +
			'\nexport { loadDailyCache, isMonthOver };',
		{ loader: 'ts', format: 'cjs', target: 'es2020' }
	).code;
	new Function('require', 'module', 'exports', 'Date', 'setTimeout', code)(
		(name) => {
			if (!(name in mocks)) throw new Error(`Unexpected dependency: ${name}`);
			return mocks[name];
		},
		module,
		module.exports,
		Clock,
		(callback) => {
			callback();
			return 0;
		}
	);
	const cachePath = '.weread-cache/daily-stats.json';
	const files = new Map(initialCache ? [[cachePath, JSON.stringify(initialCache)]] : []);
	const writes = [];
	const vault = {
		adapter: {
			exists: async (path) => files.has(path),
			read: async (path) => {
				assert.ok(files.has(path), 'read only an in-memory fixture file');
				return files.get(path);
			},
			mkdir: async (path) => {
				files.set(path, '');
			},
			write: async (path, value) => {
				files.set(path, value);
				writes.push(path);
			}
		}
	};
	const calls = [];
	const panel = Object.create(module.exports.WereadReadingStatsPanel.prototype);
	Object.assign(panel, {
		app: { vault },
		closed: false,
		loadGeneration: 0,
		currentOffset: 0,
		data: {},
		render() {},
		apiManager: {
			async getReadingStats(mode, timestamp) {
				assert.equal(mode, 'monthly');
				const date = new Date(timestamp * 1000);
				calls.push(`${date.getFullYear()}-${date.getMonth()}`);
				const end = new Date(date.getFullYear(), date.getMonth() + 1, 0, 12);
				return { readTimes: { [Math.floor(Math.min(end.getTime(), now) / 1000)]: 60 } };
			}
		}
	});
	return {
		...module.exports,
		panel,
		vault,
		calls,
		writes,
		advance: (date) => {
			now = date.getTime();
		},
		cache: () => JSON.parse(files.get(cachePath)),
		load: (mode) =>
			panel[mode === 'annually' ? 'loadAnnualDailyData' : 'loadOverallDailyData'](panel.data)
	};
}

test('v1 daily cache migration retains data and complete leap-month markers but reopens truncated and empty months', async () => {
	const data = { '2024-1-29': 120, '2026-8-30': 60, '2026-9-10': 300 };
	const f = fixture({
		version: 1,
		data,
		fetchedMonths: ['2024-1', '2026-8', '2026-9', '2026-7']
	});
	const migrated = await f.loadDailyCache(f.vault);
	assert.equal(migrated.version, 2);
	assert.deepEqual(migrated.data, data);
	assert.deepEqual(migrated.fetchedMonths, ['2024-1', '2026-8']);
	assert.equal(f.writes.length, 0);
	assert.equal(
		f.isMonthOver(new Date(2024, 1, 1), new Date(2024, 1, 29, 23, 59, 59, 999)),
		false
	);
	assert.equal(f.isMonthOver(new Date(2024, 1, 1), new Date(2024, 2, 1)), true);
	assert.equal(f.isMonthOver(new Date(2026, 11, 1), new Date(2027, 0, 1)), true);
});

for (const mode of ['annually', 'overall']) {
	test(`${mode} daily cache refetches the current month and completes it only after rollover`, async () => {
		const f = fixture({
			version: 1,
			data: { '2026-8-30': 60, '2026-9-10': 300 },
			fetchedMonths: ['2026-8', '2026-9']
		});
		await f.load(mode);
		assert.ok(f.calls.includes('2026-9'), 'migrated incomplete October is fetched');
		assert.ok(!f.calls.includes('2026-8'), 'complete September remains cached');
		assert.ok(!f.calls.includes('2026-11'), 'future December is skipped');
		assert.ok(f.cache().fetchedMonths.includes('2026-9'));
		assert.ok(!f.cache().fetchedMonths.includes('2026-10'));
		assert.equal(f.cache().data['2026-9-10'], 300, 'existing daily records survive');
		f.calls.length = 0;
		await f.load(mode);
		assert.deepEqual(f.calls, ['2026-10'], 'only the current month is refreshed');
		f.advance(new Date(2026, 11, 1, 12));
		f.calls.length = 0;
		await f.load(mode);
		assert.deepEqual(f.calls, ['2026-10', '2026-11']);
		assert.ok(f.cache().fetchedMonths.includes('2026-10'));
		assert.ok(!f.cache().fetchedMonths.includes('2026-11'));
	});

	test(`${mode} daily cache retries failed months and discards responses after the panel changes`, async () => {
		const f = fixture({ version: 2, data: {}, fetchedMonths: [] });
		const success = f.panel.apiManager.getReadingStats;
		f.panel.apiManager.getReadingStats = async (kind, timestamp) => {
			if (new Date(timestamp * 1000).getMonth() === 9) return undefined;
			return success(kind, timestamp);
		};
		await f.load(mode);
		assert.ok(!f.cache().fetchedMonths.includes('2026-9'));
		f.calls.length = 0;
		f.panel.apiManager.getReadingStats = success;
		await f.load(mode);
		assert.deepEqual(f.calls, ['2026-9', '2026-10']);
		assert.ok(f.cache().fetchedMonths.includes('2026-9'));
		const priorCache = f.cache();
		const priorWrites = f.writes.length;
		f.panel.apiManager.getReadingStats = async (...args) => {
			const result = await success(...args);
			f.panel.loadGeneration++;
			return result;
		};
		await f.load(mode);
		assert.equal(f.writes.length, priorWrites);
		assert.deepEqual(f.cache(), priorCache);
	});
}
