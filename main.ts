import { Menu, Notice, Platform, Plugin, TFile, WorkspaceLeaf } from 'obsidian';
import FileManager from './src/fileManager';
import SyncNotebooks from './src/syncNotebooks';
import ApiManager from './src/api';
import WereadBookshelfService from './src/bookshelf';
import { settingsStore } from './src/settings';
import type { ReadingOpenMode } from './src/settings';
import { get } from 'svelte/store';
import { WereadSettingsTab } from './src/settingTab';
import WereadBrowserWindow from './src/components/wereadBrowserWindow';
import { WEREAD_BROWSER_VIEW_ID, WereadReadingView } from './src/components/wereadReading';
import { WEREAD_BOOKSHELF_VIEW_ID, WereadBookshelfView } from './src/components/wereadBookshelf';
import './style.css';
export default class WereadPlugin extends Plugin {
	private syncNotebooks: SyncNotebooks;
	private bookshelfService: WereadBookshelfService;
	private fileManager: FileManager;
	private wereadSettingsTab!: WereadSettingsTab;
	private syncing = false;
	private cookieRefreshTimer: number | null = null;
	private scheduledSyncTimer: number | null = null;

	async onload() {
		console.log('load weread plugin');
		await settingsStore.initialise(this);

		const fileManager = new FileManager(this.app.vault, this.app.metadataCache);
		this.fileManager = fileManager;
		const apiManager = new ApiManager();
		this.syncNotebooks = new SyncNotebooks(fileManager, apiManager);
		this.bookshelfService = new WereadBookshelfService(fileManager, apiManager);

		// 初始化时验证 Cookie 有效性
		const settings = get(settingsStore);
		if (settings.cookies && settings.cookies.length > 0 && !settings.isCookieValid) {
			console.log('[weread plugin] 初始化时检验 Cookie 有效性');
			apiManager.verifyCookieValidity().catch((e) => {
				console.error('[weread plugin] 初始化 Cookie 验证失败', e);
			});
		}

		// 启动时同步 Cookie 到 partition，供 webview 使用（非阻塞）
		this.syncCookiesToPartition();

		const ribbonEl = this.addRibbonIcon('book-open', '打开微信读书书架', (event) => {
			if (event.button === 0) {
				this.activateBookshelfView();
			}
		});

		ribbonEl.addEventListener('contextmenu', (event: MouseEvent) => {
			event.preventDefault();
			event.stopPropagation(); // 阻止事件传播

			const preventDefaultMouseDown = (mouseDownEvent: MouseEvent) => {
				mouseDownEvent.preventDefault();
			};

			// 额外阻止mousedown事件的默认行为
			window.addEventListener('mousedown', preventDefaultMouseDown);

			const menu = new Menu();
			menu.addItem((item) =>
				item
					.setTitle('同步微信读书笔记')
					.setIcon('refresh-ccw')
					.onClick(() => {
						this.startSync();
					})
			);

			menu.addItem((item) =>
				item
					.setTitle('强制同步微信读书笔记')
					.setIcon('refresh-ccw-dot')
					.onClick(() => {
						this.startSync(true);
					})
			);

			menu.addItem((item) =>
				item
					.setTitle('打开微信读书书架')
					.setIcon('library')
					.onClick(() => {
						this.activateBookshelfView();
					})
			);

			menu.showAtMouseEvent(event);
			menu.onHide(() => {
				window.removeEventListener('mousedown', preventDefaultMouseDown);
			});
		});

		this.addCommand({
			id: 'sync-weread-notes-command',
			name: '同步微信读书笔记',
			callback: () => {
				this.startSync();
			}
		});

		this.addCommand({
			id: 'Force-sync-weread-notes-command',
			name: '强制同步微信读书笔记',
			callback: () => {
				this.startSync(true);
			}
		});

		this.registerView(WEREAD_BROWSER_VIEW_ID, (leaf) => new WereadReadingView(leaf));
		this.registerView(
			WEREAD_BOOKSHELF_VIEW_ID,
			(leaf) => new WereadBookshelfView(leaf, this, this.bookshelfService)
		);

		this.addCommand({
			id: 'open-weread-reading-view-tab',
			name: '在新标签页打开微信读书',
			callback: () => {
				this.activateReadingView('TAB');
			}
		});

		this.addCommand({
			id: 'open-weread-reading-view-window',
			name: '在新窗口打开微信读书',
			callback: () => {
				this.activateReadingView('WINDOW');
			}
		});

		this.addCommand({
			id: 'open-weread-bookshelf-view',
			name: '打开微信读书书架',
			callback: () => {
				this.activateBookshelfView();
			}
		});

		this.registerEvent(
			this.app.workspace.on('editor-menu', (menu, editor, view) => {
				const noteFile = fileManager.getWereadNoteAnnotationFile(view.file);
				if (noteFile == null) {
					return;
				}

				menu.addSeparator();
				menu.addItem((item) =>
					item
						.setIcon('refresh-ccw')
						.setTitle('同步当前读书笔记')
						.onClick(() => {
							this.syncNotebooks.syncNotebook(noteFile);
						})
				);
			})
		);

		this.wereadSettingsTab = new WereadSettingsTab(this.app, this);
		this.addSettingTab(this.wereadSettingsTab);

		this.setupCookieRefresh();
		this.setupScheduledSync();
	}

