export interface JournalNote {
	id: string;
	bookId: string;
	bookTitle: string;
	author: string;
	cover?: string;
	kind: 'highlight' | 'thought';
	text: string;
	/** Unix time in milliseconds. */
	createTime: number;
	chapterTitle?: string;
	sourceUrl?: string;
}

export type JournalObject = Record<string, unknown>;
export interface JournalRevision {
	noteCount: number;
	reviewCount: number;
	bookmarkCount?: number;
	sort?: number;
}

export const journalObject = (value: unknown): JournalObject =>
	value !== null && typeof value === 'object' && !Array.isArray(value)
		? (value as JournalObject)
		: {};
const rows = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
const text = (value: unknown): string => (typeof value === 'string' ? value : '');
export const journalId = (value: unknown): string =>
	typeof value === 'string'
		? value
		: typeof value === 'number' && Number.isFinite(value)
			? String(value)
			: '';

export function journalBookId(value: unknown): string {
	const row = journalObject(value);
	return journalId(row.bookId) || journalId(journalObject(row.book).bookId);
}

export function journalBooks(value: unknown[]): JournalObject[] {
	const seen = new Set<string>();
	return value.map(journalObject).filter((book) => {
		const id = journalBookId(book);
		if (!id || seen.has(id)) return false;
		seen.add(id);
		return true;
	});
}

export function journalRevision(book: JournalObject): JournalRevision | undefined {
	const count = (value: unknown): value is number =>
		typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
	if (!count(book.noteCount) || !count(book.reviewCount)) return undefined;
	return {
		noteCount: book.noteCount,
		reviewCount: book.reviewCount,
		...(count(book.bookmarkCount) ? { bookmarkCount: book.bookmarkCount } : {}),
		...(count(book.sort) && book.sort > 0 ? { sort: book.sort } : {})
	};
}

export function sameJournalRevision(
	left: JournalRevision | undefined,
	right: JournalRevision | undefined
): boolean {
	return (
		left !== undefined &&
		right !== undefined &&
		left.noteCount === right.noteCount &&
		left.reviewCount === right.reviewCount &&
		left.bookmarkCount === right.bookmarkCount &&
		left.sort === right.sort
	);
}

export function journalMetadata(book: JournalObject): {
	bookId: string;
	bookTitle: string;
	author: string;
	cover?: string;
} {
	const nested = journalObject(book.book);
	const cover = (text(nested.cover) || text(book.cover)).replace('/s_', '/t7_');
	return {
		bookId: journalBookId(book),
		bookTitle: text(nested.title) || text(book.title),
		author: text(nested.author) || text(book.author),
		...(cover ? { cover } : {})
	};
}

/** Source fields use Unix seconds. Invalid or unknown dates are excluded. */
function milliseconds(value: unknown): number | undefined {
	if (typeof value !== 'number' && (typeof value !== 'string' || value.trim() === '')) {
		return undefined;
	}
	const time = Number(value) * 1000;
	return Number.isFinite(time) && time > 0 && time <= 8.64e15 ? time : undefined;
}

function sourceUrl(bookId: string, note: JournalObject): string | undefined {
	const chapter = journalId(note.chapterUid);
	const range = /^(\d+)-(\d+)$/.exec(text(note.range));
	if (!/^\d+$/.test(chapter) || !range || Number(range[2]) < Number(range[1])) {
		return undefined;
	}
	return (
		`weread://bestbookmark?bookId=${encodeURIComponent(bookId)}` +
		`&chapterUid=${chapter}&rangeStart=${range[1]}&rangeEnd=${range[2]}`
	);
}

/** Independent of Obsidian and note-rendering preferences; keeps original source IDs. */
export function parseJournalNotes(
	notebook: unknown,
	highlights: unknown,
	reviews: unknown
): JournalNote[] {
	const metadata = journalMetadata(journalObject(notebook));
	if (!metadata.bookId) return [];
	const root = journalObject(highlights);
	const chapters = new Map(
		rows(root.chapters).map((value) => {
			const chapter = journalObject(value);
			return [journalId(chapter.chapterUid), text(chapter.title)];
		})
	);
	const notes = new Map<string, JournalNote>();
	const add = (
		kind: JournalNote['kind'],
		sourceId: string,
		content: unknown,
		source: JournalObject
	): void => {
		const createTime = milliseconds(source.createTime);
		const value = text(content).trim();
		if (!sourceId || !value || createTime === undefined) return;
		if (source.bookId !== undefined && journalId(source.bookId) !== metadata.bookId) return;
		const id = `${metadata.bookId}:${kind}:${sourceId}`;
		const chapterTitle =
			text(source.chapterName) ||
			text(source.chapterTitle) ||
			chapters.get(journalId(source.chapterUid));
		const url = sourceUrl(metadata.bookId, source);
		notes.set(id, {
			...metadata,
			id,
			kind,
			text: value,
			createTime,
			...(chapterTitle ? { chapterTitle } : {}),
			...(url ? { sourceUrl: url } : {})
		});
	};
	for (const value of rows(root.updated)) {
		const highlight = journalObject(value);
		if (highlight.type === 0 || highlight.type === '0') continue;
		add('highlight', journalId(highlight.bookmarkId), highlight.markText, highlight);
	}
	for (const value of rows(journalObject(reviews).reviews)) {
		const wrapper = journalObject(value);
		const review = journalObject(wrapper.review ?? wrapper);
		add(
			'thought',
			journalId(review.reviewId) || journalId(wrapper.reviewId),
			review.content,
			review
		);
	}
	return sortJournalNotes([...notes.values()]);
}

export function sortJournalNotes(notes: JournalNote[]): JournalNote[] {
	return notes.sort((a, b) => b.createTime - a.createTime || a.id.localeCompare(b.id));
}

/** Existing router methods can return undefined or a truncated first review page. */
export function journalSourceComplete(
	response: unknown,
	kind: 'highlight' | 'thought',
	expected?: number
): boolean {
	const root = journalObject(response);
	if (root.errcode !== undefined && root.errcode !== 0) return false;
	if (root.hasMore === true || root.hasMore === 1 || root.hasMore === '1') return false;
	const items = kind === 'highlight' ? root.updated : root.reviews;
	if (!Array.isArray(items)) return false;
	const ids = new Set<string>();
	for (const value of items) {
		const wrapper = journalObject(value);
		const item = kind === 'thought' ? journalObject(wrapper.review ?? wrapper) : wrapper;
		if (kind === 'highlight' && (item.type === 0 || item.type === '0')) continue;
		const id = journalId(
			kind === 'highlight' ? item.bookmarkId : (item.reviewId ?? wrapper.reviewId)
		);
		if (!id) return false;
		ids.add(id);
	}
	const total = root.totalCount;
	return (
		(expected === undefined || ids.size >= expected) &&
		(typeof total !== 'number' || ids.size >= total)
	);
}

export function validJournalNote(value: unknown, bookId: string): value is JournalNote {
	const note = journalObject(value);
	return (
		note.bookId === bookId &&
		(note.kind === 'highlight' || note.kind === 'thought') &&
		typeof note.id === 'string' &&
		note.id.startsWith(`${bookId}:${note.kind}:`) &&
		note.id.length > `${bookId}:${note.kind}:`.length &&
		['bookTitle', 'author', 'text'].every((key) => typeof note[key] === 'string') &&
		['cover', 'chapterTitle', 'sourceUrl'].every(
			(key) => note[key] === undefined || typeof note[key] === 'string'
		) &&
		typeof note.createTime === 'number' &&
		Number.isFinite(note.createTime) &&
		note.createTime > 0 &&
		note.createTime <= 8.64e15
	);
}
