/** One Obsidian leaf owns five lazily mounted panels and a persistent tab bar. */
import {
	ItemView,
	Notice,
	setIcon,
	type Menu,
	type ViewStateResult,
	type WorkspaceLeaf
} from 'obsidian';
import type WereadPlugin from '../../main';
import type ApiRouter from '../api-router';
import type WereadBookshelfService from '../bookshelf';
import type FileManager from '../fileManager';
import type { WereadJournalService } from '../journal';
import { journalId } from '../journalHelpers';
import { WereadJournalPanel } from './wereadJournal';
import { WereadBookshelfPanel } from './wereadBookshelf';
import { WereadReadingStatsPanel } from './wereadReadingStats';
import { WereadFavoritesPanel } from './wereadFavorites';
import { WereadBookDetailPanel } from './wereadBookDetailPanel';
import type { WereadPanel, WereadTab } from './wereadPanel';
import './wereadLibrary.css';

export const WEREAD_LIBRARY_VIEW_ID = 'weread-library-view';
const TABS: readonly [WereadTab, string][] = [
	['today', '今日'],
	['bookshelf', '书架'],
	['review', '回顾'],
	['favorites', '收藏'],
	['stats', '统计']
];
const TAB_ICONS: Readonly<Record<WereadTab, string>> = {
	today: 'sun',
	bookshelf: 'library',
	review: 'history',
	favorites: 'star',
	stats: 'bar-chart-3'
};
const isTab = (value: unknown): value is WereadTab => TABS.some(([tab]) => tab === value);
let instanceCount = 0;

type Entry = { panel: WereadPanel; element: HTMLElement; opening: Promise<void> };
export type WereadBookSelection = {
	bookId: string;
	bookTitle?: string;
	bookCover?: string;
	localFilePath?: string;
	currentTab?: string;
};
type BookRoute = { selection: WereadBookSelection; originTab: WereadTab };
type DetailEntry = { panel: WereadBookDetailPanel; element: HTMLElement };

/** Workspace state contains navigation only, never remote book payloads. */
function bookSelection(value: unknown): WereadBookSelection | undefined {
	if (!value || typeof value !== 'object') return undefined;
	const state = value as Record<string, unknown>;
	const bookId = journalId(state.bookId);
	if (!bookId.trim()) return undefined;
	const selection: WereadBookSelection = { bookId };
	for (const key of ['bookTitle', 'bookCover', 'localFilePath', 'currentTab'] as const) {
		if (typeof state[key] === 'string') selection[key] = state[key];
	}
	return selection;
}

export class WereadLibraryView extends ItemView {
	private tab: WereadTab;
	private opened = false;
	private panelsEl?: HTMLElement;
	private entries = new Map<WereadTab, Entry>();
	private buttons = new Map<WereadTab, HTMLButtonElement>();
	private instanceId = `weread-library-${++instanceCount}`;
	private bookRoute?: BookRoute;
	private detail?: DetailEntry;
	private returnFocus?: HTMLElement;

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
	getState(): { tab: WereadTab; bookDetail?: WereadBookSelection; originTab?: WereadTab } {
		if (!this.bookRoute) return { tab: this.tab };
		const panelState = bookSelection(this.detail?.panel.getState());
		const selection = this.bookRoute.selection;
		return {
			tab: this.tab,
			bookDetail: {
				...selection,
				...(panelState?.bookId === selection.bookId ? panelState : {})
			},
			originTab: this.bookRoute.originTab
		};
	}
	async setState(state: unknown, result: ViewStateResult): Promise<void> {
		if (state && typeof state === 'object') {
			const navigation = state as Record<string, unknown>;
			if (isTab(navigation.tab)) {
				this.closeDetail();
				this.tab = navigation.tab;
				const selection = bookSelection(navigation.bookDetail);
				if (selection) {
					this.bookRoute = {
						selection,
						originTab: isTab(navigation.originTab) ? navigation.originTab : this.tab
					};
				}
				if (this.opened) {
					await this.selectTab(this.tab);
					this.mountDetail();
				}
			}
		}
		await super.setState(state, result);
	}
	onMoreOptionsMenu(menu: Menu): void {
		if (this.detail && this.bookRoute?.originTab === this.tab) {
			this.detail.panel.onMoreOptionsMenu(menu);
		} else {
			this.entries.get(this.tab)?.panel.onMoreOptionsMenu(menu);
		}
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
			const icon = button.createEl('span', {
				cls: 'weread-library-tab-icon',
				attr: { 'aria-hidden': 'true' }
			});
			setIcon(icon, TAB_ICONS[tab]);
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
		this.mountDetail();
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
					? new WereadBookshelfPanel(
							element,
							this.plugin,
							this.bookshelf,
							(next) => this.selectTab(next),
							(selection) => this.openBookDetail(selection)
						)
					: tab === 'favorites'
						? new WereadFavoritesPanel(
								element,
								this.plugin,
								this.plugin.favoritesService
							)
						: tab === 'stats'
							? new WereadReadingStatsPanel(element, this.app, this.api, this.files)
							: new WereadJournalPanel(
									element,
									this.plugin,
									this.journal,
									this.api,
									tab
								);
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
		this.updateVisibility();
		this.app.workspace.requestSaveLayout();
		// Content requests must never hold up navigation or the host's view lifecycle.
		void entry.opening;
	}
	/** Book navigation never replaces this leaf or unmounts its originating panel. */
	async openBookDetail(selection: WereadBookSelection): Promise<void> {
		const next = bookSelection(selection);
		if (!next) return;
		const active = this.contentEl.ownerDocument?.activeElement;
		if (active && this.contentEl.contains(active)) this.returnFocus = active as HTMLElement;
		this.closeDetail();
		this.bookRoute = { selection: next, originTab: this.tab };
		this.mountDetail();
		this.app.workspace.requestSaveLayout();
	}

