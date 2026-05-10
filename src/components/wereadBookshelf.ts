import {
	App,
	ItemView,
	Modal,
	Notice,
	Platform,
	WorkspaceLeaf,
	moment,
	setIcon,
	setTooltip
} from 'obsidian';
import WereadPlugin from '../../main';
import WereadBookshelfService from '../bookshelf';
import type { BookshelfBook } from '../models';
import { WereadBookDetailModal } from './wereadBookDetailModal';
import { SyncLogModal } from './syncLogModal';
import { settingsStore } from '../settings';
import { get } from 'svelte/store';
import { getPcUrl } from '../parser/parseResponse';

export const WEREAD_BOOKSHELF_VIEW_ID = 'weread-bookshelf-view';

type CategoryFilter = 'all' | 'book' | 'article';
type SyncStatusFilter = 'all' | 'remoteOnly' | 'synced' | 'localOnly';
type ReadingStatusFilter = 'all' | 'reading' | 'finished';
type BookshelfSort = 'recent' | 'title';
const UNKNOWN_YEAR_LABEL = '未知年份';

class ConfirmDeleteModal extends Modal {
	constructor(app: App, private titleText: string, private onConfirm: () => Promise<void>) {
		super(app);
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.createEl('h3', { text: '删除本地文件' });
		contentEl.createEl('p', { text: `确认删除《${this.titleText}》的本地文件吗？` });
		const actionRow = contentEl.createDiv({ cls: 'weread-bookshelf-modal-actions' });
		actionRow.createEl('button', { text: '取消' }).onclick = () => this.close();
		actionRow.createEl('button', { text: '删除', cls: 'mod-warning' }).onclick = async () => {
			await this.onConfirm();
			this.close();
		};
	}

	onClose() {
		this.contentEl.empty();
	}
}

export class WereadBookshelfView extends ItemView {
	private shelfBooks: BookshelfBook[] = [];
	private searchKeyword = '';
	private categoryFilter: CategoryFilter = 'all';
	private syncStatusFilter: SyncStatusFilter =
		get(settingsStore).bookshelfDefaultSyncStatusFilter;
	private readingStatusFilter: ReadingStatusFilter = 'all';
	private sortMode: BookshelfSort = 'recent';
	private groupByYear = true;
	private loading = false;
	private emptyStateEl: HTMLElement;
	private summaryEl: HTMLElement;
	private gridEl: HTMLElement;
	private settingsUnsubscribe: (() => void) | null = null;
	private previousCookieValid = false;

	constructor(
		leaf: WorkspaceLeaf,
		private plugin: WereadPlugin,
		private bookshelfService: WereadBookshelfService
	) {
		super(leaf);
		this.previousCookieValid = get(settingsStore).isCookieValid;
	}

	getViewType(): string {
		return WEREAD_BOOKSHELF_VIEW_ID;
	}

	getDisplayText(): string {
		return '微信读书书架';
	}

	getIcon(): string {
		return 'library';
	}

