import { App, MarkdownView, Modal, Notice, Plugin, PluginSettingTab, prepareSimpleSearch, Setting } from 'obsidian';
import FileManager from './src/fileManager';
import SyncNotebooks from './src/syncNotebooks';
import * as express from 'express';
import {Server} from 'http'
import { createProxyMiddleware, Filter, Options, RequestHandler } from 'http-proxy-middleware';

interface WereadPluginSettings {
	cookie: string;
}

const DEFAULT_SETTINGS: WereadPluginSettings = {
	cookie: 'input you weread cookie'
}

export default class WereadPlugin extends Plugin {
	settings: WereadPluginSettings;
	private syncNotebooks: SyncNotebooks;
	async onload() {

		const fileManager = new FileManager(this.app.vault, this.app.metadataCache);

		this.syncNotebooks = new SyncNotebooks(fileManager);

		await this.loadSettings();


		const app = express();

		// This creates an icon in the left ribbon.
		const ribbonIconEl = this.addRibbonIcon('dice', 'Weread Plugin', (evt: MouseEvent) => {
			new Notice('start to sync weread notes!');
			this.startMiddleServer(app).then(server=>{
				this.startSync().then(res=>{
					server.close(() => {
						console.log('HTTP server closed ',res,server)
					})
				})
			})
		});
		// Perform additional things with the ribbon
		ribbonIconEl.addClass('my-plugin-ribbon-class');

		// This adds a status bar item to the bottom of the app. Does not work on mobile apps.
		const statusBarItemEl = this.addStatusBarItem();
		statusBarItemEl.setText('Status Bar Text');

		// This adds a simple command that can be triggered anywhere
		this.addCommand({
			id: 'open-sample-modal-simple',
			name: 'Open sample modal (simple)',
			callback: () => {
				new WereadModal(this.app).open();
			}
		});
		// This adds an editor command that can perform some operation on the current editor instance
		this.addCommand({
			id: 'sync-weread-notes-command',
			name: 'Sync Weread command',
			callback: () => {
				this.startSync();
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

		// If the plugin hooks up any global DOM events (on parts of the app that doesn't belong to this plugin)
		// Using this function will automatically remove the event listener when this plugin is disabled.
		this.registerDomEvent(document, 'click', (evt: MouseEvent) => {
			console.log('click', evt);
		});

		// When registering intervals, this function will automatically clear the interval when the plugin is disabled.
		this.registerInterval(window.setInterval(() => console.log('setInterval'), 5 * 60 * 1000));

		
	}

	onunload() {

	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}

	async startSync(): Promise<void> {
		console.log('Start syncing Weread note...')
		await this.syncNotebooks.startSync();
	}

	async startMiddleServer(app:express): Promise<Server>{
			app.use(
				'/',
				createProxyMiddleware({
					target: 'https://i.weread.qq.com',
					changeOrigin: true,
					onProxyReq:function(proxyReq,req,res){
						let cookie = this.plugin.settings.cookie
						if(cookie === undefined || cookie==''){
							// cookie = 'Hm_ck_1651985948344=42; Hm_ck_1651986152219=42; Hm_ck_1651986245447=42; Hm_ck_1651986409264=42; Hm_ck_1651986430297=42; Hm_ck_1651986471684=42; Hm_ck_1651986605529=42; Hm_ck_1652002334423=42; Hm_ck_1652007861139=42; Hm_ck_1652055475827=42; Hm_ck_1652060938667=42; Hm_ck_1652069612546=42; Hm_ck_1652072945335=42; Hm_ck_1652072994679=42; Hm_ck_1652073157117=42; Hm_ck_1652075802665=42; Hm_ck_1652082134723=42; Hm_ck_1652139948063=42; Hm_ck_1652145691888=42; Hm_lpvt_cda23766027f4145f8a9d2087788759e=1652145692; Hm_lvt_cda23766027f4145f8a9d2087788759e=1651922498; wr_avatar=https%3A%2F%2Fres.weread.qq.com%2Fwravatar%2FWV0020-JSN_wG~UnHM0pKTF~O_6ub9%2F0; wr_gender=1; wr_gid=209356474; wr_localvid=0d4320606efaf060d401c16; wr_name=%E5%96%B7%E6%B0%94%E5%BC%8F%E8%9C%97%E7%89%9B; wr_pf=0; wr_rt=web%40XFp9BaoyDeKRWVk7Q1P_WL; wr_skey=6Sq_EuRa; wr_theme=white; wr_vid=15707910'
							new Notice("cookie 已失效")
						}
						console.log("setting cookie",cookie)
						proxyReq.setHeader('Cookie', cookie);
						console.log("req",req)
						console.log("proxyReq",proxyReq)
					},
					onProxyRes: function (proxyRes, req, res) {
						console.log("successfully set allow origin:",proxyRes)
						proxyRes.headers['Access-Control-Allow-Origin'] = '*';
				  }
				})
			);
			const server =  app.listen(8081);
			console.log("server:",server)
			return server
	}

	async shutdownMiddleServer(server:Server){
			server.close(() => {
			  console.log('HTTP server closed')
	})
	}
}

class WereadModal extends Modal {
	constructor(app: App) {
		super(app);
	}

	onOpen() {
		const {contentEl} = this;
		contentEl.setText('Woah!');
	}

	onClose() {
		const {contentEl} = this;
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
		const {containerEl} = this;

		containerEl.empty();

		containerEl.createEl('h2', {text: 'Settings Weread plugin.'});

		new Setting(containerEl)
			.setName('Cookie')
			.setDesc('Input you weread Cookie')
			.addTextArea(text => text
				.setPlaceholder('Input you weread Cookie')
				.setValue(this.plugin.settings.cookie)
				.onChange(async (value) => {
					console.log('Cookie: ' + value);
					this.plugin.settings.cookie = value;
					await this.plugin.saveSettings();
				}));
	}
}



