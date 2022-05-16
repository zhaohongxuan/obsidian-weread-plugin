import { App, Notice, Plugin, PluginSettingTab, Setting } from 'obsidian';
import FileManager from './src/fileManager';
import SyncNotebooks from './src/syncNotebooks';
import NetworkManager from './src/networkManager';
import ApiManager from './src/api';
import { get } from 'svelte/store';
import { settingsStore } from './src/settings';
import { parseCookies } from './src/utils/cookiesUtil';

export default class WereadPlugin extends Plugin {
	private syncNotebooks: SyncNotebooks;
	private networkManager: NetworkManager;
	async onload() {
		console.log('load weread plugin');
		settingsStore.initialise(this);

		const fileManager = new FileManager(
			this.app.vault,
			this.app.metadataCache
		);
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

		this.addSettingTab(new WereadSettingTab(this.app, this));
	}

	async startSync() {
		new Notice('微信读书笔记同步开始!');
		await this.networkManager.startMiddleServer().then((server) => {
			this.networkManager.refreshCookie().then(() => {
				console.log('Start syncing Weread note...');

				this.syncNotebooks
					.startSync()
					.then((res) => {
						new Notice(
							`微信读书笔记同步完成!,本次更新 ${res} 本书`
						);
						this.networkManager.shutdownMiddleServer(server);
					})
					.catch((e) => {
						new Notice(
							`微信读书笔记同步失败!,请打开控制台查看详情~`
						);
					});
			});
		});
	}

	onunload() {
		console.log('unloading plugin', new Date().toLocaleString());
	}
}
class WereadSettingTab extends PluginSettingTab {
	plugin: WereadPlugin;

	constructor(app: App, plugin: WereadPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();
		containerEl.createEl('h2', { text: 'Settings Weread plugin.' });

		const cookies = get(settingsStore).cookies;
		const noteLocation = get(settingsStore).noteLocation;

		new Setting(containerEl)
			.setName('Cookie')
			.setDesc('Input you weread Cookies')
			.addTextArea((text) =>
				text
					.setPlaceholder('Input you weread Cookie')
					.setValue(cookies)
					.onChange(async (value) => {
						const cookie = parseCookies(value);
						console.log('New Cookie: ' + cookie);
						settingsStore.actions.setCookies(cookie);
					})
			);

		new Setting(containerEl)
			.setName('Notes Location')
			.setDesc('Your Weread Notes location')
			.addTextArea((text) =>
				text
					.setPlaceholder('Which folder to place your notes')
					.setValue(noteLocation)
					.onChange(async (value) => {
						console.log('Notes Location: ' + value);
						settingsStore.actions.setNoteLocationFolder(value);
					})
			);
	}
}
