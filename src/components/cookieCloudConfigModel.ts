import { App, Notice, Modal, Setting } from 'obsidian';
import { settingsStore } from '../settings';
import { get } from 'svelte/store';
import { WereadSettingsTab } from '../settingTab';
import CookieCloudManager from '../cookieCloud';

export default class CookieCloudConfigModal extends Modal {
	private cookieCloudManager: CookieCloudManager;
	private wereadSettingsTab: WereadSettingsTab;

	private serverUrl = '';
	private uuid = '';
	private password = '';

	constructor(app: App, private settingTab: WereadSettingsTab) {
		super(app);
		this.cookieCloudManager = new CookieCloudManager();
		this.wereadSettingsTab = settingTab;
		this.loadConfigFromSettings();
	}

	private loadConfigFromSettings(): void {
		const info = get(settingsStore).cookieCloudInfo;
		if (info) {
			this.serverUrl = info.serverUrl;
			this.uuid = info.uuid;
			this.password = info.password;
		}
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.addClass('cookie-cloud-modal');

		new Setting(contentEl).setHeading().setName('CookieCloud 配置');

		new Setting(contentEl).setName('服务器地址').addText((text) =>
			text
				.setPlaceholder('请输入内容')
				.setValue(this.serverUrl)
				.onChange((value) => {
					this.serverUrl = value;
				})
		);

		new Setting(contentEl).setName('用户KEY').addText((text) =>
			text
				.setPlaceholder('请输入内容')
				.setValue(this.uuid)
				.onChange((value) => {
					this.uuid = value;
				})
		);

		new Setting(contentEl).setName('端对端加密密码').addText((text) =>
			text
				.setPlaceholder('请输入内容')
				.setValue(this.password)
				.onChange((value) => {
					this.password = value;
				})
		);

		new Setting(contentEl).addButton((button) =>
			button
				.setButtonText('确定')
				.setCta()
				.onClick(() => {
					this.onSubmit();
				})
		);
	}

	onSubmit() {
		if (!this.serverUrl) {
			new Notice('请输入服务器地址');
			return;
		}

		if (!this.uuid) {
			new Notice('请输入用户KEY');
			return;
		}

		if (!this.password) {
			new Notice('请输入端对端加密密码');
			return;
		}

		settingsStore.actions.setCookieCloudInfo({
			serverUrl: this.serverUrl,
			uuid: this.uuid,
			password: this.password
		});

		// 修改 CookieCloud 配置后，先清除 cookie 在从新配置的 CookieCloud 获取 cookie
		new Notice(`清除 Cookie`);
		settingsStore.actions.clearCookies();

		void this.cookieCloudManager
			.getCookie()
			.then((refreshSuccess) => {
				if (refreshSuccess) {
					this.wereadSettingsTab.display();
					this.close();
				}
			})
			.catch((e) => {
				console.error('[weread plugin] 获取 Cookie 失败', e);
			});
	}

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
	}
}
