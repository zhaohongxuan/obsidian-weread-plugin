import { Platform, requestUrl } from 'obsidian';
import { getCookieString } from './utils/cookiesUtil';
import type { ShelfSyncResponse } from './bookshelf';
import ApiManager from './api';
import ApiV2Manager from './api-v2';
import { settingsStore } from './settings';
import { get } from 'svelte/store';
import { WereadUpgradeRequiredError } from './wereadProtocol';
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

	private shelfCache?: { key: string; expiresAt: number; shelf: ShelfSyncResponse };
	private shelfRequest?: { key: string; promise: Promise<ShelfSyncResponse> };

	async getShelf(force = false): Promise<ShelfSyncResponse> {
		const settings = get(settingsStore);
		const key = JSON.stringify([
			settings.wereadApiKey,
			settings.cookies,
			settings.isCookieValid
		]);
		if (this.shelfCache?.key !== key) this.shelfCache = undefined;
		if (!force && this.shelfCache && this.shelfCache.expiresAt > Date.now()) {
			return this.shelfCache.shelf;
		}
		if (this.shelfRequest?.key === key) return this.shelfRequest.promise;
		const promise = (async () => {
			// An explicitly configured API key is authoritative; do not silently show
			// another Cookie account's shelf after an API key authentication failure.
			const shelf = settings.wereadApiKey
				? await this.v2Manager.getShelf()
				: await this.getCookieShelf();
			const current = get(settingsStore);
			if (
				key ===
				JSON.stringify([current.wereadApiKey, current.cookies, current.isCookieValid])
			) {
				this.shelfCache = { key, expiresAt: Date.now() + 60_000, shelf };
			}
			return shelf;
		})();
		this.shelfRequest = { key, promise };
		try {
			return await promise;
		} finally {
			if (this.shelfRequest?.promise === promise) this.shelfRequest = undefined;
		}
	}

	private async getCookieShelf(): Promise<ShelfSyncResponse> {
		for (let attempt = 0; attempt < 2; attempt++) {
			const settings = get(settingsStore);
			if (!settings.cookies.length) throw new Error('请先配置 API Key 或登录微信读书');
			const cookie = Platform.isDesktopApp
				? getCookieString(settings.cookies)
				: settings.cookies
						.map((item) => `${item.name}=${encodeURIComponent(item.value)}`)
						.join(';');
			const userVid =
				settings.userVid || settings.cookies.find((item) => item.name === 'wr_vid')?.value;
			const resp = await requestUrl({
				url: `https://i.weread.qq.com/shelf/sync?userVid=${encodeURIComponent(userVid || '')}&synckey=0&lectureSynckey=0`,
				method: 'GET',
				throw: false,
				headers: {
					Cookie: cookie,
					Referer: 'https://weread.qq.com/',
					'User-Agent': 'Mozilla/5.0',
					Accept: 'application/json'
				}
			});
			const data = resp.json;
			if (resp.status === 401 || Number(data?.errcode) === -2012) {
				if (attempt === 0 && (await this.v1Manager.refreshCookie())) continue;
				throw new Error('Cookie 已失效，请重新登录或配置 API Key');
			}
			if (resp.status >= 400 || (data?.errcode && Number(data.errcode) !== 0)) {
				throw new Error(
					data?.errmsg || `书架请求失败 (${resp.status})，可尝试配置 API Key`
				);
			}
			if (!Array.isArray(data?.books))
				throw new Error('Cookie 书架接口未返回完整数据，请配置 API Key 后重试');
			return data as ShelfSyncResponse;
		}
		throw new Error('书架加载失败，请稍后重试');
	}

	private useV2(): boolean {
		const settings = get(settingsStore);
		return Boolean(settings.wereadApiKey);
	}

	/**
	 * 判断是否为公众号类型（bookType === 3）
	 * 公众号类型必须使用 V1 接口（依赖 Cookie）
	 */
	private isArticleBook(bookId: string): boolean {
		const settings = get(settingsStore);
		// 通过书架缓存或实时检查判断是否为公众号
		// 这里简单通过 bookId 特征判断，公众号 bookId 通常以特定格式存在
		// 实际使用时通过 metaData.bookType 判断
		return false;
	}

	async getBook(bookId: string): Promise<BookDetailResponse | undefined> {
		if (this.useV2()) {
			try {
				const result = await this.v2Manager.getBook(bookId);
				if (result) return result as BookDetailResponse;
			} catch (e) {
				if (e instanceof WereadUpgradeRequiredError) throw e;
				console.warn('V2 getBook 调用失败，回退到 V1', e);
			}
		}
		return this.v1Manager.getBook(bookId);
	}

	async getNotebookHighlights(
		bookId: string,
		isArticle = false
	): Promise<HighlightResponse | undefined> {
		// 公众号类型强制使用 V1 接口（依赖 Cookie）
		if (isArticle) {
			console.log('[weread plugin] 公众号类型，强制使用 V1 接口获取划线');
			return this.v1Manager.getNotebookHighlights(bookId);
		}

		if (this.useV2()) {
			const result = await this.v2Manager.getNotebookHighlights(bookId);
			if (
				!result ||
				typeof result !== 'object' ||
				!('updated' in result) ||
				!Array.isArray(result.updated)
			) {
				throw new Error('微信读书划线数据不完整，请刷新重试');
			}
			return result as HighlightResponse;
		}
		return this.v1Manager.getNotebookHighlights(bookId);
	}

	async getNotebookReviews(
		bookId: string,
		isArticle = false
	): Promise<BookReviewResponse | undefined> {
		// 公众号类型强制使用 V1 接口（依赖 Cookie）
		if (isArticle) {
			console.log('[weread plugin] 公众号类型，强制使用 V1 接口获取笔记');
			return this.v1Manager.getNotebookReviews(bookId);
		}

		if (this.useV2()) {
			return (await this.v2Manager.getNotebookReviews(bookId)) as BookReviewResponse;
		}
		return this.v1Manager.getNotebookReviews(bookId);
	}

	async getChapters(bookId: string, isArticle = false): Promise<ChapterResponse | undefined> {
		// 公众号类型强制使用 V1 接口（依赖 Cookie）
		if (isArticle) {
			console.log('[weread plugin] 公众号类型，强制使用 V1 接口获取章节');
			return this.v1Manager.getChapters(bookId);
		}

		if (this.useV2()) {
			try {
				const result = await this.v2Manager.getChapters(bookId);
				if (result) return result as ChapterResponse;
			} catch (e) {
				if (e instanceof WereadUpgradeRequiredError) throw e;
				console.warn('V2 getChapters 调用失败，回退到 V1', e);
			}
		}
		return this.v1Manager.getChapters(bookId);
	}

	async getProgress(bookId: string): Promise<BookProgressResponse | undefined> {
		if (this.useV2()) {
			return (await this.v2Manager.getProgress(bookId)) as BookProgressResponse;
		}
		return this.v1Manager.getProgress(bookId);
	}

	async getBookReadInfo(bookId: string): Promise<BookReadInfoResponse | undefined> {
		// V2 无此端点，直接使用 V1
		return this.v1Manager.getBookReadInfo(bookId);
	}

	async getReadingStats(
		mode: ReadingStatsMode,
		baseTime?: number
	): Promise<ReadingStatsResponse | undefined> {
		if (this.useV2()) {
			try {
				const result = await this.v2Manager.getReadingStats(mode, baseTime);
				if (result) return result as ReadingStatsResponse;
			} catch (e) {
				if (e instanceof WereadUpgradeRequiredError) throw e;
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
				if (e instanceof WereadUpgradeRequiredError) throw e;
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
				if (e instanceof WereadUpgradeRequiredError) throw e;
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
				if (e instanceof WereadUpgradeRequiredError) throw e;
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
	): Promise<
		Map<number, { bookmarkId: string; range: string; markText: string; totalCount: number }[]>
	> {
		const results = new Map<
			number,
			{ bookmarkId: string; range: string; markText: string; totalCount: number }[]
		>();

		for (let i = 0; i < chapterUids.length; i += batchSize) {
			const batch = chapterUids.slice(i, i + batchSize);
			const promises = batch.map(async (chapterUid) => {
				try {
					const resp = await this.getBestBookmarks(bookId, chapterUid);
					return { chapterUid, items: resp?.items ?? [] };
				} catch (e) {
					if (e instanceof WereadUpgradeRequiredError) throw e;
					throw { chapterUid, error: e };
				}
			});

			const settled = await Promise.allSettled(promises);
			for (const result of settled) {
				if (result.status === 'fulfilled') {
					results.set(result.value.chapterUid, result.value.items);
				} else {
					const { chapterUid } = result.reason as { chapterUid: number; error: unknown };
					console.warn(
						`[weread plugin] 获取章节热门划线失败: chapterUid=${chapterUid}`,
						result.reason
					);
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
				if (e instanceof WereadUpgradeRequiredError) throw e;
				console.warn('V2 getPublicReviews 调用失败，回退到 V1', e);
			}
		}
		return undefined;
	}

	async getNotebooks() {
		if (this.useV2()) return (await this.v2Manager.getNotebooks()).books;
		return this.v1Manager.getNotebooks();
	}

	async getNotebooksWithRetry() {
		if (this.useV2()) return (await this.v2Manager.getNotebooks()).books;
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
	async fetchApiKey(): Promise<{
		apikey: string;
		expireTime?: number;
		lastUsedTime?: number;
		createdAt?: number;
		lastUsedAt?: number;
	} | null> {
		return this.v1Manager.fetchAndSaveApiKey();
	}

	/**
	 * 校验 API Key 有效性
	 */
	async validateApiKey(): Promise<{
		valid: boolean;
		expireTime?: number;
		lastUsedTime?: number;
		createdAt?: number;
		lastUsedAt?: number;
	}> {
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
	async callAgentGateway<T = unknown>(
		apiName: string,
		params: Record<string, unknown> = {}
	): Promise<T | undefined> {
		return this.v1Manager.callAgentGateway<T>(apiName, params) as Promise<T | undefined>;
	}
}

export default ApiRouter;
