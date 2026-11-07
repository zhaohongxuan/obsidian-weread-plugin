import { ItemView, type WorkspaceLeaf } from 'obsidian';
import type ApiRouter from '../api-router';
import type WereadPlugin from '../../main';
import { WereadBookDetailPanel } from './wereadBookDetailPanel';

export const WEREAD_BOOK_DETAIL_VIEW_ID = 'weread-book-detail-view';

/** Restores workspaces saved before details moved inside the library. */
export class WereadBookDetailView extends ItemView {
	private panel: WereadBookDetailPanel;
	private opened = false;
	private restoredState: Record<string, unknown> = {};
	constructor(leaf: WorkspaceLeaf, api: ApiRouter, plugin: WereadPlugin) {
		super(leaf);
		this.panel = new WereadBookDetailPanel(this.contentEl, api, plugin, {
			breadcrumbLabel: '书架',
			onBack: () => {
				void this.leaf.setViewState({
					type: 'weread-library-view',
					state: { tab: 'bookshelf' }
				});
			}
		});
		this.addChild(this.panel);
	}
	getViewType(): string {
		return WEREAD_BOOK_DETAIL_VIEW_ID;
	}
	getDisplayText(): string {
		return String(this.panel.getState().bookTitle || '书籍详情');
	}
	getIcon(): string {
		return 'book-open';
	}
	async onOpen(): Promise<void> {
		this.opened = true;
		await this.panel.onOpen();
		if (this.restoredState.bookId) await this.panel.setState(this.restoredState);
	}
	async onClose(): Promise<void> {
		this.opened = false;
		await this.panel.onClose();
	}
	getState(): Record<string, unknown> {
		return this.opened ? this.panel.getState() : this.restoredState;
	}
	async setState(state: Record<string, unknown>, result?: unknown): Promise<void> {
		this.restoredState = { ...state };
		if (this.opened) await this.panel.setState(state, result);
	}
}
