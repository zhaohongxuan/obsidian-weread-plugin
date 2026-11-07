import { Notice, Platform } from 'obsidian';
import { get } from 'svelte/store';
import { settingsStore } from '../settings';
import type WereadPlugin from '../../main';
import { parseBookmarkRange, type WereadBookmarkLocation } from './webReaderBookmark';
import { getPcUrl } from '../parser/parseResponse';
import type { JournalNote } from '../journalHelpers';

export function buildBestBookmarkDeepLink(
	bookId: string,
	chapterUid: number,
	range: string
): string {
	const [start, end] = range.split('-');
	const rangeEnd = end || start;
	return `weread://bestbookmark?bookId=${encodeURIComponent(bookId)}&chapterUid=${chapterUid}&rangeStart=${start}&rangeEnd=${rangeEnd}`;
}

export async function openWereadDeepLink(url: string): Promise<boolean> {
	if (!url.startsWith('weread://')) {
		window.open(url);
		return true;
	}

	if (Platform.isDesktopApp) {
		try {
			const { shell } = require('electron') as {
				shell: { openExternal(url: string): Promise<void> };
			};
			await shell.openExternal(url);
			return true;
		} catch (error) {
			console.error('[weread plugin] openExternal failed', url, error);
		}
	} else {
		window.open(url);
		return true;
	}

	return false;
}

type JournalReadingTarget = Pick<JournalNote, 'bookId' | 'text'> &
	Partial<Pick<JournalNote, 'sourceUrl' | 'chapterTitle'>>;

/** Cached source URLs describe a location; they must not choose the user's reader. */
export function getJournalNoteBookmark(
	note: JournalReadingTarget
): WereadBookmarkLocation | undefined {
	if (!note.sourceUrl?.startsWith('weread://bestbookmark?')) return;
	try {
		const params = new URL(note.sourceUrl).searchParams;
		if (params.getAll('bookId').length !== 1 || params.get('bookId') !== note.bookId) return;
		const numbers = ['chapterUid', 'rangeStart', 'rangeEnd'].map((key) => {
			const values = params.getAll(key);
			if (values.length !== 1 || !/^\d+$/.test(values[0])) return NaN;
			return Number(values[0]);
		});
		if (!numbers.every((value) => Number.isSafeInteger(value) && value >= 0)) return;
		const [chapterUid, rangeStart, rangeEnd] = numbers;
		if (rangeEnd < rangeStart) return;
		return {
			bookId: note.bookId,
			chapterUid,
			rangeStart,
			rangeEnd,
			chapterTitle: note.chapterTitle,
			markText: note.text
		};
	} catch {
		return;
	}
}

export async function openJournalNoteOriginal(
	plugin: WereadPlugin,
	note: JournalReadingTarget
): Promise<void> {
	const bookmark = getJournalNoteBookmark(note);
	if (bookmark) {
		await openWereadHighlightLocation(
			plugin,
			note.bookId,
			bookmark.chapterUid,
			`${bookmark.rangeStart}-${bookmark.rangeEnd}`,
			bookmark
		);
		return;
	}
	if (get(settingsStore).bookOpenMode === 'app') {
		if (!(await openWereadDeepLink(`weread://reading?bId=${encodeURIComponent(note.bookId)}`)))
			new Notice('无法打开微信读书 App，请确认已安装客户端，或改用网页版阅读入口');
	} else {
		await plugin.openPreferredReadingView(getPcUrl(note.bookId));
	}
}

export async function openWereadHighlightLocation(
	plugin: WereadPlugin,
	bookId: string,
	chapterUid: number,
	range: string,
	context?: { chapterTitle?: string; markText?: string }
): Promise<void> {
	const settings = get(settingsStore);
	const appDeepLink = buildBestBookmarkDeepLink(bookId, chapterUid, range);

	if (settings.bookOpenMode === 'app') {
		const opened = await openWereadDeepLink(appDeepLink);
		if (opened) {
			return;
		}
		new Notice('无法打开微信读书 App，请确认已安装客户端，或改用网页版阅读入口');
		return;
	}

	const { rangeStart, rangeEnd } = parseBookmarkRange(range);
	await plugin.openPreferredReadingView(undefined, {
		bookId,
		chapterUid,
		rangeStart,
		rangeEnd,
		chapterTitle: context?.chapterTitle,
		markText: context?.markText
	});
}