	async onOpen() {
		this.contentEl.empty();
		this.contentEl.addClass('weread-bookshelf-view');

		// const header = this.contentEl.createDiv({ cls: 'weread-bookshelf-header' });
		// const headerTitle = header.createDiv({ cls: 'weread-bookshelf-header-title' });
		// headerTitle.createEl('h2', { text: '📚 微信读书书架' });
		// headerTitle.createEl('p', {
		// 	cls: 'weread-bookshelf-header-subtitle',
		// 	text: '读万卷书，行万里路'
		// });

		const toolbar = this.contentEl.createDiv({ cls: 'weread-bookshelf-toolbar' });
		const toolbarFilters = toolbar.createDiv({ cls: 'weread-bookshelf-toolbar-filters' });
		const searchInput = toolbarFilters.createEl('input', {
			type: 'search',
			cls: 'weread-bookshelf-search',
			attr: { 'aria-label': '搜索书名或作者' }
		});
		searchInput.placeholder = '搜索书名或作者';
		searchInput.addEventListener('input', () => {
			this.searchKeyword = searchInput.value.trim().toLowerCase();
			this.renderBooks();
		});

		// 筛选按钮（窄屏时显示）
		const filterToggle = toolbarFilters.createEl('button', {
			cls: 'weread-bookshelf-filter-toggle',
			attr: { 'aria-label': '显示筛选选项' }
		});
		filterToggle.textContent = '筛选';
		setIcon(filterToggle, 'chevron-down');

		// 筛选下拉菜单容器（包含3个select）
		const filterDropdowns = toolbarFilters.createDiv({
			cls: 'weread-bookshelf-filter-dropdowns'
		});

		const categorySelect = filterDropdowns.createEl('select', {
			cls: 'dropdown',
			attr: { 'aria-label': '筛选书籍类型' }
		});
		[
			['all', '全部类型'],
			['book', '图书'],
			['article', '公众号']
		].forEach(([value, label]) => {
			categorySelect.createEl('option', { value, text: label });
		});
		categorySelect.onchange = () => {
			this.categoryFilter = categorySelect.value as CategoryFilter;
			this.renderBooks();
		};

		const syncStatusSelect = filterDropdowns.createEl('select', {
			cls: 'dropdown',
			attr: { 'aria-label': '筛选同步状态' }
		});
		[
			['all', '全部状态'],
			['remoteOnly', '仅远程'],
			['synced', '已同步'],
			['localOnly', '仅本地']
		].forEach(([value, label]) => {
			const option = syncStatusSelect.createEl('option', { value, text: label });
			option.selected = value === this.syncStatusFilter;
		});
		syncStatusSelect.onchange = () => {
			this.syncStatusFilter = syncStatusSelect.value as SyncStatusFilter;
			this.renderBooks();
		};

		const readingStatusSelect = filterDropdowns.createEl('select', {
			cls: 'dropdown',
			attr: { 'aria-label': '筛选阅读状态' }
		});
		[
			['all', '在读+已读'],
			['reading', '在读'],
			['finished', '已读']
		].forEach(([value, label]) => {
			const option = readingStatusSelect.createEl('option', { value, text: label });
			option.selected = value === this.readingStatusFilter;
		});
		readingStatusSelect.onchange = () => {
			this.readingStatusFilter = readingStatusSelect.value as ReadingStatusFilter;
			this.renderBooks();
		};

		// 筛选按钮点击事件
		filterToggle.addEventListener('click', (event) => {
			event.stopPropagation();
			filterDropdowns.classList.toggle('is-open');
		});

		// 点击外部关闭popover
		document.addEventListener('click', (event) => {
			if (!toolbarFilters.contains(event.target as Node)) {
				filterDropdowns.classList.remove('is-open');
			}
		});

		const toolbarActions = toolbar.createDiv({ cls: 'weread-bookshelf-toolbar-actions' });
		const syncButton = toolbarActions.createEl('button', {
			cls: 'clickable-icon weread-bookshelf-icon-button weread-toolbar-icon-button mod-cta'
		});
		setIcon(syncButton, 'refresh-ccw');

		// 根据 Alt/Opt 状态切换按钮外观
		let isHovering = false;
		let isAltPressed = false;
		let isSyncing = false;
		const modKey = Platform.isMacOS ? 'Opt' : 'Alt';
		const updateSyncButton = (force: boolean) => {
			if (isSyncing) return;
			if (force) {
				setIcon(syncButton, 'refresh-ccw-dot');
				syncButton.addClass('mod-warning');
				syncButton.removeClass('mod-cta');
				setTooltip(syncButton, '强制同步（重新同步所有书籍）');
			} else {
				setIcon(syncButton, 'refresh-ccw');
				syncButton.addClass('mod-cta');
				syncButton.removeClass('mod-warning');
				setTooltip(syncButton, `同步 (按住 ${modKey} 强制同步)`);
			}
		};
		setTooltip(syncButton, `同步 (按住 ${modKey} 强制同步)`);
		syncButton.addEventListener('mouseenter', () => {
			isHovering = true;
			updateSyncButton(isAltPressed);
		});
		syncButton.addEventListener('mouseleave', () => {
			isHovering = false;
			updateSyncButton(false);
		});
		// 用 e.code 追踪 Alt 键，比 e.key 在 macOS Electron 下更可靠
		document.addEventListener('keydown', (e: KeyboardEvent) => {
			if (e.code === 'AltLeft' || e.code === 'AltRight') {
				isAltPressed = true;
				if (isHovering) updateSyncButton(true);
			}
		});
		document.addEventListener('keyup', (e: KeyboardEvent) => {
			if (e.code === 'AltLeft' || e.code === 'AltRight') {
				isAltPressed = false;
				if (isHovering) updateSyncButton(false);
			}
		});

		const openWebButton = Platform.isDesktopApp
			? (() => {
					const btn = toolbarActions.createEl('button', {
						cls: 'clickable-icon weread-bookshelf-icon-button weread-toolbar-icon-button',
						attr: { 'aria-label': '网页版' }
					});
					setIcon(btn, 'globe');
					return btn;
			  })()
			: null;

		const syncLogButton = toolbarActions.createEl('button', {
			cls: 'clickable-icon weread-bookshelf-icon-button weread-toolbar-icon-button',
			attr: { 'aria-label': '同步日志' }
		});
		setIcon(syncLogButton, 'history');

		const syncOptionsButton = toolbarActions.createEl('button', {
			cls: 'clickable-icon weread-bookshelf-icon-button weread-toolbar-icon-button',
			attr: { 'aria-label': '选项' }
		});
		setIcon(syncOptionsButton, 'settings');

		syncButton.onclick = async () => {
			if (isSyncing) return;
			const force = isAltPressed;

			// 同步中：切换为取消按钮
			isSyncing = true;
			const signal = { cancelled: false };
			setIcon(syncButton, 'square');
			setTooltip(syncButton, '取消同步');
			syncButton.removeClass('mod-cta');
			syncButton.addClass('mod-warning');
			syncOptionsButton.disabled = true;
			if (openWebButton) openWebButton.disabled = true;

			// 点击取消
			const cancelHandler = () => {
				signal.cancelled = true;
			};
			syncButton.addEventListener('click', cancelHandler, { once: true });

			try {
				const updatedCount = await this.plugin.startSync(force, signal);
				if ((updatedCount ?? 0) > 0) {
					this.bookshelfService.clearProgressCache();
					await this.loadBookshelf();
				}
			} finally {
				// 恢复同步按钮
				isSyncing = false;
				syncButton.removeEventListener('click', cancelHandler);
				updateSyncButton(isAltPressed);
				syncOptionsButton.disabled = false;
				if (openWebButton) openWebButton.disabled = false;
			}
		};
		syncOptionsButton.onclick = () => {
			this.plugin.openWereadSettingsTab();
		};
		syncLogButton.onclick = () => {
			new SyncLogModal(this.app).open();
		};
		if (openWebButton) {
			openWebButton.onclick = async () => {
				await this.plugin.openPreferredReadingView();
			};
		}

		this.summaryEl = this.contentEl.createDiv({ cls: 'weread-bookshelf-summary' });
		this.emptyStateEl = this.contentEl.createDiv({ cls: 'weread-bookshelf-empty' });
		this.gridEl = this.contentEl.createDiv({ cls: 'weread-bookshelf-grid' });

		// 订阅设置变化，监听登录状态改变
		this.settingsUnsubscribe = settingsStore.subscribe((settings) => {
			if (settings.isCookieValid !== this.previousCookieValid) {
				this.previousCookieValid = settings.isCookieValid;
				this.loadBookshelf();
			}
		});

		await this.loadBookshelf();
	}

