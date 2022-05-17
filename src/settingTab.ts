import WereadPlugin from 'main';
import { PluginSettingTab, Setting, App } from 'obsidian';
import { settingsStore } from './settings';
import { get } from 'svelte/store';
import WereadLoginModal from './components/wereadLoginModel';
import WereadLogoutModal from './components/wereadLogoutModel';
import pickBy from 'lodash.pickby';

export class WereadSettingsTab extends PluginSettingTab {
	private plugin: WereadPlugin;

	constructor(app: App, plugin: WereadPlugin) {
		super(app, plugin);
		this.plugin = plugin;
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
		new Setting(this.containerEl)
			.setName('登录微信读书')
			.addButton((button) => {
				return button
					.setButtonText('登录')
					.setCta()
					.onClick(async () => {
						button.setDisabled(true);
						const logoutModel = new WereadLoginModal(this);
						await logoutModel.doLogin();
						this.display();
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
						const logoutModel = new WereadLogoutModal(this);
						await logoutModel.doLogout();
						this.display();
					});
			});
	}
}
