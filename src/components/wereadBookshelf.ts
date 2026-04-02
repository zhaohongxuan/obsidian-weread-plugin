import { ItemView, Notice, WorkspaceLeaf, moment } from 'obsidian';
import WereadPlugin from '../../main';
import WereadBookshelfService from '../bookshelf';
import type { BookshelfBook, BookshelfProgress } from '../models';

export const WEREAD_BOOKSHELF_VIEW_ID = 'weread-bookshelf-view';

const PAGE_SIZE = 24;

type BookshelfFilter =
	| 'all'
	| 'local'
	| 'remote'
	| 'localExcluded'
	| 'finished'
	| 'unfinished'
	| 'article';
type BookshelfSort = 'recent' | 'progress' | 'title';

export class WereadBookshelfView extends ItemView {
	private shelfBooks: BookshelfBook[] = [];
	private searchKeyword = '';
	private filterMode: BookshelfFilter = 'all';
	private sortMode: BookshelfSort = 'recent';
	private visibleCount = PAGE_SIZE;
	private loading = false;
	private emptyStateEl: HTMLElement;
	private summaryEl: HTMLElement;
	private gridEl: HTMLElement;
	private loadMoreEl: HTMLElement;

	constructor(
		leaf: WorkspaceLeaf,
		private plugin: WereadPlugin,
		private bookshelfService: WereadBookshelfService
	) {
		super(leaf);
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

		const header = this.contentEl.createDiv({ cls: 'weread-bookshelf-header' });
		header.createEl('h2', { text: '微信读书书架' });
		const headerActions = header.createDiv({ cls: 'weread-bookshelf-header-actions' });
		const refreshButton = headerActions.createEl('button', {
			text: '刷新书架',
			cls: 'mod-cta'
		});
		refreshButton.onclick = async () => {
			this.bookshelfService.clearProgressCache();
			await this.loadBookshelf();
		};

		const toolbar = this.contentEl.createDiv({ cls: 'weread-bookshelf-toolbar' });
		const searchInput = toolbar.createEl('input', {
			type: 'search',
			cls: 'weread-bookshelf-search'
		});
		searchInput.placeholder = '搜索书名或作者';
		searchInput.addEventListener('input', () => {
			this.searchKeyword = searchInput.value.trim().toLowerCase();
			this.visibleCount = PAGE_SIZE;
			this.renderBooks();
		});

		const filterSelect = toolbar.createEl('select', { cls: 'dropdown' });
		[
			['all', '全部'],
			['local', '仅本地'],
			['remote', '仅远程'],
			['localExcluded', '本地但不参与同步'],
			['finished', '已读完'],
			['unfinished', '未读完'],
			['article', '公众号']
		].forEach(([value, label]) => {
			filterSelect.createEl('option', { value, text: label });
		});
		filterSelect.onchange = () => {
			this.filterMode = filterSelect.value as BookshelfFilter;
			this.visibleCount = PAGE_SIZE;
			this.renderBooks();
		};

		const sortSelect = toolbar.createEl('select', { cls: 'dropdown' });
		[
			['recent', '按最近阅读排序'],
			['progress', '按进度排序'],
			['title', '按标题排序']
		].forEach(([value, label]) => {
			sortSelect.createEl('option', { value, text: label });
		});
		sortSelect.onchange = () => {
			this.sortMode = sortSelect.value as BookshelfSort;
			this.renderBooks();
		};

		this.summaryEl = this.contentEl.createDiv({ cls: 'weread-bookshelf-summary' });
		this.emptyStateEl = this.contentEl.createDiv({ cls: 'weread-bookshelf-empty' });
		this.gridEl = this.contentEl.createDiv({ cls: 'weread-bookshelf-grid' });
		this.loadMoreEl = this.contentEl.createDiv({ cls: 'weread-bookshelf-load-more' });

		await this.loadBookshelf();
	}

	async onClose() {
		this.contentEl.empty();
	}

	private async loadBookshelf(): Promise<void> {
		this.loading = true;
		this.summaryEl.setText('加载书架中...');
		this.emptyStateEl.empty();
		this.gridEl.empty();
		this.loadMoreEl.empty();
		try {
			this.shelfBooks = await this.bookshelfService.getBookshelfBooks();
			this.visibleCount = PAGE_SIZE;
			this.renderBooks();
		} catch (error: unknown) {
			this.summaryEl.setText('加载书架失败');
			this.emptyStateEl.setText(error instanceof Error ? error.message : '加载书架失败');
		} finally {
			this.loading = false;
		}
	}

	private renderBooks(): void {
		const filteredBooks = this.getFilteredBooks();
		const visibleBooks = filteredBooks.slice(0, this.visibleCount);
		this.gridEl.empty();
		this.emptyStateEl.empty();
		this.loadMoreEl.empty();
		this.summaryEl.setText(`展示 ${visibleBooks.length} / ${filteredBooks.length} 本书`);

		if (filteredBooks.length === 0) {
			this.emptyStateEl.setText(this.loading ? '加载中...' : '没有找到匹配的书籍');
			return;
		}

		for (const book of visibleBooks) {
			this.renderBookCard(book);
		}

		this.loadProgressForVisibleBooks(visibleBooks);

		if (visibleBooks.length < filteredBooks.length) {
			const button = this.loadMoreEl.createEl('button', { text: '加载更多' });
			button.onclick = () => {
				this.visibleCount += PAGE_SIZE;
				this.renderBooks();
			};
		}
	}

