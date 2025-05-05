import type {
	BookReview,
	BookReviewResponse,
	Chapter,
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
	const author = book['author'].replace(/\[(.*?)\]/g, '【$1】');
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

const convertTagToBiLink = (review: string) => {
	return review.replace(/(?<=^|\s)#([^\s]+)/g, '[[$1]]');
};

export const parseHighlights = (
	highlightData: HighlightResponse,
	reviewData: BookReviewResponse
): Highlight[] => {
	const convertTags = get(settingsStore).convertTags;

	return highlightData.updated.map((highlight) => {
		const highlightRange = highlight.range;
		let reviewContent;
		if (reviewData.reviews) {
			const review = reviewData.reviews
				.map((review) => review.review)
				.filter((review) => review.range === highlightRange)
				.first();
			if (review) {
				reviewContent = convertTags ? convertTagToBiLink(review.content) : review.content;
			}
		}

		const chapterInfo = highlightData.chapters
			.filter((chapter) => chapter.chapterUid === highlight.chapterUid)
			.first();
		const intentMarkText = addIndentToParagraphs(highlight.markText);
		return {
			bookmarkId: highlight.bookmarkId?.replace(/[_~]/g, '-'),
			created: highlight.createTime,
			createTime: window.moment(highlight.createTime * 1000).format('YYYY-MM-DD HH:mm:ss'),
			chapterUid: highlight.chapterUid,
			chapterIdx: chapterInfo?.chapterIdx || highlight.chapterUid,
			refMpReviewId: highlight.refMpReviewId,
			range: highlight.range,
			style: highlight.style,
			colorStyle: highlight.colorStyle,
			chapterTitle: chapterInfo?.title || '未知章节',
			markText: intentMarkText,
			reviewContent: addIndentToParagraphs(reviewContent)
		};
	});
};

const addIndentToParagraphs = (content: string): string => {
	if (content === undefined || content == '') {
		return content;
	}
	// 将字符串按换行符分割成段落数组
	const paragraphs = content.split('\n');

	// 遍历段落数组，从第二个段落开始前面加上两个空格
	for (let i = 1; i < paragraphs.length; i++) {
		paragraphs[i] = '   ' + paragraphs[i];
	}

	// 将段落数组重新组合成一个字符串
	return paragraphs.join('\n');
};

export const parseArticleHighlightReview = (
	chapters: Chapter[],
	highlights: Highlight[],
	reviews?: Review[]
): ChapterHighlightReview[] => {
	const chapterResult: ChapterHighlightReview[] = [];

	for (const chapter of chapters) {
		const refMpReviewId = chapter.refMpReviewId;
		const chapterTitle = chapter.title;

		// find highlights by chapterUid
		const chapterHighlights = highlights
			.filter((highlight) => highlight.refMpReviewId === refMpReviewId)
			.sort((o1, o2) => {
				const o1Start = parseInt(o1.range.split('-')[0]);
				const o2Start = parseInt(o2.range.split('-')[0]);
				return o1Start - o2Start;
			});
		let chapterReviews;
		if (chapterHighlights && chapterHighlights.length > 0 && reviews) {
			chapterReviews = reviews
				.filter((review) => refMpReviewId == review.refMpInfo?.reviewId)
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

		if (chapterHighlights && chapterHighlights.length > 0) {
			chapterResult.push({
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
export const parseChapterHighlightReview = (
	chapters: Chapter[],
	highlights: Highlight[],
	reviews?: Review[]
): ChapterHighlightReview[] => {
	const chapterResult: ChapterHighlightReview[] = [];

	for (const chapter of chapters) {
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

export const parseChapterResp = (
	chapterResp: ChapterResponse,
	highlightResp: HighlightResponse
): Chapter[] => {
	if (chapterResp === undefined) {
		return [];
	}

	if (chapterResp.data !== undefined && chapterResp.data[0].updated.length > 0) {
		return chapterResp.data[0].updated;
	}

	if (highlightResp.refMpInfos !== undefined) {
		return highlightResp.refMpInfos.map((mpInfo) => {
			return {
				refMpReviewId: mpInfo.reviewId,
				updateTime: mpInfo.createTime,
				title: mpInfo.title,
				isMPChapter: 1,
				level: 2
			};
		});
	}
	return [];
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
	const convertTags = get(settingsStore).convertTags;
	return resp.reviews.map((reviewData) => {
		const review = reviewData.review;
		const created = review.createTime;
		const createTime = window.moment(created * 1000).format('YYYY-MM-DD HH:mm:ss');

		const mdContent = review.htmlContent
			? NodeHtmlMarkdown.translate(review.htmlContent)
			: null;
		const content = mdContent || review.content;
		const finalMdContent = convertTags ? convertTagToBiLink(content) : content;

		const reviewId: string = review.reviewId;
		return {
			bookId: review.bookId,
			created: created,
			createTime: createTime,
			chapterUid: review.chapterUid,
			chapterTitle: review.chapterTitle || review.refMpInfo?.title,
			content: convertTags ? convertTagToBiLink(review.content) : review.content,
			reviewId: reviewId?.replace(/[_~]/g, '-'),
			mdContent: finalMdContent,
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
