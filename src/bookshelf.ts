import { get } from 'svelte/store';
import ApiRouter from './api-router';
import FileManager from './fileManager';
import type { AnnotationFile, BookshelfBook, BookshelfProgress, Metadata } from './models';
import { parseMetadata } from './parser/parseResponse';
import { settingsStore } from './settings';
import { createSyncFilterContext, evaluateMetadataSyncFilter } from './syncFilter';
import { formatTimestampToDate } from './utils/dateUtil';

import type { BookshelfSourceMode, BookshelfCollection, ShelfBook } from './models';
export type { BookshelfSourceMode, ShelfSyncResponse, BookshelfFolder, BookshelfAlbum, ShelfBook, BookshelfCollection } from './models';

const PROGRESS_CONCURRENCY = 4;
const PROGRESS_TEXT_PATTERN = /^(\d+(?:\.\d+)?)%?$/;

/** Normalize the documented bookshelf category string to its primary classification. */
export function getBookshelfCategory(value: unknown): string | undefined {
	if (typeof value !== 'string') return undefined;
	return value.split('-', 1)[0].trim() || undefined;
}

const IDLE_PROGRESS: BookshelfProgress = {
	state: 'idle'
};

export default class WereadBookshelfService {
	private progressCache = new Map<string, BookshelfProgress>();

	constructor(
		private fileManager: FileManager,
		private apiManager: ApiRouter
	) {}

	private credentialKey = '';

	private checkCredentials(): string {
		const settings = get(settingsStore);
		const key = JSON.stringify([
			settings.wereadApiKey,
			settings.cookies,
			settings.isCookieValid
		]);
		if (key !== this.credentialKey) {
			this.progressCache.clear();
			this.credentialKey = key;
		}
		return key;
	}

	async getCollection(source: BookshelfSourceMode, force = false): Promise<BookshelfCollection> {
		this.checkCredentials();
		if (source === 'notebooks') {
			const books = await this.getBookshelfBooks();
			return {
				books,
				folders: [],
				albums: [],
				hasArticleCollection: false,
				remoteEntryCount: books.filter((book) => book.remoteExists).length
			};
		}
		const [shelf, localFiles] = await Promise.all([
			this.apiManager.getShelf(force),
			this.fileManager.getNotebookFilesByBookId()
		]);
		const remoteIds = new Set(shelf.books.map((book) => String(book.bookId)));
		const books: ShelfBook[] = shelf.books
			.map((raw) => {
				const bookId = String(raw.bookId ?? '');
				const localFile = localFiles.get(bookId);
				return {
					bookId,
					title: String(raw.title || '未命名书籍'),
					author: String(raw.author || '未知作者'),
					category: getBookshelfCategory(raw.category),
					cover:
						typeof raw.cover === 'string'
							? raw.cover.replace('/s_', '/t7_')
							: undefined,
					noteCount: localFile?.noteCount ?? 0,
					reviewCount: localFile?.reviewCount ?? 0,
					countsKnown: Boolean(localFile),
					lastReadDate:
						Number(raw.readUpdateTime) > 0
							? formatTimestampToDate(Number(raw.readUpdateTime))
							: undefined,
					isArticle: Number(raw.type ?? raw.bookType) === 3,
					finished:
						raw.finishReading === undefined
							? undefined
							: Number(raw.finishReading) === 1,
					hasLocalFile: Boolean(localFile),
					localFile,
					remoteExists: true,
					isLocalOnly: false,
					progress: this.getProgress(bookId, this.getLocalFallbackProgress(localFile))
				};
			})
			.filter((book) => book.bookId !== '');
		for (const file of localFiles.values()) {
			if (file.bookId !== undefined && !remoteIds.has(file.bookId)) {
				books.push(this.buildLocalOnlyBook(file as AnnotationFile & { bookId: string }));
			}
		}
		const folders = (Array.isArray(shelf.archive) ? shelf.archive : []).map(
			(folder, index) => ({
				id: `folder-${index}`,
				name: String(folder.name || `书单 ${index + 1}`),
				bookIds: Array.from(
					new Set((Array.isArray(folder.bookIds) ? folder.bookIds : []).map(String))
				)
			})
		);
		const rawAlbums = Array.isArray(shelf.albums) ? shelf.albums : [];
		const albums = rawAlbums.map((entry, index) => {
			const info = entry.albumInfo ?? {};
			return {
				id: String(info.albumId ?? `album-${index}`),
				title: String(info.name || '未命名有声书'),
				author: String(info.authorName || '未知作者'),
				cover: info.cover,
				trackCount: Number.isFinite(Number(info.trackCount))
					? Number(info.trackCount)
					: undefined
			};
		});
		const hasArticleCollection =
			Boolean(shelf.mp) &&
			(typeof shelf.mp !== 'object' || Object.keys(shelf.mp as object).length > 0);
		return {
			books,
			folders,
			albums,
			hasArticleCollection,
			remoteEntryCount: shelf.books.length + rawAlbums.length + (hasArticleCollection ? 1 : 0)
		};
	}

	async getLocalCollection(): Promise<BookshelfCollection> {
		const files = await this.fileManager.getNotebookFilesByBookId();
		const books = Array.from(files.values())
			.filter(
				(file): file is AnnotationFile & { bookId: string } => file.bookId !== undefined
			)
			.map((file) => this.buildLocalOnlyBook(file));
		return { books, folders: [], albums: [], hasArticleCollection: false, remoteEntryCount: 0 };
	}

	async getBookshelfBooks(): Promise<BookshelfBook[]> {
		this.checkCredentials();
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
		const credentialKey = this.checkCredentials();
		const idsToLoad = Array.from(new Set(bookIds)).filter((bookId) => {
			const progress = this.progressCache.get(bookId);
			return (
				progress === undefined || progress.state === 'idle' || progress.state === 'error'
			);
		});

		for (let index = 0; index < idsToLoad.length; index += PROGRESS_CONCURRENCY) {
			if (credentialKey !== this.checkCredentials()) return;
			const chunk = idsToLoad.slice(index, index + PROGRESS_CONCURRENCY);
			await Promise.all(
				chunk.map(async (bookId) => {
					const loadingState: BookshelfProgress = { state: 'loading' };
					this.progressCache.set(bookId, loadingState);
					onUpdate?.(bookId, loadingState);

					try {
						const progressResp = await this.apiManager.getProgress(bookId);
						if (credentialKey !== this.checkCredentials()) return;
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
							readingProgress: this.parseProgressValue(progressResp.book.progress),
							readingProgressText:
								this.parseProgressValue(progressResp.book.progress) === undefined
									? undefined
									: `${progressResp.book.progress}%`,
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
						if (credentialKey !== this.checkCredentials()) return;
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
		this.checkCredentials();
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

	private parseProgressValue(progress?: string | number): number | undefined {
		if (progress === undefined || progress === null) {
			return undefined;
		}
		if (typeof progress === 'number') {
			return Number.isFinite(progress) && progress >= 0 && progress <= 100
				? progress
				: undefined;
		}
		const progressMatch = progress.trim().match(PROGRESS_TEXT_PATTERN);
		if (!progressMatch) {
			return undefined;
		}
		const progressValue = Number.parseFloat(progressMatch[1]);
		return Number.isFinite(progressValue) && progressValue >= 0 && progressValue <= 100
			? progressValue
			: undefined;
	}
}
