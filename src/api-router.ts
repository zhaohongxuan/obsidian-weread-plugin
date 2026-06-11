import ApiManager from './api';
import ApiV2Manager from './api-v2';
import { settingsStore } from './settings';
import { get } from 'svelte/store';
import type {
	HighlightResponse,
	BookReviewResponse,
	ChapterResponse,
	BookReadInfoResponse,
	BookDetailResponse,
	BookProgressResponse,
	ReadingStatsResponse,
	ReadingStatsMode
} from './models';

class ApiRouter {
	private readonly v1Manager: ApiManager;
	private readonly v2Manager: ApiV2Manager;

	constructor() {
		this.v1Manager = new ApiManager();
		this.v2Manager = new ApiV2Manager();
	}

	private useV2(): boolean {
		const settings = get(settingsStore);
		return Boolean(settings.wereadApiKey);
	}

	async getBook(bookId: string): Promise<BookDetailResponse | undefined> {
		if (this.useV2()) {
			try {
				const result = await this.v2Manager.getBook(bookId);
				if (result) return result as BookDetailResponse;
			} catch (e) {
				console.warn('V2 getBook 调用失败，回退到 V1', e);
			}
		}
		return this.v1Manager.getBook(bookId);
	}

	async getNotebookHighlights(bookId: string): Promise<HighlightResponse | undefined> {
		if (this.useV2()) {
			try {
				const result = await this.v2Manager.getNotebookHighlights(bookId);
				if (result) return result as HighlightResponse;
			} catch (e) {
				console.warn('V2 getNotebookHighlights 调用失败，回退到 V1', e);
			}
		}
		return this.v1Manager.getNotebookHighlights(bookId);
	}

	async getNotebookReviews(bookId: string): Promise<BookReviewResponse | undefined> {
		if (this.useV2()) {
			try {
				const result = await this.v2Manager.getNotebookReviews(bookId);
				if (result) return result as BookReviewResponse;
			} catch (e) {
				console.warn('V2 getNotebookReviews 调用失败，回退到 V1', e);
			}
		}
		return this.v1Manager.getNotebookReviews(bookId);
	}

	async getChapters(bookId: string): Promise<ChapterResponse | undefined> {
		if (this.useV2()) {
			try {
				const result = await this.v2Manager.getChapters(bookId);
				if (result) return result as ChapterResponse;
			} catch (e) {
				console.warn('V2 getChapters 调用失败，回退到 V1', e);
			}
		}
		return this.v1Manager.getChapters(bookId);
	}

	async getProgress(bookId: string): Promise<BookProgressResponse | undefined> {
		if (this.useV2()) {
			try {
				const result = await this.v2Manager.getProgress(bookId);
				if (result) return result as BookProgressResponse;
			} catch (e) {
				console.warn('V2 getProgress 调用失败，回退到 V1', e);
			}
		}
		return this.v1Manager.getProgress(bookId);
	}

	async getBookReadInfo(bookId: string): Promise<BookReadInfoResponse | undefined> {
		// V2 无此端点，直接使用 V1
		return this.v1Manager.getBookReadInfo(bookId);
	}

	async getReadingStats(mode: ReadingStatsMode, baseTime?: number): Promise<ReadingStatsResponse | undefined> {
		if (this.useV2()) {
			try {
				const result = await this.v2Manager.getReadingStats(mode, baseTime);
				if (result) return result as ReadingStatsResponse;
			} catch (e) {
				console.warn('V2 getReadingStats 调用失败，回退到 V1', e);
			}
		}
		return this.v1Manager.getReadingStats(mode, baseTime);
	}

	async getUserInfo(userVid: string): Promise<Record<string, unknown> | undefined> {
		if (this.useV2()) {
			try {
				const result = await this.v2Manager.getUserInfo(userVid);
				if (result) return result as Record<string, unknown>;
			} catch (e) {
				console.warn('V2 getUserInfo 调用失败，回退到 V1', e);
			}
		}
		return this.v1Manager.getUserInfo(userVid);
	}

	/**
	 * 获取当前 API Key 对应的用户信息（无需 userVid）
	 */
	async getCurrentUser(): Promise<Record<string, unknown> | undefined> {
		if (this.useV2()) {
			try {
				const result = await this.v2Manager.getCurrentUser();
				if (result) return result as Record<string, unknown>;
			} catch (e) {
				console.warn('V2 getCurrentUser 调用失败', e);
			}
		}
		return undefined;
	}

