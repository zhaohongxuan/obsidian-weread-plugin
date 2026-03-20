import { Notice } from 'obsidian';
import { parseCookies } from '../utils/cookiesUtil';
import { settingsStore } from '../settings';
import { WereadSettingsTab } from '../settingTab';
import ApiManager from '../api';
import type { Cookie } from 'set-cookie-parser';

export default class WereadLoginModel {
	private modal: any;
	private settingTab: WereadSettingsTab;
	private isHandled = false;
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
			this.modal.setTitle('登录微信读书~');
			this.modal.show();
		});

		const session = this.modal.webContents.session;
		const trySyncCookiesAndClose = async () => {
			if (this.isHandled) {
				return;
			}

			const isCookieSynced = await this.syncCookiesFromSession();
			if (isCookieSynced) {
				this.isHandled = true;
				this.settingTab.display();
				this.modal.close();
			}
		};

		const loginFilter = {
			urls: ['https://weread.qq.com/api/auth/getLoginInfo?uid=*']
		};

		session.webRequest.onCompleted(loginFilter, (details: any) => {
			if (details.statusCode == 200) {
				console.log('weread login success, redirect to weread shelf');
				this.modal.loadURL('https://weread.qq.com/web/shelf');
				void trySyncCookiesAndClose();
			}
		});

		const filter = {
			urls: ['https://weread.qq.com/web/user?userVid=*']
		};
		session.webRequest.onSendHeaders(filter, (details: any) => {
			const cookies = details.requestHeaders['Cookie'];
			const cookieArr = parseCookies(cookies);
			const wrName = cookieArr.find((cookie) => cookie.name == 'wr_name');
			const wrVid = cookieArr.find((cookie) => cookie.name == 'wr_vid');
			if ((wrName && wrName.value !== '') || (wrVid && wrVid.value !== '')) {
				settingsStore.actions.setCookies(cookieArr);
				settingTab.display();
				this.isHandled = true;
				this.modal.close();
			} else {
				this.modal.reload();
			}
		});

		this.modal.webContents.on('did-navigate', () => {
			void trySyncCookiesAndClose();
		});

		this.modal.webContents.on('did-navigate-in-page', () => {
			void trySyncCookiesAndClose();
		});

		this.modal.webContents.on('did-finish-load', () => {
			void trySyncCookiesAndClose();
		});
	}

	async doLogin() {
		try {
			await this.modal.loadURL('https://weread.qq.com/#login');
			await this.syncCookiesFromSession();
		} catch (error) {
			console.log(error);
			new Notice('加载微信读书登录页面失败');
		}
	}

	private async syncCookiesFromSession(): Promise<boolean> {
		try {
			const cookieStore = this.modal.webContents.session.cookies;
			const sessionCookies = [
				...(await cookieStore.get({ domain: '.weread.qq.com' })),
				...(await cookieStore.get({ domain: 'weread.qq.com' }))
			];

			const uniqueCookies = new Map<string, Cookie>();
			for (const cookie of sessionCookies) {
				if (!uniqueCookies.has(cookie.name)) {
					uniqueCookies.set(cookie.name, {
						name: decodeURIComponent(cookie.name),
						value: decodeURIComponent(cookie.value)
					});
				}
			}

			const cookieArr = Array.from(uniqueCookies.values());
			if (cookieArr.length === 0) {
				return false;
			}

			const wrVid = cookieArr.find((cookie) => cookie.name === 'wr_vid');
			const wrName = cookieArr.find((cookie) => cookie.name === 'wr_name');
			const wrSkey = cookieArr.find((cookie) => cookie.name === 'wr_skey');

			if (!wrVid || ((!wrName || wrName.value === '') && (!wrSkey || wrSkey.value === ''))) {
				return false;
			}

			settingsStore.actions.setCookies(cookieArr);

			const apiManager = new ApiManager();
			const isValid = await apiManager.verifyCookieValidity();
			if (!isValid) {
				return false;
			}

			return true;
		} catch (e) {
			console.error('[weread plugin] 从登录窗口同步 Cookie 失败', e);
			return false;
		}
	}

	onClose() {
		this.modal.close();
	}
}
