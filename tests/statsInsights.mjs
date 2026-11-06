// Run: node --test tests/statsInsights.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { transformSync } from 'esbuild';

const module = { exports: {} };
new Function('module', 'exports', transformSync(readFileSync('src/statsInsights.ts', 'utf8'), {
	loader: 'ts', format: 'cjs', target: 'es2020'
}).code)(module, module.exports);
const { getDailyReadingInsights: insights, niceTickLabel } = module.exports;
const date = (year, month, day, hour = 0) => new Date(year, month - 1, day, hour);
const ts = (...parts) => date(...parts).getTime() / 1000;
const buckets = (entries) => Object.fromEntries(entries.map(([parts, seconds]) => [ts(...parts), seconds]));

test('sums same-day timestamps and ignores invalid timestamps and durations', () => {
	const result = insights({
		...buckets([[[2026, 11, 2], 600], [[2026, 11, 2, 12], 1200], [[2026, 11, 3], 1800],
			[[2026, 11, 4], -1], [[2026, 11, 5], NaN], [[2026, 11, 6], Infinity]]),
		invalid: 5000, Infinity: 5000, '1e300': 5000, '': 5000
	}, 'weekly', ts(2026, 11, 2), date(2026, 11, 8));
	assert.equal(result.days[0].seconds, 1800);
	assert.equal(result.activeDays, 2);
	assert.equal(result.longestStreak, 2);
	assert.equal(result.peakDay.date.getDate(), 2, 'ties select the earliest day');
	assert.equal(result.peakDay.seconds, 1800);
	assert.equal(result.elapsedDays, 7);
});

test('uses selected period boundaries and includes today, excludes future calendar days', () => {
	const result = insights(buckets([
		[[2026, 10, 31], 600], [[2026, 11, 1], 1200], [[2026, 11, 6, 23], 1800],
		[[2026, 11, 7], 9999], [[2026, 12, 1], 9999]
	]), 'monthly', ts(2026, 11, 1), date(2026, 11, 6, 12));
	assert.equal(result.elapsedDays, 6);
	assert.equal(result.activeDays, 2);
	assert.equal(result.longestStreak, 1);
	assert.equal(result.peakDay.seconds, 1800);
	assert.equal(result.days.at(-1).date.getDate(), 6);
	const past = insights(buckets([[[2026, 11, 30], 60], [[2026, 12, 1], 5000]]),
		'monthly', ts(2026, 11, 1), date(2026, 12, 6));
	assert.equal(past.elapsedDays, 30);
	assert.equal(past.activeDays, 1);
});

test('streak breaks on missing and zero-reading days and crosses month boundaries', () => {
	const result = insights(buckets([
		[[2026, 10, 26], 60], [[2026, 10, 27], 60], [[2026, 10, 29], 60],
		[[2026, 10, 30], 60], [[2026, 10, 31], 60], [[2026, 11, 1], 60], [[2026, 11, 2], 9999]
	]), 'weekly', ts(2026, 10, 26), date(2026, 11, 6));
	assert.equal(result.longestStreak, 4);
	assert.equal(result.activeDays, 6);
	assert.equal(result.elapsedDays, 7);
	const zeroBreak = insights(buckets([[[2026, 11, 2], 60], [[2026, 11, 3], 0], [[2026, 11, 4], 60]]),
		'weekly', ts(2026, 11, 2), date(2026, 11, 8));
	assert.equal(zeroBreak.longestStreak, 1);
});

test('distinguishes no data from valid zero-reading days', () => {
	for (const input of [undefined, {}, { invalid: 60 }, buckets([[[2026, 12, 1], 60]])]) {
		const result = insights(input, 'monthly', ts(2026, 11, 1), date(2026, 11, 6));
		assert.equal(result.hasData, false);
		assert.equal(result.activeDays, 0);
		assert.equal(result.longestStreak, 0);
		assert.equal(result.peakDay, null);
	}
	const result = insights(buckets([[[2026, 11, 1], 0]]), 'monthly', ts(2026, 11, 1), date(2026, 11, 6));
	assert.equal(result.hasData, true);
	assert.equal(result.activeDays, 0);
	assert.equal(result.peakDay, null);
	assert.equal(insights({}, 'monthly', NaN).elapsedDays, 0);
	assert.equal(insights({}, 'monthly', ts(2027, 1, 1), date(2026, 11, 6)).elapsedDays, 0);
});

test('calendar arithmetic keeps days and streaks aligned through DST', () => {
	const previous = process.env.TZ;
	process.env.TZ = 'America/New_York';
	try {
		for (const [month, start] of [[3, 2], [10, 26]]) {
			const entries = Array.from({ length: 7 }, (_, index) => {
				const day = date(2026, month, start + index, 12);
				return [day.getTime() / 1000, 60];
			});
			const result = insights(Object.fromEntries(entries), 'weekly', ts(2026, month, start), date(2026, 12, 1));
			assert.equal(result.elapsedDays, 7);
			assert.equal(result.longestStreak, 7);
			assert.deepEqual(result.days.map(day => day.seconds), Array(7).fill(60));
		}
	} finally {
		if (previous === undefined) delete process.env.TZ;
		else process.env.TZ = previous;
	}
});

test('chart ticks preserve minutes when values are not whole hours', () => {
	assert.equal(niceTickLabel(35 * 60), '35分钟');
	assert.equal(niceTickLabel(70 * 60), '1小时10分');
	assert.equal(niceTickLabel(90 * 60), '1小时30分');
	assert.equal(niceTickLabel(120 * 60), '2小时');
	assert.equal(niceTickLabel(0), '0');
});
