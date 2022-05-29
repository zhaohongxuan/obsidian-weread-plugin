import * as matter from 'gray-matter';
import type { Notebook } from '../models';

type FrontMatterContent = {
	doc_type: string;
	bookId: string;
	author: string;
	cover:string
	noteCount: number;
	reviewCount: number;
};

export const frontMatterDocType = 'weread-highlights-reviews';

export const addFrontMatter = (markdownContent: string, noteBook: Notebook) => {
	const frontMatter: FrontMatterContent = {
		doc_type: frontMatterDocType,
		bookId: noteBook.metaData.bookId,
		author:noteBook.metaData.author,
		cover:noteBook.metaData.cover,
		reviewCount: noteBook.metaData.reviewCount,
		noteCount: noteBook.metaData.noteCount
	};

	return matter.stringify(markdownContent, frontMatter);
};

export const updateFrontMatter = (markdownContent: string, noteBook: Notebook,existFileContent:string) => {
	const frontMatter: FrontMatterContent = {
		doc_type: frontMatterDocType,
		bookId: noteBook.metaData.bookId,
		author:noteBook.metaData.author,
		cover:noteBook.metaData.cover,
		reviewCount: noteBook.metaData.reviewCount,
		noteCount: noteBook.metaData.noteCount
	};
	const existFrontMatter = matter(existFileContent);
	const freshFrontMatter = {...existFrontMatter.data,...frontMatter};
	return matter.stringify(markdownContent, freshFrontMatter);
};