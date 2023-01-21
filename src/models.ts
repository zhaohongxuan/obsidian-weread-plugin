import { TFile } from 'obsidian';

export type Notebook = {
	metaData: Metadata;
	chapterHighlights: ChapterHighlight[];
	bookReview: BookReview;
};

export type Metadata = {
	bookId: string;
	author: string;
	title: string;
	url: string;
	cover: string;
	bookType: number;
	publishTime: string;
	noteCount: number;
	reviewCount: number;
	isbn?: string;
	category?: string;
	publisher?: string;
	intro?: string;
	duplicate?: boolean;
	lastReadDate: string;
	file?: AnnotationFile;
};

export type Highlight = {
	bookmarkId: string;
	created: number;
	createTime: string;
	chapterUid: number;
	chapterTitle: string;
	markText: string;
	style: number;
	reviewContent?: string;
	range: string;
};

export type BookReview = {
	chapterReviews: ChapterReview[];
	bookReviews: Review[];
};

export type ChapterReview = {
	chapterUid: number;
	chapterTitle: string;
	chapterReviews?: Review[];
	reviews: Review[];
};

export type Review = {
	reviewId: string;
	chapterUid?: number;
	chapterTitle?: string;
	created: number;
	createTime: string;
	content: string;
	mdContent?: string;
	abstract?: string;
	range?: string;
	type: number;
};

export type ChapterHighlight = {
	chapterUid: number;
	chapterTitle: string;
	chapterReviewCount: number;
	highlights: Highlight[];
};

export type RenderTemplate = {
	metaData: Metadata;
	chapterHighlights: ChapterHighlight[];
	bookReview: BookReview;
};

export type DailyNoteReferenece = {
	bookName: string;
	refBlocks: RefBlockDetail[];
};

export type RefBlockDetail = {
	refBlockId: string;
	createTime: number;
};

export type AnnotationFile = {
	bookId?: string;
	noteCount: number;
	reviewCount: number;
	new: boolean;
	file: TFile;
};

export type RecentBook = {
	bookId: string;
	title: string;
	recentTime: number;
};
