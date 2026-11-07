// Run: node --test tests/localHighlightFallback.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { transformSync } from 'esbuild';
import nunjucks from 'nunjucks';

function load(filename, mocks = {}) {
	const module = { exports: {} };
	const code = transformSync(readFileSync(filename, 'utf8'), {
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
	return module.exports;
}

const parsers = load('src/utils/localHighlightParser.ts');
const { parseLocalUserHighlights, parseLocalPopularHighlights } = parsers;
const bookId = '123';
function highlight(overrides = {}) {
	return {
		markText: 'First paragraph\n   Second paragraph',
		chapterUid: 42,
		range: '12-80',
		bookmarkId: 'bookmark-1',
		createTime: '2026-11-06 12:00:00',
		isUserHighlight: true,
		isPopular: false,
		popularCount: 37,
		...overrides
	};
}
function render(theme, highlights, id = bookId) {
	const env = new nunjucks.Environment(null, {
		autoescape: false,
		trimBlocks: true,
		lstripBlocks: true
	});
	env.addFilter('split', (value, separator) => value.split(separator));
	return env.renderString(readFileSync(`src/themes/${theme}.njk`, 'utf8'), {
		metaData: { bookId: id },
		chapterHighlights: [{ level: 1, chapterTitle: 'Chapter title', highlights }],
		bookReview: {},
		syncPopularHighlightsToggle: true
	});
}

for (const theme of ['notebookTemplate', 'separatedTemplate', 'wereadOfficialTemplate']) {
	test(`${theme}: recover multiline personal highlights and preserve location`, () => {
		const markdown = render(theme, [highlight()]);
		const result = parseLocalUserHighlights(markdown, bookId);
		assert.equal(result.updated.length, 1);
		assert.equal(result.updated[0].markText, 'First paragraph\nSecond paragraph');
		assert.equal(result.updated[0].bookId, bookId);
		assert.equal(result.updated[0].chapterUid, 42);
		assert.equal(result.updated[0].range, '12-80');
		assert.equal(result.chapters[0].chapterUid, 42);
		assert.ok(result.chapters[0].title.includes('Chapter title'));
		assert.equal(parseLocalPopularHighlights(markdown, bookId).items.length, 0);
		assert.equal(parseLocalUserHighlights(markdown, 'other-book').updated.length, 0);
	});

	test(`${theme}: recover multiline popular highlights and following count`, () => {
		const markdown = render(theme, [highlight({ isPopular: true })]);
		const personal = parseLocalUserHighlights(markdown, bookId);
		const popular = parseLocalPopularHighlights(markdown, bookId);
		assert.equal(personal.updated.length, theme === 'wereadOfficialTemplate' ? 0 : 1);
		assert.equal(popular.items.length, 1);
		assert.equal(popular.items[0].markText, 'First paragraph\nSecond paragraph');
		assert.equal(popular.items[0].totalCount, 37);
		assert.equal(popular.items[0].chapterUid, 42);
		assert.equal(popular.items[0].range, '12-80');
		assert.equal(popular.chapters[0].chapterUid, 42);
		assert.equal(parseLocalPopularHighlights(markdown, 'other-book').items.length, 0);
	});
}

test('explicit popular-only markers stay out of personal highlights', () => {
	const markdown = render('notebookTemplate', [
		highlight({ isPopular: true, isUserHighlight: false })
	]);
	assert.equal(parseLocalUserHighlights(markdown, bookId).updated.length, 0);
	assert.equal(parseLocalPopularHighlights(markdown, bookId).items[0].totalCount, 37);
});

test('official popular-only records do not infer personal ownership', () => {
	const markdown = render('wereadOfficialTemplate', [
		highlight({ isPopular: true, isUserHighlight: false })
	]);
	assert.equal(parseLocalUserHighlights(markdown, bookId).updated.length, 0);
	assert.equal(parseLocalPopularHighlights(markdown, bookId).items[0].totalCount, 37);
});

test('emoji in quote text does not change explicit personal classification', () => {
	const markdown = render('notebookTemplate', [highlight({ markText: 'A quote about 🔥 fire' })]);
	assert.equal(parseLocalUserHighlights(markdown, bookId).updated.length, 1);
	assert.equal(parseLocalPopularHighlights(markdown, bookId).items.length, 0);
});

test('multiple records preserve chapters, filter other books, and do not merge malformed links', () => {
	const link = (id, uid, start) =>
		`weread://bestbookmark?bookId=${id}&chapterUid=${uid}&rangeStart=${start}&rangeEnd=${start + 9}`;
	const markdown = [
		'## First chapter',
		'> 📌 [Malformed unfinished link',
		`> 📌 [Personal](<${link(bookId, 11, 10)}>)`,
		`> 📌 [Other book](<${link('other', 11, 20)}>)`,
		'### Second chapter',
		`> 📌🔥 [Both](<${link(bookId, 22, 30)}>)`,
		'> 🔥 17 人共读',
		`> 🔥 [Only popular](<${link(bookId, 22, 50)}>)`,
		'> 📊 23 人共读'
	].join('\r\n');
	const personal = parseLocalUserHighlights(markdown, bookId);
	assert.deepEqual(personal.updated.map((entry) => [entry.markText, entry.chapterUid, entry.range]), [
		['Personal', 11, '10-19'],
		['Both', 22, '30-39']
	]);
	assert.deepEqual(personal.chapters.map((chapter) => chapter.title), ['First chapter', 'Second chapter']);
	assert.deepEqual(parseLocalPopularHighlights(markdown, bookId).items.map((entry) => entry.totalCount), [17, 23]);
});

// View integration (popular-only offline fallback, remote priority, and foreign-book rejection)
// runs against the production panel in tests/bookDetailView.mjs rather than a private ItemView mock.
