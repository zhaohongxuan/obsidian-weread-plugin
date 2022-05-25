import WereadPlugin from 'main';
import templateInstructions from './assets/templateInstructions.html';
import { PluginSettingTab, Setting, App } from 'obsidian';
import { settingsStore } from './settings';
import { get } from 'svelte/store';
import WereadLoginModel from './components/wereadLoginModel';
import WereadLogoutModel from './components/wereadLogoutModel';
import pickBy from 'lodash.pickby';
import { Renderer } from './renderer';

export class WereadSettingsTab extends PluginSettingTab {
	private plugin: WereadPlugin;
	private renderer: Renderer;

	constructor(app: App, plugin: WereadPlugin) {
		super(app, plugin);
		this.plugin = plugin;
		this.renderer = new Renderer();
	}

	display() {
		const { containerEl } = this;
		containerEl.empty();
		containerEl.createEl('h2', { text: '设置微信读书插件' });
		const isCookieValid = get(settingsStore).isCookieValid;
		if (isCookieValid) {
			this.showLogout();
		} else {
			this.showLogin();
		}
		this.notebookFolder();
		this.noteCountLimit();
		this.subFolderType();
		this.template();
	}

	private notebookFolder(): void {
		new Setting(this.containerEl)
			.setName('笔记保存位置')
			.setDesc('请选择Obsidian Vault中微信读书笔记存放的位置')
			.addDropdown((dropdown) => {
				const files = (this.app.vault.adapter as any).files;
				const folders = pickBy(files, (val: any) => {
					return val.type === 'folder';
				});

				Object.keys(folders).forEach((val) => {
					dropdown.addOption(val, val);
				});
				return dropdown
					.setValue(get(settingsStore).noteLocation)
					.onChange(async (value) => {
						settingsStore.actions.setNoteLocationFolder(value);
					});
			});
	}

	private showLogin(): void {
		new Setting(this.containerEl).setName('登录微信读书').addButton((button) => {
			return button
				.setButtonText('登录')
				.setCta()
				.onClick(async () => {
					button.setDisabled(true);
					const logoutModel = new WereadLoginModel(this);
					await logoutModel.doLogin();
					this.display();
				});
		});
	}

	private subFolderType(): void {
		new Setting(this.containerEl)
			.setName('文件夹分类')
			.setDesc('请选择按照哪个维度对笔记文件进行分类')
			.addDropdown((dropdown) => {
				dropdown.addOptions({
					'-1': '无分类',
					title: '书名',
					category: '图书分类'
				});
				return dropdown
					.setValue(get(settingsStore).subFolderType)
					.onChange(async (value) => {
						settingsStore.actions.setSubFolderType(value);
					});
			});
	}

	private fileNameType(): void {
		new Setting(this.containerEl)
			.setName('文件名')
			.setDesc('你选择你喜欢的文件名模板，重复的书会在文件名后加上ID')
			.addDropdown((dropdown) => {
				dropdown.addOptions({
					'BOOK_NAME': '书名',
					'BOOK_NAME-AUTHOR': '书名-作者名',
					'BOOK_NAME-ID': '书名-bookId',
				});
				return dropdown
					.setValue(get(settingsStore).fileNameType)
					.onChange(async (value) => {
						settingsStore.actions.setFileNameType(value);
					});
			});
	}

	private showLogout(): void {
		document.createRange().createContextualFragment;
		const desc = document.createRange().createContextualFragment(
			`1. 登录：点击登录按钮，在弹出页面【扫码登录】。
             2. 注销：点击注销，在弹出书架页面右上角点击头像，下拉菜单选择【退出登录】`
		);

		new Setting(this.containerEl)
			.setName(`微信读书已登录，用户名：  ${get(settingsStore).user}`)
			.setDesc(desc)
			.addButton((button) => {
				return button
					.setButtonText('注销')
					.setCta()
					.onClick(async () => {
						button.setDisabled(true);
						const logoutModel = new WereadLogoutModel(this);
						await logoutModel.doLogout();
						this.display();
					});
			});
	}

	private template(): void {
		const descFragment = document.createRange().createContextualFragment(templateInstructions);

		new Setting(this.containerEl)
			.setName('笔记模板')
			.setDesc(descFragment)
			.addTextArea((text) => {
				text.inputEl.style.width = '100%';
				text.inputEl.style.height = '540px';
				text.inputEl.style.fontSize = '0.8em';
				text.setValue(get(settingsStore).template).onChange(async (value) => {
					const isValid = this.renderer.validate(value);

					if (isValid) {
						settingsStore.actions.setTemplate(value);
					}
					text.inputEl.style.border = isValid ? '' : '2px solid red';
				});
				return text;
			});
	}

	private noteCountLimit() {
		new Setting(this.containerEl)
			.setName('笔记划线数量最小值')
			.setDesc('划线数量小于该值的笔记将不会被同步')
			.addDropdown((dropdown) => {
				dropdown
					.addOptions({
						'-1': '无限制',
						'3': '3条',
						'5': '5条',
						'10': '10条',
						'15': '15条',
						'30': '30条'
					})
					.setValue(get(settingsStore).noteCountLimit.toString())
					.onChange(async (value) => {
						console.log('new note count limit', value);
						settingsStore.actions.setNoteCountLimit(+value);
					});
			});
	}
}