	async getBestBookmarks(bookId: string, chapterUid?: number) {
		if (this.useV2()) {
			try {
				return await this.v2Manager.getBestBookmarks(bookId, chapterUid);
			} catch (e) {
				console.warn('V2 getBestBookmarks 调用失败', e);
			}
		}
		return undefined;
	}

	/**
	 * 批量获取热门划线（按章节）
	 * @param bookId 书籍 ID
	 * @param chapterUids 章节 UID 数组
	 * @param batchSize 每批数量，默认 5
	 */
	async getBestBookmarksBatch(
		bookId: string,
		chapterUids: number[],
		batchSize = 5
	): Promise<Map<number, { bookmarkId: string; range: string; markText: string; totalCount: number }[]>> {
		const results = new Map<number, { bookmarkId: string; range: string; markText: string; totalCount: number }[]>();

		for (let i = 0; i < chapterUids.length; i += batchSize) {
			const batch = chapterUids.slice(i, i + batchSize);
			const promises = batch.map(async (chapterUid) => {
				try {
					const resp = await this.getBestBookmarks(bookId, chapterUid);
					return { chapterUid, items: resp?.items ?? [] };
				} catch (e) {
					throw { chapterUid, error: e };
				}
			});

			const settled = await Promise.allSettled(promises);
			for (const result of settled) {
				if (result.status === 'fulfilled') {
					results.set(result.value.chapterUid, result.value.items);
				} else {
					const { chapterUid } = result.reason as { chapterUid: number; error: unknown };
					console.warn(`[weread plugin] 获取章节热门划线失败: chapterUid=${chapterUid}`, result.reason);
				}
			}
		}

		return results;
	}

	async getPublicReviews(bookId: string): Promise<BookReviewResponse | undefined> {
		if (this.useV2()) {
			try {
				const result = await this.v2Manager.getPublicReviews(bookId);
				if (result) return result as BookReviewResponse;
			} catch (e) {
				console.warn('V2 getPublicReviews 调用失败，回退到 V1', e);
			}
		}
		return undefined;
	}

	async getNotebooks() {
		if (this.useV2()) {
			try {
				const result = await this.v2Manager.getNotebooks();
				if (result?.books) return result.books;
			} catch (e) {
				console.warn('V2 getNotebooks 调用失败，回退到 V1', e);
			}
		}
		return this.v1Manager.getNotebooks();
	}

	async getNotebooksWithRetry() {
		if (this.useV2()) {
			try {
				const books = await this.v2Manager.getNotebooks();
				if (books?.books) return books.books;
			} catch (e) {
				console.warn('V2 getNotebooksWithRetry 调用失败，回退到 V1', e);
			}
		}
		return this.v1Manager.getNotebooksWithRetry();
	}

	/**
	 * 刷新 Cookie（仅 V1 支持）
	 */
	async refreshCookie(showNotice?: boolean): Promise<boolean> {
		return this.v1Manager.refreshCookie(showNotice);
	}

	/**
	 * 扫码登录后获取 API Key（需要 Cookie，仅 V1 支持）
	 */
	async fetchApiKey(): Promise<{ apikey: string; expireTime?: number; lastUsedTime?: number; createdAt?: number; lastUsedAt?: number } | null> {
		return this.v1Manager.fetchAndSaveApiKey();
	}

	/**
	 * 校验 API Key 有效性
	 */
	async validateApiKey(): Promise<{ valid: boolean; expireTime?: number; lastUsedTime?: number; createdAt?: number; lastUsedAt?: number }> {
		if (this.useV2()) {
			const result = await this.v2Manager.validateApiKey();
			return result;
		}
		// 无 API Key 时通过 Cookie 校验
		const cookieValid = await this.v1Manager.verifyCookieValidity();
		return { valid: cookieValid };
	}

	/**
	 * 验证 Cookie 有效性（仅 V1 支持）
	 */
	async verifyCookieValidity(): Promise<boolean> {
		return this.v1Manager.verifyCookieValidity();
	}

	/**
	 * 通过 Agent API Gateway 直接调用（V1 中的 callAgentGateway）
	 */
	async callAgentGateway<T = unknown>(apiName: string, params: Record<string, unknown> = {}): Promise<T | undefined> {
		return this.v1Manager.callAgentGateway<T>(apiName, params) as Promise<T | undefined>;
	}
}

export default ApiRouter;
