import { journalId, journalObject, parseJournalNotes, type JournalNote } from './journalHelpers';

/** Local Markdown parsers synthesize IDs and dates: never promote those to durable favorites. */
export function bookDetailFavoriteNote(
	book: { bookId: string; title: string; author: string; cover?: string },
	highlight: unknown,
	chapters: unknown[],
	usingLocalHighlights = false
): JournalNote | undefined {
	if (usingLocalHighlights || !journalId(journalObject(highlight).bookmarkId).trim())
		return undefined;
	return parseJournalNotes(book, { updated: [highlight], chapters }, {})[0];
}
