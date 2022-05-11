import { App, MarkdownView, Modal, Notice, Plugin, PluginSettingTab, Setting } from 'obsidian';
import FileManager from './src/fileManager';
import SyncNotebooks from './src/syncNotebooks';
import * as express from 'express';
import { Server,ServerResponse } from 'http'
import { createProxyMiddleware } from 'http-proxy-middleware';

interface WereadPluginSettings {
	cookie: string;
	noteLocation: string;
}

const DEFAULT_SETTINGS: WereadPluginSettings = {
	cookie: '',
	noteLocation: '/Hypothesis/weread/'
}

export default class WereadPlugin extends Plugin {
	settings: WereadPluginSettings;
	private syncNotebooks: SyncNotebooks;
	async onload() {
		console.log("load weread plugin")
		await this.loadSettings();
		const fileManager = new FileManager(this.app.vault, this.app.metadataCache, this.settings.noteLocation);
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
			},
		});

		// This adds a complex command that can check whether the current state of the app allows execution of the command
		this.addCommand({
			id: 'open-sample-modal-complex',
			name: 'Open sample modal (complex)',
			checkCallback: (checking: boolean) => {
				// Conditions to check
				const markdownView = this.app.workspace.getActiveViewOfType(MarkdownView);
				if (markdownView) {
					// If checking is true, we're simply "checking" if the command can be run.
					// If checking is false, then we want to actually perform the operation.
					if (!checking) {
						new WereadModal(this.app).open();
					}

					// This command will only show up in Command Palette when the check function returns true
					return true;
				}
			}
		});

		// This adds a settings tab so the user can configure various aspects of the plugin
		this.addSettingTab(new WereadSettingTab(this.app, this));
	}

	async startSync(app:any) {
		new Notice('start to sync weread notes!');
		this.startMiddleServer(app).then(server => {
			console.log('Start syncing Weread note...')
			this.syncNotebooks.startSync().then(res=>{
				server.close(() => {
					console.log('HTTP server closed ', res, server);
				});
				new Notice('weread notes sync complete!');
			})
		});
	}

	onunload() {
		console.log('unloading plugin', new Date().toLocaleString());
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}

	async startMiddleServer(app: any): Promise<Server> {
		const cookie = this.settings.cookie
		if (cookie === undefined || cookie == '') {
			new Notice("cookie未设置，请填写Cookie")
		}
		const escapeCookie = this.escapeCookie(cookie)
		app.use('/', createProxyMiddleware({
			target: 'https://i.weread.qq.com',
			changeOrigin: true,
			onProxyReq: function (proxyReq, req, res) {
			
				try {
					proxyReq.setHeader('Cookie', escapeCookie);
				} catch (error) {
					new Notice("cookie 设置失败，检查Cookie格式")	
				}
			},
			onProxyRes: function (proxyRes, req, res:ServerResponse) {
				if(res.statusCode!=200){
					new Notice("获取微信读书服务器数据异常！")
				}
				proxyRes.headers['Access-Control-Allow-Origin'] = '*';
			}
		})
		);
		const server = app.listen(8081);
		return server
	}

	async shutdownMiddleServer(server: Server) {
		server.close(() => {
			console.log('HTTP server closed')
		})
	}
	
	escapeCookie(cookie:string): string {
		const esacpeCookie = cookie.split(';')
			.map(v => { 
				const arr = v.split('=');
				const decodeCookie = decodeURIComponent(arr[1].trim()) 
				return arr[0] + "=" + encodeURIComponent(decodeCookie)
			}).join(";")
		console.log("escape cookie:", esacpeCookie)
		return esacpeCookie
	}
}

class WereadModal extends Modal {
	constructor(app: App) {
		super(app);
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.setText('Woah!');
	}

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
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
			.addTextArea(text => text
				.setPlaceholder('Input you weread Cookie')
				.setValue(this.plugin.settings.cookie)
				.onChange(async (value) => {
					console.log('New Cookie: ' + value);
					this.plugin.settings.cookie = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Notes Location')
			.setDesc('Your Weread Notes location')
			.addTextArea(text => text
				.setPlaceholder('Which folder to place your notes')
				.setValue(this.plugin.settings.noteLocation)
				.onChange(async (value) => {
					console.log('Notes Location: ' + value);
					this.plugin.settings.noteLocation = value;
					await this.plugin.saveSettings();
				}));
	}

}



