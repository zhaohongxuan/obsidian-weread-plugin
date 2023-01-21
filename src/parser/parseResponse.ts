import type {
	BookReview,
	ChapterHighlight,
	ChapterReview,
	DailyNoteReferenece,
	Highlight,
	Metadata,
	Notebook,
	RecentBook,
	RefBlockDetail,
	Review
} from 'src/models';
import { NodeHtmlMarkdown } from 'node-html-markdown';

export const parseMetadata = (noteBook: any): Metadata => {
	const book = noteBook['book'];
	const cover: string = book['cover'].replace('/s_', '/t7_');
	const lastReadDate = window.moment(noteBook['sort'] * 1000).format('YYYY-MM-DD');
	const metaData: Metadata = {
		bookId: book['bookId'],
		author: book['author'],
		title: book['title'],
		url: book['url'],
		cover: cover,
		publishTime: book['publishTime'],
		noteCount: noteBook['noteCount'],
		reviewCount: noteBook['reviewCount'],
		bookType: book['type'],
		lastReadDate: lastReadDate
	};
	return metaData;
};

export const parseHighlights = (highlightData: any, reviewData: any): Highlight[] => {
	const chapters: [] =
		highlightData['chapters'].length === 0
			? highlightData['refMpInfos'] || []
			: highlightData['chapters'];
	const chapterMap = new Map(
		chapters.map(
			(chapter) =>
				[chapter['chapterUid'] || chapter['reviewId'], chapter['title']] as [string, string]
		)
	);
	const highlights: [] = highlightData['updated'];
	const reviews: [] = reviewData['reviews'];
	return highlights.map((highlight) => {
		const chapterUid = highlight['chapterUid'] || highlight['refMpReviewId'];
		const created = highlight['createTime'];
		const createTime = window.moment(created * 1000).format('YYYY-MM-DD HH:mm:ss');
		const highlightRange = highlight['range'];
		let reviewContent;
		if (reviews) {
			const review = reviews
				.map((review) => review['review'])
				.filter((review) => review['range'] === highlightRange)
				.first();
			if (review) {
				reviewContent = review['content'];
			}
		}

		let bookmarkId: string = highlight['bookmarkId'];
		if (bookmarkId.startsWith('MP_WXS')) {
			bookmarkId = highlight['range'];
		}
		const markText: string = highlight['markText'];
		return {
			bookmarkId: bookmarkId.replace(/_/gi, '-'),
			created: created,
			createTime: createTime,
			chapterUid: chapterUid,
			range: highlight['range'],
			style: highlight['style'],
			chapterTitle: chapterMap.get(chapterUid),
			markText: markText.replace(/\n/gi, ''),
			reviewContent: reviewContent
		};
	});
};

export const parseChapterHighlights = (highlights: Highlight[]): ChapterHighlight[] => {
	const chapterResult: ChapterHighlight[] = [];
	for (const highlight of highlights) {
		const chapterUid = highlight['chapterUid'];
		const chapterTitle = highlight['chapterTitle'];
		const existChapter = chapterResult.find(
			(chapter) => chapter.chapterUid == highlight.chapterUid
		);
		const reviewCount = highlight.reviewContent ? 1 : 0;
		if (existChapter == null) {
			const currentHighlight = [highlight];
			const chapter = {
				chapterUid: chapterUid,
				chapterTitle: chapterTitle,
				chapterReviewCount: reviewCount,
				highlights: currentHighlight
			};
			chapterResult.push(chapter);
		} else {
			existChapter.chapterReviewCount += reviewCount;
			existChapter.highlights.push(highlight);
		}
	}
	chapterResult.forEach((chapter) =>
		chapter.highlights.sort((o1, o2) => {
			const o1Start = parseInt(o1.range.split('-')[0]);
			const o2Start = parseInt(o2.range.split('-')[0]);
			return o1Start - o2Start;
		})
	);
	return chapterResult.sort((o1, o2) => o1.chapterUid - o2.chapterUid);
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
				bookName: notebook.metaData.title,
				refBlocks: refBlocks
			});
		}
	}
	return todayHighlightBlocks;
};

export const parseReviews = (data: any): Review[] => {
	const reviews: [] = data['reviews'];
	return reviews.map((reviewData) => {
		const review = reviewData['review'];
		const created = review['createTime'];
		const createTime = window.moment(created * 1000).format('YYYY-MM-DD HH:mm:ss');
		const htmlContent = review['htmlContent'];
		const mdContent = htmlContent ? NodeHtmlMarkdown.translate(htmlContent) : null;
		const reviewId: string = review['reviewId'];
		return {
			bookId: review['bookId'],
			created: created,
			createTime: createTime,
			chapterUid: review['chapterUid'] || review['refMpInfo']?.['reviewId'],
			chapterTitle: review['chapterTitle'] || review['refMpInfo']?.['title'],
			content: review['content'],
			reviewId: reviewId.replace(/_/gi, '-'),
			mdContent: mdContent ? mdContent : review['content'],
			range: review['range'],
			abstract: review['abstract'],
			type: review['type']
		};
	});
};

export const parseRecentBooks = (data: []): RecentBook[] => {
	return data.map((book) => {
		return {
			bookId: book['bookId'],
			title: book['title'],
			recentTime: book['readUpdateTime']
		};
	});
};

export const parseChapterReviews = (reviewData: any): BookReview => {
	const reviews = parseReviews(reviewData);
	const chapterReviews = reviews
		.filter((review) => review.type == 1)
		.sort((o1, o2) => o2.created - o1.created);

	const entireReviews = reviews.filter((review) => review.type == 4);
	const chapterResult = new Map();
	for (const review of chapterReviews) {
		const chapterUid = review['chapterUid'];
		const chapterTitle = review['chapterTitle'];
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
