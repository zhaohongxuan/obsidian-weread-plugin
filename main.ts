import { App, MarkdownView, Modal, Notice, Plugin, PluginSettingTab, Setting } from 'obsidian';
import FileManager from './src/fileManager';
import SyncNotebooks from './src/syncNotebooks';

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

		// This creates an icon in the left ribbon.
		const ribbonIconEl = this.addRibbonIcon('dice', 'Weread Plugin', (evt: MouseEvent) => {
			new Notice('start to sync weread notes!');
			this.startSync();
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
			.addText(text => text
				.setPlaceholder('Input you weread Cookie')
				.setValue(this.plugin.settings.cookie)
				.onChange(async (value) => {
					console.log('Cookie: ' + value);
					this.plugin.settings.cookie = value;
					await this.plugin.saveSettings();
				}));
	}
}