	async onClose() {
		if (this.settingsUnsubscribe) {
			this.settingsUnsubscribe();
		}
		this.contentEl.empty();
	}

	private async loadBookshelf(): Promise<void> {
		this.loading = true;
		this.summaryEl.empty();
		this.summaryEl.createDiv({
			cls: 'weread-bookshelf-summary-loading',
			text: '加载书架中...'
		});
		this.emptyStateEl.empty();
		this.gridEl.empty();

		// Check if user is logged in
		const settings = get(settingsStore);
		if (!settings.isCookieValid || settings.cookies.length === 0) {
			this.loading = false;
			this.renderUnloggedState();
			return;
		}

		try {
			this.shelfBooks = await this.bookshelfService.getBookshelfBooks();
			this.sortMode = settings.bookshelfSortMode;
			this.groupByYear = settings.bookshelfGroupByYear;
			this.renderBooks();
		} catch (error: unknown) {
			this.summaryEl.empty();
			this.summaryEl.createDiv({
				cls: 'weread-bookshelf-summary-error',
				text: '加载书架失败'
			});
			this.emptyStateEl.setText(error instanceof Error ? error.message : '加载书架失败');
		} finally {
			this.loading = false;
		}
	}

	private renderUnloggedState(): void {
		this.summaryEl.empty();
		const card = this.summaryEl.createDiv({ cls: 'weread-bookshelf-unlogged-card' });

		const icon = card.createDiv({ cls: 'weread-bookshelf-unlogged-icon' });
		setIcon(icon, 'lock');

		const content = card.createDiv({ cls: 'weread-bookshelf-unlogged-content' });
		content.createDiv({ cls: 'weread-bookshelf-unlogged-title', text: '请先登录' });
		content.createDiv({
			cls: 'weread-bookshelf-unlogged-description',
			text: '请在设置中登录后开始使用'
		});

		const button = content.createEl('button', {
			cls: 'weread-bookshelf-unlogged-button',
			text: '前往登录'
		});
		button.onclick = () => {
			this.plugin.openWereadSettingsTab();
		};
	}

