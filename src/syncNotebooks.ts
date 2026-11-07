import ApiRouter from './api-router';
import FileManager from './fileManager';
import PopularHighlightsCacheManager from './popularHighlightsCache';
import {
	Metadata,
	Notebook,
	AnnotationFile,
	BookProgressResponse,
	SyncedNote,
	SyncLogEntry,
	PopularChapterHighlight,
	PopularHighlight
} from './models';
import {
	parseHighlights,
	parseMetadata,
	parseChapterHighlightReview,
	parseChapterReviews,
	parseDailyNoteReferences,
	parseReviews,
	parseChapterResp,
	parseArticleHighlightReview
} from './parser/parseResponse';
import { settingsStore } from './settings';
import { get } from 'svelte/store';
import { Notice, Vault } from 'obsidian';
import { createSyncFilterContext, evaluateMetadataSyncFilter } from './syncFilter';
export default class SyncNotebooks {
	private fileManager: FileManager;
	private apiManager: ApiRouter;
	private cacheManager: PopularHighlightsCacheManager;

	constructor(fileManager: FileManager, apiManager: ApiRouter, vault: Vault) {
		this.fileManager = fileManager;
		this.apiManager = apiManager;
		this.cacheManager = new PopularHighlightsCacheManager(vault);
	}

	async syncNotebook(noteFile: AnnotationFile) {
		const metaDataArr: Metadata[] = await this.getALlMetadata();
		const currentBookMeta = metaDataArr.find((metaData) => metaData.bookId === noteFile.bookId);
		if (!currentBookMeta) {
			throw new Error(
				`《${noteFile.title}》 (${noteFile.bookId}) metadata: 未找到远程书籍元数据`
			);
		}
		noteFile.new = true;
		currentBookMeta.file = noteFile;
		const savedPath = await this.syncMetadata(currentBookMeta);
		new Notice(
			savedPath
				? `当前笔记 《${currentBookMeta.title}》 同步成功!`
				: `《${currentBookMeta.title}》无需更新`
		);
	}

