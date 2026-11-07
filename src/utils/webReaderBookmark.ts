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
	const payload = JSON.stringify({ markText: (bookmark.markText ?? '').trim() });

	return String.raw`(async () => {
		const target = ${payload};
		const token = {};
		window.__wereadBookmarkNavigationToken = token;
		const chapterUrl = location.href;
		const active = () => window.__wereadBookmarkNavigationToken === token && location.href === chapterUrl;
		const stopped = () => ({ mode: window.__wereadBookmarkNavigationToken === token ? 'chapter-only' : 'cancelled' });
		const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
		const normalize = text => (text || '').replace(/[\u200b\u200c\u200d\ufeff]/g, '')
			.replace(/[\u201c\u201d\u2018\u2019「」]/g, '"').replace(/\s+/g, '');
		const needle = normalize(target.markText);
		const snippet = target.markText.slice(0, 32);
		const excluded = element => !element || !!element.closest(
			'.wr_reader_note_panel, [class*="wr_reader_note_panel"], .preRenderContainer, .preRenderContent, [hidden], [aria-hidden="true"]'
		);
		const readerElement = element => !excluded(element) && !!element.closest('.readerChapterContent, .renderTargetContainer');
		const displayed = element => {
			for (let node = element; node instanceof Element; node = node.parentElement) {
				const style = getComputedStyle(node);
				if (style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse' || Number(style.opacity) === 0) return false;
			}
			return true;
		};
		const visibleRect = (rect, element) => {
			if (!rect || !rect.width || !rect.height || !displayed(element)) return false;
			let left = Math.max(0, rect.left), right = Math.min(innerWidth, rect.right);
			let top = Math.max(0, rect.top), bottom = Math.min(innerHeight, rect.bottom);
			for (let node = element.parentElement; node; node = node.parentElement) {
				const style = getComputedStyle(node);
				const bounds = node.getBoundingClientRect();
				if (/(auto|scroll|hidden|clip)/.test(style.overflowX)) { left = Math.max(left, bounds.left); right = Math.min(right, bounds.right); }
				if (/(auto|scroll|hidden|clip)/.test(style.overflowY)) { top = Math.max(top, bounds.top); bottom = Math.min(bottom, bounds.bottom); }
			}
			return right > left && bottom > top;
		};
		const visibleBookText = () => {
			let text = '';
			const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
			for (let node = walker.nextNode(); node; node = walker.nextNode()) {
				const element = node.parentElement;
				if (!readerElement(element)) continue;
				const range = document.createRange(); range.selectNodeContents(node);
				if (Array.from(range.getClientRects()).some(rect => visibleRect(rect, element))) text += normalize(node.textContent);
			}
			return text.includes(needle);
		};
		const validSelection = () => {
			const selection = window.getSelection();
			if (!selection || !selection.rangeCount) return false;
			const range = selection.getRangeAt(0);
			const element = range.commonAncestorContainer.nodeType === Node.ELEMENT_NODE
				? range.commonAncestorContainer : range.commonAncestorContainer.parentElement;
			const selected = normalize(selection.toString());
			return readerElement(element) && selected.length >= 4 && needle.includes(selected)
				&& Array.from(range.getClientRects()).some(rect => visibleRect(rect, element));
		};
		const canvasEntries = () => {
			const state = window.__wereadBookmarkCanvasState;
			return state && state.canvases instanceof Map ? Array.from(state.canvases.entries())
				.filter(([canvas]) => canvas.isConnected && readerElement(canvas) && displayed(canvas)) : [];
		};
		const canvasMatch = () => {
			for (const [canvas, data] of canvasEntries()) {
				const runs = data.runs || [];
				const text = runs.map(run => normalize(run.text)).join('');
				let index = text.indexOf(needle);
				if (index < 0 && needle.length >= 32) {
					const prefixIndex = text.indexOf(needle.slice(0, 32));
					if (prefixIndex >= 0 && text.length - prefixIndex < needle.length) index = prefixIndex;
				}
				if (index < 0) continue;
				for (const run of runs) {
					const length = normalize(run.text).length;
					if (index < length) return { canvas, run };
					index -= length;
				}
			}
			return null;
		};
		const canvasRect = match => {
			const rect = match.canvas.getBoundingClientRect(), run = match.run;
			const x = rect.left + run.x * rect.width / match.canvas.width;
			const y = rect.top + run.y * rect.height / match.canvas.height;
			const width = Math.max(1, run.width * rect.width / match.canvas.width);
			const height = Math.max(1, run.height * rect.height / match.canvas.height);
			return { left: x, right: x + width, top: y, bottom: y + height, width, height };
		};
		const canvasVisible = match => match && visibleRect(canvasRect(match), match.canvas);
		const proof = () => visibleBookText() || validSelection() || canvasVisible(canvasMatch());
		const pageSignature = () => JSON.stringify(canvasEntries().map(([canvas, data]) => [data.revision, canvas.width, canvas.height, (data.runs || []).map(run => run.text).join('')]));
		const hasPaint = () => canvasEntries().some(([, data]) => data.runs && data.runs.length);
		const usablePager = button => button instanceof HTMLElement && !button.hasAttribute('disabled')
			&& button.getAttribute('aria-disabled') !== 'true' && !/disabled/i.test(button.className)
			&& !/下一章|上一章|next\s*chapter|previous\s*chapter/i.test([button.textContent, button.title, button.getAttribute('aria-label')].join(' '));
		const waitForPaintChange = async before => {
			for (let attempt = 0; attempt < 12; attempt++) {
				await sleep(100);
				if (!active()) return false;
				if (pageSignature() !== before && hasPaint()) return true;
			}
			return false;
		};
		const primeLateCapture = async () => {
			const state = window.__wereadBookmarkCanvasState;
			const visibleCanvas = Array.from(document.querySelectorAll('canvas')).some(canvas => readerElement(canvas) && visibleRect(canvas.getBoundingClientRect(), canvas));
			if (!state || !(state.canvases instanceof Map) || hasPaint() || !visibleCanvas) return true;
			if (!active()) return false;
			window.dispatchEvent(new Event('resize'));
			for (let attempt = 0; attempt < 5; attempt++) {
				await sleep(100);
				if (!active()) return false;
				if (hasPaint()) return true;
			}
			const next = document.querySelector('.renderTarget_pager_button_right');
			const previousSelector = '.renderTarget_pager_button:not(.renderTarget_pager_button_right)';
			if (!usablePager(next) || !document.querySelector(previousSelector)) return false;
			const before = pageSignature();
			if (!active()) return false;
			next.click();
			if (!await waitForPaintChange(before) || !active()) return false;
			const previous = document.querySelector(previousSelector);
			if (!usablePager(previous)) return false;
			const advanced = pageSignature();
			previous.click();
			return await waitForPaintChange(advanced) && active();
		};
		const notesVisible = () => Array.from(document.querySelectorAll('.readerNotePanel, .wr_reader_note_panel, .wr_reader_note_panel_item_cell_content_text'))
			.some(element => visibleRect(element.getBoundingClientRect(), element));
		const visibleNotesPanel = () => {
			const visible = Array.from(document.querySelectorAll('.readerNotePanel, .wr_reader_note_panel_item_cell_content_text'))
				.find(element => visibleRect(element.getBoundingClientRect(), element));
			return visible && (visible.matches('.readerNotePanel') ? visible : visible.closest('.readerNotePanel'));
		};
		const finishSuccess = async result => {
			if (!active()) return stopped();
			if (notesVisible()) {
				const panel = visibleNotesPanel();
				const mask = panel && panel.parentElement && Array.from(panel.parentElement.children)
					.find(element => element.matches('.wr_mask'));
				const button = mask ? (displayed(mask) ? mask : null) : document.querySelector('.readerControls_item.wr_note');
				if (button instanceof HTMLElement) {
					if (!active()) return stopped();
					button.click();
					for (let attempt = 0; attempt < 6; attempt++) {
						await sleep(100);
						if (!active()) return stopped();
						if (!notesVisible()) break;
					}
					await sleep(150);
				}
			}
			return active() ? result : stopped();
		};
		try {
			if (needle.length < 4) return { mode: 'chapter-only' };
			for (let attempt = 0; attempt < 60 && !document.querySelector('.readerChapterContent, .renderTargetContainer'); attempt++) {
				if (!active()) return stopped();
				await sleep(250);
			}
			if (!active()) return stopped();
			if (!notesVisible()) {
				const button = document.querySelector('.readerControls_item.wr_note');
				if (button instanceof HTMLElement) {
					button.click();
					for (let attempt = 0; attempt < 40 && !notesVisible(); attempt++) {
						if (!active()) return stopped();
						await sleep(100);
					}
				}
			}
			if (!active()) return stopped();
			const items = Array.from(document.querySelectorAll('.wr_reader_note_panel_item_cell_wrapper'));
			const itemText = item => normalize((item.querySelector('.wr_reader_note_panel_item_cell_content_text') || item).textContent);
			const exact = items.filter(item => itemText(item).includes(needle));
			const prefix = exact.length ? exact : items.filter(item => itemText(item).includes(needle.slice(0, 32)));
			const match = prefix.length === 1 ? prefix[0] : null;
			if (match instanceof HTMLElement) {
				match.click();
				for (let attempt = 0; attempt < 12; attempt++) {
					if (!active()) return stopped();
					if (proof()) return await finishSuccess({ mode: 'note-panel', needle });
					await sleep(100);
				}
			}
			if (!await primeLateCapture()) return stopped();
			for (let page = 0; page < 80; page++) {
				if (!active()) return stopped();
				if (typeof window.find === 'function') {
					window.getSelection()?.removeAllRanges();
					for (let attempt = 0; attempt < 8; attempt++) {
						if (!active()) return stopped();
						if (!window.find(snippet, false, false, true)) break;
						if (validSelection()) return await finishSuccess({ mode: 'find', snippet, page });
					}
					window.getSelection()?.removeAllRanges();
				}
				const painted = canvasMatch();
				if (painted) {
					if (!canvasVisible(painted)) {
						const rect = canvasRect(painted);
						let scroller = painted.canvas.parentElement;
						while (scroller && !(scroller.scrollHeight > scroller.clientHeight && /(auto|scroll)/.test(getComputedStyle(scroller).overflowY))) scroller = scroller.parentElement;
						if (scroller) scroller.scrollTo({ top: scroller.scrollTop + rect.top - scroller.getBoundingClientRect().top - 160, behavior: 'auto' });
						else window.scrollTo({ top: Math.max(0, window.scrollY + rect.top - 160), behavior: 'auto' });
						await sleep(50);
					}
					if (!active()) return stopped();
					if (canvasVisible(painted)) return await finishSuccess({ mode: page ? 'canvas-page' : 'canvas-scroll', page });
				}
				if (!canvasEntries().some(([, data]) => data.runs && data.runs.length)) break;
				const next = document.querySelector('.renderTarget_pager_button_right');
				if (!usablePager(next)) break;
				const before = pageSignature();
				if (!active()) return stopped();
				next.click();
				let changed = false;
				for (let attempt = 0; attempt < 12; attempt++) {
					await sleep(100);
					if (!active()) return stopped();
					if (pageSignature() !== before) { changed = true; break; }
				}
				if (!changed) break;
			}
			return { mode: 'chapter-only' };
		} catch (_) {
			return active() ? { mode: 'chapter-only' } : stopped();
		}
	})()`;
}
