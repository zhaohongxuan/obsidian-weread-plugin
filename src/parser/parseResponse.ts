import type { ChapterHighlight, Highlight, Metadata } from 'src/models';
import moment from 'moment';

export const parseMetadata = (noteBook: any): Metadata => {
	const book = noteBook['book'];
	const cover: string = book['cover'].replace('/s_', '/t6_');
	const metaData: Metadata = {
		bookId: book['bookId'],
		author: book['author'],
		title: book['title'],
		url: book['url'],
		cover: cover,
		publishTime: book['publishTime'],
		noteCount: noteBook['noteCount'],
		reviewCount: noteBook['reviewCount']
	};
	return metaData;
};

export const parseHighlights = (highlightData: any, reviewData: any): Highlight[] => {
	const chapters: [] = highlightData['chapters'];
	const chapterMap = new Map(
		chapters.map((chapter) => [chapter['chapterUid'], chapter['title']] as [string, string])
	);
	const highlights: [] = highlightData['updated'];
	const reviews: [] = reviewData['reviews'];

	return highlights.map((highlight) => {
		const chapterUid = highlight['chapterUid'];
		const created = highlight['createTime'];
		const createTime = moment(created * 1000).format('YYYY-MM-DD HH:mm:ss');
		const highlightRange = highlight['range'];
		const review = reviews
			.map((review) => review['review'])
			.filter((review) => review['range'] === highlightRange)
			.first();
		let reviewContent;
		if (review) {
			reviewContent = review['content'];
		}
		return {
			bookId: highlight['bookId'],
			created: created,
			createTime: createTime,
			chapterUid: highlight['chapterUid'],
			range: highlight['range'],
			chapterTitle: chapterMap.get(chapterUid),
			markText: highlight['markText'],
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
		chapter.highlights.sort((o1, o2) => o1.created - o2.created)
	);
	return chapterResult.sort((o1, o2) => o1.chapterUid - o2.chapterUid);
};
