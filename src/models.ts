import { TFile } from 'obsidian';

export interface HighlightResponse {
	synckey: number;
	updated: {
		bookId: string;
		bookVersion: number;
		chapterName: string;
		chapterUid: number;
		colorStyle: number;
		contextAbstract: string;
		markText: string;
		range: string;
		style: number;
		type: number;
		createTime: number;
		bookmarkId: string;
	}[];
	removed: any[];
	chapters: {
		bookId: string;
		chapterUid: number;
		chapterIdx: number;
		title: string;
	}[];
	book: {
		bookId: string;
		version: number;
		format: string;
		soldout: number;
		bookStatus: number;
		cover: string;
		title: string;
		author: string;
		coverBoxInfo: {
			blurhash: string;
			colors: {
				key: string;
				hex: string;
			}[];
			dominate_color: {
				hex: string;
				hsv: number[];
			};
			custom_cover: string;
			custom_rec_cover: string;
		};
	};
}

export interface BookReviewResponse {
	synckey: number;
	totalCount: number;
	reviews: {
		reviewId: string;
		review: {
			abstract: string;
			atUserVids: any[];
			bookId: string;
			bookVersion: number;
			chapterName: string;
			chapterUid: number;
			content: string;
			contextAbstract: string;
			friendship: number;
			htmlContent: string;
			isPrivate: number;
			range: string;
			createTime: number;
			title: string;
			type: number;
			reviewId: string;
			userVid: number;
			topics: any[];
			isLike: number;
			isReposted: number;
			book: {
				bookId: string;
				format: string;
				version: number;
				soldout: number;
				bookStatus: number;
				type: number;
				cover: string;
				title: string;
				author: string;
				payType: number;
			};
			chapterIdx: number;
			chapterTitle: string;
			author: {
				userVid: number;
				name: string;
				avatar: string;
				isFollowing: number;
				isFollower: number;
				isHide: number;
				medalInfo: {
					id: string;
					desc: string;
					title: string;
					levelIndex: number;
				};
			};
		};
	}[];
	removed: any[];
	atUsers: any[];
	refUsers: any[];
	columns: any[];
	hasMore: number;
}

export type ChapterResponse = {
	data: {
		bookId: string;
		chapterUpdateTime: number;
		updated: Chapter[];
	}[];
};

export type Chapter = {
	chapterUid: number;
	chapterIdx: number;
	updateTime: number;
	title: string;
	isMPChapter: number;
	level: number;
};

export type Notebook = {
	metaData: Metadata;
	chapterHighlights: ChapterHighlightReview[];
	bookReview: BookReview;
};

export type Metadata = {
	bookId: string;
	author: string;
	title: string;
	url: string;
	pcUrl?: string;
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
	totalWords?: number;
	rating?: string;
};

export type Highlight = {
	bookmarkId: string;
	created: number;
	createTime: string;
	chapterUid: number;
	chapterIdx: number;
	chapterTitle: string;
	markText: string;
	style: number;
	colorStyle: number;
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

export type ChapterHighlightReview = {
	chapterUid: number;
	chapterIdx: number;
	chapterTitle: string;
	level: number;
	isMPChapter: number;
	// highlight and review can be empty, just output title
	highlights?: Highlight[];
	chapterReviews?: Review[];
};

export type RenderTemplate = {
	metaData: Metadata;
	chapterHighlights: ChapterHighlightReview[];
	bookReview: BookReview;
};

export type DailyNoteReferenece = {
	metaData: Metadata;
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
