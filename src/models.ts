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
	publishTime: string;
	noteCount: number;
	reviewCount: number;
	isbn?: string;
	category?: string;
	publisher?: string;
	isDuplicated?: boolean;
};

export type Highlight = {
	bookmarkId: string;
	created: number;
	createTime: string;
	chapterUid: number;
	chapterTitle: string;
	markText: string;
	reviewContent?: string;
	range: string;
};

export type BookReview = {
	chapterReviews: ChapterReview[];
	bookReview: Review;
};

export type ChapterReview = {
	chapterUid: number;
	chapterTitle: string;
	chapterReview?: Review;
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