	private renderBookCard(book: BookshelfBook): void {
		const card = this.gridEl.createDiv({ cls: 'weread-bookshelf-card' });
		const coverWrap = card.createDiv({ cls: 'weread-bookshelf-card-cover-wrap' });
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
			text: book.title
		});
		if (book.hasLocalFile && book.localFile?.file) {
			title.addClass('is-clickable');
			title.onclick = async () => {
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
			text: this.getProgressText(book.progress)
		});
		details.createDiv({
			cls: 'weread-bookshelf-card-meta',
			text: this.getDateText(book)
		});
		if (book.localFile?.file?.path) {
			details.createDiv({
				cls: 'weread-bookshelf-card-path',
				text: book.localFile.file.path
			});
		}

		const actions = details.createDiv({ cls: 'weread-bookshelf-card-actions' });
		if (book.hasLocalFile) {
			const openButton = actions.createEl('button', { text: '打开本地文件', cls: 'mod-cta' });
			openButton.onclick = async (event) => {
				event.stopPropagation();
				await this.openLocalFile(book);
			};
		} else if (book.remoteExists) {
			const syncButton = actions.createEl('button', { text: '同步此书' });
			syncButton.onclick = async (event) => {
				event.stopPropagation();
				syncButton.disabled = true;
				syncButton.textContent = '同步中...';
				try {
					await this.plugin.syncBookById(book.bookId);
					await this.loadBookshelf();
				} finally {
					syncButton.disabled = false;
					syncButton.textContent = '同步此书';
				}
			};
		}

		if (book.progress.state === 'error' && book.remoteExists) {
			const retryButton = actions.createEl('button', { text: '重试进度' });
			retryButton.onclick = async (event) => {
				event.stopPropagation();
				this.bookshelfService.clearProgressCache(book.bookId);
				await this.loadProgressForVisibleBooks([book]);
			};
		}
	}

	private renderBadges(book: BookshelfBook, container: HTMLElement): void {
		const labels: string[] = [];
		if (book.isLocalOnly) {
			labels.push('仅本地');
		} else if (!book.hasLocalFile) {
			labels.push('仅远程');
		} else {
			labels.push('本地已存在');
		}
		if (book.isArticle) {
			labels.push('公众号');
		}
		if (book.syncFilter && !book.syncFilter.includedByCurrentSettings) {
			labels.push('当前不参与同步');
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
				switch (this.filterMode) {
					case 'local':
						return book.hasLocalFile;
					case 'remote':
						return book.remoteExists && !book.hasLocalFile;
					case 'localExcluded':
						return (
							book.hasLocalFile &&
							book.remoteExists &&
							Boolean(book.syncFilter) &&
							!book.syncFilter.includedByCurrentSettings
						);
					case 'finished':
						return Boolean(
							book.progress.finishedDateText || book.progress.finishedDate
						);
					case 'unfinished':
						return !book.progress.finishedDateText && !book.progress.finishedDate;
					case 'article':
						return book.isArticle;
					default:
						return true;
				}
			})
			.sort((left, right) => this.sortBooks(left, right));
	}

	private sortBooks(left: BookshelfBook, right: BookshelfBook): number {
		if (this.sortMode === 'title') {
			return left.title.localeCompare(right.title, 'zh-Hans-CN');
		}
		if (this.sortMode === 'progress') {
			return this.getProgressValue(right) - this.getProgressValue(left);
		}
		return this.getRecentValue(right) - this.getRecentValue(left);
	}

	private getProgressValue(book: BookshelfBook): number {
		return book.progress.readingProgress ?? -1;
	}

	private getRecentValue(book: BookshelfBook): number {
		if (book.progress.finishedDate) {
			return book.progress.finishedDate;
		}
		if (book.progress.readingDate) {
			return book.progress.readingDate;
		}
		if (book.lastReadDate) {
			return Number(moment(book.lastReadDate, 'YYYY-MM-DD').format('X'));
		}
		return 0;
	}

	private getProgressText(progress: BookshelfProgress): string {
		if (progress.state === 'loading') {
			return '进度：加载中...';
		}
		if (progress.state === 'error') {
			return '进度：加载失败';
		}
		if (progress.readingProgressText) {
			return `进度：${progress.readingProgressText}`;
		}
		return '进度：未加载';
	}

	private getDateText(book: BookshelfBook): string {
		if (book.progress.finishedDateText) {
			return `完成时间：${book.progress.finishedDateText}`;
		}
		if (book.progress.readingDateText) {
			return `最近阅读：${book.progress.readingDateText}`;
		}
		if (book.lastReadDate) {
			return `最近阅读：${book.lastReadDate}`;
		}
		return book.isLocalOnly ? '仅存在本地文件' : '最近阅读：暂无';
	}

	private async loadProgressForVisibleBooks(books: BookshelfBook[]): Promise<void> {
		const remoteBookIds = books.filter((book) => book.remoteExists).map((book) => book.bookId);
		if (remoteBookIds.length === 0) {
			return;
		}
		await this.bookshelfService.loadProgressForBooks(remoteBookIds, (bookId, progress) => {
			const target = this.shelfBooks.find((book) => book.bookId === bookId);
			if (!target) {
				return;
			}
			target.progress = progress;
			this.renderBooks();
		});
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
