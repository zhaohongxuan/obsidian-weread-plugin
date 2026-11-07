// Run: node --test tests/reviewChapterTitles.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import { transformSync } from 'esbuild';
import { get, writable } from 'svelte/store';

const require = createRequire(import.meta.url);
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
	return module.exports;
}

const settingsStore = writable({ convertTags: false, syncPopularHighlightsToggle: false });
const common = { 'svelte/store': { get }, './settings': { settingsStore } };
const parser = load('src/parser/parseResponse.ts', {
	'../settings': { settingsStore },
	'svelte/store': { get },
	'node-html-markdown': require('node-html-markdown'),
	'crypto-js': require('crypto-js')
});
const { Renderer } = load('src/renderer.ts', { ...common, nunjucks: require('nunjucks') });
const renderer = new Renderer();
globalThis.window = { moment: (value) => ({ format: () => `time-${value}` }) };
if (!Array.prototype.first)
	Object.defineProperty(Array.prototype, 'first', {
		value() {
			return this[0];
		},
		configurable: true
	});
const template = readFileSync('src/themes/notebookTemplate.njk', 'utf8');
const chapter = (chapterUid, title) => ({
	chapterUid,
	title,
	chapterIdx: chapterUid,
	level: 1,
	isMPChapter: 0
});
const review = (overrides = {}) => ({
	review: {
		bookId: 'fixture-book',
		reviewId: 'review-1',
		chapterUid: 7,
		content: 'A personal thought',
		abstract: 'Quoted text',
		range: '10-20',
		createTime: 1700000000,
		type: 1,
		...overrides
	}
});
const response = (...reviews) => ({ reviews });
function render(bookReview, chapterHighlights = []) {
	return renderer.renderWithTemplate(
		template,
		{
			metaData: { bookId: 'fixture-book', title: 'Fixture book' },
			chapterHighlights,
			bookReview
		},
		true
	);
}

