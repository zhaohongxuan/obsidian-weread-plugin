import { WorkspaceLeaf, ItemView } from 'obsidian';
import WereadPlugin from '../../main';

export const WEREAD_BROWSER_VIEW_ID = 'weread-reading-view';

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
		this.webviewEl.setAttribute('allowpopups', '');
		this.webviewEl.addClass('weread-frame');
		this.webviewEl.setAttribute('src', 'https://r.qq.com');
		this.leaf.setViewState({
			type: WEREAD_BROWSER_VIEW_ID,
			active: true
		});

		this.contentEl.appendChild(this.webviewEl);
		this.contentEl.addClass('weread-view-content');
	}
}
