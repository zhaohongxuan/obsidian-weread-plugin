import type {
	ChapterHighlight,
	ChapterReview,
	Highlight,
	Metadata,
	Review
} from 'src/models';
import moment from 'moment';

export const parseMetadata = (noteBook: any): Metadata => {
	const book = noteBook['book'];
	const metaData: Metadata = {
		bookId: book['bookId'],
		author: book['author'],
		title: book['title'],
		url: book['url'],
		cover: book['cover'],
		publishTime: book['publishTime'],
		noteCount: noteBook['noteCount'],
		reviewCount: noteBook['reviewCount']
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
		const created = highlight['createTime'];
		const createTime = moment(created * 1000).format('YYYY-MM-DD hh:mm:ss');
		return {
			bookId: highlight['bookId'],
			created: created,
			createTime: createTime,
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
		const created = review['createTime'];
		const createTime = moment(created * 1000).format('YYYY-MM-DD hh:mm:ss');
		return {
			bookId: review['bookId'],
			created: created,
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
	chapterResult.forEach((chapter) =>
		chapter.highlights.sort((o1, o2) => o1.created - o2.created)
	);
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
		const chapterReviews: Review[] = reviews.filter(
			(review) => review.chapterUid == review.chapterUid
		);
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
	chapterResult.forEach((chapter) =>
		chapter.reviews.sort((o1, o2) => o1.created - o2.created)
	);
	return chapterResult.sort((o1, o2) => o1.chapterUid - o2.chapterUid);
};