	private renderBooks(): void {
		const filteredBooks = this.getFilteredBooks();
		this.gridEl.empty();
		this.emptyStateEl.empty();

		const settings = get(settingsStore);
		this.renderSummaryCard(filteredBooks, settings);

		if (filteredBooks.length === 0) {
			this.emptyStateEl.setText(this.loading ? '加载中...' : '没有找到匹配的书籍');
			return;
		}

		if (this.shouldGroupByYear()) {
			for (const group of this.groupBooksByYear(filteredBooks)) {
				const section = this.gridEl.createDiv({ cls: 'weread-bookshelf-group' });
				section.createEl('h3', {
					cls: 'weread-bookshelf-group-title',
					text: group.year === UNKNOWN_YEAR_LABEL ? group.year : `${group.year} 年`
				});
				const groupGrid = section.createDiv({ cls: 'weread-bookshelf-group-grid' });
				for (const book of group.books) {
					this.renderBookCard(book, groupGrid);
				}
			}
			return;
		}

		const defaultGrid = this.gridEl.createDiv({ cls: 'weread-bookshelf-group-grid' });
		for (const book of filteredBooks) {
			this.renderBookCard(book, defaultGrid);
		}
	}

	private renderSummaryCard(filteredBooks: BookshelfBook[], settings: any): void {
		this.summaryEl.empty();
		const card = this.summaryEl.createDiv({ cls: 'weread-bookshelf-summary-card' });

		// Book count section
		const bookSection = card.createDiv({ cls: 'weread-bookshelf-summary-item' });
		const bookIcon = bookSection.createDiv({ cls: 'weread-bookshelf-summary-icon' });
		setIcon(bookIcon, 'book');
		bookSection.createDiv({
			cls: 'weread-bookshelf-summary-value',
			text: `${filteredBooks.length} 本`
		});
		setTooltip(bookSection, `展示书籍: ${filteredBooks.length} 本`);

		// Year groups section (only show when grouping by year)
		if (this.shouldGroupByYear()) {
			const groupedBooks = this.groupBooksByYear(filteredBooks);
			const yearSection = card.createDiv({ cls: 'weread-bookshelf-summary-item' });
			const yearIcon = yearSection.createDiv({ cls: 'weread-bookshelf-summary-icon' });
			setIcon(yearIcon, 'calendar');
			yearSection.createDiv({
				cls: 'weread-bookshelf-summary-value',
				text: `${groupedBooks.length} 个`
			});
			setTooltip(yearSection, `年份分组: ${groupedBooks.length} 个`);
		}

		// Last sync time section
		const syncSection = card.createDiv({ cls: 'weread-bookshelf-summary-item' });
		const syncIcon = syncSection.createDiv({ cls: 'weread-bookshelf-summary-icon' });
		setIcon(syncIcon, 'clock');
		let syncText: string;
		if (settings.lastSyncTime > 0) {
			const lastSyncStr = new Date(settings.lastSyncTime).toLocaleString();
			syncText = lastSyncStr;
		} else {
			syncText = '尚未同步';
		}
		syncSection.createDiv({
			cls: 'weread-bookshelf-summary-value',
			text: syncText
		});
		setTooltip(syncSection, `上次同步: ${syncText}`);

		// Updated books count section
		const updateSection = card.createDiv({ cls: 'weread-bookshelf-summary-item' });
		const updateIcon = updateSection.createDiv({ cls: 'weread-bookshelf-summary-icon' });
		setIcon(updateIcon, 'refresh-ccw');
		updateSection.createDiv({
			cls: 'weread-bookshelf-summary-value',
			text: `${settings.lastSyncBookCount} 本`
		});
		setTooltip(updateSection, `更新数量: ${settings.lastSyncBookCount} 本`);
	}

