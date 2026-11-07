import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';
import { build } from 'esbuild';

const compiled = await build({
	stdin: {
		contents: "export * from './src/favoriteBookFiles';",
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
	createRequire(import.meta.url),
	module,
	module.exports
);
const { resolveFavoriteBookFiles, isFavoriteBookPath } = module.exports;
const record = (bookId, deletedAt) => ({ note: { bookId }, deletedAt });
function fixture(entries) {
	const files = entries.map(([path]) => ({ path, extension: path.split('.').at(-1) }));
	let scans = 0;
	let reads = 0;
	return {
		vault: {
			getMarkdownFiles() {
				scans++;
				return files;
			}
		},
		metadataCache: {
			getFileCache(file) {
				reads++;
				const index = files.indexOf(file);
				assert(index >= 0, 'Metadata is requested with the indexed file object');
				return { frontmatter: entries[index][1] };
			}
		},
		counts: () => ({ scans, reads })
	};
}
const metadata = (bookId, title = 'Shared title') => ({
	doc_type: 'weread-highlights-reviews',
	bookId,
	title
});

test('numeric and string IDs use cached metadata, never titles or filename conventions', () => {
	const f = fixture([
		['Books/One.md', metadata(42)],
		['Books/Two.md', metadata('43')],
		['Books/42.md', metadata('other')],
		['Books/Unrelated.md', { bookId: 44, title: 'Shared title' }],
		['Books/Synthetic.md', metadata({ bookId: 45 })]
	]);
	const result = resolveFavoriteBookFiles(
		['42', '43', '44', '45', 'missing'].map((id) => record(id)),
		f.vault,
		f.metadataCache
	);
	assert.deepEqual({ ...result }, { 42: 'Books/One.md', 43: 'Books/Two.md' });
	assert.deepEqual(f.counts(), { scans: 1, reads: 5 });
});

test('ambiguous identity falls back, deleted favorites are excluded, special IDs are safe', () => {
	const f = fixture([
		['A.md', metadata(42)],
		['B.md', metadata('42')],
		['Deleted.md', metadata('deleted')],
		['Prototype.md', metadata('__proto__')]
	]);
	const result = resolveFavoriteBookFiles(
		[record('42'), record('deleted', 123), record('__proto__')],
		f.vault,
		f.metadataCache
	);
	assert.deepEqual({ ...result }, { ['__proto__']: 'Prototype.md' });
	assert.equal(Object.getPrototypeOf(result), null);
	assert.deepEqual(resolveFavoriteBookFiles([], f.vault, f.metadataCache), {});
	assert.equal(f.counts().scans, 1, 'No index enumeration for an empty active collection');
});

test('only canonical vault-relative Markdown paths become file references', () => {
	for (const path of [
		'/absolute.md',
		'../escape.md',
		'A/../B.md',
		'A/./B.md',
		'A//B.md',
		'https://example.test/book.md',
		'file:///book.md',
		'C:\\book.md',
		'book.md#heading',
		'book.md?query',
		'A\u0000.md',
		'A.canvas',
		'~/Book.md',
		'https:book.md'
	])
		assert.equal(isFavoriteBookPath(path), false, path);
	for (const path of [
		'Book.md',
		'Books/中文书籍.md',
		'Books/My book.md',
		'Books/C#入门.md',
		'Books/Why?.MD'
	]) {
		assert.equal(isFavoriteBookPath(path), true, path);
	}
	const f = fixture([
		['../bad.md', metadata(42)],
		['/absolute.md', metadata(42)],
		['Valid.md', metadata(42)],
		['Canvas.canvas', metadata(43)]
	]);
	assert.deepEqual(
		{ ...resolveFavoriteBookFiles([record('42'), record('43')], f.vault, f.metadataCache) },
		{ 42: 'Valid.md' }
	);
	assert.deepEqual(f.counts(), { scans: 1, reads: 1 });
});

test('literal vault filenames with punctuation, spaces and uppercase Markdown match by metadata ID', () => {
	const f = fixture([
		['Books/C#入门.md', metadata(42)],
		['Books/Why?.MD', metadata('43')],
		['Books/My book.MD', metadata(44)]
	]);
	assert.deepEqual(
		{
			...resolveFavoriteBookFiles(
				['42', '43', '44'].map((id) => record(id)),
				f.vault,
				f.metadataCache
			)
		},
		{ 42: 'Books/C#入门.md', 43: 'Books/Why?.MD', 44: 'Books/My book.MD' }
	);
	assert.deepEqual(f.counts(), { scans: 1, reads: 3 });
});

test('missing runtime indexes safely use fallback cards without adapter reads', () => {
	assert.deepEqual(resolveFavoriteBookFiles([record('42')], {}, undefined), {});
	assert.deepEqual(
		resolveFavoriteBookFiles(
			[record('42')],
			{
				getMarkdownFiles() {
					throw new Error('must not scan');
				}
			},
			undefined
		),
		{}
	);
});
