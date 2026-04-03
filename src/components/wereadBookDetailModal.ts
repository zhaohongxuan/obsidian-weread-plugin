import { App, Modal, Notice, Platform } from 'obsidian';
import ApiManager from '../api';
import type { BookDetailResponse, BookProgressResponse, BookshelfBook } from '../models';
import { getPcUrl } from '../parser/parseResponse';
import { formatTimeDuration, formatTimestampToDate } from '../utils/dateUtil';

const MODAL_DESKTOP_WIDTH = '800px';
const MODAL_DESKTOP_MAX_WIDTH = '92vw';
const MODAL_MOBILE_MAX_WIDTH = '96vw';
const MODAL_MAX_HEIGHT = '85vh';

export class WereadBookDetailModal extends Modal {
	private apiManager = new ApiManager();

	constructor(
		app: App,
		private book: BookshelfBook,
		private onOpenLocalFile?: () => Promise<void>,
		private onOpenRemoteDetail?: (url: string) => Promise<void> | void
	) {
		super(app);
	}

	onOpen() {
		const { contentEl, modalEl } = this;
		contentEl.empty();
		modalEl.addClass('weread-book-detail-modal');
		modalEl.style.width = Platform.isDesktopApp ? MODAL_DESKTOP_WIDTH : MODAL_MOBILE_MAX_WIDTH;
		modalEl.style.maxWidth = Platform.isDesktopApp
			? MODAL_DESKTOP_MAX_WIDTH
			: MODAL_MOBILE_MAX_WIDTH;
		modalEl.style.maxHeight = MODAL_MAX_HEIGHT;

		contentEl.createEl('h2', { text: this.book.title });
		contentEl.createDiv({
			cls: 'weread-book-detail-loading',
			text: '正在加载详情...'
		});
		this.loadDetail().catch((error: unknown) => {
			new Notice(error instanceof Error ? error.message : '加载图书详情失败');
			this.renderDetail();
		});
	}

	onClose() {
		this.contentEl.empty();
	}

	private async loadDetail(): Promise<void> {
		const [detail, progress] = await Promise.all([
			this.book.remoteExists
				? this.apiManager.getBook(this.book.bookId)
				: Promise.resolve(undefined),
			this.book.remoteExists
				? this.apiManager.getProgress(this.book.bookId)
				: Promise.resolve(undefined)
		]);
		if (this.book.remoteExists && !detail && !progress) {
			throw new Error('加载图书详情失败');
		}
		this.renderDetail(detail, progress);
	}

	private renderDetail(detail?: BookDetailResponse, progress?: BookProgressResponse): void {
		const { contentEl } = this;
		contentEl.empty();
		const isDesktop = Platform.isDesktopApp;

		const header = contentEl.createDiv({ cls: 'weread-book-detail-header' });
		if (this.book.cover) {
			const cover = header.createEl('img', {
				cls: 'weread-book-detail-cover'
			});
			cover.src = this.book.cover;
			cover.alt = this.book.title;
		}

		const info = header.createDiv({ cls: 'weread-book-detail-info' });
		const title = info.createEl('h2', { text: this.book.title });
		title.setAttr('title', this.book.hasLocalFile ? '打开本地文件' : this.book.title);
		if (this.book.hasLocalFile && this.onOpenLocalFile) {
			title.addClass('is-clickable');
			title.onclick = async () => {
				await this.onOpenLocalFile?.();
				this.close();
			};
		}
		info.createDiv({
			cls: 'weread-book-detail-author',
			text: this.book.author
		});

		const badges = info.createDiv({ cls: 'weread-book-detail-badges' });
		this.createBadge(badges, this.book.isArticle ? '公众号' : '图书');
		this.createBadge(badges, this.getSyncStatusText());
		this.createBadge(badges, this.getFinishedStatusText(progress));
		for (const label of this.getSyncFilterReasonLabels()) {
			this.createBadge(badges, label);
		}
		if (isDesktop) {
			const linkRow = info.createDiv({ cls: 'weread-book-detail-entry-row' });
			this.createInlineLink(linkRow, '打开网页版详情', getPcUrl(this.book.bookId));
		}

		const stats = contentEl.createDiv({ cls: 'weread-book-detail-stats' });
		this.createStatRow(stats, '划线', String(this.book.noteCount));
		this.createStatRow(stats, '想法', String(this.book.reviewCount));
		this.createStatRow(stats, '阅读进度', this.getReadingProgressText(progress));
		this.createStatRow(stats, '完成时间', this.getFinishedDateText(progress));
		this.createStatRow(stats, '最近阅读', this.getLastReadDateText(progress));
		this.createStatRow(stats, '阅读时长', this.getReadingTimeText(progress));
		if (detail?.publisher) {
			this.createStatRow(stats, '出版社', detail.publisher);
		}
		if (detail?.publishTime) {
			this.createStatRow(stats, '出版时间', detail.publishTime);
		}
		if (detail?.category) {
			this.createStatRow(stats, '分类', detail.category);
		}
		if (detail?.totalWords) {
			this.createStatRow(stats, '字数', `${detail.totalWords}`);
		}

		const introSection = contentEl.createDiv({ cls: 'weread-book-detail-section' });
		introSection.createEl('h3', { text: '简介' });
		introSection.createDiv({
			cls: 'weread-book-detail-intro',
			text: detail?.intro?.trim() || '暂无简介'
		});
	}

