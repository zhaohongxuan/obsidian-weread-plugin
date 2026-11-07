import { Notice, WorkspaceLeaf, ItemView } from 'obsidian';
import type WereadPlugin from '../../main';
import {
	buildBookmarkNavigationScript,
	type WereadBookmarkLocation
} from '../utils/webReaderBookmark';
import { BOOKMARK_CANVAS_HOOK_SCRIPT } from '../utils/webReaderCanvas';

export const WEREAD_BROWSER_VIEW_ID = 'weread-reading-view';
const WEREAD_HOME_URL = 'https://weread.qq.com/web/shelf';
const WEREAD_PARTITION = 'persist:weread-plugin-browser';

type WereadViewState = {
	url?: string;
	bookmark?: WereadBookmarkLocation;
};

type WebviewElement = HTMLElement & {
	executeJavaScript?: (code: string, userGesture?: boolean) => Promise<unknown>;
	getURL?: () => string;
};

export class WereadReadingView extends ItemView {
	plugin: WereadPlugin;
	getViewType(): string {
		return WEREAD_BROWSER_VIEW_ID;
	}
	getDisplayText(): string {
		return '微信读书';
	}
	leaf: WorkspaceLeaf;
	private webviewEl: WebviewElement;
	private currentUrl = WEREAD_HOME_URL;
	private pendingUrl: string | null = null;
	private pendingBookmark: WereadBookmarkLocation | null = null;
	private isBootstrapped = false;
	private bookmarkNavigationTimer: number | null = null;
	private bookmarkNavigationGeneration = 0;

	constructor(leaf: WorkspaceLeaf) {
		super(leaf);
	}

	getIcon(): string {
		return 'book-open';
	}

	async onClose() {
		this.cancelBookmarkNavigation();
		this.pendingBookmark = null;
	}

	async onOpen() {
		this.webviewEl = this.contentEl.doc.createElement('webview') as WebviewElement;
		this.webviewEl.setAttribute('partition', WEREAD_PARTITION);
		this.webviewEl.setAttribute('allowpopups', '');
		this.webviewEl.addClass('weread-frame');
		// A hook in the previous document is discarded during navigation. Install in
		// the new document before the asynchronous reader paints its first page.
		this.webviewEl.addEventListener('dom-ready', () => {
			if (this.pendingBookmark) void this.installEarlyCanvasHooks();
		});
		this.webviewEl.addEventListener('did-finish-load', () => {
			if (!this.isBootstrapped) {
				this.isBootstrapped = true;
				if (this.pendingUrl) {
					const nextUrl = this.pendingUrl;
					this.pendingUrl = null;
					this.webviewEl.setAttribute('src', nextUrl);
					return;
				}
			}
			void this.installEarlyCanvasHooks().then(() => this.scheduleBookmarkNavigation());
		});

		if (this.currentUrl === WEREAD_HOME_URL) {
			this.webviewEl.setAttribute('src', WEREAD_HOME_URL);
		} else {
			this.pendingUrl = this.currentUrl;
			this.webviewEl.setAttribute('src', WEREAD_HOME_URL);
		}
		this.contentEl.appendChild(this.webviewEl);
		this.contentEl.addClass('weread-view-content');
	}

	getState(): WereadViewState {
		return {
			url: this.currentUrl,
			bookmark: this.pendingBookmark ?? undefined
		};
	}

	async setState(state: WereadViewState): Promise<void> {
		this.cancelBookmarkNavigation();
		this.currentUrl = state?.url || WEREAD_HOME_URL;
		this.pendingBookmark = state?.bookmark ?? null;
		this.loadCurrentDestination();
	}

	navigate(url: string = WEREAD_HOME_URL, bookmark?: WereadBookmarkLocation | null) {
		this.cancelBookmarkNavigation();
		this.currentUrl = url;
		this.pendingBookmark = bookmark ?? null;
		this.loadCurrentDestination();
	}

