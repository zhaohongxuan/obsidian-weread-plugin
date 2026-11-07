// Run: node --test tests/legacyParserSyntax.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { parse } from 'acorn';
import ts from 'typescript';

const parserSource = readFileSync(
	new URL('../src/parser/parseResponse.ts', import.meta.url),
	'utf8'
);
// Downlevel ordinary JS syntax, but keep regex literals intact, as TypeScript does in production.
const parserCode = ts.transpileModule(parserSource, {
	compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2017 }
}).outputText;

function parseLegacy(code) {
	return parse(code, { ecmaVersion: 2017, sourceType: 'script' });
}

test('legacy grammar rejects lookbehind even though current Node accepts it', () => {
	const unsupported = 'const tag = /(?<=^|\\s)#([^\\s]+)/g;';
	assert.doesNotThrow(() => parse(unsupported, { ecmaVersion: 2018 }));
	assert.throws(() => parseLegacy(unsupported), /Invalid regular expression/);
});

test('production parser module loads under pre-lookbehind JavaScript grammar', () => {
	assert.doesNotThrow(() => parseLegacy(parserCode));
});

function loadParser(convertTags = true) {
	const module = { exports: {} };
	const settings = { convertTags };
	const dependencies = {
		'node-html-markdown': { NodeHtmlMarkdown: { translate: () => '#htmlTag' } },
		'crypto-js': {},
		'../settings': { settingsStore: settings },
		'svelte/store': { get: (store) => store }
	};
	new Function('require', 'module', 'exports', 'window', parserCode)(
		(name) => {
			if (!(name in dependencies)) throw new Error(`Unexpected dependency: ${name}`);
			return dependencies[name];
		},
		module,
		module.exports,
		{ moment: () => ({ format: () => '2026-01-01 00:00:00' }) }
	);
	return module.exports;
}

function parseReview(parser, content, htmlContent) {
	return parser.parseReviews({
		reviews: [{ review: { content, htmlContent, reviewId: 'review-1', createTime: 0 } }]
	})[0];
}

const parser = loadParser();
for (const [description, input, expected] of [
	['start of review', '#标签', '[[标签]]'],
	['spaces and tabs', '  #one\t#two  ', '  [[one]]\t[[two]]  '],
	['newlines', '#one\n#two\r\n#three', '[[one]]\n[[two]]\r\n[[three]]'],
	['multiple hashtags', '#one #two #three', '[[one]] [[two]] [[three]]'],
	['punctuation remains part of a tag', '#one, #two! #中文。', '[[one,]] [[two!]] [[中文。]]'],
	[
		'embedded hashes remain unchanged',
		'word#tag ##two #one#two',
		'word#tag [[#two]] [[one#two]]'
	],
	[
		'link and punctuation boundaries',
		'[#label](https://example.test/#anchor) [[#wiki]] (#tag) #yes',
		'[#label](https://example.test/#anchor) [[#wiki]] (#tag) [[yes]]'
	],
	['Unicode whitespace', '\u00a0#one\u3000#two', '\u00a0[[one]]\u3000[[two]]'],
	['empty and bare hashtags', ' # \n#', ' # \n#'],
	['empty review', '', '']
]) {
	test(`review hashtag conversion preserves ${description}`, () => {
		const review = parseReview(parser, input);
		assert.equal(review.content, expected);
		assert.equal(review.mdContent, expected);
	});
}

test('review hashtag conversion also applies to translated HTML', () => {
	const review = parseReview(parser, '#plainTag', '<p>#htmlTag</p>');
	assert.equal(review.content, '[[plainTag]]');
	assert.equal(review.mdContent, '[[htmlTag]]');
});

test('review hashtag conversion remains optional', () => {
	const review = parseReview(loadParser(false), '#one #two');
	assert.equal(review.content, '#one #two');
	assert.equal(review.mdContent, '#one #two');
});
