import { App, Modal } from 'obsidian';
import ApiManager from '../api';
import type { BookDetailResponse, BookProgressResponse, BookshelfBook } from '../models';
import { formatTimeDuration, formatTimestampToDate } from '../utils/dateUtil';

export class WereadBookDetailModal extends Modal {
	private apiManager = new ApiManager();

	constructor(
		app: App,
		private book: BookshelfBook,
		private onOpenLocalFile?: () => Promise<void>
	) {
		super(app);
	}

	onOpen() {
		const { contentEl, modalEl } = this;
		contentEl.empty();
		modalEl.addClass('weread-book-detail-modal');
		modalEl.style.width = '720px';
		modalEl.style.maxWidth = '90vw';
		modalEl.style.maxHeight = '85vh';

		contentEl.createEl('h2', { text: this.book.title });
		contentEl.createDiv({
			cls: 'weread-book-detail-loading',
			text: '正在加载详情...'
		});
		this.loadDetail().catch(() => {
			this.renderDetail();
		});
	}

	onClose() {
		this.contentEl.empty();
	}

	private async loadDetail(): Promise<void> {
		const [detail, progress] = await Promise.all([
			this.book.remoteExists ? this.apiManager.getBook(this.book.bookId) : Promise.resolve(undefined),
			this.book.remoteExists
				? this.apiManager.getProgress(this.book.bookId)
				: Promise.resolve(undefined)
		]);
		this.renderDetail(detail, progress);
	}

	private renderDetail(detail?: BookDetailResponse, progress?: BookProgressResponse): void {
		const { contentEl } = this;
		contentEl.empty();

		const header = contentEl.createDiv({ cls: 'weread-book-detail-header' });
		if (this.book.cover) {
			const cover = header.createEl('img', {
				cls: 'weread-book-detail-cover'
			});
			cover.src = this.book.cover;
			cover.alt = this.book.title;
		}

		const info = header.createDiv({ cls: 'weread-book-detail-info' });
		info.createEl('h2', { text: this.book.title });
		info.createDiv({
			cls: 'weread-book-detail-author',
			text: this.book.author
		});

		const badges = info.createDiv({ cls: 'weread-book-detail-badges' });
		this.createBadge(badges, this.book.isArticle ? '公众号' : '图书');
		this.createBadge(badges, this.getSyncStatusText());
		this.createBadge(badges, this.getFinishedStatusText(progress));

		const stats = info.createDiv({ cls: 'weread-book-detail-stats' });
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

		if (progress?.book?.summary) {
			const summarySection = contentEl.createDiv({ cls: 'weread-book-detail-section' });
			summarySection.createEl('h3', { text: '摘要' });
			summarySection.createDiv({
				cls: 'weread-book-detail-intro',
				text: progress.book.summary
			});
		}

		const actions = contentEl.createDiv({ cls: 'weread-bookshelf-modal-actions' });
		if (this.book.hasLocalFile && this.onOpenLocalFile) {
			actions.createEl('button', { text: '打开本地文件' }).onclick = async () => {
				await this.onOpenLocalFile?.();
			};
		}
		actions.createEl('button', { text: '关闭', cls: 'mod-cta' }).onclick = () => this.close();
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

	private getSyncStatusText(): string {
		if (this.book.isLocalOnly) {
			return '仅本地';
		}
		if (!this.book.hasLocalFile) {
			return '仅远程';
		}
		return '已同步';
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
