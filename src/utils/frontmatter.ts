import { Notice, parseYaml, stringifyYaml, TFile, App } from 'obsidian';
import type { Notebook } from '../models';
import { formatTimeDuration, formatTimestampToDate } from './dateUtil';
import { settingsStore } from '../settings';
import { get } from 'svelte/store';
import { hasFinishedDate, hasPositiveReadingTime } from './readingStatus';

type FrontMatterContent = {
	doc_type: string;
	bookId: string;
	title?: string;
	noteCount: number;
	reviewCount: number;
	author?: string;
	cover?: string;
	readingStatus?: string;
	progress?: string;
	readingTime?: string;
	totalReadDay?: number;
	readingDate?: string;
	finishedDate?: string;
};

export const frontMatterDocType = 'weread-highlights-reviews';

enum ReadingStatus {
	'未标记' = 1,
	'在读' = 2,
	'读过' = 3,
	'读完' = 4
}

export const buildFrontMatter = (
	markdownContent: string,
	noteBook: Notebook,
	existFile?: TFile,
	app?: App
) => {
	const frontMatter: FrontMatterContent = {
		doc_type: frontMatterDocType,
		bookId: noteBook.metaData.bookId,
		title: noteBook.metaData.title,
		reviewCount: noteBook.metaData.reviewCount,
		noteCount: noteBook.metaData.noteCount
	};

	const saveReadingInfoToggle = get(settingsStore).saveReadingInfoToggle;

	if (saveReadingInfoToggle) {
		(frontMatter.author = noteBook.metaData.author),
			(frontMatter.cover = noteBook.metaData.cover);

		const readInfo = noteBook.metaData.readInfo;
		if (readInfo) {
			if (hasFinishedDate(readInfo.finishedDate)) {
				frontMatter.readingStatus = ReadingStatus['读完'].toString();
			} else if (hasPositiveReadingTime(readInfo.readingTime)) {
				frontMatter.readingStatus = ReadingStatus['在读'].toString();
			} else {
				frontMatter.readingStatus = ReadingStatus['未标记'].toString();
			}
			frontMatter.progress =
				readInfo.readingProgress === undefined ? '-1' : readInfo.readingProgress + '%';
			frontMatter.totalReadDay = readInfo.totalReadDay;
			frontMatter.readingTime = formatTimeDuration(readInfo.readingTime);
			if (readInfo.readingBookDate) {
				frontMatter.readingDate = formatTimestampToDate(readInfo.readingBookDate);
			}
			if (hasFinishedDate(readInfo.finishedDate)) {
				frontMatter.finishedDate = formatTimestampToDate(readInfo.finishedDate);
			}
		}
	}
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
		const freshMarkdownContent = markdownContent.substring(endInd + 4);
		const freshFrontMatter = { ...existFrontMatter, ...frontMatter, ...templateFrontMatter };
		const frontMatterStr = stringifyYaml(freshFrontMatter);
		return '---\n' + frontMatterStr + freshMarkdownContent;
	}

	const frontMatterStr = stringifyYaml(frontMatter);
	return '---\n' + frontMatterStr + '---\n' + markdownContent;
};
