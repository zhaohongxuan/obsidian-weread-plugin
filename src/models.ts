export type Notebook = {
	metaData: Metadata;
	chapterHighlights: ChapterHighlight[];
	chapterReviews: ChapterReview[];
};

export type Metadata = {
	bookId: string;
	author: string;
	title: string;
	url: string;
	cover: string;
	publishTime: string;
	noteCount: number;
	reviewCount: number;
};

export type Highlight = {
	bookId: string;
	created: number;
	createTime: string;
	chapterUid: number;
	chapterTitle: string;
	markText: string;
	range: string;
};
export type ChapterHighlight = {
	chapterUid: number;
	chapterTitle: string;
	highlights: Highlight[];
};

export type ChapterReview = {
	chapterUid: number;
	chapterTitle: string;
	reviews: Review[];
};

export type Review = {
	bookId: string;
	chapterUid: number;
	chapterTitle: string;
	createTime: string;
	created: number;
	content: string;
	abstract: string;
	range: string;
};

export type RenderTemplate = {
	isNewNote: boolean;
	title: string;
	author: string;
	url: string;
	cover: string;
	publishTime: string;
	chapterHighlights: ChapterHighlight[];
	chapterReviews: ChapterReview[];
};
