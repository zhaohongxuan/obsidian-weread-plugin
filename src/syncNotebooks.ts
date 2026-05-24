import ApiManager from './api';
import FileManager from './fileManager';
import {
	Metadata,
	Notebook,
	AnnotationFile,
	BookProgressResponse,
	SyncedNote,
	SyncLogEntry
} from './models';
import {
	parseHighlights,
	parseMetadata,
	parseChapterHighlightReview,
	parseChapterReviews,
	parseDailyNoteReferences,
	parseReviews,
	parseChapterResp,
	parseArticleHighlightReview,
	parseLikedReviews,
	attachLikedReviewsToChapters
} from './parser/parseResponse';
import { settingsStore } from './settings';
import { get } from 'svelte/store';
import { Notice } from 'obsidian';
import { createSyncFilterContext, evaluateMetadataSyncFilter } from './syncFilter';
export default class SyncNotebooks {
	private fileManager: FileManager;
	private apiManager: ApiManager;

	constructor(fileManager: FileManager, apiManeger: ApiManager) {
		this.fileManager = fileManager;
		this.apiManager = apiManeger;
	}

	async syncNotebook(noteFile: AnnotationFile) {
		const metaDataArr: Metadata[] = await this.getALlMetadata();
		const currentBookMeta = metaDataArr.find((metaData) => metaData.bookId === noteFile.bookId);
		noteFile.new = true;
		currentBookMeta.file = noteFile;
		if (currentBookMeta) {
			const notebook = await this.convertToNotebook(currentBookMeta);
			await this.saveNotebook(notebook);
			new Notice(`当前笔记 《${currentBookMeta.title}》 同步成功!`);
		} else {
			new Notice(`当前笔记元数据缺少，同步失败!`);
		}
	}

