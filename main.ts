import { Notice, Plugin } from 'obsidian';
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
			name: 'Sync Weread command',
			callback: () => {
				this.startSync();
			}
		});
		this.addSettingTab(new WereadSettingsTab(this.app, this));
	}

	async startSync() {
		console.log('Start syncing Weread note...');
		try{
			await this.syncNotebooks.startSync();
		}catch(e){
			new Notice("同步微信读书笔记异常,请打开控制台查看详情")
			console.error("同步微信读书笔记异常",e)
		}
	}

	onunload() {
		console.log('unloading weread plugin', new Date().toLocaleString());
	}
}
