import { get } from 'svelte/store';
import { Notice } from 'obsidian';
import { settingsStore } from '../settings';
import { buildBookmarkNavigationScript, type WereadBookmarkLocation } from '../utils/webReaderBookmark';
import { BOOKMARK_CANVAS_HOOK_SCRIPT } from '../utils/webReaderCanvas';

const WEREAD_HOME_URL = 'https://weread.qq.com/web/shelf';
const WEREAD_PARTITION = 'persist:weread-plugin-browser';

export default class WereadBrowserWindow {
	private modal: any;
	private closed = false;
	private generation = 0;
	private currentUrl = WEREAD_HOME_URL;
	private pendingBookmark: WereadBookmarkLocation | null = null;
	private bookmarkNavigationTimer: number | null = null;

	constructor() {
		const { remote } = require('electron');
		const { BrowserWindow: RemoteBrowserWindow } = remote;
		this.modal = new RemoteBrowserWindow({
			parent: remote.getCurrentWindow(),
			width: 1280,
			height: 860,
			show: false,
			webPreferences: {
				partition: WEREAD_PARTITION
			}
		});

		this.modal.webContents.on('dom-ready', (): void => {
			void this.installCanvasHooks(this.generation);
		});
		this.modal.webContents.on('did-finish-load', (): void => {
			void this.prepareBookmarkNavigation(this.generation);
		});
		this.modal.on('close', (): void => {
			this.cancelBookmarkNavigation();
			this.closed = true;
			this.pendingBookmark = null;
		});
		this.modal.on('closed', (): void => {
			this.cancelBookmarkNavigation();
			this.closed = true;
			this.pendingBookmark = null;
		});
		this.modal.once('ready-to-show', () => {
			if (!this.isAlive()) return;
			this.modal.setTitle('微信读书');
			this.modal.show();
		});
	}

	async open(url: string = WEREAD_HOME_URL, bookmark?: WereadBookmarkLocation): Promise<void> {
		if (!this.isAlive()) return;
		this.cancelBookmarkNavigation();
		const generation = this.generation;
		this.currentUrl = url;
		this.pendingBookmark = bookmark ?? null;
		await this.syncCookiesToSession();
		if (!this.isCurrent(generation)) return;
		await this.modal.loadURL(url);
		if (!this.isCurrent(generation)) return;
		await this.prepareBookmarkNavigation(generation);
	}

	private isAlive(): boolean {
		return !this.closed && !this.modal.isDestroyed?.() && !this.modal.webContents.isDestroyed?.();
	}

	private isCurrent(generation: number): boolean {
		return generation === this.generation && this.isAlive();
	}

	private cancelBookmarkNavigation(): void {
		this.generation++;
		if (this.bookmarkNavigationTimer !== null) {
			window.clearTimeout(this.bookmarkNavigationTimer);
			this.bookmarkNavigationTimer = null;
		}
		if (this.isAlive()) {
			void this.modal.webContents.executeJavaScript('window.__wereadBookmarkNavigationToken = null;')
				.catch((): void => undefined);
		}
	}

	private async installCanvasHooks(generation: number): Promise<void> {
		if (!this.isCurrent(generation) || !this.pendingBookmark) return;
		try {
			await this.modal.webContents.executeJavaScript(BOOKMARK_CANVAS_HOOK_SCRIPT);
		} catch {
			// The document may still be navigating; retry before applying the bookmark.
		}
	}

	private async prepareBookmarkNavigation(generation: number): Promise<void> {
		await this.installCanvasHooks(generation);
		if (this.isCurrent(generation)) this.scheduleBookmarkNavigation(generation);
	}

	private scheduleBookmarkNavigation(generation: number, retry = 0): void {
		const bookmark = this.pendingBookmark;
		if (!bookmark || !this.isCurrent(generation)) return;
		if (this.bookmarkNavigationTimer !== null) window.clearTimeout(this.bookmarkNavigationTimer);
		const loadedUrl = this.modal.webContents.getURL();
		if (!loadedUrl.includes('/web/reader/') || loadedUrl.split(/[?#]/)[0] !== this.currentUrl.split(/[?#]/)[0]) {
			if (retry < 12) {
				this.bookmarkNavigationTimer = window.setTimeout((): void => {
					this.bookmarkNavigationTimer = null;
					if (this.isCurrent(generation)) this.scheduleBookmarkNavigation(generation, retry + 1);
				}, 500);
			}
			return;
		}
		this.bookmarkNavigationTimer = window.setTimeout((): void => {
			this.bookmarkNavigationTimer = null;
			if (this.isCurrent(generation)) void this.applyBookmarkNavigation(bookmark, generation);
		}, retry === 0 ? 2500 : 1000);
	}

	private async applyBookmarkNavigation(bookmark: WereadBookmarkLocation, generation: number): Promise<void> {
		await this.installCanvasHooks(generation);
		if (!this.isCurrent(generation)) return;
		try {
			const result = await this.modal.webContents.executeJavaScript(buildBookmarkNavigationScript(bookmark));
			if (!this.isCurrent(generation) || this.pendingBookmark !== bookmark) return;
			const mode = result && typeof result === 'object' && 'mode' in result ? result.mode : undefined;
			if (mode === 'cancelled') return;
			this.pendingBookmark = null;
			if (mode === 'note-panel' || mode === 'find' || mode === 'canvas-scroll' || mode === 'canvas-page') return;
			new Notice(bookmark.markText
				? '已打开对应章节，未能精确定位划线，请手动搜索划线内容'
				: '已打开对应章节');
		} catch {
			if (this.isCurrent(generation)) new Notice('打开原文失败，请重试');
		}
	}

	private async syncCookiesToSession(): Promise<void> {
		const session = this.modal.webContents.session;
		const cookies = get(settingsStore).cookies ?? [];

		for (const cookie of cookies) {
			try {
				await session.cookies.set({
					url: 'https://weread.qq.com',
					name: cookie.name,
					value: cookie.value,
					domain: '.weread.qq.com',
					path: '/',
					secure: true,
					httpOnly: false
				});
			} catch (error) {
				console.debug('[weread plugin] sync window cookie failed', cookie.name, error);
			}
		}

		// Force persist cookies to disk before loading URL
		await session.cookies.flush();
	}
}
