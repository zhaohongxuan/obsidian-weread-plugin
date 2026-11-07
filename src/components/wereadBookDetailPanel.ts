import './wereadBookDetail.css';
import { Notice, TFile, setIcon } from 'obsidian';
import { get } from 'svelte/store';
import type ApiRouter from '../api-router';
import type WereadPlugin from '../../main';
import type {
	BookDetailResponse,
	BookProgressResponse,
	HighlightResponse,
	BookReviewResponse,
	FavoritesState
} from '../models';
import { journalId, type JournalNote } from '../journalHelpers';
import { bookDetailFavoriteNote } from '../bookDetailHelpers';
import { settingsStore } from '../settings';
import { getPcUrl } from '../parser/parseResponse';
import {
	parseLocalPopularHighlights,
	parseLocalUserHighlights
} from '../utils/localHighlightParser';
import { openWereadHighlightLocation } from '../utils/openWereadUrl';
import { setOriginalReadingIcon } from '../utils/readingActionIcon';
import { formatNoteTimestamp } from '../utils/noteTime';
import { WereadPanel } from './wereadPanel';
import { FavoritesUndoToast } from './wereadFavorites';

const HIGHLIGHT_COLORS: Record<number, { name: string; label: string }> = {
	1: { name: 'yellow', label: '黄色' },
	2: { name: 'blue', label: '蓝色' },
	3: { name: 'green', label: '绿色' },
	4: { name: 'red', label: '红色' },
	5: { name: 'purple', label: '紫色' }
};
const TABS = [
	['highlights', '划线'],
	['notes', '笔记'],
	['popular', '热门划线'],
	['reviews', '书评']
] as const;
type Tab = (typeof TABS)[number][0];
type PopularResponse = { items: any[]; chapters: any[] };
export interface BookDetailPanelOptions {
	onBack?: () => void;
	breadcrumbLabel?: string;
}

/** Book detail rendered inside the library; owns neither a workspace leaf nor navigation. */
export class WereadBookDetailPanel extends WereadPanel {
	private active = false;
	private generation = 0;
	private bookId = '';
	private bookTitle = '';
	private bookCover = '';
	private localFilePath = '';
	private currentTab: Tab = 'highlights';
	private detail?: BookDetailResponse;
	private progress?: BookProgressResponse;
	private highlightResp?: HighlightResponse;
	private reviewResp?: BookReviewResponse;
	private popularResp?: PopularResponse;
	private publicReviewResp?: BookReviewResponse;
	private usingLocalHighlights = false;
	private usingLocalPopular = false;
	private loading = false;
	private syncing = false;
	private failures = new Set<string>();
	private header!: HTMLElement;
	private tabs!: HTMLElement;
	private body!: HTMLElement;
	private favoriteStatus!: HTMLElement;
	private breadcrumbTitle!: HTMLElement;
	private unsubscribe?: () => void;
	private undo?: FavoritesUndoToast;
	private favoriteState?: FavoritesState;
	private stars = new Map<HTMLButtonElement, JournalNote>();
	private pending = new Set<string>();

	constructor(
		containerEl: HTMLElement,
		private api: ApiRouter,
		private plugin: WereadPlugin,
		private options: BookDetailPanelOptions = {}
	) {
		super(containerEl, plugin.app);
	}

