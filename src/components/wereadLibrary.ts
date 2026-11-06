/** One Obsidian leaf owns four lazily mounted panels and a persistent tab bar. */
import { ItemView, Notice, type Menu, type ViewStateResult, type WorkspaceLeaf } from 'obsidian';
import type WereadPlugin from '../../main';
import type ApiRouter from '../api-router';
import type WereadBookshelfService from '../bookshelf';
import type FileManager from '../fileManager';
import type { WereadJournalService } from '../journal';
import { WereadJournalPanel } from './wereadJournal';
import { WereadBookshelfPanel } from './wereadBookshelf';
import { WereadReadingStatsPanel } from './wereadReadingStats';
import type { WereadPanel, WereadTab } from './wereadPanel';
import './wereadLibrary.css';

export const WEREAD_LIBRARY_VIEW_ID = 'weread-library-view';
const TABS: readonly [WereadTab, string][] = [
	['today', '今日'],
	['bookshelf', '书架'],
	['review', '回顾'],
	['stats', '统计']
];
const isTab = (value: unknown): value is WereadTab => TABS.some(([tab]) => tab === value);
let instanceCount = 0;

type Entry = { panel: WereadPanel; element: HTMLElement; opening: Promise<void> };

export class WereadLibraryView extends ItemView {
	private tab: WereadTab;
	private opened = false;
	private panelsEl?: HTMLElement;
	private entries = new Map<WereadTab, Entry>();
	private buttons = new Map<WereadTab, HTMLButtonElement>();
	private instanceId = `weread-library-${++instanceCount}`;

	constructor(
		leaf: WorkspaceLeaf,
		private plugin: WereadPlugin,
		private api: ApiRouter,
		private bookshelf: WereadBookshelfService,
		private journal: WereadJournalService,
		private files: FileManager,
		initialTab: WereadTab = 'today',
		private viewType = WEREAD_LIBRARY_VIEW_ID
	) {
		super(leaf);
		this.tab = initialTab;
	}
	getViewType(): string {
		return this.viewType;
	}
	getDisplayText(): string {
		return '微信读书';
	}
	getIcon(): string {
		return 'book-open';
	}
	getState(): { tab: WereadTab } {
		return { tab: this.tab };
	}
	async setState(state: unknown, result: ViewStateResult): Promise<void> {
		const tab =
			state && typeof state === 'object' ? (state as { tab?: unknown }).tab : undefined;
		if (isTab(tab)) {
			this.tab = tab;
			if (this.opened) await this.selectTab(tab);
		}
		await super.setState(state, result);
	}
	onMoreOptionsMenu(menu: Menu): void {
		this.entries.get(this.tab)?.panel.onMoreOptionsMenu(menu);
	}

	async onOpen(): Promise<void> {
		this.contentEl.empty();
		this.contentEl.addClass('weread-library-view');
		this.opened = true;
		const nav = this.contentEl.createDiv({
			cls: 'weread-library-tabs',
			attr: { role: 'tablist', 'aria-label': '微信读书功能' }
		});
		for (const [tab, label] of TABS) {
			const button = nav.createEl('button', {
				text: label,
				attr: {
					role: 'tab',
					id: `${this.instanceId}-tab-${tab}`,
					'aria-controls': `${this.instanceId}-panel-${tab}`
				}
			});
			button.onclick = () => {
				void this.selectTab(tab);
			};
			button.onkeydown = (event) => {
				const index = TABS.findIndex(([value]) => value === tab);
				const next =
					event.key === 'ArrowRight'
						? (index + 1) % TABS.length
						: event.key === 'ArrowLeft'
							? (index + TABS.length - 1) % TABS.length
							: event.key === 'Home'
								? 0
								: event.key === 'End'
									? TABS.length - 1
									: undefined;
				if (next === undefined) return;
				event.preventDefault();
				const target = TABS[next][0];
				this.buttons.get(target)?.focus();
				void this.selectTab(target);
			};
			this.buttons.set(tab, button);
		}
		this.panelsEl = this.contentEl.createDiv({ cls: 'weread-library-panels' });
		await this.selectTab(this.tab);
	}

	/** Switching only changes visibility; existing instances retain filters and scroll. */
	async selectTab(tab: WereadTab): Promise<void> {
		if (!isTab(tab)) return;
		this.tab = tab;
		if (!this.opened || !this.panelsEl) return;
		for (const [key, button] of this.buttons) {
			const selected = key === tab;
			button.classList.toggle('mod-cta', selected);
			button.setAttribute('aria-selected', String(selected));
			button.tabIndex = selected ? 0 : -1;
		}
		for (const [key, entry] of this.entries) entry.element.hidden = key !== tab;
		let entry = this.entries.get(tab);
		if (!entry) {
			const element = this.panelsEl.createDiv({
				cls: 'weread-library-panel',
				attr: {
					role: 'tabpanel',
					id: `${this.instanceId}-panel-${tab}`,
					'aria-labelledby': `${this.instanceId}-tab-${tab}`
				}
			});
			const panel =
				tab === 'bookshelf'
					? new WereadBookshelfPanel(element, this.plugin, this.bookshelf, (next) =>
							this.selectTab(next)
						)
					: tab === 'stats'
						? new WereadReadingStatsPanel(element, this.app, this.api, this.files)
						: new WereadJournalPanel(element, this.plugin, this.journal, this.api, tab);
			this.addChild(panel);
			// Publish before opening because subscriptions can synchronously navigate.
			entry = { panel, element, opening: Promise.resolve() };
			this.entries.set(tab, entry);
			entry.opening = panel.onOpen().catch((error: unknown) => {
				if (!this.opened) return;
				element.empty();
				element.createEl('p', { text: '页面加载失败，请重试。' });
				element.createEl('button', { text: '重试' }).onclick = () => {
					this.removeChild(panel);
					this.entries.delete(tab);
					element.remove();
					void this.selectTab(tab);
				};
				new Notice(error instanceof Error ? error.message : '微信读书页面加载失败');
			});
		}
		entry.element.hidden = this.tab !== tab;
		this.app.workspace.requestSaveLayout();
		// Content requests must never hold up navigation or the host's view lifecycle.
		void entry.opening;
	}
	async onClose(): Promise<void> {
		this.opened = false;
		for (const entry of this.entries.values()) this.removeChild(entry.panel);
		this.entries.clear();
		this.buttons.clear();
		this.panelsEl = undefined;
		this.contentEl.empty();
	}
}
