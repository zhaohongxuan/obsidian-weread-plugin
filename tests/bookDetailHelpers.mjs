import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';
import { build } from 'esbuild';

const require = createRequire(import.meta.url);
const compiled = await build({
	stdin: {
		contents: `export * from './src/bookDetailHelpers'; export { parseJournalNotes } from './src/journalHelpers';`,
		resolveDir: process.cwd(),
		loader: 'ts'
	},
	bundle: true,
	platform: 'node',
	format: 'cjs',
	write: false
});
const module = { exports: {} };
new Function('require', 'module', 'exports', compiled.outputFiles[0].text)(
	require,
	module,
	module.exports
);
const { bookDetailFavoriteNote, parseJournalNotes } = module.exports;
const book = {
	bookId: 'one',
	title: 'A book',
	author: 'An author',
	cover: 'https://example.invalid/s_cover.jpg'
};
const highlight = {
	bookId: 'one',
	bookmarkId: 'original-id',
	type: 1,
	createTime: 1700000000,
	chapterUid: 2,
	range: '10-20',
	markText: 'A real quote'
};
const chapters = [{ chapterUid: 2, title: 'A chapter', chapterIdx: 1 }];

test('detail favorites use exact Journal identity, original source, seconds conversion and Canvas snapshot', () => {
	const note = bookDetailFavoriteNote(book, highlight, chapters);
	assert.deepEqual(note, parseJournalNotes(book, { updated: [highlight], chapters }, {})[0]);
	assert.equal(note.id, 'one:highlight:original-id');
	assert.equal(note.createTime, 1700000000000);
	assert.equal(note.chapterTitle, 'A chapter');
	assert.equal(
		note.sourceUrl,
		'weread://bestbookmark?bookId=one&chapterUid=2&rangeStart=10&rangeEnd=20'
	);
	assert.equal(note.cover, 'https://example.invalid/t7_cover.jpg');
	assert.equal(note.author, 'An author');
});

test('local fallback never promotes synthesized ID, date or source to favorites', () => {
	assert.equal(bookDetailFavoriteNote(book, highlight, chapters, true), undefined);
	assert.equal(
		bookDetailFavoriteNote(
			book,
			{ ...highlight, bookmarkId: 'one-2-10-20', createTime: 0 },
			chapters,
			true
		),
		undefined
	);
});

test('missing original IDs or valid creation times are ineligible', () => {
	for (const bookmarkId of [undefined, '', '   ', {}, NaN])
		assert.equal(
			bookDetailFavoriteNote(book, { ...highlight, bookmarkId }, chapters),
			undefined
		);
	for (const createTime of [undefined, '', 0, -1, NaN, Infinity, 'not-a-date'])
		assert.equal(
			bookDetailFavoriteNote(book, { ...highlight, createTime }, chapters),
			undefined
		);
});

test('deleted type zero and highlights from another book cannot be favorited', () => {
	for (const type of [0, '0'])
		assert.equal(bookDetailFavoriteNote(book, { ...highlight, type }, chapters), undefined);
	assert.equal(
		bookDetailFavoriteNote(book, { ...highlight, bookId: 'another-book' }, chapters),
		undefined
	);
});

test('absent source location stays absent instead of inventing a range', () => {
	const note = bookDetailFavoriteNote(
		book,
		{ ...highlight, range: undefined, chapterUid: undefined },
		[]
	);
	assert.equal(note.sourceUrl, undefined);
	assert.equal(note.chapterTitle, undefined);
});

test('cross-book identity stays distinct for equal bookmark IDs', () => {
	const first = bookDetailFavoriteNote(book, highlight, chapters);
	const second = bookDetailFavoriteNote(
		{ ...book, bookId: 'two' },
		{ ...highlight, bookId: 'two' },
		chapters
	);
	assert.notEqual(first.id, second.id);
	assert.equal(second.id, 'two:highlight:original-id');
});
