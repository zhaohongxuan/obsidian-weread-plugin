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
		refMpReviewId?: string;
	}[];
	removed: any[];
	chapters: {
		bookId: string;
		chapterUid: number;
		chapterIdx: number;
		title: string;
	}[];
	refMpInfos?: {
		reviewId: string;
		title: string;
		pic_url: string;
		createTime: number;
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
			refMpInfo: {
				reviewId: string;
				title: string;
				pic_url: string;
				createTime: number;
			};
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

export type BookReadInfoResponse = {
	finishedBookCount: number;
	finishedBookIndex: number;
	finishedDate: number;
	readingBookCount: number;
	readingBookDate: number;
	readingProgress: number;
	readingReviewId: string;
	canCancelReadstatus: number;
	markedStatus: number;
	readingTime: number;
	totalReadDay: number;
	recordReadingTime: number;
	continueReadDays: number;
	continueBeginDate: number;
	continueEndDate: number;
	showSummary: number;
	showDetail: number;
	readDetail: {
		totalReadingTime: number;
		totalReadDay: number;
		continueReadDays: number;
		continueBeginDate: number;
		continueEndDate: number;
		beginReadingDate: number;
		lastReadingDate: number;
		longestReadingDate: number;
		avgReadingTime: number;
		longestReadingTime: number;
		data: {
			readDate: number;
			readTime: number;
		}[];
	};
	bookInfo: {
		bookId: string;
		title: string;
		author: string;
		translator: string;
		intro: string;
		cover: string;
		version: number;
		format: string;
		type: number;
		soldout: number;
		bookStatus: number;
		payType: number;
		finished: number;
		maxFreeChapter: number;
		free: number;
		mcardDiscount: number;
		ispub: number;
		extra_type: number;
		cpid: number;
		publishTime: string;
		lastChapterIdx: number;
		paperBook: {
			skuId: string;
		};
		centPrice: number;
		readingCount: number;
		maxfreeInfo: {
			maxfreeChapterIdx: number;
			maxfreeChapterUid: number;
			maxfreeChapterRatio: number;
		};
		blockSaveImg: number;
		language: string;
		hideUpdateTime: boolean;
		isEPUBComics: number;
		webBookControl: number;
	};
};

export type BookDetailResponse = {
	bookId: string;
	title: string;
	author: string;
	cover: string;
	version: number;
	format: string;
	type: number;
	price: number;
	originalPrice: number;
	soldout: number;
	bookStatus: number;
	payType: number;
	intro: string;
	centPrice: number;
	finished: number;
	maxFreeChapter: number;
	free: number;
	mcardDiscount: number;
	ispub: number;
	extra_type: number;
	cpid: number;
	publishTime: string;
	category: string;
	categories: {
		categoryId: number;
		subCategoryId: number;
		categoryType: number;
		title: string;
	}[];
	hasLecture: number;
	lastChapterIdx: number;
	paperBook: { skuId: string };
	blockSaveImg: number;
	language: string;
	hideUpdateTime: boolean;
	isEPUBComics: number;
	webBookControl: number;
	payingStatus: number;
	chapterSize: number;
	updateTime: number;
	onTime: number;
	lastChapterCreateTime: number;
	unitPrice: number;
	marketType: number;
	isbn: string;
	publisher: string;
	totalWords: number;
	bookSize: number;
	shouldHideTTS: number;
	recommended: number;
	lectureRecommended: number;
	follow: number;
	secret: number;
	offline: number;
	lectureOffline: number;
	finishReading: number;
	hideReview: number;
	hideFriendMark: number;
	blacked: number;
	isAutoPay: number;
	availables: number;
	paid: number;
	isChapterPaid: number;
	showLectureButton: number;
	wxtts: number;
	ratingCount: number;
	newRating: number;
	newRatingCount: number;
	newRatingDetail: {
		good: number;
		fair: number;
		poor: number;
		recent: number;
		myRating: string;
		title: string;
	};
};

export type Chapter = {
	chapterUid?: number;
	chapterIdx?: number;
	updateTime: number;
	title: string;
	isMPChapter: number;
	refMpReviewId?: string;
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
	readInfo?: {
		markedStatus: number;
		readingTime: number;
		totalReadDay: number;
		continueReadDays: number;
		readingBookCount: number;
		readingBookDate: number;
		finishedBookCount: number;
		finishedBookIndex: number;
		finishedDate: number;
		readingProgress: number;
	};
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
	refMpReviewId?: string;
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
	refMpInfo?: {
		reviewId: string;
		title: string;
		pic_url: string;
		createTime: number;
	};
};

export type ChapterHighlightReview = {
	chapterUid?: number;
	chapterIdx?: number;
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
