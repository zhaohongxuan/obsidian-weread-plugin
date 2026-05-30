import { ItemView, WorkspaceLeaf, setIcon, Notice, TFile } from 'obsidian';
import { get } from 'svelte/store';
import ApiRouter from '../api-router';
import { settingsStore } from '../settings';
import { getPcUrl } from '../parser/parseResponse';
import type {
	BookDetailResponse,
	BookProgressResponse,
	HighlightResponse,
	BookReviewResponse
} from '../models';

export const WEREAD_BOOK_DETAIL_VIEW_ID = 'weread-book-detail-view';

const COLOR_MAP: Record<number, { label: string; cssClass: string }> = {
	1: { label: '黄色', cssClass: 'hl-color-yellow' },
	2: { label: '蓝色', cssClass: 'hl-color-blue' },
	3: { label: '绿色', cssClass: 'hl-color-green' },
	4: { label: '红色', cssClass: 'hl-color-red' },
	5: { label: '紫色', cssClass: 'hl-color-purple' }
};

const TABS = [
	{ id: 'highlights', label: '划线', icon: 'highlighter' },
	{ id: 'notes', label: '笔记', icon: 'pencil' },
	{ id: 'popular', label: '热门划线', icon: 'flame' },
	{ id: 'reviews', label: '书评', icon: 'message-square' }
] as const;

export class WereadBookDetailView extends ItemView {
	private apiRouter: ApiRouter;

	private bookId = '';
	private bookTitle = '';
	private bookCover = '';
	private localFilePath = '';
	private currentTab: string = 'highlights';

	private detail?: BookDetailResponse;
	private progress?: BookProgressResponse;
	private highlightResp?: HighlightResponse;
	private reviewResp?: BookReviewResponse;
	private popularResp?: { items: any[]; chapters: any[] };
	private publicReviewResp?: BookReviewResponse;

	private loading = false;
	private error: string | null = null;
	private requestBookId = '';

	private headerEl!: HTMLElement;
	private tabBarEl!: HTMLElement;
	private contentChildEl!: HTMLElement;

	constructor(leaf: WorkspaceLeaf, apiRouter: ApiRouter) {
		super(leaf);
		this.apiRouter = apiRouter;
	}

	getViewType(): string {
		return WEREAD_BOOK_DETAIL_VIEW_ID;
	}

	getDisplayText(): string {
		return this.bookTitle || '书籍详情';
	}

	getIcon(): string {
		return 'book-open';
	}

	async onOpen(): Promise<void> {
		this.contentEl.empty();
		this.contentEl.addClass('weread-book-detail-view');

		this.headerEl = this.contentEl.createDiv({ cls: 'weread-book-detail-header' });
		this.tabBarEl = this.contentEl.createDiv({ cls: 'weread-book-detail-tabbar' });
		this.contentChildEl = this.contentEl.createDiv({ cls: 'weread-book-detail-content' });
	}