	private createBadge(container: HTMLElement, text: string): void {
		container.createDiv({
			cls: 'weread-book-detail-badge',
			text
		});
	}

	private createStatRow(container: HTMLElement, label: string, value: string): void {
		const row = container.createDiv({ cls: 'weread-book-detail-stat-row' });
		row.createDiv({
			cls: 'weread-book-detail-stat-label',
			text: label
		});
		row.createDiv({
			cls: 'weread-book-detail-stat-value',
			text: value
		});
	}

	private createInlineLink(container: HTMLElement, linkText: string, href: string): void {
		const link = container.createEl('a', {
			cls: 'weread-book-detail-link',
			text: linkText,
			href
		});
		link.onclick = async (event) => {
			event.preventDefault();
			await this.onOpenRemoteDetail?.(href);
		};
	}

	private createLinkStatRow(
		container: HTMLElement,
		label: string,
		linkText: string,
		href: string
	): void {
		const row = container.createDiv({ cls: 'weread-book-detail-stat-row' });
		row.createDiv({
			cls: 'weread-book-detail-stat-label',
			text: label
		});
		this.createInlineLink(row, linkText, href);
	}

	private getSyncStatusText(): string {
		if (this.isDisplayLocalOnly()) {
			return '仅本地';
		}
		if (this.isDisplaySynced()) {
			return '已同步';
		}
		return '仅远程';
	}

	private isDisplaySynced(): boolean {
		return this.book.hasLocalFile && this.isRemoteIncludedInCurrentSettings();
	}

	private isDisplayLocalOnly(): boolean {
		return this.book.hasLocalFile && !this.isRemoteIncludedInCurrentSettings();
	}

	private isRemoteIncludedInCurrentSettings(): boolean {
		if (!this.book.remoteExists) {
			return false;
		}
		return this.book.syncFilter?.includedByCurrentSettings ?? true;
	}

	private getSyncFilterReasonLabels(): string[] {
		if (!this.book.syncFilter || this.book.syncFilter.includedByCurrentSettings) {
			return [];
		}

		return this.book.syncFilter.reasonLabels;
	}

	private getFinishedStatusText(progress?: BookProgressResponse): string {
		if (progress?.book?.finishTime) {
			return '已读完';
		}
		if (this.book.progress.finishedDateText) {
			return '已读完';
		}
		return '在读';
	}

	private getReadingProgressText(progress?: BookProgressResponse): string {
		if (progress?.book?.progress !== undefined) {
			return `${progress.book.progress}%`;
		}
		if (this.book.progress.readingProgressText) {
			return this.book.progress.readingProgressText;
		}
		return this.book.remoteExists ? '读取失败或暂无数据' : '仅本地暂无远程进度';
	}

	private getFinishedDateText(progress?: BookProgressResponse): string {
		if (progress?.book?.finishTime) {
			return formatTimestampToDate(progress.book.finishTime);
		}
		if (this.book.progress.finishedDateText) {
			return this.book.progress.finishedDateText;
		}
		return '未完成';
	}

	private getLastReadDateText(progress?: BookProgressResponse): string {
		if (this.book.lastReadDate) {
			return this.book.lastReadDate;
		}
		if (progress?.book?.startReadingTime) {
			return formatTimestampToDate(progress.book.startReadingTime);
		}
		if (this.book.progress.readingDateText) {
			return this.book.progress.readingDateText;
		}
		return '暂无';
	}

	private getReadingTimeText(progress?: BookProgressResponse): string {
		if (progress?.book?.readingTime) {
			return formatTimeDuration(progress.book.readingTime);
		}
		if (this.book.progress.readingTime) {
			return formatTimeDuration(this.book.progress.readingTime);
		}
		return '暂无';
	}
}