	async syncBookById(bookId: string) {
		const metaDataArr: Metadata[] = await this.getALlMetadata();
		const localFiles: AnnotationFile[] = await this.fileManager.getNotebookFiles();
		const duplicateBookSet = this.getDuplicateBooks(metaDataArr);
		const currentBookMeta = metaDataArr.find((metaData) => metaData.bookId === bookId);

		if (!currentBookMeta) {
			new Notice('未在远程书架中找到该书籍');
			return;
		}

		currentBookMeta.file = await this.getLocalNotebookFile(currentBookMeta, localFiles, true);
		if (duplicateBookSet.has(currentBookMeta.title)) {
			currentBookMeta.duplicate = true;
		}

		const notebook = await this.convertToNotebook(currentBookMeta);
		await this.saveNotebook(notebook);
		new Notice(`《${currentBookMeta.title}》已同步到本地`);
	}
	async syncNotebooks(
		force = false,
		journalDate: string,
		signal?: { cancelled: boolean }
	): Promise<number> {
		const syncStartTime = new Date().getTime();
		const metaDataArr = await this.getALlMetadata();
		const filterMetaArr = await this.filterNoteMetas(force, metaDataArr);
		let syncedNotebooks = 0;
		let failedNotebooks = 0;
		const total = filterMetaArr.length;
		const progressNotice = new Notice('', 0);
		const syncedNotes: SyncedNote[] = [];
		let lastError: string | undefined;

		// 一次性建好固定尺寸骨架，后续只更新内容，不触发 reflow
		const frag = document.createDocumentFragment();
		const container = frag.createDiv({ cls: 'weread-notice-progress' });
		const headerEl = container.createDiv({ cls: 'weread-notice-progress-header' });
		const barTrack = container.createDiv({ cls: 'weread-notice-progress-track' });
		const barFill = barTrack.createDiv({ cls: 'weread-notice-progress-fill' });
		const titleEl = container.createDiv({ cls: 'weread-notice-progress-title' });
		progressNotice.setMessage(frag);

		const updateProgress = (current: number, currentTitle?: string) => {
			const pct = total > 0 ? Math.round((current / total) * 100) : 0;
			headerEl.setText(`📚 微信读书同步中 · ${current}/${total} 本 (${pct}%)`);
			barFill.style.width = `${pct}%`;
			titleEl.setText(currentTitle ? `正在同步：${currentTitle}` : '');
		};

		updateProgress(0, filterMetaArr[0]?.title);

		try {
			for (let i = 0; i < filterMetaArr.length; i++) {
				if (signal?.cancelled) break;
				const meta = filterMetaArr[i];
				const next = filterMetaArr[i + 1];
				// 提前显示下一本书名，让用户感知当前在处理哪本
				updateProgress(syncedNotebooks, meta.title);
				try {
					const notebook = await this.convertToNotebook(meta);
					const savedFilePath = await this.saveNotebook(notebook);
					syncedNotebooks++;

					// Track synced note for the log
					if (savedFilePath) {
						syncedNotes.push({
							bookId: meta.bookId,
							title: meta.title,
							filePath: savedFilePath
						});
					}
				} catch (e) {
					failedNotebooks++;
					lastError = e instanceof Error ? e.message : String(e);
					console.error(`[weread plugin] 同步书籍 ${meta.title} 失败`, e);
				}
				updateProgress(syncedNotebooks, next?.title);
			}
		} catch (e) {
			progressNotice.hide();
			throw e;
		}

		const wasCancelled = signal?.cancelled ?? false;
		this.saveToJounal(journalDate, metaDataArr);
		const syncEndTime = new Date().getTime();
		const syncTimeInMilliseconds = syncEndTime - syncStartTime;
		const syncTimeInSeconds = syncTimeInMilliseconds / 1000;

		// Record sync log
		const syncLog: SyncLogEntry = {
			id: `sync-${syncStartTime}`,
			timestamp: syncStartTime,
			totalBooks: metaDataArr.length,
			syncedBooks: syncedNotebooks,
			skippedBooks: filterMetaArr.length - syncedNotebooks,
			duration: syncTimeInSeconds,
			notes: syncedNotes,
			success: !lastError,
			errorMessage: lastError
		};
		settingsStore.actions.addSyncLog(syncLog);

		// 复用进度 notice 的 DOM 骨架，切换为完成状态，10 秒后关闭
		const icon = wasCancelled ? '🚫' : '✅';
		const verb = wasCancelled ? '已取消，已更新' : '完成！更新';
		headerEl.setText(`${icon} 同步${verb} ${syncedNotebooks} 本书`);
		barFill.style.width = '100%';
		if (wasCancelled) barFill.style.background = 'var(--text-muted)';
		const summaryParts = [
			`📚 书架共 ${metaDataArr.length} 本 · 本次处理 ${total} 本`,
			failedNotebooks > 0 ? `⚠️ ${failedNotebooks} 本同步失败` : '',
			`⏱ 耗时 ${syncTimeInSeconds.toFixed(1)} 秒`
		].filter(Boolean);
		titleEl.setText(summaryParts.join(' · '));
		setTimeout(() => progressNotice.hide(), 5000);
		return syncedNotebooks;
	}

	public async syncNotesToJounal(journalDate: string) {
		const metaDataArr = await this.getALlMetadata();
		this.saveToJounal(journalDate, metaDataArr);
	}

	private async convertToNotebook(metaData: Metadata): Promise<Notebook> {
		const bookDetail = await this.apiManager.getBook(metaData.bookId);
		if (bookDetail) {
			metaData.category = bookDetail.category;
			metaData.publisher = bookDetail.publisher;
			metaData.isbn = bookDetail.isbn;
			metaData.intro = bookDetail.intro;
			metaData.totalWords = bookDetail.totalWords;
			metaData.rating = `${bookDetail.newRating / 10}%`;
		}
		const progress: BookProgressResponse = await this.apiManager.getProgress(metaData.bookId);
		if (progress && progress.book) {
			metaData.readInfo = {
				readingProgress: progress.book.progress,
				readingTime: progress.book.readingTime,
				readingBookDate: progress.book.startReadingTime,
				finishedDate: progress.book.finishTime
			};
		}

		const highlightResp = await this.apiManager.getNotebookHighlights(metaData.bookId);
		const reviewResp = await this.apiManager.getNotebookReviews(metaData.bookId);
		const chapterResp = await this.apiManager.getChapters(metaData.bookId);
		const highlights = parseHighlights(highlightResp, reviewResp);
		const reviews = parseReviews(reviewResp);
		const chapters = parseChapterResp(chapterResp, highlightResp);
		let chapterHighlightReview;
		if (metaData.bookType === 3) {
			//公众号文章
			console.log('sync 公众号：', metaData.title);
			chapterHighlightReview = parseArticleHighlightReview(chapters, highlights, reviews);
			console.log('sync 公众号 result', metaData.title, chapterHighlightReview);
		} else {
			chapterHighlightReview = parseChapterHighlightReview(chapters, highlights, reviews);
		}

		if (get(settingsStore).syncLikedReviews && reviewResp) {
			const likedReviews = parseLikedReviews(reviewResp);
			attachLikedReviewsToChapters(chapterHighlightReview, likedReviews);
		}

		const bookReview = parseChapterReviews(reviewResp);
		return {
			metaData: metaData,
			chapterHighlights: chapterHighlightReview,
			bookReview: bookReview
		};
	}