	async onClose(): Promise<void> {
		this.contentEl.empty();
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

	async setState(state: Record<string, unknown>, _result: any): Promise<void> {
		const newBookId = (state.bookId as string) || '';
		const newTitle = (state.bookTitle as string) || '';
		const newCover = (state.bookCover as string) || '';
		const newLocalPath = (state.localFilePath as string) || '';
		const newTab = (state.currentTab as string) || 'highlights';

		if (newBookId !== this.bookId) {
			this.bookId = newBookId;
			this.bookTitle = newTitle;
			this.bookCover = newCover;
			this.localFilePath = newLocalPath;
			this.currentTab = newTab;
			this.detail = undefined;
			this.progress = undefined;
			this.highlightResp = undefined;
			this.reviewResp = undefined;
			this.popularResp = undefined;
			this.publicReviewResp = undefined;
			this.error = null;

			if (this.bookId) {
				await this.loadAllData();
			}
			this.render();
		} else if (newTab !== this.currentTab) {
			this.currentTab = newTab;
			this.renderContent();
		}

		super.setState(state, _result);
	}

	// ── 数据加载 ────────────────────────────────────────────────

	private async loadAllData(): Promise<void> {
		this.loading = true;
		this.error = null;
		this.requestBookId = this.bookId;
		this.renderLoadingState();

		const [detail, progress, highlights, reviews, popular, publicReviews] =
			await Promise.allSettled([
				this.apiRouter.getBook(this.bookId),
				this.apiRouter.getProgress(this.bookId),
				this.apiRouter.getNotebookHighlights(this.bookId),
				this.apiRouter.getNotebookReviews(this.bookId),
				this.apiRouter.getBestBookmarks(this.bookId),
				this.apiRouter.getPublicReviews(this.bookId)
			]);

		if (this.requestBookId !== this.bookId) return;

		this.detail = detail.status === 'fulfilled' ? detail.value : undefined;
		this.progress = progress.status === 'fulfilled' ? progress.value : undefined;
		this.highlightResp =
			highlights.status === 'fulfilled' ? highlights.value : undefined;
		this.reviewResp = reviews.status === 'fulfilled' ? reviews.value : undefined;
		this.popularResp = popular.status === 'fulfilled' ? (popular.value as any) : undefined;
		this.publicReviewResp =
			publicReviews.status === 'fulfilled' ? publicReviews.value : undefined;

		if (!this.detail && !this.highlightResp && !this.reviewResp) {
			this.error = '加载失败，请检查网络或 API Key';
		}

		this.loading = false;
	}

	// ── 主渲染方法 ──────────────────────────────────────────────

	private render(): void {
		if (this.loading) {
			this.renderLoadingState();
			return;
		}

		this.headerEl.empty();
		this.tabBarEl.empty();
		this.contentChildEl.empty();

		if (!this.bookId) {
			this.renderEmptyState('点击书籍查看详情');
			return;
		}

		if (this.error && !this.detail && !this.highlightResp && !this.reviewResp) {
			this.renderErrorState();
			return;
		}

		this.renderHeader();
		this.renderTabBar();
		this.renderContent();
	}

	private renderLoadingState(): void {
		this.headerEl.empty();
		this.tabBarEl.empty();
		this.contentChildEl.empty();
		const wrap = this.contentChildEl.createDiv({ cls: 'weread-book-detail-status' });
		wrap.createDiv({ cls: 'weread-book-detail-loading', text: '正在加载...' });
	}

	private renderEmptyState(message: string): void {
		this.headerEl.empty();
		this.tabBarEl.empty();
		this.contentChildEl.empty();
		const wrap = this.contentChildEl.createDiv({ cls: 'weread-book-detail-status' });
		wrap.createDiv({ cls: 'weread-book-detail-empty', text: message });
	}

	private renderErrorState(): void {
		const wrap = this.contentChildEl.createDiv({ cls: 'weread-book-detail-status' });
		wrap.createDiv({ cls: 'weread-book-detail-error', text: this.error || '加载失败' });
		const retryBtn = wrap.createEl('button', {
			text: '重试',
			cls: 'weread-book-detail-retry-btn'
		});
		retryBtn.addEventListener('click', async () => {
			await this.loadAllData();
			this.render();
		});
	}

	// ── Header ──────────────────────────────────────────────────

	private async openLocalFileIfExists(): Promise<void> {
		if (!this.localFilePath) return;
		const file = this.app.vault.getAbstractFileByPath(this.localFilePath);
		if (file instanceof TFile) {
			const leaf = this.app.workspace.getLeaf(true);
			await leaf.openFile(file);
			this.app.workspace.revealLeaf(leaf);
		} else {
			new Notice('本地文件不存在');
		}
	}

	private renderHeader(): void {
		const header = this.headerEl;
		const hasLocal = !!this.localFilePath;

		// 单行布局：封面在左，所有描述信息在右
		const topRow = header.createDiv({ cls: 'weread-book-detail-header-top' });

		// 封面
		const coverSrc = this.detail?.cover || this.bookCover;
		if (coverSrc) {
			const coverEl = topRow.createEl('img', {
				cls: 'weread-book-detail-cover' + (hasLocal ? ' is-clickable' : '')
			});
			coverEl.src = coverSrc;
			coverEl.alt = this.detail?.title || this.bookTitle;
			if (hasLocal) {
				coverEl.setAttr('title', '打开本地笔记');
				coverEl.addEventListener('click', () => this.openLocalFileIfExists());
			}
		}

		// 右侧描述区：标题、作者、评分、进度、统计、简介
		const info = topRow.createDiv({ cls: 'weread-book-detail-info' });

		const titleEl = info.createEl('h2', {
			text: this.detail?.title || this.bookTitle,
			cls: 'weread-book-detail-title' + (hasLocal ? ' is-clickable' : '')
		});
		if (hasLocal) {
			titleEl.setAttr('title', '打开本地笔记');
			titleEl.addEventListener('click', () => this.openLocalFileIfExists());
		}

		const author = this.detail?.author || '';
		if (author) {
			const authorRow = info.createDiv({ cls: 'weread-book-detail-author' });
			setIcon(authorRow.createSpan(), 'user');
			authorRow.createSpan({ text: ` ${author}` });
		}

		// 评分（newRating 需除以 100，保留 1 位小数）
		if (this.detail?.newRating) {
			const rating = this.detail.newRating / 100;
			const ratingRow = info.createDiv({ cls: 'weread-book-detail-rating' });
			setIcon(ratingRow.createSpan({ cls: 'weread-book-detail-rating-icon' }), 'star');
			for (let i = 1; i <= 5; i++) {
				const star = ratingRow.createSpan({ cls: 'weread-star' });
				if (i <= Math.round(rating / 2)) {
					star.addClass('is-filled');
				}
			}
			ratingRow.createSpan({
				text: ` ${rating.toFixed(1)}`,
				cls: 'weread-book-detail-rating-value'
			});
			if (this.detail.newRatingCount) {
				ratingRow.createSpan({
					text: ` (${this.detail.newRatingCount}人)`,
					cls: 'weread-book-detail-rating-count'
				});
			}
		}

		// 阅读进度
		const progressValue = this.getProgressPercent();
		if (progressValue !== null) {
			const progressRow = info.createDiv({ cls: 'weread-book-detail-progress' });
			setIcon(progressRow.createSpan({ cls: 'weread-book-detail-progress-icon' }), 'trending-up');
			const bar = progressRow.createDiv({ cls: 'weread-book-detail-progress-bar' });
			bar.createDiv({
				cls: 'weread-book-detail-progress-fill'
			}).style.width = `${progressValue}%`;
			progressRow.createSpan({
				text: ` ${progressValue}%`,
				cls: 'weread-book-detail-progress-text'
			});
		}

		// 元数据行
		this.renderMetadataRow(info);
		// 快捷统计 + 本地文件链接
		const statsRow = info.createDiv({ cls: 'weread-book-detail-stats-row' });
		const highlightCount = this.highlightResp?.updated?.length || 0;
		const reviewCount = this.reviewResp?.totalCount || 0;
		const popularCount = this.popularResp?.items?.length || 0;

		this.createStatBadge(statsRow, 'highlighter', `划线 ${highlightCount}`);
		this.createStatBadge(statsRow, 'pencil', `笔记 ${reviewCount}`);
		if (popularCount > 0) {
			this.createStatBadge(statsRow, 'flame', `热门 ${popularCount}`);
		}
		if (hasLocal) {
			this.createStatBadge(statsRow, 'file-text', '本地笔记', true);
		}

		// 简介（放入 info 右侧描述区，无分割线）
		const intro = this.detail?.intro?.trim();
		if (intro) {
			const introText = info.createDiv({
				cls: 'weread-book-detail-intro-text',
				text: intro
			});
			if (intro.length > 200) {
				introText.addClass('is-collapsed');
				const toggleBtn = info.createEl('button', {
					text: '展开',
					cls: 'weread-book-detail-intro-toggle'
				});
				toggleBtn.addEventListener('click', () => {
					const collapsed = introText.hasClass('is-collapsed');
					if (collapsed) {
						introText.removeClass('is-collapsed');
						toggleBtn.textContent = '收起';
					} else {
						introText.addClass('is-collapsed');
						toggleBtn.textContent = '展开';
					}
				});
			}
		}
	}

	private createStatBadge(container: HTMLElement, icon: string, text: string, clickable = false): void {
		const badge = container.createDiv({
			cls: 'weread-book-detail-stat' + (clickable ? ' is-clickable' : '')
		});
		setIcon(badge.createSpan(), icon);
		badge.createSpan({ text: ` ${text}` });
		if (clickable) {
			badge.setAttr('title', '打开本地笔记');
			badge.addEventListener('click', () => this.openLocalFileIfExists());
		}
	}

	// ── Tab Bar ─────────────────────────────────────────────────

	private renderTabBar(): void {
		const bar = this.tabBarEl;
		for (const tab of TABS) {
			const btn = bar.createEl('button', {
				cls: 'weread-book-detail-tab' + (this.currentTab === tab.id ? ' is-active' : '')
			});
			setIcon(btn, tab.icon);
			btn.createSpan({ text: ` ${tab.label}` });
			btn.addEventListener('click', () => {
				if (this.currentTab === tab.id) return;
				this.currentTab = tab.id;
				bar.querySelectorAll('.weread-book-detail-tab').forEach((b) =>
					b.removeClass('is-active')
				);
				btn.addClass('is-active');
				this.renderContent();
			});
		}

		// 弹性空间 + 阅读按钮 + 刷新按钮
		bar.createDiv({ cls: 'weread-book-detail-tabbar-spacer' });
		const readBtn = bar.createEl('button', { cls: 'weread-book-detail-tab-action' });
		setIcon(readBtn, 'book-open');
		readBtn.setAttr('title', '在微信读书中打开');
		readBtn.addEventListener('click', () => {
			const settings = get(settingsStore);
			const url = settings.bookOpenMode === 'app'
				? `weread://reading?bId=${this.bookId}`
				: getPcUrl(this.bookId);
			window.open(url);
		});
		const refreshBtn = bar.createEl('button', { cls: 'weread-book-detail-tab-action' });
			refreshBtn.style.marginLeft = '4px';
		setIcon(refreshBtn, 'refresh-ccw');
		refreshBtn.setAttr('title', '刷新数据');
		refreshBtn.addEventListener('click', async () => {
			refreshBtn.addClass('is-spinning');
			await this.loadAllData();
			refreshBtn.removeClass('is-spinning');
			this.render();
		});
	}

	// ── Content Router ──────────────────────────────────────────

	private renderContent(): void {
		this.contentChildEl.empty();
		switch (this.currentTab) {
			case 'highlights':
				this.renderHighlightsTab();
				break;
			case 'notes':
				this.renderNotesTab();
				break;
			case 'popular':
				this.renderPopularTab();
				break;
			case 'reviews':
				this.renderReviewsTab();
				break;
		}
	}

	// ── 划线标签页 ───────────────────────────────────────────────

	private renderHighlightsTab(): void {
		const container = this.contentChildEl;
		const highlights = this.highlightResp?.updated || [];
		const chapters = this.highlightResp?.chapters || [];


		if (highlights.length === 0) {
			container.createDiv({
				text: '暂无划线',
				cls: 'weread-book-detail-empty'
			});
			return;
		}

		// 构建章节顺序映射：chapterUid → { title, chapterIdx }
		const chapterInfoMap = new Map<number, { title: string; chapterIdx: number }>();
		for (const ch of chapters) {
			if (ch.chapterUid !== undefined) {
				chapterInfoMap.set(ch.chapterUid, {
					title: ch.title,
					chapterIdx: ch.chapterIdx
				});
			}
		}

		// 按 chapterUid 分组，组内按 range 起始位置排序
		const groupedMap = new Map<number, typeof highlights>();
		for (const h of highlights) {
			if (!groupedMap.has(h.chapterUid)) {
				groupedMap.set(h.chapterUid, []);
			}
			groupedMap.get(h.chapterUid)!.push(h);
		}

		// 每个 chapterUid 组内按 range 起始位置排序
		for (const [, items] of groupedMap) {
			items.sort((a, b) => {
				const aStart = parseInt(a.range?.split('-')[0] || '0', 10);
				const bStart = parseInt(b.range?.split('-')[0] || '0', 10);
				return aStart - bStart;
			});
		}

		// 按 chapterIdx 排序章节
		const sortedEntries = [...groupedMap.entries()].sort((a, b) => {
			const aIdx = chapterInfoMap.get(a[0])?.chapterIdx ?? Number.MAX_SAFE_INTEGER;
			const bIdx = chapterInfoMap.get(b[0])?.chapterIdx ?? Number.MAX_SAFE_INTEGER;
			return aIdx - bIdx;
		});

		for (const [chapterUid, items] of sortedEntries) {
			const chInfo = chapterInfoMap.get(chapterUid);
			const chapterTitle = chInfo?.title || '未知章节';
			const section = container.createDiv({ cls: 'weread-book-detail-section' });
			section.createEl('h3', {
				text: chapterTitle,
				cls: 'weread-book-detail-section-title'
			});

			for (const h of items) {
				const colorInfo = COLOR_MAP[h.colorStyle] || COLOR_MAP[1];
				const card = section.createDiv({
					cls: `weread-book-detail-hl-card ${colorInfo.cssClass}`
				});

				// 划线文本，左侧有颜色边线
				const quoteRow = card.createDiv({ cls: 'weread-book-detail-hl-quote' });
				quoteRow.createDiv({
					text: h.markText,
					cls: 'weread-book-detail-hl-text'
				});

				// 元信息行
				const meta = card.createDiv({ cls: 'weread-book-detail-hl-meta' });

				const rangeStart = h.range ? h.range.split('-')[0] : '';
				if (rangeStart) {
					meta.createSpan({
						text: `位置 ${rangeStart}`,
						cls: 'weread-book-detail-hl-meta-item'
					});
				}

				if (h.createTime) {
					meta.createSpan({
						text: this.formatDateTime(h.createTime),
						cls: 'weread-book-detail-hl-meta-item'
					});
				}

				// 笔记指示器
				if (h.contextAbstract) {
					const noteIndicator = meta.createSpan({ cls: 'weread-book-detail-hl-note' });
					setIcon(noteIndicator, 'pencil');
					noteIndicator.setAttr('title', h.contextAbstract);
				}

				// 操作按钮（inline 在 meta 行右侧）
				const actions = meta.createDiv({ cls: 'weread-book-detail-hl-actions' });
				this.createDeepLinkButton(actions, this.buildDeepLink(h.chapterUid, h.range));
				this.createCopyButton(actions, h.markText);
			}
		}
	}

	// ── 笔记标签页 ───────────────────────────────────────────────

	private renderNotesTab(): void {
		const container = this.contentChildEl;
		const reviews = this.reviewResp?.reviews || [];

		if (reviews.length === 0) {
			container.createDiv({
				text: '暂无笔记',
				cls: 'weread-book-detail-empty'
			});
			return;
		}

		const chapters = this.highlightResp?.chapters || [];
		const chapterInfoMap = new Map<number, { title: string; chapterIdx: number }>();
		for (const ch of chapters) {
			if (ch.chapterUid !== undefined) {
				chapterInfoMap.set(ch.chapterUid, {
					title: ch.title,
					chapterIdx: ch.chapterIdx
				});
			}
		}

		// 按时间倒序排列
		const sortedReviews = [...reviews].sort((a, b) => {
			return (b.review?.createTime || 0) - (a.review?.createTime || 0);
		});

		for (const r of sortedReviews) {
			const card = container.createDiv({ cls: 'weread-book-detail-note-card' });

			// 引用的原文
			const abstract = r.review?.abstract;
			if (abstract) {
				const ref = card.createDiv({ cls: 'weread-book-detail-note-ref' });
				setIcon(ref.createSpan({ cls: 'weread-book-detail-note-ref-icon' }), 'quote');
				ref.createSpan({
					text: abstract,
					cls: 'weread-book-detail-note-ref-text'
				});
			}

			// 笔记内容
			const content = r.review?.content;
			if (content) {
				this.renderTextWithBreaks(card, content, 'weread-book-detail-note-content');
			}

			// 元信息
			const meta = card.createDiv({ cls: 'weread-book-detail-note-meta' });
			const chTitle =
				r.review?.chapterName ||
				(r.review?.chapterUid
					? chapterInfoMap.get(r.review.chapterUid)?.title
					: undefined);
			if (chTitle) {
				meta.createSpan({
					text: chTitle,
					cls: 'weread-book-detail-hl-meta-item'
				});
			}
			if (r.review?.createTime) {
				meta.createSpan({
					text: this.formatDateTime(r.review.createTime),
					cls: 'weread-book-detail-hl-meta-item'
				});
			}
			if (r.review?.range) {
				const rangeStart = r.review.range.split('-')[0];
				meta.createSpan({
					text: `位置 ${rangeStart}`,
					cls: 'weread-book-detail-hl-meta-item'
				});
			}
		}
	}

	// ── 热门划线标签页 ───────────────────────────────────────────

	private renderPopularTab(): void {
		const container = this.contentChildEl;
		const items = this.popularResp?.items || [];
		const chapters = this.popularResp?.chapters || [];

		if (items.length === 0) {
			container.createDiv({
				text: '暂无热门划线',
				cls: 'weread-book-detail-empty'
			});
			return;
		}

		// 构建章节顺序映射
		const chapterInfoMap = new Map<number, { title: string; chapterIdx: number }>();
		for (const ch of chapters) {
			if (ch.chapterUid !== undefined) {
				chapterInfoMap.set(ch.chapterUid, {
					title: ch.title,
					chapterIdx: ch.chapterIdx
				});
			}
		}

		// 按 chapterUid 分组
		const groupedMap = new Map<number, typeof items>();
		for (const item of items) {
			if (!groupedMap.has(item.chapterUid)) {
				groupedMap.set(item.chapterUid, []);
			}
			groupedMap.get(item.chapterUid)!.push(item);
		}

		// 组内按 range 排序
		for (const [, chapterItems] of groupedMap) {
			chapterItems.sort((a, b) => {
				const aStart = parseInt(a.range?.split('-')[0] || '0', 10);
				const bStart = parseInt(b.range?.split('-')[0] || '0', 10);
				return aStart - bStart;
			});
		}

		// 按 chapterIdx 排序章节
		const sortedEntries = [...groupedMap.entries()].sort((a, b) => {
			const aIdx = chapterInfoMap.get(a[0])?.chapterIdx ?? Number.MAX_SAFE_INTEGER;
			const bIdx = chapterInfoMap.get(b[0])?.chapterIdx ?? Number.MAX_SAFE_INTEGER;
			return aIdx - bIdx;
		});

		for (const [chapterUid, chapterItems] of sortedEntries) {
			const chInfo = chapterInfoMap.get(chapterUid);
			const chapterTitle = chInfo?.title || '未知章节';
			const section = container.createDiv({ cls: 'weread-book-detail-section' });
			section.createEl('h3', {
				text: chapterTitle,
				cls: 'weread-book-detail-section-title'
			});

			for (const h of chapterItems) {
				const card = section.createDiv({ cls: 'weread-book-detail-popular-card' });

				card.createDiv({
					text: h.markText,
					cls: 'weread-book-detail-popular-text'
				});

				const meta = card.createDiv({ cls: 'weread-book-detail-popular-meta' });

				if (h.totalCount > 0) {
					const countBadge = meta.createSpan({
						cls: 'weread-book-detail-popular-count'
					});
					setIcon(countBadge, 'flame');
					countBadge.createSpan({
						text: ` ${h.totalCount}人划线`
					});
				}

				const rangeStart = h.range ? h.range.split('-')[0] : '';
				if (rangeStart) {
					meta.createSpan({
						text: `位置 ${rangeStart}`,
						cls: 'weread-book-detail-hl-meta-item'
					});
				}

				// 操作按钮（inline 在 meta 行右侧）
				const actions = meta.createDiv({ cls: 'weread-book-detail-hl-actions' });
				this.createDeepLinkButton(actions, this.buildDeepLink(h.chapterUid, h.range));
				this.createCopyButton(actions, h.markText);
			}
		}
	}

	// ── 书评标签页 ───────────────────────────────────────────────

	private static readonly MAX_PUBLIC_REVIEWS = 20;

	private renderReviewsTab(): void {
		const container = this.contentChildEl;

		// 收集我自己的书评（type 4 = 整本书评）
		const myBookReviews =
			this.reviewResp?.reviews?.filter((r) => r.review?.type === 4) || [];

		// 公共书评
		const allPublicReviews = this.publicReviewResp?.reviews || [];

		if (myBookReviews.length === 0 && allPublicReviews.length === 0) {
			container.createDiv({
				text: '暂无书评',
				cls: 'weread-book-detail-empty'
			});
			return;
		}

		// 先渲染我的书评
		if (myBookReviews.length > 0) {
			const mySection = container.createDiv({ cls: 'weread-book-detail-section' });
			mySection.createEl('h3', {
				text: '我的书评',
				cls: 'weread-book-detail-section-title'
			});
			for (const r of myBookReviews) {
				this.renderSingleReviewCard(mySection, r);
			}
		}

		// 再渲染公共书评（限制数量）
		if (allPublicReviews.length > 0) {
			const pubSection = container.createDiv({ cls: 'weread-book-detail-section' });
			const header = pubSection.createEl('h3', {
				cls: 'weread-book-detail-section-title'
			});
			const visibleReviews = allPublicReviews.slice(0, WereadBookDetailView.MAX_PUBLIC_REVIEWS);
			const remaining = allPublicReviews.length - visibleReviews.length;
			header.setText(
				remaining > 0
					? `社区书评（显示前 ${visibleReviews.length} 条，共 ${allPublicReviews.length} 条）`
					: `社区书评（${allPublicReviews.length} 条）`
			);

			// 输出第一条公共书评的原始结构供调试
			if (allPublicReviews.length > 0) {
				console.log('[weread plugin] 公共书评第一条原始结构:', JSON.stringify(allPublicReviews[0], null, 2));
			}

			for (const r of visibleReviews) {
				this.renderSingleReviewCard(pubSection, r);
			}
		}
	}

	private renderSingleReviewCard(container: HTMLElement, r: any): void {
		const card = container.createDiv({ cls: 'weread-book-detail-review-card' });

		// 公共书评为双层嵌套 r.review.review，个人书评为单层 r.review
		// 统一用内层 review 数据
		const innerReview = r.review?.review || r.review || r;
		const authorName = innerReview?.author?.name || '匿名用户';
		const avatar = innerReview?.author?.avatar;
		const createTime = innerReview?.createTime;
		const title = innerReview?.title;
		const content = innerReview?.content;

		// 作者行
		const authorRow = card.createDiv({ cls: 'weread-book-detail-review-author' });
		if (avatar) {
			const avatarEl = authorRow.createEl('img', {
				cls: 'weread-book-detail-review-avatar'
			});
			avatarEl.src = avatar;
		}
		const authorInfo = authorRow.createDiv({ cls: 'weread-book-detail-review-author-info' });
		authorInfo.createSpan({
			text: authorName,
			cls: 'weread-book-detail-review-author-name'
		});
		if (createTime) {
			authorInfo.createSpan({
				text: this.formatDateTime(createTime),
				cls: 'weread-book-detail-review-time'
			});
		}

		// 标题
		if (title) {
			card.createDiv({
				text: title,
				cls: 'weread-book-detail-review-title'
			});
		}

		// 内容
		if (content) {
			this.renderTextWithBreaks(card, content, 'weread-book-detail-review-content');
		}

		// 复制按钮
		if (content) {
			const actions = card.createDiv({ cls: 'weread-book-detail-actions' });
			this.createCopyButton(actions, content);
		}
	}

	// ── 辅助方法 ────────────────────────────────────────────────

	private buildDeepLink(chapterUid: number, range: string): string {
		const [start, end] = range.split('-');
		return `weread://bestbookmark?bookId=${this.bookId}&chapterUid=${chapterUid}&rangeStart=${start}&rangeEnd=${end || start}`;
	}

	private renderTextWithBreaks(container: HTMLElement, text: string, cls: string): void {
		const el = container.createDiv({ cls });
		const lines = text.split('\n');
		for (let i = 0; i < lines.length; i++) {
			if (i > 0) el.createEl('br');
			el.createSpan({ text: lines[i] });
		}
	}

	private createCopyButton(container: HTMLElement, text: string): void {
		const btn = container.createEl('button', { cls: 'weread-book-detail-action-btn' });
		setIcon(btn, 'copy');
		btn.setAttr('title', '复制');
		btn.addEventListener('click', (e) => {
			e.stopPropagation();
			navigator.clipboard.writeText(text).then(() => {
				new Notice('已复制');
			});
		});
	}

	private createDeepLinkButton(container: HTMLElement, deepLink: string): void {
		const btn = container.createEl('button', { cls: 'weread-book-detail-action-btn' });
		setIcon(btn, 'external-link');
		btn.setAttr('title', '跳转到微信读书');
		btn.addEventListener('click', (e) => {
			e.stopPropagation();
			window.open(deepLink, '_blank');
		});
	}

	private formatDateTime(ts: number): string {
		if (!ts) return '';
		return window.moment(ts * 1000).format('YYYY-MM-DD HH:mm');
	}

	private createMetaItem(container: HTMLElement, icon: string, text: string, cls = ''): void {
		const item = container.createDiv({ cls: `weread-book-detail-meta-item ${cls}`.trim() });
		setIcon(item.createSpan(), icon);
		item.createSpan({ text: ` ${text}` });
		item.setAttr('title', text);
	}

	private renderMetadataRow(container: HTMLElement): void {
		const meta = container.createDiv({ cls: 'weread-book-detail-metadata' });

		// 阅读状态
		const finished = this.progress?.book?.finishTime || this.detail?.finishReading;
		const isReading = this.progress?.book?.progress && this.progress.book.progress > 0;
		if (finished) {
			this.createMetaItem(meta, 'check-circle', '已读完', 'weread-book-detail-status-finished');
		} else if (isReading) {
			this.createMetaItem(meta, 'book-open', '阅读中', 'weread-book-detail-status-reading');
		}

		// 阅读时长
		const readingTime = this.progress?.book?.readingTime;
		if (readingTime && readingTime > 0) {
			const hours = Math.floor(readingTime / 3600);
			const mins = Math.floor((readingTime % 3600) / 60);
			const timeStr = hours > 0 ? `${hours}时${mins}分` : `${mins}分钟`;
			this.createMetaItem(meta, 'clock', `阅读 ${timeStr}`);
		}

		// 开始阅读日期
		const startTime = this.progress?.book?.startReadingTime;
		if (startTime && startTime > 0) {
			const startDate = new Date(startTime * 1000).toISOString().slice(0, 10);
			this.createMetaItem(meta, 'play-circle', `开始 ${startDate}`);
		}

		// 读完日期
		const finishTime = this.progress?.book?.finishTime;
		if (finishTime && finishTime > 0) {
			const finishDate = new Date(finishTime * 1000).toISOString().slice(0, 10);
			this.createMetaItem(meta, 'flag', `读完 ${finishDate}`);
		}

		// 出版社
		const publisher = this.detail?.publisher;
		if (publisher) {
			this.createMetaItem(meta, 'building', publisher);
		}

		// 分类
		const category = this.detail?.category;
		if (category) {
			this.createMetaItem(meta, 'folder', category);
		}

		// 字数
		const totalWords = this.detail?.totalWords;
		if (totalWords && totalWords > 0) {
			const wordsStr = totalWords >= 10000 ? `${(totalWords / 10000).toFixed(1)}万字` : `${totalWords}字`;
			this.createMetaItem(meta, 'file-text', `字数 ${wordsStr}`);
		}

		// 出版时间（仅显示日期）
		const publishTime = this.detail?.publishTime;
		if (publishTime) {
			const pubDate = publishTime.length > 10 ? publishTime.slice(0, 10) : publishTime;
			this.createMetaItem(meta, 'calendar', `出版 ${pubDate}`);
		}
	}

	private getProgressPercent(): number | null {
		if (this.progress?.book?.progress !== undefined) {
			return this.progress.book.progress;
		}
		return null;
	}
}
