/** Shared lifecycle for content rendered beneath the library's internal tab bar. */
import { Component, type App, type Menu } from 'obsidian';

export type WereadTab = 'today' | 'bookshelf' | 'review' | 'favorites' | 'stats';
export type WereadNavigate = (tab: WereadTab) => Promise<void>;

export abstract class WereadPanel extends Component {
	constructor(
		public readonly contentEl: HTMLElement,
		public readonly app: App
	) {
		super();
	}
	abstract onOpen(): Promise<void>;
	abstract onClose(): Promise<void>;
	onMoreOptionsMenu(_menu: Menu): void {}
	onunload(): void {
		void this.onClose();
	}
}
