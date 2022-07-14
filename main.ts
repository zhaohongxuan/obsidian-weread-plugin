import { App, Modal, Notice, Platform, Plugin } from 'obsidian';
import FileManager from './src/fileManager';
import SyncNotebooks from './src/syncNotebooks';
import ApiManager from './src/api';
import { settingsStore } from './src/settings';
import { WereadSettingsTab } from './src/settingTab';
export default class WereadPlugin extends Plugin {
	private syncNotebooks: SyncNotebooks;

	async onload() {
		console.log('load weread plugin');
		settingsStore.initialise(this);

		const fileManager = new FileManager(this.app.vault, this.app.metadataCache);
		const apiManager = new ApiManager();
		this.syncNotebooks = new SyncNotebooks(fileManager, apiManager);

		this.addRibbonIcon('book-open', 'Weread', (evt: MouseEvent) => {
			this.startSync();
		});

		this.addCommand({
			id: 'sync-weread-notes-command',
			name: 'Sync Weread Notes',
			callback: () => {
				this.startSync();
			}
		});

		this.addCommand({
			id: 'sync-weread-notes-command',
			name: 'Force Sync Weread Notes',
			callback: () => {
				this.startSync(true);
			}
		});

		this.addCommand({
			id: 'testInput',
			name: 'Test Input (dev)',
			callback: async () => {
				const p = new ExampleModal(this.app);
				p.open();
				console.log(p);
			}
		});

		this.addSettingTab(new WereadSettingsTab(this.app, this));
	}

	async startSync(force = false, journalDate: moment.Moment = window.moment()) {
		console.log('syncing Weread note start');
		try {
			await this.syncNotebooks.startSync(force, journalDate);
			console.log('syncing Weread note finish');
		} catch (e) {
			if (Platform.isDesktopApp) {
				new Notice('同步微信读书笔记异常,请打开控制台查看详情');
			} else {
				new Notice('同步微信读书笔记异常,请使用电脑端打开控制台查看详情' + e);
			}
			console.error('同步微信读书笔记异常', e);
		}
	}

	onunload() {
		console.log('unloading weread plugin', new Date().toLocaleString());
	}
}

export class ExampleModal extends Modal {
	constructor(app: App) {
		super(app);
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.setText("Look at me, I'm a modal! 👀");
	}

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
	}
}