	private renderBookCard(book: BookshelfBook, container: HTMLElement = this.gridEl): void {
		const card = container.createDiv({ cls: 'weread-bookshelf-card is-clickable' });
		card.setAttr('title', `查看《${book.title}》详情`);
		card.onclick = () => {
			this.openBookDetail(book);
		};
		const cardTopActions = card.createDiv({ cls: 'weread-bookshelf-card-top-actions' });
		this.renderActionIcons(book, cardTopActions);

		const coverWrap = card.createDiv({
			cls: `weread-bookshelf-card-cover-wrap${book.hasLocalFile ? ' is-clickable' : ''}`
		});
		if (book.hasLocalFile) {
			coverWrap.setAttr('title', `打开《${book.title}》本地文件`);
			coverWrap.onclick = async (event) => {
				event.stopPropagation();
				await this.openLocalFile(book);
			};
		}
		if (book.cover) {
			const cover = coverWrap.createEl('img', {
				cls: 'weread-bookshelf-card-cover'
			});
			cover.src = book.cover;
			cover.alt = book.title;
		} else {
			coverWrap.createDiv({
				cls: 'weread-bookshelf-card-cover-placeholder',
				text: '无封面'
			});
		}

		const details = card.createDiv({ cls: 'weread-bookshelf-card-details' });
		const title = details.createDiv({
			cls: 'weread-bookshelf-card-title',
			text: book.title,
			attr: { title: book.title }
		});
		if (book.hasLocalFile) {
			title.addClass('is-clickable');
			title.setAttr('title', `打开《${book.title}》本地文件`);
			title.onclick = async (event) => {
				event.stopPropagation();
				await this.openLocalFile(book);
			};
		}
		details.createDiv({
			cls: 'weread-bookshelf-card-author',
			text: book.author
		});

		const badgeGroup = details.createDiv({ cls: 'weread-bookshelf-badges' });
		this.renderBadges(book, badgeGroup);

		details.createDiv({
			cls: 'weread-bookshelf-card-meta',
			text: `划线 ${book.noteCount} · 想法 ${book.reviewCount}`
		});
		details.createDiv({
			cls: 'weread-bookshelf-card-meta',
			text: `最近阅读 ${this.getLastReadDateText(book)}`
		});
	}