	openWereadSettingsTab(section?: 'sync') {
		const settingManager = (this.app as any).setting as
			| {
					open: () => void;
					openTabById?: (id: string) => void;
			  }
			| undefined;

		settingManager?.open();
		settingManager?.openTabById?.(this.manifest.id);
		this.wereadSettingsTab.display();

		if (section) {
			window.setTimeout(() => {
				this.wereadSettingsTab.scrollToSection(section);
			}, 50);
		}
	}

	private getPreferredReadingOpenMode(): ReadingOpenMode {
		return get(settingsStore).readingOpenMode ?? 'TAB';
	}

	async openPreferredReadingView(url?: string) {
		await this.activateReadingView(this.getPreferredReadingOpenMode(), url);
	}

	async startSync(force = false): Promise<number | undefined> {
		if (this.syncing) {
			new Notice('正在同步微信读书笔记，请勿重复点击');
			return;
		}
		this.syncing = true;
		try {
			const syncedCount = await this.syncNotebooks.syncNotebooks(
				force,
				window.moment().format('YYYY-MM-DD')
			);
			// 更新最近同步信息
			const settings = get(settingsStore);
			const bookTitles = settings.lastSyncBookTitles || [];
			settingsStore.actions.updateLastSyncInfo(syncedCount || 0, bookTitles);
			console.log('syncing Weread note finish');
			return syncedCount;
		} catch (e) {
			if (Platform.isDesktopApp) {
				new Notice('同步微信读书笔记异常,请打开控制台查看详情');
			} else {
				new Notice('同步微信读书笔记异常,请使用电脑端打开控制台查看详情' + e);
			}
			console.error('同步微信读书笔记异常', e);
		} finally {
			this.syncing = false;
		}
	}

	async syncBookById(bookId: string) {
		if (this.syncing) {
			new Notice('正在同步微信读书笔记，请稍后再试');
			return;
		}
		this.syncing = true;
		try {
			await this.syncNotebooks.syncBookById(bookId);
		} catch (e) {
			new Notice('同步当前书籍异常,请打开控制台查看详情');
			console.error('同步当前书籍异常', e);
		} finally {
			this.syncing = false;
		}
	}

	async deleteLocalBookByPath(filePath: string) {
		const targetFile = this.app.vault.getAbstractFileByPath(filePath);
		if (!(targetFile instanceof TFile)) {
			new Notice('未找到本地文件');
			return;
		}
		await this.fileManager.deleteNotebookFile(targetFile);
		new Notice('本地文件已删除');
	}

	async activateReadingView(type: string, url?: string) {
		const { workspace } = this.app;
		const targetUrl = url ?? 'https://weread.qq.com/web/shelf';

		if (type === 'WINDOW') {
			const browserWindow = new WereadBrowserWindow();
			await browserWindow.open(targetUrl);
			return;
		}

		let leaf: WorkspaceLeaf | null = null;
		const leaves = workspace.getLeavesOfType(WEREAD_BROWSER_VIEW_ID);
		leaf = leaves[0] ?? workspace.getLeaf('split', 'vertical');

		if (!leaf) {
			return;
		}

		await leaf.setViewState({
			type: WEREAD_BROWSER_VIEW_ID,
			active: true,
			state: {
				url: targetUrl
			}
		});

		workspace.revealLeaf(leaf);
	}

