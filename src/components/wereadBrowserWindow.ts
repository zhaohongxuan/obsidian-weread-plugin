import { get } from 'svelte/store';
import { settingsStore } from '../settings';

const WEREAD_HOME_URL = 'https://weread.qq.com/web/shelf';
const WEREAD_PARTITION = 'persist:weread-plugin-browser';

export default class WereadBrowserWindow {
	private modal: any;

	constructor() {
		const { remote } = require('electron');
		const { BrowserWindow: RemoteBrowserWindow } = remote;
		this.modal = new RemoteBrowserWindow({
			parent: remote.getCurrentWindow(),
			width: 1280,
			height: 860,
			show: false,
			webPreferences: {
				partition: WEREAD_PARTITION
			}
		});

		this.modal.once('ready-to-show', () => {
			this.modal.setTitle('微信读书');
			this.modal.show();
		});
	}

	async open(url: string = WEREAD_HOME_URL): Promise<void> {
		await this.syncCookiesToSession();
		await this.modal.loadURL(url);
	}

	private async syncCookiesToSession(): Promise<void> {
		const session = this.modal.webContents.session;
		const cookies = get(settingsStore).cookies ?? [];

		for (const cookie of cookies) {
			try {
				await session.cookies.set({
					url: 'https://weread.qq.com',
					name: cookie.name,
					value: cookie.value,
					domain: '.weread.qq.com',
					path: '/',
					secure: true,
					httpOnly: false
				});
			} catch (error) {
				console.debug('[weread plugin] sync window cookie failed', cookie.name, error);
			}
		}
	}
}