test('catalog title reaches the real notebook renderer when a review omits chapterTitle', () => {
	const result = parser.parseChapterReviews(response(review()), [chapter(7, 'Catalog chapter')]);
	const markdown = render(result);
	assert.match(markdown, /# 读书笔记\n## Catalog chapter\n/);
	assert.match(markdown, /A personal thought/);
});

test('a later review supplies the missing group title before the catalog fallback', () => {
	const result = parser.parseChapterReviews(
		response(
			review({ range: '10-20' }),
			review({ reviewId: 'later', range: '30-40', chapterTitle: 'Explicit later title' })
		),
		[chapter(7, 'Catalog chapter')]
	);
	assert.match(render(result), /# 读书笔记\n## Explicit later title\n/);
	assert.equal(result.chapterReviews[0].reviews.length, 2);
});

test('known review titles and explicit MP precedence survive conflicting catalog titles', () => {
	const result = parser.parseChapterReviews(
		response(
			review({ chapterTitle: 'Known title', range: '1-2', refMpInfo: { title: 'MP title' } }),
			review({ chapterTitle: 'Later conflict', range: '3-4' }),
			review({ chapterUid: 8, chapterTitle: '', refMpInfo: { title: 'Article title' } })
		),
		[chapter(7, 'Catalog conflict'), chapter(8, 'Catalog article conflict')]
	);
	assert.deepEqual(
		result.chapterReviews.map((item) => item.chapterTitle),
		['Known title', 'Article title']
	);
	assert.match(render(result), /## Article title/);
});

test('decimal string UIDs match numeric catalog UIDs, including zero, without matching missing IDs', () => {
	const result = parser.parseChapterReviews(
		response(
			review({ chapterUid: '7', reviewId: 'string-seven', range: '20-30' }),
			review({ chapterUid: 7, reviewId: 'number-seven', range: '1-2' }),
			review({ chapterUid: '0', reviewId: 'zero' }),
			review({ chapterUid: undefined, reviewId: 'missing' }),
			review({ chapterUid: null, reviewId: 'null' })
		),
		[chapter(7, 'Seven'), chapter(0, 'Zero'), chapter(undefined, 'Must not match')]
	);
	assert.equal(
		result.chapterReviews.find((item) => item.chapterTitle === 'Seven').reviews.length,
		2
	);
	assert.equal(
		result.chapterReviews.find((item) => item.chapterTitle === 'Zero').reviews[0].reviewId,
		'zero'
	);
	assert.ok(
		result.chapterReviews
			.filter((item) => item.chapterUid == null)
			.every((item) => !item.chapterTitle)
	);
	assert.match(render(result), /## Zero/);
});

test('chapter-only reviews render despite the legacy singular condition typo', () => {
	const result = parser.parseChapterReviews(response(review({ range: undefined })), [
		chapter(7, 'Chapter-only title')
	]);
	assert.deepEqual(result.chapterReviews[0].reviews, []);
	const markdown = render(result);
	assert.match(markdown, /## Chapter-only title\n### 章节评论 No.1/);
	assert.match(markdown, /A personal thought/);
});

test('range ordering, book reviews, legacy calls and missing catalog entries stay compatible', () => {
	const data = response(
		review({ reviewId: 'late', range: '30-40' }),
		review({ reviewId: 'chapter', range: undefined }),
		review({ reviewId: 'early', range: '1-2' }),
		review({ reviewId: 'book', type: 4, chapterTitle: 'Book review', range: undefined }),
		review({ reviewId: 'unmapped', chapterUid: 99, chapterName: 'Do not infer this alias' })
	);
	const before = JSON.stringify(data);
	const result = parser.parseChapterReviews(data, [chapter(7, 'Seven')]);
	assert.deepEqual(
		result.chapterReviews[0].reviews.map((item) => item.reviewId),
		['early', 'late']
	);
	assert.equal(result.chapterReviews[0].chapterReviews[0].reviewId, 'chapter');
	assert.equal(result.bookReviews[0].reviewId, 'book');
	assert.equal(result.chapterReviews[1].chapterTitle, undefined);
	assert.equal(parser.parseChapterReviews(data).chapterReviews[0].chapterTitle, undefined);
	assert.equal(JSON.stringify(data), before, 'API responses remain unmodified');
});

test('malformed IDs cannot borrow zero or absent catalog titles', () => {
	for (const chapterUid of ['', false, ' ', -1, '7x']) {
		const result = parser.parseChapterReviews(response(review({ chapterUid })), [
			chapter(0, 'Zero'),
			chapter(undefined, 'Missing'),
			chapter(7, 'Seven')
		]);
		assert.equal(result.chapterReviews[0].chapterTitle, undefined);
	}
});

test('legacy template renders catalog titles while retaining bookId and doc_type', () => {
	const bookReview = parser.parseChapterReviews(response(review()), [
		chapter(7, 'Legacy chapter')
	]);
	const legacyTemplate =
		'---\nbookId: {{metaData.bookId}}\ndoc_type: weread\n---\n' +
		'{% for chapter in bookReview.chapterReviews %}{% if chapter.reviews or chapter.chapterReview %}' +
		'## {{chapter.chapterTitle}}\n{% endif %}{% endfor %}';
	for (const trimBlocks of [false, true]) {
		const markdown = renderer.renderWithTemplate(
			legacyTemplate,
			{
				metaData: { bookId: 'fixture-book' },
				chapterHighlights: [],
				bookReview
			},
			trimBlocks
		);
		assert.match(markdown, /bookId: fixture-book\ndoc_type: weread/);
		assert.match(markdown, /## Legacy chapter/);
	}
});

test('real convertToNotebook passes its existing catalog through to review rendering', async () => {
	const catalog = [chapter(7, 'Assembly catalog title')];
	const highlightResp = {
		updated: [
			{
				bookmarkId: 'own-highlight',
				chapterUid: 7,
				markText: 'Owned text',
				range: '10-20',
				createTime: 1700000000
			}
		],
		chapters: catalog
	};
	const calls = [];
	const api = Object.fromEntries(
		Object.entries({
			getBook: undefined,
			getProgress: undefined,
			getNotebookHighlights: highlightResp,
			getNotebookReviews: response(review()),
			getChapters: { data: [{ updated: catalog }] }
		}).map(([name, value]) => [
			name,
			async () => {
				calls.push(name);
				return value;
			}
		])
	);
	const SyncNotebooks = load('src/syncNotebooks.ts', {
		...common,
		'./parser/parseResponse': parser,
		obsidian: { Notice: class {} },
		'./popularHighlightsCache': class {},
		'./syncFilter': { createSyncFilterContext() {}, evaluateMetadataSyncFilter() {} }
	}).default;
	const sync = new SyncNotebooks({}, api, {});
	const notebook = await sync.convertToNotebook({
		bookId: 'fixture-book',
		title: 'Fixture book',
		bookType: 1
	});
	assert.equal(notebook.chapterHighlights[0].chapterTitle, 'Assembly catalog title');
	assert.equal(notebook.chapterHighlights[0].highlights[0].bookmarkId, 'own-highlight');
	assert.equal(notebook.chapterHighlights[0].highlights[0].reviewContent, 'A personal thought');
	assert.equal(notebook.bookReview.chapterReviews[0].chapterTitle, 'Assembly catalog title');
	assert.match(
		render(notebook.bookReview, notebook.chapterHighlights),
		/# 读书笔记\n## Assembly catalog title/
	);
	assert.deepEqual(calls, [
		'getBook',
		'getProgress',
		'getNotebookHighlights',
		'getNotebookReviews',
		'getChapters'
	]);
});