	private renderActionIcons(book: BookshelfBook, container: HTMLElement): void {
		if (book.remoteExists && !book.hasLocalFile) {
			const syncButton = container.createEl('button', {
				cls: 'clickable-icon weread-bookshelf-icon-button',
				attr: { 'aria-label': '同步此书' }
			});
			setIcon(syncButton, 'refresh-ccw');
			syncButton.onclick = async (event) => {
				event.stopPropagation();
				syncButton.disabled = true;
				try {
					await this.plugin.syncBookById(book.bookId);
					await this.loadBookshelf();
				} finally {
					syncButton.disabled = false;
				}
			};
		}

		if (this.isDisplayLocalOnly(book) && book.localFile?.file?.path) {
			const deleteButton = container.createEl('button', {
				cls: 'clickable-icon weread-bookshelf-icon-button',
				attr: { 'aria-label': '删除本地文件' }
			});
			setIcon(deleteButton, 'trash');
			deleteButton.onclick = async (event) => {
				event.stopPropagation();
				new ConfirmDeleteModal(this.app, book.title, async () => {
					deleteButton.disabled = true;
					try {
						await this.plugin.deleteLocalBookByPath(book.localFile.file.path);
						await this.loadBookshelf();
					} finally {
						deleteButton.disabled = false;
					}
				}).open();
			};
		}

		// 公众号类型的书和移动端设备不显示阅读按钮
		if (book.remoteExists && !book.isArticle && Platform.isDesktopApp) {
			const readButton = container.createEl('button', {
				cls: 'clickable-icon weread-bookshelf-icon-button',
				attr: { 'aria-label': '阅读此书' }
			});
			setIcon(readButton, 'book-open');
			readButton.onclick = async (event) => {
				event.stopPropagation();
				await this.plugin.openPreferredReadingView(getPcUrl(book.bookId));
			};
		}
	}

	private renderBadges(book: BookshelfBook, container: HTMLElement): void {
		const labels: string[] = [];
		if (this.isDisplayLocalOnly(book)) {
			labels.push('仅本地');
		} else if (this.isDisplaySynced(book)) {
			labels.push('已同步');
		} else if (!book.hasLocalFile) {
			labels.push('仅远程');
		}
		labels.push(book.isArticle ? '公众号' : '图书');

		// 添加阅读状态标签
		if (book.hasLocalFile && book.localFile?.finishedDate) {
			labels.push('已读');
		} else if (book.hasLocalFile) {
			labels.push('在读');
		}

		if (book.syncFilter && !book.syncFilter.includedByCurrentSettings) {
			labels.push(...book.syncFilter.reasonLabels);
		}

		for (const label of labels) {
			container.createDiv({
				cls: 'weread-bookshelf-badge',
				text: label
			});
		}
	}

	private getFilteredBooks(): BookshelfBook[] {
		const keyword = this.searchKeyword;
		return [...this.shelfBooks]
			.filter((book) => {
				const searchMatched =
					keyword.length === 0 ||
					`${book.title} ${book.author}`.toLowerCase().includes(keyword);
				if (!searchMatched) {
					return false;
				}

				if (this.categoryFilter === 'book' && book.isArticle) {
					return false;
				}
				if (this.categoryFilter === 'article' && !book.isArticle) {
					return false;
				}

				if (
					this.syncStatusFilter === 'remoteOnly' &&
					(this.isDisplayLocalOnly(book) || book.hasLocalFile)
				) {
					return false;
				}
				if (this.syncStatusFilter === 'synced' && !this.isDisplaySynced(book)) {
					return false;
				}
				if (this.syncStatusFilter === 'localOnly' && !this.isDisplayLocalOnly(book)) {
					return false;
				}

				if (this.readingStatusFilter !== 'all') {
					const isFinished = this.isBookFinished(book);
					if (this.readingStatusFilter === 'finished' && !isFinished) {
						return false;
					}
					if (this.readingStatusFilter === 'reading' && isFinished) {
						return false;
					}
				}

				return true;
			})
			.sort((left, right) => this.sortBooks(left, right));
	}

