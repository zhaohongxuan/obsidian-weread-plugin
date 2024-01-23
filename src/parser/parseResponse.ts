import type {
	BookReview,
	BookReviewResponse,
	ChapterHighlightReview,
	ChapterResponse,
	ChapterReview,
	DailyNoteReferenece,
	Highlight,
	HighlightResponse,
	Metadata,
	Notebook,
	RefBlockDetail,
	Review
} from 'src/models';
import { NodeHtmlMarkdown } from 'node-html-markdown';
import * as CryptoJS from 'crypto-js';
import { settingsStore } from '../settings';
import { get } from 'svelte/store';

export const parseMetadata = (noteBook: any): Metadata => {
	const book = noteBook['book'];
	const cover: string = book['cover'].replace('/s_', '/t7_');
	const lastReadDate = window.moment(noteBook['sort'] * 1000).format('YYYY-MM-DD');
	const bookId = book['bookId'];
	const pcUrl = getPcUrl(bookId);
	const author = book['author'].replace(/\[(.*?)\]/g, "【$1】");
	const metaData: Metadata = {
		bookId: book['bookId'],
		author: author,
		title: book['title'],
		url: book['url'],
		cover: cover,
		publishTime: book['publishTime'],
		noteCount: noteBook['noteCount'],
		reviewCount: noteBook['reviewCount'],
		bookType: book['type'],
		lastReadDate: lastReadDate,
		pcUrl: pcUrl
	};
	return metaData;
};

export const parseHighlights = (
	highlightData: HighlightResponse,
	reviewData: BookReviewResponse
): Highlight[] => {
	return highlightData.updated.map((highlight) => {
		const highlightRange = highlight.range;
		let reviewContent;
		if (reviewData.reviews) {
			const review = reviewData.reviews
				.map((review) => review.review)
				.filter((review) => review.range === highlightRange)
				.first();
			if (review) {
				reviewContent = review.content;
			}
		}

		const chapterInfo = highlightData.chapters
			.filter((chapter) => chapter.chapterUid === highlight.chapterUid)
			.first();
		return {
			bookmarkId: highlight.bookmarkId?.replace(/_/gi, '-'),
			created: highlight.createTime,
			createTime: window.moment(highlight.createTime * 1000).format('YYYY-MM-DD HH:mm:ss'),
			chapterUid: highlight.chapterUid,
			chapterIdx: chapterInfo?.chapterIdx || highlight.chapterUid,
			range: highlight.range,
			style: highlight.style,
			colorStyle: highlight.colorStyle,
			chapterTitle: chapterInfo?.title || '未知章节',
			markText: highlight.markText,
			reviewContent: reviewContent
		};
	});
};

export const parseChapterHighlightReview = (
	chapterResp: ChapterResponse,
	highlights: Highlight[],
	reviews?: Review[]
): ChapterHighlightReview[] => {
	const chapterResult: ChapterHighlightReview[] = [];

	if (chapterResp === undefined || chapterResp.data[0] === undefined) {
		return chapterResult;
	}

	for (const chapter of chapterResp.data[0].updated) {
		const chapterUid = chapter.chapterUid;
		const chapterIdx = chapter.chapterIdx;
		const chapterTitle = chapter.title;

		// find highlights by chapterUid
		const chapterHighlights = highlights
			.filter((highlight) => highlight.chapterUid == chapterUid)
			.sort((o1, o2) => {
				const o1Start = parseInt(o1.range.split('-')[0]);
				const o2Start = parseInt(o2.range.split('-')[0]);
				return o1Start - o2Start;
			});
		let chapterReviews;
		if (chapterHighlights && chapterHighlights.length > 0 && reviews) {
			chapterReviews = reviews
				.filter((review) => chapterUid == review.chapterUid && review.type == 1)
				.sort((o1, o2) => {
					if (o1.range === undefined && o2.range === undefined) {
						return 0;
					} else if (o1.range === undefined) {
						return 1;
					} else if (o2.range === undefined) {
						return -1;
					} else {
						const o1Start = parseInt(o1.range.split('-')[0]);
						const o2Start = parseInt(o2.range.split('-')[0]);
						return o1Start - o2Start;
					}
				});
		}

		const showEmptyChapterTitleToggle = get(settingsStore).showEmptyChapterTitleToggle;
		// if showEmptyChapterTitle is true, will set chapter even there is no highlight in this chapter
		if ((chapterHighlights && chapterHighlights.length > 0) || showEmptyChapterTitleToggle) {
			chapterResult.push({
				chapterUid: chapterUid,
				chapterIdx: chapterIdx,
				chapterTitle: chapterTitle,
				level: chapter.level,
				isMPChapter: chapter.isMPChapter,
				chapterReviews: chapterReviews,
				highlights: chapterHighlights
			});
		}
	}

	return chapterResult.sort((o1, o2) => o1.chapterIdx - o2.chapterIdx);
};