	private loadCurrentDestination(): void {
		if (!this.webviewEl) return;
		if (!this.isBootstrapped && this.currentUrl !== WEREAD_HOME_URL) {
			this.pendingUrl = this.currentUrl;
			this.webviewEl.setAttribute('src', WEREAD_HOME_URL);
			return;
		}
		this.pendingUrl = null;
		const loadedUrl = this.webviewEl.getURL?.() ?? this.webviewEl.getAttribute('src');
		if (loadedUrl === this.currentUrl) {
			// Selecting another highlight in this chapter does not cause a load event.
			if (this.pendingBookmark) {
				void this.installEarlyCanvasHooks().then(() => this.scheduleBookmarkNavigation());
			}
			return;
		}
		this.webviewEl.setAttribute('src', this.currentUrl);
	}

	private cancelBookmarkNavigation(): void {
		this.bookmarkNavigationGeneration++;
		if (this.bookmarkNavigationTimer !== null) {
			window.clearTimeout(this.bookmarkNavigationTimer);
			this.bookmarkNavigationTimer = null;
		}
		// Stop a pending page scan before a newer highlight or another book opens.
		void this.webviewEl
			?.executeJavaScript?.('window.__wereadBookmarkNavigationToken = null;')
			.catch((): void => undefined);
	}

	private async installEarlyCanvasHooks(): Promise<void> {
		if (!this.pendingBookmark || !this.webviewEl?.executeJavaScript) return;
		try {
			await this.webviewEl.executeJavaScript(BOOKMARK_CANVAS_HOOK_SCRIPT);
		} catch (error) {
			console.debug('[weread plugin] early canvas hook failed', error);
		}
	}

	private scheduleBookmarkNavigation(retry = 0): void {
		const bookmark = this.pendingBookmark;
		if (!bookmark || !this.webviewEl) return;
		const generation = this.bookmarkNavigationGeneration;
		if (this.bookmarkNavigationTimer !== null)
			window.clearTimeout(this.bookmarkNavigationTimer);
		const currentUrl = this.webviewEl.getURL?.() ?? this.webviewEl.getAttribute('src') ?? '';
		const expected = this.currentUrl.split(/[?#]/)[0];
		if (!currentUrl.includes('/web/reader/') || currentUrl.split(/[?#]/)[0] !== expected) {
			if (retry < 12) {
				this.bookmarkNavigationTimer = window.setTimeout(() => {
					if (generation === this.bookmarkNavigationGeneration)
						this.scheduleBookmarkNavigation(retry + 1);
				}, 500);
			}
			return;
		}
		this.bookmarkNavigationTimer = window.setTimeout(
			() => {
				this.bookmarkNavigationTimer = null;
				if (generation === this.bookmarkNavigationGeneration) {
					void this.applyBookmarkNavigation(bookmark, generation);
				}
			},
			retry === 0 ? 2500 : 1000
		);
	}

	private async applyBookmarkNavigation(
		bookmark: WereadBookmarkLocation,
		generation = this.bookmarkNavigationGeneration
	): Promise<void> {
		if (!this.webviewEl?.executeJavaScript) return;
		try {
			await this.installEarlyCanvasHooks();
			if (generation !== this.bookmarkNavigationGeneration) return;
			const result = await this.webviewEl.executeJavaScript(
				buildBookmarkNavigationScript(bookmark)
			);
			if (
				generation !== this.bookmarkNavigationGeneration ||
				this.pendingBookmark !== bookmark
			)
				return;
			const mode =
				result && typeof result === 'object' && 'mode' in result ? result.mode : undefined;
			if (mode === 'cancelled') return;
			console.debug('[weread plugin] bookmark navigation result', { mode });
			this.pendingBookmark = null;
			if (
				mode === 'note-panel' ||
				mode === 'find' ||
				mode === 'canvas-scroll' ||
				mode === 'canvas-page'
			)
				return;
			if (bookmark.markText) {
				new Notice('已打开对应章节，未能精确定位划线，请手动搜索划线内容');
			} else {
				new Notice('已打开对应章节');
			}
		} catch (error) {
			if (generation === this.bookmarkNavigationGeneration) {
				console.warn('[weread plugin] bookmark navigation failed', error);
			}
		}
	}
}
