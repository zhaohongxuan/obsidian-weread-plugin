import { get } from 'svelte/store';
import ApiManager from './api';
import FileManager from './fileManager';
import type { AnnotationFile, BookshelfBook, BookshelfProgress, Metadata } from './models';
import { parseMetadata } from './parser/parseResponse';
import { settingsStore } from './settings';
import { createSyncFilterContext, evaluateMetadataSyncFilter } from './syncFilter';
import { formatTimestampToDate } from './utils/dateUtil';

const PROGRESS_CONCURRENCY = 4;
const PROGRESS_TEXT_PATTERN = /^(\d+(?:\.\d+)?)%?$/;

const IDLE_PROGRESS: BookshelfProgress = {
	state: 'idle'
};

export default class WereadBookshelfService {
	private progressCache = new Map<string, BookshelfProgress>();

	constructor(private fileManager: FileManager, private apiManager: ApiManager) {}

	async getBookshelfBooks(): Promise<BookshelfBook[]> {
		const [notebookResp, localFilesByBookId] = await Promise.all([
			this.apiManager.getNotebooksWithRetry(),
			this.fileManager.getNotebookFilesByBookId()
		]);
		const remoteBooks = notebookResp.map((noteBook) => parseMetadata(noteBook));
		const remoteBookIds = new Set(remoteBooks.map((book) => book.bookId));
		const filterContext = createSyncFilterContext(get(settingsStore));
		const remoteEntries = remoteBooks.map((metaData) =>
			this.buildRemoteBook(metaData, localFilesByBookId.get(metaData.bookId), filterContext)
		);
		const localEntries = Array.from(localFilesByBookId.values())
			.filter(
				(file): file is AnnotationFile & { bookId: string } =>
					file.bookId !== undefined && !remoteBookIds.has(file.bookId)
			)
			.map((file) => this.buildLocalOnlyBook(file));

		return [...remoteEntries, ...localEntries];
	}

	async loadProgressForBooks(
		bookIds: string[],
		onUpdate?: (bookId: string, progress: BookshelfProgress) => void
	): Promise<void> {
		const idsToLoad = Array.from(new Set(bookIds)).filter((bookId) => {
			const progress = this.progressCache.get(bookId);
			return (
				progress === undefined || progress.state === 'idle' || progress.state === 'error'
			);
		});

		for (let index = 0; index < idsToLoad.length; index += PROGRESS_CONCURRENCY) {
			const chunk = idsToLoad.slice(index, index + PROGRESS_CONCURRENCY);
			await Promise.all(
				chunk.map(async (bookId) => {
					const loadingState: BookshelfProgress = { state: 'loading' };
					this.progressCache.set(bookId, loadingState);
					onUpdate?.(bookId, loadingState);

					try {
						const progressResp = await this.apiManager.getProgress(bookId);
						if (!progressResp?.book) {
							const errorState: BookshelfProgress = {
								state: 'error',
								error: '读取进度失败'
							};
							this.progressCache.set(bookId, errorState);
							onUpdate?.(bookId, errorState);
							return;
						}

						const loadedState: BookshelfProgress = {
							state: 'loaded',
							readingProgress: progressResp.book.progress,
							readingProgressText: `${progressResp.book.progress}%`,
							readingDate: progressResp.book.startReadingTime,
							readingDateText: progressResp.book.startReadingTime
								? formatTimestampToDate(progressResp.book.startReadingTime)
								: undefined,
							finishedDate: progressResp.book.finishTime,
							finishedDateText: progressResp.book.finishTime
								? formatTimestampToDate(progressResp.book.finishTime)
								: undefined,
							readingTime: progressResp.book.readingTime
						};
						this.progressCache.set(bookId, loadedState);
						onUpdate?.(bookId, loadedState);
					} catch (error: unknown) {
						const errorState: BookshelfProgress = {
							state: 'error',
							error: error instanceof Error ? error.message : '读取进度失败'
						};
						this.progressCache.set(bookId, errorState);
						onUpdate?.(bookId, errorState);
					}
				})
			);
		}
	}

	getProgress(bookId: string, fallback?: BookshelfProgress): BookshelfProgress {
		return this.progressCache.get(bookId) ?? fallback ?? IDLE_PROGRESS;
	}

	clearProgressCache(bookId?: string): void {
		if (bookId) {
			this.progressCache.delete(bookId);
			return;
		}
		this.progressCache.clear();
	}

	private buildRemoteBook(
		metaData: Metadata,
		localFile: AnnotationFile | undefined,
		filterContext: ReturnType<typeof createSyncFilterContext>
	): BookshelfBook {
		return {
			bookId: metaData.bookId,
			title: metaData.title,
			author: metaData.author,
			cover: metaData.cover,
			noteCount: metaData.noteCount,
			reviewCount: metaData.reviewCount,
			lastReadDate: metaData.lastReadDate,
			isArticle: metaData.bookType === 3,
			hasLocalFile: Boolean(localFile),
			localFile,
			remoteExists: true,
			isLocalOnly: false,
			syncFilter: evaluateMetadataSyncFilter(metaData, filterContext),
			progress: this.getProgress(metaData.bookId, this.getLocalFallbackProgress(localFile))
		};
	}

	private buildLocalOnlyBook(localFile: AnnotationFile & { bookId: string }): BookshelfBook {
		return {
			bookId: localFile.bookId,
			title: localFile.title ?? localFile.file.basename,
			author: localFile.author ?? '未知作者',
			cover: localFile.cover,
			noteCount: localFile.noteCount,
			reviewCount: localFile.reviewCount,
			lastReadDate: localFile.readingDate ?? localFile.finishedDate,
			isArticle: false,
			hasLocalFile: true,
			localFile,
			remoteExists: false,
			isLocalOnly: true,
			progress: this.getProgress(localFile.bookId, this.getLocalFallbackProgress(localFile))
		};
	}

	private getLocalFallbackProgress(localFile?: AnnotationFile): BookshelfProgress | undefined {
		if (!localFile) {
			return undefined;
		}
		const readingProgress = this.parseProgressValue(localFile.progress);
		if (
			readingProgress === undefined &&
			localFile.readingDate === undefined &&
			localFile.finishedDate === undefined
		) {
			return undefined;
		}
		return {
			state: 'loaded',
			readingProgress,
			readingProgressText:
				localFile.progress ??
				(readingProgress === undefined ? undefined : `${readingProgress}%`),
			readingDateText: localFile.readingDate,
			finishedDateText: localFile.finishedDate
		};
	}

	private parseProgressValue(progress?: string): number | undefined {
		if (!progress) {
			return undefined;
		}
		const progressMatch = progress.trim().match(PROGRESS_TEXT_PATTERN);
		if (!progressMatch) {
			return undefined;
		}
		const progressValue = Number.parseFloat(progressMatch[1]);
		return Number.isNaN(progressValue) ? undefined : progressValue;
	}
}
