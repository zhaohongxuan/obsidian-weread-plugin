import type { HighlightResponse } from '../models';

const DEEPLINK_RE =
	/weread:\/\/bestbookmark\?bookId=([^&]+)&chapterUid=(\d+)&rangeStart=(\d+)&rangeEnd=(\d+)/;

function parseHighlightLine(
	line: string,
	bookId: string,
	chapterTitle: string,
	chapters: HighlightResponse['chapters'],
	chapterMap: Map<number, { title: string; chapterIdx: number }>,
	includeUser: boolean,
	includePopular: boolean
): HighlightResponse['updated'][number] | null {
	const isUser = line.includes('📌');
	const isPopular = line.includes('🔥');
	if (includeUser && !isUser) return null;
	if (includePopular && !isPopular) return null;
	if (!includeUser && !includePopular) return null;

	const textMatch = line.match(/^>\s*(?:📌(?:🔥)?|🔥)\s*\[(.+)\]\(<([^>]+)>\)/);
	if (!textMatch) return null;

	const markText = textMatch[1].trim();
	const deeplink = textMatch[2];
	const linkMatch = deeplink.match(DEEPLINK_RE);
	if (!linkMatch || linkMatch[1] !== bookId) return null;

	const chapterUid = parseInt(linkMatch[2], 10);
	const rangeStart = linkMatch[3];
	const rangeEnd = linkMatch[4];
	if (!chapterMap.has(chapterUid)) {
		const chapterIdx = chapters.length + 1;
		chapterMap.set(chapterUid, { title: chapterTitle, chapterIdx });
		chapters.push({ bookId, chapterUid, chapterIdx, title: chapterTitle });
	}

	return {
		bookId,
		bookVersion: 0,
		chapterName: chapterTitle,
		chapterUid,
		colorStyle: isPopular && !isUser ? 2 : 1,
		contextAbstract: '',
		markText,
		range: `${rangeStart}-${rangeEnd}`,
		style: 0,
		type: 1,
		createTime: 0,
		bookmarkId: `${bookId}_${chapterUid}_${rangeStart}-${rangeEnd}`
	};
}

function parseTimestampLine(line: string): number {
	const match = line.match(/⏱\s*(\d{4}-\d{2}-\d{2})(?:\s+(\d{2}:\d{2}:\d{2}))?/);
	if (!match) return 0;
	const iso = match[2] ? `${match[1]}T${match[2]}` : `${match[1]}T00:00:00`;
	return Math.floor(new Date(iso).getTime() / 1000);
}

export function parseLocalUserHighlights(content: string, bookId: string): HighlightResponse {
	const chapters: HighlightResponse['chapters'] = [];
	const updated: HighlightResponse['updated'] = [];
	const chapterMap = new Map<number, { title: string; chapterIdx: number }>();
	let currentChapter = '未知章节';
	const lines = content.split('\n');

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		const chapterMatch = line.match(/^#{2,4}\s+(.+)$/);
		if (chapterMatch) {
			currentChapter = chapterMatch[1].trim();
			continue;
		}

		const highlight = parseHighlightLine(
			line,
			bookId,
			currentChapter,
			chapters,
			chapterMap,
			true,
			false
		);
		if (!highlight) continue;

		const nextLine = lines[i + 1] ?? '';
		highlight.createTime = parseTimestampLine(nextLine);
		updated.push(highlight);
	}

	return {
		synckey: 0,
		updated,
		removed: [],
		chapters,
		book: {
			bookId,
			version: 0,
			format: '',
			soldout: 0,
			bookStatus: 0,
			cover: '',
			title: '',
			author: '',
			coverBoxInfo: {
				blurhash: '',
				colors: [],
				dominate_color: { hex: '', hsv: [] },
				custom_cover: '',
				custom_rec_cover: ''
			}
		}
	};
}

export function parseLocalPopularHighlights(
	content: string,
	bookId: string
): { items: any[]; chapters: any[] } {
	const chapters: any[] = [];
	const items: any[] = [];
	const chapterMap = new Map<number, { title: string; chapterIdx: number }>();
	let currentChapter = '未知章节';
	const lines = content.split('\n');

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		const chapterMatch = line.match(/^#{2,4}\s+(.+)$/);
		if (chapterMatch) {
			currentChapter = chapterMatch[1].trim();
			continue;
		}

		if (!line.includes('🔥')) continue;
		const highlight = parseHighlightLine(
			line,
			bookId,
			currentChapter,
			chapters as HighlightResponse['chapters'],
			chapterMap,
			false,
			true
		);
		if (!highlight) continue;

		const countMatch = lines[i + 1]?.match(/(?:📊|🔥)\s*(\d+)\s*人共读/);
		items.push({
			bookId,
			bookmarkId: highlight.bookmarkId,
			chapterUid: highlight.chapterUid,
			range: highlight.range,
			markText: highlight.markText,
			totalCount: countMatch ? parseInt(countMatch[1], 10) : 0
		});
	}

	return { items, chapters };
}
