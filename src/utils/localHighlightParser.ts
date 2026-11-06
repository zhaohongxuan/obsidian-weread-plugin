import type { HighlightResponse } from '../models';

const DEEPLINK_RE =
	/weread:\/\/bestbookmark\?bookId=([^&]+)&chapterUid=(\d+)&rangeStart=(\d+)&rangeEnd=(\d+)/;

const POPULAR_COUNT_RE = /(?:📊|🔥)\s*(\d+)\s*人共读/;
const HIGHLIGHT_START_RE = /^>\s*(?:📌(?:🔥)?|🔥)?\s*\[/;

function getHighlightBlocks(content: string) {
	const lines = content.replace(/\r\n/g, '\n').split('\n');
	const blocks: { line: string; nextLine: string; chapterTitle: string }[] = [];
	let chapterTitle = '未知章节';

	for (let i = 0; i < lines.length; i++) {
		const chapterMatch = lines[i].match(/^#{2,4}\s+(.+)$/);
		if (chapterMatch) {
			chapterTitle = chapterMatch[1].trim();
			continue;
		}
		if (!HIGHLIGHT_START_RE.test(lines[i])) continue;

		let line = lines[i];
		while (!line.includes('](<weread://bestbookmark?') && i + 1 < lines.length) {
			const nextLine = lines[i + 1];
			if (/^#{1,6}\s/.test(nextLine) || HIGHLIGHT_START_RE.test(nextLine)) break;
			line += '\n' + nextLine.replace(/^ {3}/, '');
			i++;
		}
		blocks.push({ line, nextLine: lines[i + 1] ?? '', chapterTitle });
	}
	return blocks;
}

function parseHighlightLine(
	line: string,
	nextLine: string,
	bookId: string,
	chapterTitle: string,
	chapters: HighlightResponse['chapters'],
	chapterMap: Map<number, { title: string; chapterIdx: number }>,
	includeUser: boolean,
	includePopular: boolean
): HighlightResponse['updated'][number] | null {
	const textMatch = line.match(/^>\s*(📌(?:🔥)?|🔥)?\s*\[([\s\S]+)\]\(<([^>]+)>\)/);
	if (!textMatch) return null;

	const marker = textMatch[1] ?? '';
	// The official theme omits markers; its count is on the following line.
	const isPopular = marker.includes('🔥') || POPULAR_COUNT_RE.test(nextLine);
	const isUser = marker.includes('📌') || (!marker && !isPopular);
	if (includeUser && !isUser) return null;
	if (includePopular && !isPopular) return null;
	if (!includeUser && !includePopular) return null;

	const markText = textMatch[2].trim();
	const deeplink = textMatch[3];
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
	for (const { line, nextLine, chapterTitle } of getHighlightBlocks(content)) {
		const highlight = parseHighlightLine(
			line,
			nextLine,
			bookId,
			chapterTitle,
			chapters,
			chapterMap,
			true,
			false
		);
		if (!highlight) continue;

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
	for (const { line, nextLine, chapterTitle } of getHighlightBlocks(content)) {
		const highlight = parseHighlightLine(
			line,
			nextLine,
			bookId,
			chapterTitle,
			chapters as HighlightResponse['chapters'],
			chapterMap,
			false,
			true
		);
		if (!highlight) continue;

		const countMatch = nextLine.match(POPULAR_COUNT_RE);
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
