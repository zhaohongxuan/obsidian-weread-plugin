import { App, Notice, Plugin, PluginSettingTab, Setting } from 'obsidian';
import FileManager from './src/fileManager';
import SyncNotebooks from './src/syncNotebooks';
import * as express from 'express';
import { Server, ServerResponse } from 'http';
import { createProxyMiddleware } from 'http-proxy-middleware';
import cookie from 'cookie'

interface WereadPluginSettings {
	cookie: string;
	noteLocation: string;
}

const DEFAULT_SETTINGS: WereadPluginSettings = {
	cookie: '',
	noteLocation: '/weread'
};

export default class WereadPlugin extends Plugin {
	settings: WereadPluginSettings;
	private syncNotebooks: SyncNotebooks;
	async onload() {
		console.log('load weread plugin');
		await this.loadSettings();
		const fileManager = new FileManager(
			this.app.vault,
			this.app.metadataCache,
			this.settings.noteLocation
		);
		this.syncNotebooks = new SyncNotebooks(fileManager);
		const app = express();

		this.addRibbonIcon('book-open', 'Weread', (evt: MouseEvent) => {
			this.startSync(app);
		});

		this.addCommand({
			id: 'sync-weread-notes-command',
			name: 'Sync Weread command',
			callback: () => {
				this.startSync(app);
			}
		});

		// This adds a settings tab so the user can configure various aspects of the plugin
		this.addSettingTab(new WereadSettingTab(this.app, this));
	}

	async startSync(app: any) {
		new Notice('start to sync weread notes!');
		this.startMiddleServer(app).then((server) => {
			console.log('Start syncing Weread note...');
			this.syncNotebooks.startSync().then((res) => {
				server.close(() => {
					console.log('HTTP server closed ', res, server);
				});
				new Notice('weread notes sync complete!');
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

	async startMiddleServer(app: any): Promise<Server> {
		const cookie = this.settings.cookie;
		if (cookie === undefined || cookie == '') {
			new Notice('cookie未设置，请填写Cookie');
		}
		const escapeCookie = this.escapeCookie(cookie)
		app.use(
			'/',
			createProxyMiddleware({
				target: 'https://i.weread.qq.com',
				changeOrigin: true,
				onProxyReq: function (proxyReq, req, res) {
					try {
						proxyReq.setHeader('Cookie', escapeCookie);
					} catch (error) {
						new Notice('cookie 设置失败，检查Cookie格式');
					}
				},
				onProxyRes: function (proxyRes, req, res: ServerResponse) {
					if (res.statusCode != 200) {
						new Notice('获取微信读书服务器数据异常！');
					}
					proxyRes.headers['Access-Control-Allow-Origin'] = '*';
				}
			})
		);
		const server = app.listen(12011);
		return server;
	}

	async shutdownMiddleServer(server: Server) {
		server.close(() => {
			console.log('HTTP server closed');
		});
	}

	escapeCookie(cookie: string): string {
		if(cookie.indexOf('%')!==-1){
			//alreay escaped
			return cookie;
		}
		const esacpeCookie = cookie
			.split(';')
			.map((v) => {
				const equalPos = v.lastIndexOf('=');
				const key = v.substring(0, equalPos)
				const value = v.substring(equalPos + 1)
				const decodeValue = value.indexOf('%') !== -1 ? decodeURIComponent(value) : value
				return key + '=' + encodeURIComponent(decodeValue);
			})
			.join(';');
		return esacpeCookie;
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
					.setValue(this.plugin.settings.cookie)
					.onChange(async (value) => {
						console.log('New Cookie: ' + value);
						this.plugin.settings.cookie = value;
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
