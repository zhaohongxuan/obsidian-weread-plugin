import { App, Notice, Plugin, PluginSettingTab, Setting } from 'obsidian';
import FileManager from './src/fileManager';
import SyncNotebooks from './src/syncNotebooks';
import NetworkManager from './src/networkManager';
import ApiManager from './src/api';

interface WereadPluginSettings {
	cookies: string;
	noteLocation: string;
	cookieTime: number;
}

const DEFAULT_SETTINGS: WereadPluginSettings = {
	cookies: '',
	noteLocation: '/weread',
	cookieTime: -1
};

export default class WereadPlugin extends Plugin {
	settings: WereadPluginSettings;
	private syncNotebooks: SyncNotebooks;
	private networkManager: NetworkManager;
	async onload() {
		console.log('load weread plugin');
		await this.loadSettings();
		const fileManager = new FileManager(
			this.app.vault,
			this.app.metadataCache,
			this.settings.noteLocation
		);
		const apiManager = new ApiManager();
		this.syncNotebooks = new SyncNotebooks(fileManager, apiManager);
		this.networkManager = new NetworkManager(
			this.settings.cookies,
			apiManager
		);

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
			this.checkCookie().then(() => {
				console.log('Start syncing Weread note...');
				this.syncNotebooks.startSync().then((res) => {
					new Notice(`微信读书笔记同步完成!,本次更新 ${res} 本书`);
					this.networkManager.shutdownMiddleServer(server);
				});
			});
		});
	}

	onunload() {
		console.log('unloading plugin', new Date().toLocaleString());
	}

	async loadSettings() {
		this.settings = Object.assign(
			{},
			DEFAULT_SETTINGS,
			await this.loadData()
		);
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}

	async setCookie(cookie: string) {
		this.networkManager.setCookie(cookie);
	}

	async checkCookie() {
		if (
			this.settings.cookieTime === -1 ||
			new Date().getTime() - this.settings.cookieTime > 600 * 1000
		) {
			console.log(
				'last cookie time ',
				new Date(this.settings.cookieTime).toString(),
				'try to refresh...'
			);
			await this.networkManager.refreshCookie().then(() => {
				this.updateCookie();
			});
		}
	}
	async updateCookie() {
		const newCookieTime = new Date().getTime();
		this.settings.cookieTime = newCookieTime;
		this.settings.cookies = this.networkManager.getCookieString();
		console.log('update cookie complete, new settings', this.settings);
		await this.saveSettings();
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

		new Setting(containerEl)
			.setName('Cookie')
			.setDesc('Input you weread Cookies')
			.addTextArea((text) =>
				text
					.setPlaceholder('Input you weread Cookie')
					.setValue(this.plugin.settings.cookies)
					.onChange(async (value) => {
						console.log('New Cookie: ' + value);
						this.plugin.settings.cookies = value;
						this.plugin.setCookie(value);
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName('Notes Location')
			.setDesc('Your Weread Notes location')
			.addTextArea((text) =>
				text
					.setPlaceholder('Which folder to place your notes')
					.setValue(this.plugin.settings.noteLocation)
					.onChange(async (value) => {
						console.log('Notes Location: ' + value);
						this.plugin.settings.noteLocation = value;
						await this.plugin.saveSettings();
					})
			);
	}
}
