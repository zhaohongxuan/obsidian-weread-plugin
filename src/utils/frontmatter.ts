import { Notice, parseYaml, stringifyYaml, TFile } from 'obsidian';
import type { Notebook } from '../models';

type FrontMatterContent = {
	doc_type: string;
	bookId: string;
	author: string;
	cover: string;
	noteCount: number;
	reviewCount: number;
};

export const frontMatterDocType = 'weread-highlights-reviews';

export const buildFrontMatter = (
	markdownContent: string,
	noteBook: Notebook,
	existFile?: TFile
) => {
	const frontMatter: FrontMatterContent = {
		doc_type: frontMatterDocType,
		bookId: noteBook.metaData.bookId,
		author: noteBook.metaData.author,
		cover: noteBook.metaData.cover,
		reviewCount: noteBook.metaData.reviewCount,
		noteCount: noteBook.metaData.noteCount
	};
	let existFrontMatter = Object();
	if (existFile) {
		const cache = app.metadataCache.getFileCache(existFile);
		existFrontMatter = cache.frontmatter;
		if (existFrontMatter === undefined) {
			new Notice('weread front matter invalid');
			throw Error('weread front matter invalid');
		}
		delete existFrontMatter['position'];
	}

	const idx = markdownContent.indexOf('---');
	let templateFrontMatter = Object();
	if (idx !== -1) {
		const startInd = markdownContent.indexOf('---') + 4;
		const endInd = markdownContent.substring(startInd).indexOf('---') - 1;
		const templateYmlRaw = markdownContent.substring(startInd, startInd + endInd);
		templateFrontMatter = parseYaml(templateYmlRaw);
	}
	const freshMarkdownContent = markdownContent.substring(markdownContent.lastIndexOf('---') + 4);
	const freshFrontMatter = { ...existFrontMatter, ...frontMatter, ...templateFrontMatter };
	const frontMatterStr = stringifyYaml(freshFrontMatter);
	return '---\n' + frontMatterStr + '---\n' + freshMarkdownContent;
};
