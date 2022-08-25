import { App, Modal } from 'obsidian';
import { settingsStore } from '../settings';
import { getCookieString } from '../utils/cookiesUtil';
import { get } from 'svelte/store';

export class ShowDebugInfoModal extends Modal {
	constructor(app: App) {
		super(app);
	}

	onOpen() {
		const { contentEl } = this;
		const cookies = get(settingsStore).cookies;
		const cookieStr = getCookieString(cookies);

		const keys = contentEl.createDiv();
		keys.createEl('h1', { text: '🚨Cookie 是敏感信息，仅用于Debug，请不要泄露' });

		const cookie = contentEl.createDiv();
		cookie.createEl('kbd', { text: cookieStr });
	}

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
	}
}