	async activateBookshelfView() {
		const { workspace } = this.app;
		let leaf: WorkspaceLeaf | null = null;
		const leaves = workspace.getLeavesOfType(WEREAD_BOOKSHELF_VIEW_ID);

		if (leaves.length > 0) {
			leaf = leaves[0];
		} else {
			leaf = workspace.getLeaf('tab');
			await leaf.setViewState({ type: WEREAD_BOOKSHELF_VIEW_ID, active: true });
		}

		workspace.revealLeaf(leaf);
	}

	private async syncCookiesToPartition(): Promise<void> {
		if (!Platform.isDesktopApp) {
			return;
		}
		const cookies = get(settingsStore).cookies ?? [];
		if (cookies.length === 0) {
			return;
		}

		try {
			const { remote } = window.require('electron');
			const { BrowserWindow: RemoteBrowserWindow } = remote;
			const WEREAD_PARTITION = 'persist:weread-plugin-browser';

			// Create a hidden window with the same partition as webview
			const hiddenWindow = new RemoteBrowserWindow({
				width: 1,
				height: 1,
				show: false,
				webPreferences: {
					partition: WEREAD_PARTITION
				}
			});

			const session = hiddenWindow.webContents.session;
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
				} catch (e) {
					console.debug('[weread plugin] cookie set failed:', cookie.name, e);
				}
			}

			hiddenWindow.close();
			console.log('[weread plugin] startup cookie sync complete');
		} catch (e) {
			console.error('[weread plugin] startup cookie sync failed', e);
		}
	}

	onunload() {
		console.log('unloading weread plugin', new Date().toLocaleString());
		this.clearCookieRefreshTimer();
		this.clearScheduledSyncTimer();
	}

	setupCookieRefresh() {
		this.clearCookieRefreshTimer();
		const { cookieAutoRefreshToggle, cookieRefreshInterval } = get(settingsStore);
		if (!cookieAutoRefreshToggle) {
			return;
		}
		const apiManager = new ApiManager();
		apiManager
			.refreshCookie()
			.catch((e) => console.error('[weread plugin] 刷新 Cookie 失败', e));
		const intervalMs = Math.max(1, cookieRefreshInterval) * 60 * 60 * 1000;
		this.cookieRefreshTimer = window.setInterval(() => {
			apiManager
				.refreshCookie()
				.catch((e) => console.error('[weread plugin] 定时刷新 Cookie 失败', e));
		}, intervalMs);
	}

	private clearCookieRefreshTimer() {
		if (this.cookieRefreshTimer !== null) {
			window.clearInterval(this.cookieRefreshTimer);
			this.cookieRefreshTimer = null;
		}
	}

	setupScheduledSync() {
		this.clearScheduledSyncTimer();
		const { scheduledSyncToggle, scheduledSyncInterval } = get(settingsStore);
		if (!scheduledSyncToggle) {
			return;
		}
		const intervalMs = Math.max(1, scheduledSyncInterval) * 60 * 1000;
		console.log(`[weread plugin] 设置定时同步，间隔 ${scheduledSyncInterval} 分钟`);
		this.scheduledSyncTimer = window.setInterval(async () => {
			console.log('[weread plugin] 执行定时同步');
			try {
				const syncedCount = await this.syncNotebooks.syncNotebooks(
					false,
					window.moment().format('YYYY-MM-DD')
				);
				// 获取同步的书籍信息并更新设置
				const settings = get(settingsStore);
				const bookTitles = settings.lastSyncBookTitles || [];
				settingsStore.actions.updateLastSyncInfo(syncedCount || 0, bookTitles);
				new Notice(`定时同步完成，共同步 ${syncedCount || 0} 本书`);
			} catch (e) {
				console.error('[weread plugin] 定时同步失败', e);
				new Notice('定时同步失败，请查看控制台');
			}
		}, intervalMs);
	}

	private clearScheduledSyncTimer() {
		if (this.scheduledSyncTimer !== null) {
			window.clearInterval(this.scheduledSyncTimer);
			this.scheduledSyncTimer = null;
		}
	}
}