	private async filterNoteMetas(force = false, metaDataArr: Metadata[]): Promise<Metadata[]> {
		const localFiles: AnnotationFile[] = await this.fileManager.getNotebookFiles();
		const duplicateBookSet = this.getDuplicateBooks(metaDataArr);
		const settings = get(settingsStore);
		const filterContext = createSyncFilterContext(settings);
		const filterMetaArr: Metadata[] = [];
		for (const metaData of metaDataArr) {
			const syncFilter = evaluateMetadataSyncFilter(metaData, filterContext);
			if (!syncFilter.includedByCurrentSettings) {
				console.debug(
					`[weread plugin] skip book ${
						metaData.title
					}, reasons: ${syncFilter.reasonLabels.join(', ')}`
				);
				continue;
			}
			const localNotebookFile = await this.getLocalNotebookFile(metaData, localFiles, force);
			if (localNotebookFile && !localNotebookFile.new) {
				continue;
			}
			metaData.file = localNotebookFile;
			if (duplicateBookSet.has(metaData.title)) {
				metaData.duplicate = true;
			}
			filterMetaArr.push(metaData);
		}
		return filterMetaArr;
	}

	private async getALlMetadata() {
		const notebookResp = await this.apiManager.getNotebooksWithRetry();
		const metaDataArr = notebookResp.map((noteBook) => parseMetadata(noteBook));
		return metaDataArr;
	}

	private async saveToJounal(journalDate: string, metaDataArr: Metadata[]) {
		const metaDataArrInDate = metaDataArr.filter((meta) => meta.lastReadDate === journalDate);

		const notebooksInDate = [];
		for (const meta of metaDataArrInDate) {
			const notebook = await this.convertToNotebook(meta);
			notebooksInDate.push(notebook);
		}

		if (get(settingsStore).dailyNotesToggle) {
			const dailyNoteRefereneces = parseDailyNoteReferences(notebooksInDate);
			const dailyNotePath = this.fileManager.getDailyNotePath(window.moment());
			console.log(
				'get daily note path',
				dailyNotePath,
				' size:',
				dailyNoteRefereneces.length
			);
			this.fileManager.saveDailyNotes(dailyNotePath, dailyNoteRefereneces);
		}
	}

	private getDuplicateBooks(metaDatas: Metadata[]): Set<string> {
		const bookArr = metaDatas.map((metaData) => metaData.title);
		const uniqueElements = new Set(bookArr);
		const filteredElements = bookArr.filter((item) => {
			if (uniqueElements.has(item)) {
				uniqueElements.delete(item);
			} else {
				return item;
			}
		});
		return new Set(filteredElements);
	}

	async getLocalNotebookFile(
		notebookMeta: Metadata,
		localFiles: AnnotationFile[],
		force = false
	): Promise<AnnotationFile> {
		const localFile = localFiles.find((file) => file.bookId === notebookMeta.bookId) || null;
		if (localFile) {
			if (
				localFile.noteCount == notebookMeta.noteCount &&
				localFile.reviewCount == notebookMeta.reviewCount &&
				!force
			) {
				localFile.new = false;
			} else {
				localFile.new = true;
			}
			return localFile;
		}
		return null;
	}

	private async saveNotebook(notebook: Notebook): Promise<string | null> {
		try {
			return await this.fileManager.saveNotebook(notebook);
		} catch (e) {
			console.log('[weread plugin] sync note book error', notebook.metaData.title, e);
			return null;
		}
	}
}
