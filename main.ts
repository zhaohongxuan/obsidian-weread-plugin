import { Notice, Plugin } from 'obsidian';
import FileManager from './src/fileManager';
import SyncNotebooks from './src/syncNotebooks';
import NetworkManager from './src/networkManager';
import ApiManager from './src/api';
import { settingsStore } from './src/settings';
import { WereadSettingsTab } from './src/settingTab';
export default class WereadPlugin extends Plugin {
	private syncNotebooks: SyncNotebooks;
	private networkManager: NetworkManager;

	async onload() {
		console.log('load weread plugin');
		settingsStore.initialise(this);

		const fileManager = new FileManager(this.app.vault, this.app.metadataCache);
		const apiManager = new ApiManager();
		this.syncNotebooks = new SyncNotebooks(fileManager, apiManager);

		this.networkManager = new NetworkManager(apiManager);
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

	async startMiddleServer() {
		await this.networkManager.startMiddleServer();
	}

	async startSync() {
		new Notice('微信读书笔记同步开始!');
		await this.networkManager.startMiddleServer().then((server) => {
			this.networkManager.refreshCookie().then(() => {
				console.log('Start syncing Weread note...');
				this.syncNotebooks
					.startSync()
					.then((res) => {
						new Notice(`微信读书笔记同步完成!,本次更新 ${res} 本书`);
						this.networkManager.shutdownMiddleServer(server);
					})
					.catch((e) => {
						this.networkManager.shutdownMiddleServer(server);
						console.log(e);
					});
			});
		});
	}

	onunload() {
		console.log('unloading plugin', new Date().toLocaleString());
	}
}
