import {
	MarkdownView,
	Notice,
	Platform,
	Plugin,
	WorkspaceLeaf
} from 'obsidian';
import FileManager from './src/fileManager';
import SyncNotebooks from './src/syncNotebooks';
import ApiManager from './src/api';
import { settingsStore } from './src/settings';
import { WereadSettingsTab } from './src/settingTab';
import { WEREAD_BROWSER_VIEW_ID, WereadReadingView } from './src/components/wereadReading';
import './style.css';
export default class WereadPlugin extends Plugin {
	private syncNotebooks: SyncNotebooks;
	private syncing = false;

	async onload() {
		console.log('load weread plugin');
		settingsStore.initialise(this);

		const fileManager = new FileManager(this.app.vault, this.app.metadataCache);
		const apiManager = new ApiManager();
		this.syncNotebooks = new SyncNotebooks(fileManager, apiManager);

		this.addRibbonIcon('book-open', 'Weread', () => {
			this.startSync();
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
			name: '同步微信读书笔记（强制刷新）',
			callback: () => {
				this.startSync(true);
			}
		});

		this.registerView(WEREAD_BROWSER_VIEW_ID, (leaf) => new WereadReadingView(leaf));

		this.addCommand({
			id: 'open-weread-reading-view',
			name: '打开网页版微信读书',
			callback: () => {
				this.activateReadingView();
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
						.setTitle('Sync current weread note')
						.onClick(() => {
							this.syncNotebooks.syncNotebook(noteFile);
						})
				);
			})
		);

		this.addSettingTab(new WereadSettingsTab(this.app, this));
	}

	async startSync(force = false) {
		if (this.syncing) {
			new Notice('正在同步微信读书笔记，请勿重复点击');
			return;
		}
		this.syncing = true;
		try {
			await this.syncNotebooks.syncNotebooks(force, window.moment().format('YYYY-MM-DD'));
			console.log('syncing Weread note finish');
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

	async activateReadingView() {
		const { workspace } = this.app;

		let leaf: WorkspaceLeaf | null = null;
		const leaves = workspace.getLeavesOfType(WEREAD_BROWSER_VIEW_ID);

		if (leaves.length > 0) {
			// A leaf with our view already exists, use that
			leaf = leaves[0];
		} else {
			leaf = workspace.getLeaf('split', 'vertical');
			await leaf.setViewState({ type: WEREAD_BROWSER_VIEW_ID, active: true });
		}

		// "Reveal" the leaf in case it is in a collapsed sidebar
		workspace.revealLeaf(leaf);
	}
	onunload() {
		console.log('unloading weread plugin', new Date().toLocaleString());
	}
}