	async onOpen(): Promise<void> {
		this.active = true;
		this.contentEl.empty();
		this.contentEl.addClass('weread-detail-panel');
		const page = this.contentEl.createDiv({ cls: 'weread-detail-page' });
		const breadcrumb = page.createEl('nav', {
			cls: 'weread-detail-breadcrumb',
			attr: { 'aria-label': '书籍导航' }
		});
		const label = this.options.breadcrumbLabel || '书架';
		const back = this.button(breadcrumb, label, () => {
			if (this.options.onBack) this.options.onBack();
			else void this.onClose();
		});
		back.setAttribute('aria-label', `返回${label}`);
		back.classList.add('weread-detail-back');
		breadcrumb.createSpan({ text: '/', attr: { 'aria-hidden': 'true' } });
		this.breadcrumbTitle = breadcrumb.createSpan({
			text: this.bookTitle || '书籍详情',
			attr: { 'aria-current': 'page' }
		});
		this.header = page.createEl('header', { cls: 'weread-detail-hero' });
		this.tabs = page.createDiv({
			cls: 'weread-detail-tabs',
			attr: { role: 'tablist', 'aria-label': '书籍内容' }
		});
		this.favoriteStatus = page.createDiv({
			cls: 'weread-detail-favorite-status',
			attr: { 'aria-live': 'polite' }
		});
		this.body = page.createDiv({
			cls: 'weread-detail-content',
			attr: { role: 'tabpanel', 'aria-label': '书籍内容' }
		});
		this.render();
		// Data requests belong to setState; opening the panel only creates its scaffold.
		this.connectFavorites();
	}
	async onClose(): Promise<void> {
		this.active = false;
		this.generation += 1;
		this.unsubscribe?.();
		this.unsubscribe = undefined;
		this.undo?.clear();
		this.syncing = false;
		this.stars.clear();
		this.pending.clear();
	}
	getState(): Record<string, unknown> {
		return {
			bookId: this.bookId,
			bookTitle: this.bookTitle,
			bookCover: this.bookCover,
			localFilePath: this.localFilePath,
			currentTab: this.currentTab
		};
	}
	async setState(state: Record<string, unknown>, _result?: unknown): Promise<void> {
		const bookId = journalId(state.bookId);
		const changed = bookId !== this.bookId;
		if (changed) {
			this.generation += 1;
			this.undo?.clear();
			this.bookId = bookId;
			this.syncing = false;
			this.detail = undefined;
			this.progress = undefined;
			this.highlightResp = undefined;
			this.reviewResp = undefined;
			this.popularResp = undefined;
			this.publicReviewResp = undefined;
			this.usingLocalHighlights = false;
			this.usingLocalPopular = false;
			this.failures.clear();
			this.stars.clear();
			this.pending.clear();
		}
		for (const key of ['bookTitle', 'bookCover', 'localFilePath'] as const) {
			if (typeof state[key] === 'string') this[key] = state[key] as string;
			else if (changed) this[key] = '';
		}
		this.currentTab = TABS.some(([tab]) => tab === state.currentTab)
			? (state.currentTab as Tab)
			: 'highlights';
		this.render();
		if (this.bookId && (changed || (!this.highlightResp && !this.detail && !this.loading)))
			await this.loadData();
	}
	private valid(generation: number, bookId: string): boolean {
		return this.active && generation === this.generation && bookId === this.bookId;
	}
	private async loadData(): Promise<void> {
		if (this.syncing) return;
		const bookId = this.bookId;
		const path = this.localFilePath;
		const generation = ++this.generation;
		this.loading = true;
		this.pending.clear();
		this.undo?.clear();
		this.render();
		const results = await Promise.allSettled([
			Promise.resolve().then(() => this.api.getBook(bookId)),
			Promise.resolve().then(() => this.api.getProgress(bookId)),
			Promise.resolve().then(() => this.api.getNotebookHighlights(bookId)),
			Promise.resolve().then(() => this.api.getNotebookReviews(bookId)),
			Promise.resolve().then(() => this.api.getBestBookmarks(bookId)),
			Promise.resolve().then(() => this.api.getPublicReviews(bookId))
		]);
		if (!this.valid(generation, bookId)) return;
		const value = (index: number): any => {
			const result = results[index];
			return result.status === 'fulfilled' && result.value && !(result.value as any).errcode
				? result.value
				: undefined;
		};
		const detail = value(0) as BookDetailResponse | undefined;
		const progress = value(1) as BookProgressResponse | undefined;
		let highlights = value(2) as HighlightResponse | undefined;
		const reviews = value(3) as BookReviewResponse | undefined;
		let popular = value(4) as PopularResponse | undefined;
		const publicReviews = value(5) as BookReviewResponse | undefined;
		const failures = new Set<string>();
		if (!detail) failures.add('detail');
		if (!progress) failures.add('progress');
		if (!Array.isArray(highlights?.updated)) failures.add('highlights');
		if (!Array.isArray(reviews?.reviews)) failures.add('notes');
		if (!Array.isArray(popular?.items)) failures.add('popular');
		if (!Array.isArray(publicReviews?.reviews)) failures.add('reviews');
		let localHighlights = false,
			localPopular = false;
		if (path && (!highlights?.updated?.length || !popular?.items?.length)) {
			try {
				const file = this.app.vault.getAbstractFileByPath(path);
				if (file instanceof TFile) {
					const content = await this.app.vault.read(file);
					if (!this.valid(generation, bookId)) return;
					if (!highlights?.updated?.length) {
						const parsed = parseLocalUserHighlights(content, bookId);
						if (parsed.updated.length) {
							highlights = { ...parsed, book: highlights?.book || parsed.book };
							localHighlights = true;
						}
					}
					if (!popular?.items?.length) {
						const parsed = parseLocalPopularHighlights(content, bookId);
						if (parsed.items.length) {
							popular = parsed;
							localPopular = true;
						}
					}
				}
			} catch {
				failures.add('local');
			}
		}
		if (!this.valid(generation, bookId)) return;
		this.detail = detail;
		this.progress = progress;
		this.highlightResp = highlights;
		this.reviewResp = reviews;
		this.popularResp = popular;
		this.publicReviewResp = publicReviews;
		this.usingLocalHighlights = localHighlights;
		this.usingLocalPopular = localPopular;
		this.failures = failures;
		this.loading = false;
		this.render();
	}
	private button(
		parent: HTMLElement,
		text: string,
		action: () => void,
		cls = 'weread-detail-action'
	): HTMLButtonElement {
		const button = parent.createEl('button', { text, cls, attr: { type: 'button' } });
		button.onclick = action;
		return button;
	}
	private render(): void {
		if (!this.active || !this.header) return;
		this.header.empty();
		this.tabs.empty();
		this.breadcrumbTitle.setText(
			this.detail?.title || this.highlightResp?.book?.title || this.bookTitle || '书籍详情'
		);
		this.renderHeader();
		for (const [id, label] of TABS) {
			const tab = this.button(
				this.tabs,
				label,
				() => {
					this.currentTab = id;
					this.app.workspace.requestSaveLayout?.();
					this.renderTabs();
					this.renderContent();
				},
				'weread-detail-tab'
			);
			tab.dataset.tab = id;
			tab.setAttribute('role', 'tab');
		}
		this.renderTabs();
		this.renderContent();
		this.updateStars();
	}
	private renderTabs(): void {
		this.tabs.querySelectorAll<HTMLButtonElement>('[role="tab"]').forEach((tab) => {
			const selected = tab.dataset.tab === this.currentTab;
			tab.setAttribute('aria-selected', String(selected));
			tab.classList.toggle('is-active', selected);
		});
		this.body.setAttribute(
			'aria-label',
			TABS.find(([tab]) => tab === this.currentTab)?.[1] || '划线'
		);
	}
	private headerButton(
		parent: HTMLElement,
		text: string,
		icon: string,
		action: () => void
	): HTMLButtonElement {
		const button = this.button(parent, '', action);
		const glyph = button.createSpan({
			cls: 'weread-detail-action-icon',
			attr: { 'aria-hidden': 'true' }
		});
		if (icon === 'reading') setOriginalReadingIcon(glyph);
		else setIcon(glyph, icon);
		button.createSpan({ text });
		return button;
	}
	private renderHeader(): void {
		const title =
			this.detail?.title || this.highlightResp?.book?.title || this.bookTitle || '书籍详情';
		const cover = this.detail?.cover || this.highlightResp?.book?.cover || this.bookCover;
		const coverColumn = this.header.createDiv({ cls: 'weread-detail-cover-column' });
		const jacket = coverColumn.createDiv({ cls: 'weread-detail-jacket' });
		if (cover && /^https?:\/\//.test(cover)) {
			const image = jacket.createEl('img', {
				cls: 'weread-detail-cover',
				attr: { src: cover, alt: `《${title}》封面` }
			});
			image.onerror = () => {
				image.remove();
				jacket.createSpan({ text: title });
			};
		} else jacket.createSpan({ text: title });
		const info = this.header.createDiv({ cls: 'weread-detail-info' });
		info.createEl('p', { text: '我的阅读 · 书籍详情', cls: 'weread-detail-eyebrow' });
		info.createEl('h1', { text: title, cls: 'weread-detail-title' });
		info.createEl('p', {
			text: this.detail?.author || this.highlightResp?.book?.author || '作者信息暂缺',
			cls: 'weread-detail-author'
		});
		if (this.detail?.intro)
			info.createEl('p', { text: this.detail.intro, cls: 'weread-detail-intro' });
		const stats = info.createDiv({ cls: 'weread-detail-reading-stats' });
		const facts = stats.createDiv({ cls: 'weread-detail-facts' });
		const reading = this.progress?.book;
		if (reading?.finishTime || this.detail?.finishReading) facts.createSpan({ text: '已读完' });
		else if (reading?.progress) facts.createSpan({ text: '阅读中' });
		if (reading?.readingTime) {
			const minutes = Math.floor(reading.readingTime / 60);
			facts.createSpan({
				text:
					minutes >= 60
						? `阅读 ${Math.floor(minutes / 60)} 小时 ${minutes % 60} 分钟`
						: `阅读 ${minutes} 分钟`
			});
		}
		if (reading?.finishTime)
			facts.createSpan({ text: `读完于 ${this.date(reading.finishTime)}` });
		if (typeof reading?.progress === 'number' && Number.isFinite(reading.progress)) {
			const percent = Math.max(0, Math.min(100, reading.progress));
			const progress = stats.createDiv({ cls: 'weread-detail-progress' });
			progress.createSpan({ text: `阅读进度 ${percent}%` });
			progress.createEl('progress', {
				attr: { max: '100', value: String(percent), 'aria-label': '阅读进度' }
			});
		}
		const counts = coverColumn.createDiv({ cls: 'weread-detail-counts' });
		if (this.highlightResp)
			counts.createSpan({ text: `${this.personalHighlights().length} 条划线` });
		if (this.reviewResp)
			counts.createSpan({
				text: `${this.reviewResp.reviews?.filter((row) => row.review?.type !== 4).length || 0} 条笔记`
			});
		const actions = info.createDiv({ cls: 'weread-detail-header-actions' });
		this.headerButton(actions, '去阅读', 'reading', () => void this.openBook());
		if (this.localFilePath)
			this.headerButton(actions, '本地笔记', 'file-text', () => void this.openLocal());
		const refresh = this.headerButton(
			actions,
			this.loading ? '正在刷新…' : '刷新',
			'refresh-cw',
			() => void this.loadData()
		);
		refresh.disabled = this.loading || this.syncing || !this.bookId;
		if (typeof this.plugin.syncBookById === 'function') {
			const sync = this.headerButton(
				actions,
				this.syncing ? '同步中…' : '同步笔记',
				'cloud-download',
				() => void this.syncNotes()
			);
			sync.classList.add('weread-detail-sync');
			sync.title = '同步这本书的本地笔记';
			sync.disabled = this.loading || this.syncing || !this.bookId;
		}
		if (this.failures.has('detail') || this.failures.has('progress'))
			info.createEl('p', {
				cls: 'weread-detail-muted',
				text: '部分书籍信息暂不可用，可刷新重试。'
			});
	}
	private async syncNotes(): Promise<void> {
		if (
			!this.active ||
			this.syncing ||
			this.loading ||
			!this.bookId ||
			typeof this.plugin.syncBookById !== 'function'
		)
			return;
		const bookId = this.bookId;
		const generation = this.generation;
		this.syncing = true;
		this.header.empty();
		this.renderHeader();
		try {
			await this.plugin.syncBookById(bookId);
			if (!this.valid(generation, bookId)) return;
			this.syncing = false;
			await this.loadData();
		} catch (error) {
			if (this.valid(generation, bookId)) {
				this.syncing = false;
				this.header.empty();
				this.renderHeader();
				new Notice(error instanceof Error ? error.message : '同步笔记失败，请重试');
			}
		}
	}
	private personalHighlights(): HighlightResponse['updated'] {
		return (this.highlightResp?.updated || []).filter((h) => String(h.type) !== '0');
	}
	private renderContent(): void {
		this.stars.clear();
		this.body.empty();
		this.body.setAttribute('aria-busy', String(this.loading));
		if (!this.bookId) {
			this.status('选择一本书，继续阅读与回顾。');
			return;
		}
		if (this.loading) {
			this.status('正在整理这本书的阅读记录…');
			return;
		}
		const local =
			this.currentTab === 'highlights'
				? this.usingLocalHighlights
				: this.currentTab === 'popular' && this.usingLocalPopular;
		if (local)
			this.status(
				'当前显示本地已同步划线。联网读取原始划线后可收藏。',
				'weread-detail-warning'
			);
		if (this.failures.has(this.currentTab)) {
			const warning = this.body.createDiv({
				cls: 'weread-detail-warning',
				attr: { role: 'status' }
			});
			warning.createSpan({ text: '此项远程数据暂不可用，请检查登录或 API 配置后重试。' });
			this.button(warning, '重试', () => void this.loadData());
		}
		if (this.failures.has('local'))
			this.status('本地笔记暂时无法读取。', 'weread-detail-warning');
		switch (this.currentTab) {
			case 'highlights':
				this.renderHighlights(
					this.personalHighlights(),
					this.highlightResp?.chapters || [],
					true
				);
				break;
			case 'popular':
				this.renderHighlights(
					this.popularResp?.items || [],
					this.popularResp?.chapters || [],
					false
				);
				break;
			case 'notes':
				this.renderNotes();
				break;
			case 'reviews':
				this.renderReviews();
				break;
		}
		this.updateStars();
	}
	private status(text: string, cls = 'weread-detail-empty'): void {
		this.body.createEl('p', { text, cls });
	}
	private renderHighlights(items: any[], chapters: any[], personal: boolean): void {
		if (!items.length) {
			this.status(personal ? '还没有划线，读到喜欢的句子时留下印记。' : '暂无热门划线。');
			return;
		}
		const chapterMap = new Map(chapters.map((ch) => [String(ch.chapterUid), ch]));
		const groups = new Map<string, any[]>();
		for (const item of items) {
			const key = String(item.chapterUid);
			if (!groups.has(key)) groups.set(key, []);
			groups.get(key)!.push(item);
		}
		const ordered = [...groups].sort(
			([a], [b]) =>
				(chapterMap.get(a)?.chapterIdx ?? Number.MAX_SAFE_INTEGER) -
				(chapterMap.get(b)?.chapterIdx ?? Number.MAX_SAFE_INTEGER)
		);
		for (const [key, highlights] of ordered) {
			const chapter = chapterMap.get(key)?.title || highlights[0]?.chapterName || '未分章节';
			const section = this.body.createEl('section', { cls: 'weread-detail-chapter' });
			section.createEl('h2', { text: chapter, cls: 'weread-detail-chapter-title' });
			for (const h of [...highlights].sort(
				(a, b) => (parseInt(a.range, 10) || 0) - (parseInt(b.range, 10) || 0)
			)) {
				const card = section.createEl('article', {
					cls: personal ? 'weread-detail-highlight' : 'weread-detail-popular'
				});
				if (personal) card.dataset.bookmarkId = String(h.bookmarkId || '');
				card.createEl('blockquote', { text: h.markText || '', cls: 'weread-detail-quote' });
				if (h.contextAbstract)
					card.createEl('p', {
						text: h.contextAbstract,
						cls: 'weread-detail-annotation'
					});
				const meta = card.createDiv({ cls: 'weread-detail-entry-meta' });
				if (personal) {
					const color = HIGHLIGHT_COLORS[Number(h.colorStyle)] || HIGHLIGHT_COLORS[1];
					meta.createSpan({
						cls: 'weread-detail-highlight-color',
						attr: {
							'data-color': color.name,
							role: 'img',
							'aria-label': `${color.label}划线`,
							title: `${color.label}划线`
						}
					});
				}
				if (h.createTime) meta.createSpan({ text: formatNoteTimestamp(Number(h.createTime) * 1000) });
				if (h.range) meta.createSpan({ text: `位置 ${String(h.range).split('-')[0]}` });
				if (!personal && h.totalCount) meta.createSpan({ text: `${h.totalCount} 人划线` });
				const actions = meta.createDiv({ cls: 'weread-detail-entry-actions' });
				this.sourceAndCopy(actions, h.chapterUid, h.range, chapter, h.markText || '');
				if (personal) this.favoriteButton(actions, h);
			}
		}
	}
	private renderNotes(): void {
		const entries = [...(this.reviewResp?.reviews || [])]
			.filter((row) => row.review?.type !== 4)
			.sort((a, b) => (b.review?.createTime || 0) - (a.review?.createTime || 0));
		if (!entries.length) {
			this.status('还没有笔记，留一点自己的思考。');
			return;
		}
		for (const wrapper of entries) {
			const r = wrapper.review;
			const card = this.body.createEl('article', { cls: 'weread-detail-note' });
			if (r?.abstract)
				card.createEl('blockquote', { text: r.abstract, cls: 'weread-detail-quote' });
			card.createEl('p', { text: r?.content || '', cls: 'weread-detail-note-text' });
			const meta = card.createDiv({ cls: 'weread-detail-entry-meta' });
			const chapter =
				r?.chapterName ||
				this.highlightResp?.chapters?.find((ch) => ch.chapterUid === r?.chapterUid)
					?.title ||
				'';
			if (chapter) meta.createSpan({ text: chapter });
			if (r?.createTime) meta.createSpan({ text: formatNoteTimestamp(Number(r.createTime) * 1000) });
			const actions = meta.createDiv({ cls: 'weread-detail-entry-actions' });
			this.sourceAndCopy(actions, r?.chapterUid, r?.range, chapter, r?.content || '');
			if (this.localFilePath) this.button(actions, '本地笔记', () => void this.openLocal());
		}
	}
	private renderReviews(): void {
		const mine = (this.reviewResp?.reviews || []).filter((row) => row.review?.type === 4);
		const community = this.publicReviewResp?.reviews || [];
		if (!mine.length && !community.length) {
			this.status('暂无书评。');
			return;
		}
		for (const [label, rows] of [
			['我的书评', mine],
			[`社区书评${community.length > 20 ? ' · 显示前 20 条' : ''}`, community.slice(0, 20)]
		] as const) {
			if (!rows.length) continue;
			const section = this.body.createEl('section', { cls: 'weread-detail-chapter' });
			section.createEl('h2', { text: label, cls: 'weread-detail-chapter-title' });
			for (const wrapper of rows) {
				const r = (wrapper.review as any)?.review || wrapper.review || wrapper;
				const card = section.createEl('article', { cls: 'weread-detail-review' });
				card.createEl('p', {
					text: `${r.author?.name || (label === '我的书评' ? '我' : '读者')}${r.createTime ? ` · ${formatNoteTimestamp(Number(r.createTime) * 1000)}` : ''}`,
					cls: 'weread-detail-muted'
				});
				if (r.title) card.createEl('h3', { text: r.title });
				card.createEl('p', { text: r.content || '', cls: 'weread-detail-note-text' });
				if (r.content) {
					const actions = card.createDiv({ cls: 'weread-detail-entry-actions' });
					this.copyButton(actions, r.content);
				}
			}
		}
	}
	private sourceAndCopy(
		parent: HTMLElement,
		chapterUid: number | undefined,
		range: string | undefined,
		chapterTitle: string,
		text: string
	): void {
		const bookId = this.bookId;
		const generation = this.generation;
		if (chapterUid !== undefined && range) {
			const original = this.button(
				parent,
				'',
				() => {
					if (!this.valid(generation, bookId)) return;
					void openWereadHighlightLocation(this.plugin, bookId, chapterUid, range, {
						chapterTitle,
						markText: text
					}).catch(() => {
						if (this.valid(generation, bookId)) new Notice('打开原文失败，请重试');
					});
				},
				'weread-detail-action weread-detail-note-action'
			);
			original.title = '回到原文';
			original.setAttribute('aria-label', '回到原文');
			setOriginalReadingIcon(original);
		}
		this.copyButton(parent, text);
	}
	private copyButton(parent: HTMLElement, text: string): void {
		const bookId = this.bookId,
			generation = this.generation;
		const copy = this.button(
			parent,
			'',
			() => {
				void navigator.clipboard
					.writeText(text)
					.then(() => {
						if (this.valid(generation, bookId)) new Notice('已复制');
					})
					.catch(() => {
						if (this.valid(generation, bookId)) new Notice('复制失败，请重试');
					});
			},
			'weread-detail-action weread-detail-note-action'
		);
		copy.title = '复制正文';
		copy.setAttribute('aria-label', '复制正文');
		setIcon(copy, 'copy');
	}
	private date(seconds: number): string {
		const date = new Date(Number(seconds) * 1000);
		return Number.isFinite(date.getTime()) ? date.toLocaleDateString('zh-CN') : '';
	}
	private async openBook(): Promise<void> {
		const bookId = this.bookId,
			generation = this.generation;
		try {
			if (get(settingsStore).bookOpenMode === 'app')
				window.open(`weread://reading?bId=${encodeURIComponent(bookId)}`);
			else await this.plugin.openPreferredReadingView(getPcUrl(bookId));
		} catch {
			if (this.valid(generation, bookId)) new Notice('打开书籍失败，请重试');
		}
	}
	private async openLocal(): Promise<void> {
		const bookId = this.bookId,
			generation = this.generation;
		try {
			const file = this.app.vault.getAbstractFileByPath(this.localFilePath);
			if (!(file instanceof TFile)) throw new Error('本地笔记不存在');
			await this.app.workspace.getLeaf(true).openFile(file);
		} catch (error) {
			if (this.valid(generation, bookId))
				new Notice(error instanceof Error ? error.message : '打开本地笔记失败');
		}
	}
	private connectFavorites(): void {
		const service = this.plugin.favoritesService;
		if (!service) return;
		this.unsubscribe?.();
		this.undo = new FavoritesUndoToast(this.contentEl, service, () => this.active);
		this.favoriteState = service.getSnapshot();
		this.unsubscribe = service.subscribe((state) => {
			this.favoriteState = state;
			if (!this.active) return;
			this.undo?.update(state);
			this.updateStars();
		});
		const generation = this.generation,
			bookId = this.bookId;
		void service.load().catch(() => {
			if (this.valid(generation, bookId)) {
				this.favoriteStatus.setText('收藏暂不可用，请重新读取本地收藏。');
			}
		});
	}
	private favoriteButton(parent: HTMLElement, highlight: unknown): void {
		const note = bookDetailFavoriteNote(
			{
				bookId: this.bookId,
				title: this.detail?.title || this.highlightResp?.book?.title || this.bookTitle,
				author: this.detail?.author || this.highlightResp?.book?.author || '',
				cover: this.detail?.cover || this.highlightResp?.book?.cover || this.bookCover
			},
			highlight,
			this.highlightResp?.chapters || [],
			this.usingLocalHighlights
		);
		const button = this.button(
			parent,
			'',
			() => {
				if (note) void this.toggleFavorite(note);
			},
			'weread-detail-action weread-detail-favorite'
		);
		setIcon(button, 'star');
		button.setAttribute('aria-pressed', 'false');
		if (!note) {
			button.disabled = true;
			button.title = this.usingLocalHighlights
				? '联网读取原始划线后可收藏'
				: '原始划线标识或创建时间缺失，暂不可收藏';
			button.setAttribute('aria-label', button.title);
			return;
		}
		button.dataset.favoriteId = note.id;
		this.stars.set(button, note);
	}
	private updateStars(): void {
		if (!this.active || !this.favoriteStatus) return;
		const state = this.favoriteState;
		this.favoriteStatus.empty();
		if (state?.error || state?.warning || (state?.loaded && !state.writable)) {
			this.favoriteStatus.createEl('p', {
				text: [
					state.error,
					state.warning,
					!state.writable ? '收藏当前为只读，已有收藏仍可阅读。' : ''
				]
					.filter(Boolean)
					.join(' ')
			});
			this.button(this.favoriteStatus, '重新读取收藏', () => {
				const generation = this.generation,
					bookId = this.bookId;
				void this.plugin.favoritesService?.load(true).catch(() => {
					if (this.valid(generation, bookId)) new Notice('收藏读取失败，请重试');
				});
			});
		}
		for (const [button, note] of this.stars) {
			const saved = state?.favorites.some((entry) => entry.id === note.id) || false;
			const pending = this.pending.has(note.id) || !!state?.pendingIds.includes(note.id);
			const label = saved ? '取消收藏' : '收藏';
			button.setAttribute('aria-pressed', String(saved));
			button.setAttribute('aria-label', label);
			button.classList.toggle('is-favorite', saved);
			button.disabled = pending || !state?.loaded || state.loading || !state.writable;
			button.title = pending
				? '正在保存收藏…'
				: !state?.loaded || state.loading
					? '正在读取本地收藏…'
					: !state.writable
						? state.error || '收藏当前为只读'
						: label;
		}
	}
	private async toggleFavorite(note: JournalNote): Promise<void> {
		const service = this.plugin.favoritesService;
		const state = service?.getSnapshot();
		if (
			!this.active ||
			!service ||
			!state?.loaded ||
			state.loading ||
			!state.writable ||
			this.pending.has(note.id) ||
			state.pendingIds.includes(note.id)
		)
			return;
		const bookId = this.bookId,
			generation = this.generation;
		const previous = state.favorites.find((entry) => entry.id === note.id);
		this.pending.add(note.id);
		this.undo?.clear();
		this.updateStars();
		try {
			await service.setFavorite(note, !previous);
			if (!this.valid(generation, bookId)) return;
			if (previous) this.undo?.show(previous);
		} catch (error) {
			if (this.valid(generation, bookId))
				new Notice(error instanceof Error ? error.message : '收藏保存失败，请重试');
		} finally {
			if (this.valid(generation, bookId)) {
				this.pending.delete(note.id);
				this.favoriteState = service.getSnapshot();
				this.updateStars();
			}
		}
	}
}