	private sortBooks(left: BookshelfBook, right: BookshelfBook): number {
		if (this.sortMode === 'title') {
			return left.title.localeCompare(right.title);
		}
		return this.getRecentValue(right) - this.getRecentValue(left);
	}

	private shouldGroupByYear(): boolean {
		return this.groupByYear && this.sortMode === 'recent';
	}

	private groupBooksByYear(books: BookshelfBook[]): Array<{
		year: string;
		books: BookshelfBook[];
	}> {
		const groupedBooks = new Map<string, BookshelfBook[]>();
		for (const book of books) {
			const year = this.getReadYear(book);
			const yearBooks = groupedBooks.get(year);
			if (yearBooks) {
				yearBooks.push(book);
				continue;
			}
			groupedBooks.set(year, [book]);
		}
		return Array.from(groupedBooks.entries()).map(([year, yearBooks]) => ({
			year,
			books: yearBooks
		}));
	}

	private getRecentValue(book: BookshelfBook): number {
		if (book.lastReadDate) {
			const parsedDate = moment(book.lastReadDate, 'YYYY-MM-DD', true);
			if (parsedDate.isValid()) {
				return parsedDate.unix();
			}
		}
		return 0;
	}

	private getReadYear(book: BookshelfBook): string {
		if (!book.lastReadDate) {
			return UNKNOWN_YEAR_LABEL;
		}
		const parsedDate = moment(
			book.lastReadDate,
			['YYYY-MM-DD', 'YYYY/M/D', 'YYYY/MM/DD'],
			true
		);
		return parsedDate.isValid() ? parsedDate.format('YYYY') : UNKNOWN_YEAR_LABEL;
	}

	private getLastReadDateText(book: BookshelfBook): string {
		return (
			book.lastReadDate ??
			book.progress.readingDateText ??
			book.progress.finishedDateText ??
			'暂无'
		);
	}

	private isDisplaySynced(book: BookshelfBook): boolean {
		return book.hasLocalFile && this.isRemoteIncludedInCurrentSettings(book);
	}

	private isDisplayLocalOnly(book: BookshelfBook): boolean {
		return book.hasLocalFile && !this.isRemoteIncludedInCurrentSettings(book);
	}

	private isBookFinished(book: BookshelfBook): boolean {
		// 检查本地文件的 finishedDate 来判断是否已读
		return book.hasLocalFile && book.localFile?.finishedDate !== undefined;
	}

	private isRemoteIncludedInCurrentSettings(book: BookshelfBook): boolean {
		if (!book.remoteExists) {
			return false;
		}
		return book.syncFilter?.includedByCurrentSettings ?? true;
	}

	private openBookDetail(book: BookshelfBook): void {
		new WereadBookDetailModal(
			this.app,
			book,
			async () => {
				await this.openLocalFile(book);
			},
			async (url: string) => {
				await this.plugin.openPreferredReadingView(url);
			}
		).open();
	}

	private async openLocalFile(book: BookshelfBook): Promise<void> {
		if (!book.localFile?.file) {
			new Notice('该书暂无本地文件');
			return;
		}
		const leaf = this.app.workspace.getLeaf(true);
		await leaf.openFile(book.localFile.file);
		this.app.workspace.revealLeaf(leaf);
	}
}