	async syncBookById(bookId: string) {
		const metaDataArr: Metadata[] = await this.getALlMetadata();
		const localFiles: AnnotationFile[] = await this.fileManager.getNotebookFiles();
		const duplicateBookSet = this.getDuplicateBooks(metaDataArr);
		const currentBookMeta = metaDataArr.find((metaData) => metaData.bookId === bookId);

		if (!currentBookMeta) {
			throw new Error(`(${bookId}) metadata: 未在远程书架中找到该书籍`);
		}

		currentBookMeta.file = await this.getLocalNotebookFile(currentBookMeta, localFiles, true);
		if (duplicateBookSet.has(currentBookMeta.title)) {
			currentBookMeta.duplicate = true;
		}

		const savedPath = await this.syncMetadata(currentBookMeta);
		new Notice(
			savedPath
				? `《${currentBookMeta.title}》已同步到本地`
				: `《${currentBookMeta.title}》无需更新`
		);
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
		const failures: NonNullable<SyncLogEntry['failures']> = [];
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
				updateProgress(i, meta.title);
				try {
					const savedFilePath = await this.syncMetadata(meta);

					// Track synced note for the log
					if (savedFilePath) {
						syncedNotebooks++;
						syncedNotes.push({
							bookId: meta.bookId,
							title: meta.title,
							filePath: savedFilePath
						});
					}
				} catch (e) {
					lastError = e instanceof Error ? e.message : String(e);
					failures.push({
						bookId: meta.bookId,
						title: meta.title,
						stage: (e as { stage?: string })?.stage ?? 'sync',
						errorMessage: lastError
					});
					console.error(`[weread plugin] 同步书籍 ${meta.title} 失败`, e);
				}
				updateProgress(i + 1, next?.title);
			}
		} catch (e) {
			progressNotice.hide();
			throw e;
		}

		let wasCancelled = signal?.cancelled ?? false;
		if (!wasCancelled) {
			try {
				await this.saveToJounal(journalDate, metaDataArr, signal);
			} catch (error) {
				const journalError = `Daily Notes: ${error instanceof Error ? error.message : String(error)}`;
				lastError = lastError ? `${lastError}; ${journalError}` : journalError;
				console.error('[weread plugin] Daily Notes 同步失败', error);
			}
		}
		wasCancelled = signal?.cancelled ?? false;
		const syncEndTime = new Date().getTime();
		const syncTimeInMilliseconds = syncEndTime - syncStartTime;
		const syncTimeInSeconds = syncTimeInMilliseconds / 1000;

		// Record sync log
		const syncLog: SyncLogEntry = {
			id: `sync-${syncStartTime}`,
			timestamp: syncStartTime,
			totalBooks: metaDataArr.length,
			syncedBooks: syncedNotebooks,
			skippedBooks: filterMetaArr.length - syncedNotebooks - failures.length,
			failedBooks: failures.length,
			failures,
			cancelled: wasCancelled,
			duration: syncTimeInSeconds,
			notes: syncedNotes,
			success: !lastError && !wasCancelled,
			errorMessage: lastError
		};
		settingsStore.actions.addSyncLog(syncLog);

		// 复用进度 notice 的 DOM 骨架，切换为完成状态，10 秒后关闭
		const icon = wasCancelled ? '🚫' : lastError ? '⚠️' : '✅';
		const verb = wasCancelled ? '已取消，已更新' : lastError ? '结束，更新' : '完成！更新';
		headerEl.setText(`${icon} 同步${verb} ${syncedNotebooks} 本书`);
		barFill.style.width = '100%';
		if (wasCancelled) barFill.style.background = 'var(--text-muted)';
		const summaryParts = [
			`📚 书架共 ${metaDataArr.length} 本 · 本次处理 ${total} 本`,
			failures.length > 0 ? `⚠️ ${failures.length} 本同步失败` : '',
			lastError ?? '',
			`⏱ 耗时 ${syncTimeInSeconds.toFixed(1)} 秒`
		].filter(Boolean);
		titleEl.setText(summaryParts.join(' · '));
		setTimeout(() => progressNotice.hide(), 5000);
		return syncedNotebooks;
	}

	public async syncNotesToJounal(journalDate: string) {
		const metaDataArr = await this.getALlMetadata();
		await this.saveToJounal(journalDate, metaDataArr);
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

		const highlightResp = await this.apiManager.getNotebookHighlights(metaData.bookId, metaData.bookType === 3);
		const reviewResp = await this.apiManager.getNotebookReviews(metaData.bookId, metaData.bookType === 3);
		const chapterResp = await this.apiManager.getChapters(metaData.bookId, metaData.bookType === 3);

		// 处理 V1 API 返回 undefined 的情况（如 Cookie 无效）
		if (!highlightResp || !chapterResp) {
			console.warn(`[weread plugin] 获取书籍数据失败: ${metaData.title}, bookType=${metaData.bookType}`);
			if (metaData.bookType === 3) {
				throw new Error(`公众号"${metaData.title}"数据获取失败，请检查 Cookie 是否有效（需扫码登录）`);
			}
			throw new Error(`书籍"${metaData.title}"数据获取失败`);
		}

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
		const bookReview = parseChapterReviews(reviewResp, chapters);

		let popularHighlights: PopularChapterHighlight[] = [];

		if (get(settingsStore).syncPopularHighlightsToggle) {
			// 构建章节信息
			const chaptersInfo = chapters.map((c) => ({
				chapterUid: c.chapterUid ?? 0,
				chapterIdx: c.chapterIdx ?? 0,
				title: c.title
			}));

			// 获取热门划线（缓存优先 + 并发查询）
			popularHighlights = await this.getPopularHighlights(metaData.bookId, chaptersInfo);

			// 合并热门划线到章节划线中
			const popularByChapter = new Map<number, PopularHighlight[]>();
			for (const chapter of popularHighlights) {
				popularByChapter.set(chapter.chapterUid, chapter.highlights);
			}

			for (const chapter of chapterHighlightReview) {
				const chapterPopular = popularByChapter.get(chapter.chapterUid ?? 0) ?? [];
				if (chapterPopular.length === 0) continue;

				const existingHighlights = chapter.highlights ?? [];
				const userRangeSet = new Set(existingHighlights.map((h) => h.range));

				// 已有划线与热门重叠：标记为热门并加人数，同时标记为用户划线
				for (const h of existingHighlights) {
					const match = chapterPopular.find((p) => p.range === h.range);
					if (match) {
						h.isPopular = true;
						h.popularCount = match.totalCount;
					}
					h.isUserHighlight = true;
				}

				// 热门划线中用户未标注的：追加为新 Highlight
				for (const p of chapterPopular) {
					if (!userRangeSet.has(p.range)) {
						existingHighlights.push({
							bookmarkId: p.bookmarkId?.replace(/[_~]/g, '-'),
							created: 0,
							createTime: '',
							chapterUid: chapter.chapterUid ?? 0,
							chapterIdx: chapter.chapterIdx ?? 0,
							chapterTitle: chapter.chapterTitle,
							markText: p.markText,
							style: 0,
							colorStyle: 0,
							range: p.range,
							isPopular: true,
							popularCount: p.totalCount,
							isUserHighlight: false
						});
					}
				}

				// 按 range 起始位置重新排序
				chapter.highlights = existingHighlights.sort((a, b) => {
					return (parseInt(a.range.split('-')[0]) || 0) - (parseInt(b.range.split('-')[0]) || 0);
				});
			}
		}
		return {
			metaData: metaData,
			chapterHighlights: chapterHighlightReview,
			bookReview: bookReview,
			popularHighlights: popularHighlights
		};
	}

	/**
	 * 获取热门划线（支持缓存 + 并发查询）
	 */
	private async getPopularHighlights(
		bookId: string,
		chapters: { chapterUid: number; chapterIdx: number; title: string }[]
	): Promise<PopularChapterHighlight[]> {
		// 1. 尝试从缓存获取
		const cached = await this.cacheManager.get(bookId);
		if (cached) {
			return this.groupPopularByChapter(cached.items, cached.chapters);
		}

		// 2. 缓存未命中，使用并发批量获取
		const chapterUids = chapters.map((c) => c.chapterUid);
		const popularByChapter = await this.apiManager.getBestBookmarksBatch(bookId, chapterUids, 5);

		// 3. 转换为数组格式
		const items: {
			bookmarkId: string;
			chapterUid: number;
			chapterTitle: string;
			range: string;
			markText: string;
			totalCount: number;
		}[] = [];
		const chapterMap = new Map(chapters.map((c) => [c.chapterUid, c]));

		for (const [chapterUid, highlights] of popularByChapter) {
			const chapterInfo = chapterMap.get(chapterUid);
			for (const h of highlights) {
				items.push({
					bookmarkId: h.bookmarkId?.replace(/[_~]/g, '-'),
					chapterUid,
					chapterTitle: chapterInfo?.title ?? '',
					range: h.range,
					markText: h.markText,
					totalCount: h.totalCount
				});
			}
		}

		// 缓存章节类型（包含 bookId）
		type CacheChapter = { bookId: string; chapterUid: number; chapterIdx: number; title: string };

		// 4. 写入缓存
		const cacheChapters: CacheChapter[] = chapters.map((c) => ({
			bookId,
			chapterUid: c.chapterUid,
			chapterIdx: c.chapterIdx,
			title: c.title
		}));
		await this.cacheManager.set(bookId, items as PopularHighlight[], cacheChapters);

		// 5. 按章节分组返回
		return this.groupPopularByChapter(items as PopularHighlight[], cacheChapters);
	}

	/**
	 * 按章节分组热门划线
	 */
	private groupPopularByChapter(
		items: PopularHighlight[],
		chapters: { bookId?: string; chapterUid: number; chapterIdx: number; title: string }[]
	): PopularChapterHighlight[] {
		const chapterMap = new Map(chapters.map((c) => [c.chapterUid, c]));
		const grouped = new Map<number, PopularChapterHighlight>();

		for (const item of items) {
			// Normalize bookmarkId: replace _/~ with - for Obsidian block reference compatibility
			item.bookmarkId = item.bookmarkId?.replace(/[_~]/g, '-');
			if (!grouped.has(item.chapterUid)) {
				const chapterInfo = chapterMap.get(item.chapterUid);
				grouped.set(item.chapterUid, {
					chapterUid: item.chapterUid,
					chapterIdx: chapterInfo?.chapterIdx ?? 0,
					chapterTitle: chapterInfo?.title ?? item.chapterTitle,
					highlights: []
				});
			}
			grouped.get(item.chapterUid).highlights.push(item);
		}

		return Array.from(grouped.values());
	}

	private async filterNoteMetas(force = false, metaDataArr: Metadata[]): Promise<Metadata[]> {
		const localFiles: AnnotationFile[] = await this.fileManager.getNotebookFiles();
		const duplicateBookSet = this.getDuplicateBooks(metaDataArr);
		const settingsFilteredMetaArr = this.filterMetasByCurrentSettings(metaDataArr, true);
		const filterMetaArr: Metadata[] = [];
		for (const metaData of settingsFilteredMetaArr) {
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

	private filterMetasByCurrentSettings(metaDataArr: Metadata[], logSkipped = false): Metadata[] {
		const settings = get(settingsStore);
		const filterContext = createSyncFilterContext(settings);
		return metaDataArr.filter((metaData) => {
			const syncFilter = evaluateMetadataSyncFilter(metaData, filterContext);
			if (syncFilter.includedByCurrentSettings) {
				return true;
			}
			if (logSkipped) {
				console.debug(
					`[weread plugin] skip book ${
						metaData.title
					}, reasons: ${syncFilter.reasonLabels.join(', ')}`
				);
			}
			return false;
		});
	}

	private async getALlMetadata() {
		const notebookResp = await this.apiManager.getNotebooksWithRetry();
		const metaDataArr = notebookResp.map((noteBook) => parseMetadata(noteBook));
		return metaDataArr;
	}

	private async saveToJounal(
		journalDate: string,
		metaDataArr: Metadata[],
		signal?: { cancelled: boolean }
	) {
		if (!get(settingsStore).dailyNotesToggle) return;
		const metaDataArrInDate = this.filterMetasByCurrentSettings(metaDataArr).filter(
			(meta) => meta.lastReadDate === journalDate
		);

		const notebooksInDate = [];
		for (const meta of metaDataArrInDate) {
			if (signal?.cancelled) return;
			const notebook = await this.convertToNotebook(meta);
			notebooksInDate.push(notebook);
		}

		if (!signal?.cancelled && get(settingsStore).dailyNotesToggle) {
			const dailyNoteRefereneces = parseDailyNoteReferences(notebooksInDate);
			const dailyNotePath = this.fileManager.getDailyNotePath(window.moment());
			console.log(
				'get daily note path',
				dailyNotePath,
				' size:',
				dailyNoteRefereneces.length
			);
			await this.fileManager.saveDailyNotes(dailyNotePath, dailyNoteRefereneces);
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

	private async syncMetadata(meta: Metadata): Promise<string | null> {
		let stage = 'fetch/parse';
		try {
			const notebook = await this.convertToNotebook(meta);
			stage = 'save';
			return await this.fileManager.saveNotebook(notebook);
		} catch (cause) {
			stage = (cause as { stage?: string })?.stage ?? stage;
			const message = cause instanceof Error ? cause.message : String(cause);
			throw Object.assign(
				new Error(`《${meta.title}》 (${meta.bookId}) ${stage}: ${message}`),
				{
					stage,
					cause
				}
			);
		}
	}
}
