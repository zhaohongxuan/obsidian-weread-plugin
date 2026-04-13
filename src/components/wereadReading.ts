import { WorkspaceLeaf, ItemView } from 'obsidian';
import WereadPlugin from '../../main';

export const WEREAD_BROWSER_VIEW_ID = 'weread-reading-view';
const WEREAD_HOME_URL = 'https://weread.qq.com/web/shelf';
const WEREAD_PARTITION = 'persist:weread-plugin-browser';

type WereadViewState = {
	url?: string;
};

export class WereadReadingView extends ItemView {
	plugin: WereadPlugin;
	getViewType(): string {
		return WEREAD_BROWSER_VIEW_ID;
	}
	getDisplayText(): string {
		return '微信读书';
	}
	leaf: WorkspaceLeaf;
	private webviewEl: HTMLElement;
	private currentUrl = WEREAD_HOME_URL;
	private pendingUrl: string | null = null;
	private isBootstrapped = false;

	constructor(leaf: WorkspaceLeaf) {
		super(leaf);
	}

	getIcon(): string {
		return 'book-open';
	}

	async onClose() {
		// Nothing to clean up.
	}

	async onOpen() {
		this.webviewEl = this.contentEl.doc.createElement('webview');
		this.webviewEl.setAttribute('partition', WEREAD_PARTITION);
		this.webviewEl.setAttribute('allowpopups', '');
		this.webviewEl.addClass('weread-frame');
		this.webviewEl.addEventListener('did-finish-load', () => {
			if (!this.isBootstrapped) {
				this.isBootstrapped = true;
				if (this.pendingUrl) {
					const nextUrl = this.pendingUrl;
					this.pendingUrl = null;
					this.webviewEl.setAttribute('src', nextUrl);
				}
			}
		});

		if (this.currentUrl === WEREAD_HOME_URL) {
			this.webviewEl.setAttribute('src', WEREAD_HOME_URL);
		} else {
			this.pendingUrl = this.currentUrl;
			this.webviewEl.setAttribute('src', WEREAD_HOME_URL);
		}

		this.contentEl.appendChild(this.webviewEl);
		this.contentEl.addClass('weread-view-content');
	}

	getState(): WereadViewState {
		return {
			url: this.currentUrl
		};
	}

	async setState(state: WereadViewState): Promise<void> {
		this.currentUrl = state?.url || WEREAD_HOME_URL;
		if (!this.webviewEl) {
			return;
		}

		if (!this.isBootstrapped && this.currentUrl !== WEREAD_HOME_URL) {
			this.pendingUrl = this.currentUrl;
			this.webviewEl.setAttribute('src', WEREAD_HOME_URL);
			return;
		}

		this.pendingUrl = null;
		this.webviewEl.setAttribute('src', this.currentUrl);
	}

	navigate(url: string = WEREAD_HOME_URL) {
		this.currentUrl = url;
		if (!this.webviewEl) {
			return;
		}

		if (!this.isBootstrapped && url !== WEREAD_HOME_URL) {
			this.pendingUrl = url;
			this.webviewEl.setAttribute('src', WEREAD_HOME_URL);
			return;
		}

		this.pendingUrl = null;
		this.webviewEl.setAttribute('src', url);
	}
}
