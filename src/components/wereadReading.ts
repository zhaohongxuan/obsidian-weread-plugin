import { Notice, WorkspaceLeaf, ItemView } from 'obsidian';
import WereadPlugin from '../../main';
import {
	buildBookmarkNavigationScript,
	type WereadBookmarkLocation
} from '../utils/webReaderBookmark';

export const WEREAD_BROWSER_VIEW_ID = 'weread-reading-view';
const WEREAD_HOME_URL = 'https://weread.qq.com/web/shelf';
const WEREAD_PARTITION = 'persist:weread-plugin-browser';
const EARLY_CANVAS_HOOK_SCRIPT = `(function () {
	if (window.__wereadBookmarkHookInstalled) return;
	window.__wereadBookmarkHookInstalled = true;
	window.__wereadBookmarkCharPositions = [];
	const install = () => {
		for (const canvas of document.querySelectorAll('canvas')) {
			const ctx = canvas.getContext('2d');
			if (!ctx || ctx.__wereadBookmarkHook) continue;
			ctx.__wereadBookmarkHook = true;
			const orig = ctx.fillText.bind(ctx);
			ctx.fillText = function (text, x, y, ...rest) {
				for (let i = 0; i < text.length; i++) {
					window.__wereadBookmarkCharPositions.push({ x, y: y - 18 });
				}
				return orig(text, x, y, ...rest);
			};
		}
	};
	install();
	new MutationObserver(install).observe(document.documentElement, { childList: true, subtree: true });
})();`;

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

	constructor(leaf: WorkspaceLeaf) {
		super(leaf);
	}

	getIcon(): string {
		return 'book-open';
	}

	async onClose() {
		if (this.bookmarkNavigationTimer !== null) {
			window.clearTimeout(this.bookmarkNavigationTimer);
			this.bookmarkNavigationTimer = null;
		}
	}

	async onOpen() {
		this.webviewEl = this.contentEl.doc.createElement('webview') as WebviewElement;
		this.webviewEl.setAttribute('partition', WEREAD_PARTITION);
		this.webviewEl.setAttribute('allowpopups', '');
		this.webviewEl.addClass('weread-frame');
		this.webviewEl.addEventListener('did-start-loading', () => {
			if (this.pendingBookmark) {
				void this.installEarlyCanvasHooks();
			}
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

			this.scheduleBookmarkNavigation();
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
		this.currentUrl = state?.url || WEREAD_HOME_URL;
		this.pendingBookmark = state?.bookmark ?? null;
		if (!this.webviewEl) {
			return;
		}

		if (!this.isBootstrapped && this.currentUrl !== WEREAD_HOME_URL) {
			this.pendingUrl = this.currentUrl;
			this.webviewEl.setAttribute('src', WEREAD_HOME_URL);
			return;
		}

		this.pendingUrl = null;
		this.webviewEl.setAttribute('src', this.currentUrl);
	}

	navigate(url: string = WEREAD_HOME_URL, bookmark?: WereadBookmarkLocation | null) {
		this.currentUrl = url;
		this.pendingBookmark = bookmark ?? null;
		if (!this.webviewEl) {
			return;
		}

		if (!this.isBootstrapped && url !== WEREAD_HOME_URL) {
			this.pendingUrl = url;
			this.webviewEl.setAttribute('src', WEREAD_HOME_URL);
			return;
		}

		this.pendingUrl = null;
		this.webviewEl.setAttribute('src', url);
	}

	private async installEarlyCanvasHooks(): Promise<void> {
		if (!this.webviewEl?.executeJavaScript) {
			return;
		}

		try {
			await this.webviewEl.executeJavaScript(EARLY_CANVAS_HOOK_SCRIPT);
		} catch (error) {
			console.debug('[weread plugin] early canvas hook failed', error);
		}
	}

	private scheduleBookmarkNavigation(retry = 0): void {
		if (!this.pendingBookmark || !this.webviewEl) {
			return;
		}

		const currentUrl = this.webviewEl.getURL?.() ?? this.webviewEl.getAttribute('src') ?? '';
		if (!currentUrl.includes('/web/reader/')) {
			if (retry < 12) {
				this.bookmarkNavigationTimer = window.setTimeout(() => {
					this.scheduleBookmarkNavigation(retry + 1);
				}, 500);
			}
			return;
		}

		this.bookmarkNavigationTimer = window.setTimeout(() => {
			void this.applyBookmarkNavigation(this.pendingBookmark!);
		}, retry === 0 ? 2500 : 1000);
	}

	private async applyBookmarkNavigation(bookmark: WereadBookmarkLocation): Promise<void> {
		if (!this.webviewEl?.executeJavaScript) {
			return;
		}

		try {
			const result = await this.webviewEl.executeJavaScript(
				buildBookmarkNavigationScript(bookmark)
			);
			console.debug('[weread plugin] bookmark navigation result', result);
			this.pendingBookmark = null;
			if (result?.mode === 'note-panel' || result?.mode === 'find' || result?.mode === 'canvas-scroll') {
				return;
			}
			if (bookmark.markText) {
				new Notice('已打开对应章节，未能精确定位划线，请手动搜索划线内容');
			} else {
				new Notice('已打开对应章节');
			}
		} catch (error) {
			console.warn('[weread plugin] bookmark navigation failed', error);
		}
	}
}
