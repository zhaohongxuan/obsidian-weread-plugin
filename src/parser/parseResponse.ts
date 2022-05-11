import type {
	ChapterHighlight,
	ChapterReview,
	Highlight,
	Metadata,
	Review
} from 'src/models';
import moment from 'moment';

export const parseMetadata = (book: any): Metadata => {
	const metaData: Metadata = {
		bookId: book['bookId'],
		author: book['author'],
		title: book['title'],
		url: book['url'],
		cover: book['cover'],
		publishTime: book['publishTime']
	};
	return metaData;
};

export const parseHighlights = (data: any): Highlight[] => {
	const chapters: [] = data['chapters'];
	const chapterMap = new Map(
		chapters.map(
			(chapter) =>
				[chapter['chapterUid'], chapter['title']] as [string, string]
		)
	);
	const highlights: [] = data['updated'];

	return highlights.map((highlight) => {
		const chapterUid = highlight['chapterUid'];
		const createTime = moment(highlight['createTime'] * 1000).format(
			'YYYY-MM-DD hh:mm:ss'
		);
		return {
			bookId: highlight['bookId'],
			created: createTime,
			chapterUid: highlight['chapterUid'],
			range: highlight['range'],
			chapterTitle: chapterMap.get(chapterUid),
			markText: highlight['markText']
		};
	});
};

export const parseReviews = (data: any): Review[] => {
	const reviews: [] = data['reviews'];
	return reviews.map((reviewData) => {
		const review = reviewData['review'];
		const createTime = moment(review['createTime'] * 1000).format(
			'YYYY-MM-DD hh:mm:ss'
		);
		return {
			bookId: review['bookId'],
			createTime: createTime,
			chapterUid: review['chapterUid'],
			chapterTitle: review['chapterTitle'],
			range: review['range'],
			abstract: review['abstract'],
			content: review['content']
		};
	});
};

export const parseChapterHighlights = (
	highlights: Highlight[]
): ChapterHighlight[] => {
	const chapterResult: ChapterHighlight[] = [];
	for (const highlight of highlights) {
		const chapterUid = highlight['chapterUid'];
		const chapterTitle = highlight['chapterTitle'];
		const existChapter = chapterResult.find(
			(chapter) => chapter.chapterUid == highlight.chapterUid
		);
		if (existChapter == null) {
			const currentHighlight = [highlight];
			const chapter = {
				chapterUid: chapterUid,
				chapterTitle: chapterTitle,
				highlights: currentHighlight
			};
			chapterResult.push(chapter);
		} else {
			existChapter.highlights.push(highlight);
		}
	}
	for (const chapter of chapterResult) {
		chapter.highlights.sort((o1, o2) => o2.range.localeCompare(o1.range));
	}
	return chapterResult.sort((o1, o2) => o1.chapterUid - o2.chapterUid);
};

export const parseChapterReviews = (reviews: Review[]): ChapterReview[] => {
	const chapterResult: ChapterReview[] = [];

	for (const review of reviews) {
		const chapterUid = review['chapterUid'];
		const chapterTitle = review['chapterTitle'];
		const existChapter = chapterResult.find(
			(chapter) => chapter.chapterUid == review.chapterUid
		);
		const chapterReviews: Review[] = reviews
			.filter((review) => review.chapterUid == review.chapterUid)
			.sort((o1, o2) => o1.range.localeCompare(o2.range) * -1);
		if (existChapter == null) {
			const chapter = {
				chapterUid: chapterUid,
				chapterTitle: chapterTitle,
				reviews: chapterReviews
			};
			chapterResult.push(chapter);
		} else {
			existChapter.reviews.push(...chapterReviews);
		}
	}
	return chapterResult.sort((o1, o2) => o1.chapterUid - o2.chapterUid);
};