export const parseDailyNoteReferences = (notebooks: Notebook[]): DailyNoteReferenece[] => {
	const today = window.moment().format('YYYYMMDD');
	const todayHighlightBlocks: DailyNoteReferenece[] = [];
	for (const notebook of notebooks) {
		const chapterHighlights = notebook.chapterHighlights;
		const todayHighlights = chapterHighlights
			.flatMap((chapterHighlight) => chapterHighlight.highlights)
			.filter((highlight) => {
				const createTime = window.moment(highlight.created * 1000).format('YYYYMMDD');
				return today === createTime;
			});
		const refBlocks: RefBlockDetail[] = [];
		if (todayHighlights) {
			for (const highlight of todayHighlights) {
				refBlocks.push({
					refBlockId: highlight.bookmarkId,
					createTime: highlight.created
				});
			}
		}
		// only record book have notes
		if (refBlocks.length > 0) {
			todayHighlightBlocks.push({
				metaData: notebook.metaData,
				refBlocks: refBlocks
			});
		}
	}
	return todayHighlightBlocks;
};

export const parseReviews = (resp: BookReviewResponse): Review[] => {
	return resp.reviews.map((reviewData) => {
		const review = reviewData.review;
		const created = review.createTime;
		const createTime = window.moment(created * 1000).format('YYYY-MM-DD HH:mm:ss');
		const htmlContent = review.htmlContent;
		const mdContent = htmlContent ? NodeHtmlMarkdown.translate(htmlContent) : null;
		const reviewId: string = review.reviewId;
		return {
			bookId: review.bookId,
			created: created,
			createTime: createTime,
			chapterUid: review.chapterUid,
			chapterTitle: review.chapterTitle,
			content: review.content,
			reviewId: reviewId?.replace(/_/gi, '-'),
			mdContent: mdContent ? mdContent : review['content'],
			range: review.range,
			abstract: review.abstract,
			type: review.type
		};
	});
};

export const parseChapterReviews = (resp: BookReviewResponse): BookReview => {
	const reviews = parseReviews(resp);
	const chapterReviews = reviews.filter((review) => review.type == 1);

	chapterReviews.sort((o1, o2) => {
		if (o1.range === undefined && o2.range === undefined) {
			return 0;
		} else if (o1.range === undefined) {
			return 1;
		} else if (o2.range === undefined) {
			return -1;
		} else {
			const o1Start = parseInt(o1.range.split('-')[0]);
			const o2Start = parseInt(o2.range.split('-')[0]);
			return o1Start - o2Start;
		}
	});

	const entireReviews = reviews.filter((review) => review.type == 4);
	const chapterResult = new Map();
	for (const review of chapterReviews) {
		const chapterUid = review.chapterUid;
		const chapterTitle = review.chapterTitle;
		const existChapter = chapterResult.get(review.chapterUid);
		if (existChapter == null) {
			const chapter: ChapterReview = {
				chapterUid: chapterUid,
				chapterTitle: chapterTitle,
				reviews: [],
				chapterReviews: []
			};
			if (review.range) {
				chapter.reviews.push(review);
			} else {
				chapter.chapterReviews.push(review);
			}
			chapterResult.set(review.chapterUid, chapter);
		} else {
			const chapterRview: ChapterReview = chapterResult.get(review.chapterUid);
			if (review.range) {
				chapterRview.reviews.push(review);
			} else {
				chapterRview.chapterReviews.push(review);
			}
		}
	}
	const chapterReviewResult: ChapterReview[] = Array.from(chapterResult.values()).sort(
		(o1, o2) => o1.chapterUid - o2.chapterUid
	);
	return {
		bookReviews: entireReviews,
		chapterReviews: chapterReviewResult
	};
};

const getFa = (id: string): [string, string[]] => {
	if (/^\d*$/.test(id)) {
		const c: string[] = [];
		for (let a = 0; a < id.length; a += 9) {
			const b = id.slice(a, Math.min(a + 9, id.length));
			c.push(parseInt(b, 10).toString(16));
		}
		return ['3', c];
	}
	let d = '';
	for (let i = 0; i < id.length; i++) {
		d += id.charCodeAt(i).toString(16);
	}
	return ['4', [d]];
};

const getPcUrl = (bookId: string): string => {
	const str = CryptoJS.MD5(bookId).toString(CryptoJS.enc.Hex);
	const fa = getFa(bookId);
	let strSub = str.substr(0, 3);
	strSub += fa[0];
	strSub += '2' + str.substr(str.length - 2, 2);

	for (let j = 0; j < fa[1].length; j++) {
		const n = fa[1][j].length.toString(16);
		if (n.length === 1) {
			strSub += '0' + n;
		} else {
			strSub += n;
		}
		strSub += fa[1][j];
		if (j < fa[1].length - 1) {
			strSub += 'g';
		}
	}

	if (strSub.length < 20) {
		strSub += str.substr(0, 20 - strSub.length);
	}

	strSub += CryptoJS.MD5(strSub).toString(CryptoJS.enc.Hex).substr(0, 3);
	const prefix = 'https://weread.qq.com/web/reader/';
	return prefix + strSub;
};
