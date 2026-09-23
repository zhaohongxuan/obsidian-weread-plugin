import { getChapterReaderUrl } from '../parser/parseResponse';

export interface WereadBookmarkLocation {
	bookId: string;
	chapterUid: number;
	rangeStart: number;
	rangeEnd: number;
	chapterTitle?: string;
	markText?: string;
}

export function parseBookmarkRange(range: string): { rangeStart: number; rangeEnd: number } {
	const [start, end] = range.split('-');
	const rangeStart = parseInt(start, 10);
	const rangeEnd = parseInt(end || start, 10);
	return {
		rangeStart: Number.isFinite(rangeStart) ? rangeStart : 0,
		rangeEnd: Number.isFinite(rangeEnd) ? rangeEnd : rangeStart
	};
}

export function getReaderUrlForBookmark(bookmark: WereadBookmarkLocation): string {
	return getChapterReaderUrl(bookmark.bookId, bookmark.chapterUid);
}

export function buildBookmarkNavigationScript(bookmark: WereadBookmarkLocation): string {
	const payload = JSON.stringify({
		rangeStart: bookmark.rangeStart,
		markText: (bookmark.markText ?? '').trim()
	});

	return `(async () => {
		const target = ${payload};
		const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

		const normalizeText = (text) =>
			(text ?? '')
				.replace(/[\\u200b\\u200c\\u200d\\ufeff]/g, '')
				.replace(/[\\u201c\\u201d\\u2018\\u2019「」]/g, '"')
				.trim();

		const waitFor = async (selector, attempts = 60) => {
			for (let i = 0; i < attempts; i++) {
				if (document.querySelector(selector)) return true;
				await sleep(250);
			}
			return false;
		};

		await waitFor('.readerControls_item.wr_note, .readerChapterContent');

		if (target.markText) {
			const needle = normalizeText(target.markText).slice(0, Math.min(normalizeText(target.markText).length, 20));
			if (needle.length >= 4) {
				const noteBtn = document.querySelector('.readerControls_item.wr_note');
				if (noteBtn instanceof HTMLElement) {
					noteBtn.click();
					await waitFor('.wr_reader_note_panel_item_cell_content_text', 40);

					const items = Array.from(
						document.querySelectorAll('.wr_reader_note_panel_item_cell_wrapper')
					);
					const match = items.find((el) => normalizeText(el.textContent).includes(needle));
					if (match instanceof HTMLElement) {
						match.click();
						await sleep(1200);
						if (normalizeText(document.body.innerText).includes(needle.slice(0, 8))) {
							return { mode: 'note-panel', needle };
						}
					}
				}
			}
		}

		if (target.markText) {
			const snippet = normalizeText(target.markText).slice(0, Math.min(normalizeText(target.markText).length, 32));
			if (snippet.length >= 4 && typeof window.find === 'function') {
				for (let page = 0; page < 80; page++) {
					if (window.find(snippet, false, false, true)) {
						return { mode: 'find', snippet, page };
					}
					const nextBtn = document.querySelector('.renderTarget_pager_button_right:not([disabled])');
					if (!(nextBtn instanceof HTMLElement)) break;
					nextBtn.click();
					await sleep(450);
				}
			}
		}

		const charPositions = window.__wereadBookmarkCharPositions || [];
		const pos = charPositions[target.rangeStart];
		if (pos) {
			window.scrollTo({ top: Math.max(0, pos.y - 160), behavior: 'auto' });
			return { mode: 'canvas-scroll', charCount: charPositions.length };
		}

		return { mode: 'chapter-only', charCount: charPositions.length };
	})()`;
}
