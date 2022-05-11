import matter from 'gray-matter';
import type { Notebook } from '../models';

type FrontMatterContent = {
	doc_type?: string;
	bookId?: string;
	author?: string;
	title?: string;
	publishTime?: string;
	noteCount?: number;
	reviewCount?: number;
};

export const frontMatterDocType = 'weread-highlights-reviews';

export const addFrontMatter = (markdownContent: string, noteBook: Notebook) => {
	const frontMatter: FrontMatterContent = {
		doc_type: frontMatterDocType,
		bookId: noteBook.metaData.bookId,
		author: noteBook.metaData.author,
		title: noteBook.metaData.title,
		publishTime: noteBook.metaData.publishTime,
		reviewCount: noteBook.metaData.reviewCount,
		noteCount: noteBook.metaData.noteCount
	};
	return matter.stringify(markdownContent, frontMatter);
};
