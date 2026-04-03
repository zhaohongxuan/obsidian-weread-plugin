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
	onunload() {
		console.log('unloading weread plugin', new Date().toLocaleString());
		this.clearCookieRefreshTimer();
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
}