	private updateVisibility(): void {
		const showingDetail = this.bookRoute?.originTab === this.tab;
		for (const [tab, button] of this.buttons) {
			button.setAttribute(
				'aria-controls',
				showingDetail && tab === this.tab
					? `${this.instanceId}-book-detail`
					: `${this.instanceId}-panel-${tab}`
			);
		}
		for (const [tab, entry] of this.entries) {
			entry.element.hidden = tab !== this.tab || showingDetail;
		}
		if (this.detail) this.detail.element.hidden = !showingDetail;
	}

	private mountDetail(): void {
		if (!this.opened || !this.panelsEl || !this.bookRoute || this.detail) return;
		const route = this.bookRoute;
		const element = this.panelsEl.createDiv({
			cls: 'weread-library-panel weread-library-book-detail',
			attr: {
				role: 'tabpanel',
				id: `${this.instanceId}-book-detail`,
				'aria-labelledby': `${this.instanceId}-tab-${route.originTab}`
			}
		});
		const panel = new WereadBookDetailPanel(element, this.api, this.plugin, {
			onBack: () => {
				if (this.detail?.panel !== panel) return;
				const focus = this.returnFocus;
				this.closeDetail();
				void this.selectTab(route.originTab);
				if (focus && this.contentEl.contains(focus)) focus.focus({ preventScroll: true });
				else this.buttons.get(route.originTab)?.focus({ preventScroll: true });
				this.returnFocus = undefined;
			},
			breadcrumbLabel: TABS.find(([tab]) => tab === route.originTab)?.[1]
		});
		this.detail = { panel, element };
		this.addChild(panel);
		this.updateVisibility();
		// Lifecycle/navigation readiness must not wait on any remote detail request.
		void panel
			.onOpen()
			.then(() => {
				if (this.detail?.panel === panel) return panel.setState(route.selection);
			})
			.catch((error: unknown) => {
				if (!this.opened || this.detail?.panel !== panel) return;
				new Notice(error instanceof Error ? error.message : '书籍详情加载失败，请重试');
			});
	}

	private closeDetail(): void {
		const detail = this.detail;
		this.detail = undefined;
		this.bookRoute = undefined;
		if (detail) {
			this.removeChild(detail.panel);
			detail.element.remove();
		}
	}

	async onClose(): Promise<void> {
		this.opened = false;
		this.closeDetail();
		this.returnFocus = undefined;
		for (const entry of this.entries.values()) this.removeChild(entry.panel);
		this.entries.clear();
		this.buttons.clear();
		this.panelsEl = undefined;
		this.contentEl.empty();
	}
}
