export type Notebook = {
	metaData: Metadata;
	chapterHighlights: ChapterHighlight[];
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
	bookId: string;
	created: number;
	createTime: string;
	chapterUid: number;
	chapterTitle: string;
	markText: string;
	reviewContent?: string;
	range: string;
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
};
