import { settingsStore } from '../settings';
import { WereadSettingsTab } from '../settingTab';

export default class WereadLoginModel {
	private modal: any;
	private settingTab: WereadSettingsTab;
	constructor(settingTab: WereadSettingsTab) {
		this.settingTab = settingTab;
		const { remote } = require('electron');
		const { BrowserWindow: RemoteBrowserWindow } = remote;
		this.modal = new RemoteBrowserWindow({
			parent: remote.getCurrentWindow(),
			width: 960,
			height: 540,
			show: false
		});
		this.modal.once('ready-to-show', () => {
			this.modal.setTitle('正在注销微信读书账号...');
			this.modal.show();
		});
		const session = this.modal.webContents.session;
		const filter = {
			urls: ['https://weread.qq.com/api/auth/logout']
		};
		session.webRequest.onCompleted(filter, (details) => {
			if (details.statusCode == 200 || details.statusCode == 204) {
				console.log('weread logout success, clear cookies...');
				settingsStore.actions.clearCookies();
				this.settingTab.display();
				this.modal.close();
			}
		});
	}

	async doLogout() {
		await this.modal.loadURL('https://weread.qq.com');
		// 页面加载完成后，自动调用注销接口
		this.modal.webContents.executeJavaScript(`
			// 自动调用微信读书注销接口
			fetch('https://weread.qq.com/api/auth/logout', {
				method: 'POST',
				credentials: 'include',
				headers: {
					'Content-Type': 'application/json'
				}
			}).then(res => {
				console.log('Logout request sent, status:', res.status);
			}).catch(err => {
				console.error('Logout request failed:', err);
			});
		`);
	}

	onClose() {
		this.modal.close();
	}
}
