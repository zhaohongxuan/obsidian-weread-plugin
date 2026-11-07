import { requestUrl, RequestUrlParam } from 'obsidian';
import { settingsStore } from './settings';
import { get } from 'svelte/store';
import { WEREAD_SKILL_VERSION, assertWereadProtocol, WereadUpgradeRequiredError } from './wereadProtocol';

import type { ShelfSyncResponse } from './bookshelf';

class ApiV2Manager {
	private readonly gatewayUrl: string = 'https://i.weread.qq.com/api/agent/gateway';

	private async callAgent<T>(
		apiName: string,
		params: Record<string, unknown> = {},
		strict = false
	): Promise<T | undefined> {
		const settings = get(settingsStore);

		if (!settings.wereadApiKey) {
			if (strict) throw new Error('API Key 未配置，请在设置中填写。');
			console.error('API Key 未配置，请在设置中填写。');
			return undefined;
		}

		const req: RequestUrlParam = {
			url: this.gatewayUrl,
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				Authorization: `Bearer ${settings.wereadApiKey}`
			},
			body: JSON.stringify({
				...params,
				api_name: apiName,
				skill_version: WEREAD_SKILL_VERSION
			})
		};

		try {
			const resp = await requestUrl(req);
			assertWereadProtocol(resp.json);
			if (resp.json?.errcode && Number(resp.json.errcode) !== 0) {
				throw new Error(resp.json.errmsg || `微信读书接口错误 (${resp.json.errcode})`);
			}
			return resp.json as T;
		} catch (e) {
			if (strict || e instanceof WereadUpgradeRequiredError) throw e;
			console.error(`Agent API 调用失败: ${apiName}`, e);
			return undefined;
		}
	}

	async getShelf(): Promise<ShelfSyncResponse> {
		const shelf = await this.callAgent<ShelfSyncResponse>('/shelf/sync', {}, true);
		if (!shelf || !Array.isArray(shelf.books)) {
			throw new Error('书架数据格式异常，请稍后刷新重试');
		}
		return shelf;
	}

	async getBook(bookId: string) {
		return this.callAgent('/book/info', { bookId });
	}

	async getNotebookHighlights(bookId: string) {
		return this.callAgent('/book/bookmarklist', { bookId }, true);
	}

	async getProgress(bookId: string) {
		return this.callAgent('/book/getprogress', { bookId }, true);
	}

	async getReadingStats(mode: string, baseTime?: number) {
		const params: Record<string, unknown> = { mode };
		if (baseTime !== undefined) params.baseTime = baseTime;
		return this.callAgent('/readdata/detail', params);
	}

	async getChapters(bookId: string) {
		const result = await this.callAgent<{
			bookId: string;
			synckey: number;
			chapterUpdateTime: number;
			chapters: any[];
		}>('/book/chapterinfo', { bookId });

		if (!result) return undefined;

		// V2 返回 { chapters: [] }，转换为 V1 格式 { data: [{ updated: [] }] }
		return {
			data: [
				{
					bookId: result.bookId,
					chapterUpdateTime: result.chapterUpdateTime,
					updated: result.chapters
				}
			]
		};
	}

	async getNotebookReviews(bookId: string) {
		const reviews = new Map<string, any>();
		const cursors = new Set<number>();
		let synckey = 0;
		for (let pageIndex = 0; pageIndex < 1000; pageIndex++) {
			cursors.add(synckey);
			const page = await this.callAgent<{
				reviews: any[];
				hasMore?: number | string | boolean;
				synckey?: number | string;
				totalCount?: number;
			}>('/review/list/mine', { bookid: bookId, synckey, count: 100 }, true);
			if (!page || !Array.isArray(page.reviews))
				throw new Error('想法列表加载失败，未返回完整数据');
			for (const item of page.reviews) {
				const id = item?.review?.reviewId ?? item?.reviewId;
				if (id === undefined || id === null || String(id) === '')
					throw new Error('想法列表缺少唯一标识');
				reviews.set(String(id), item);
			}
			if (Number(page.hasMore) !== 1) {
				if (Number(page.totalCount) > reviews.size)
					throw new Error('想法列表不完整，请稍后重试');
				return { ...page, reviews: Array.from(reviews.values()), hasMore: 0 };
			}
			const next =
				page.synckey === undefined || page.synckey === null ? NaN : Number(page.synckey);
			if (!page.reviews.length || !Number.isFinite(next) || cursors.has(next)) {
				throw new Error('想法分页游标异常，已停止加载以避免遗漏');
			}
			synckey = next;
		}
		throw new Error('想法分页过多，请稍后重试');
	}

	async getBestBookmarks(bookId: string, chapterUid = 0) {
		return this.callAgent<{
			synckey: number;
			totalCount: number;
			items: {
				bookId: string;
				bookmarkId: string;
				chapterUid: number;
				range: string;
				markText: string;
				totalCount: number;
			}[];
			chapters: { bookId: string; chapterUid: number; chapterIdx: number; title: string }[];
		}>('/book/bestbookmarks', { bookId, chapterUid });
	}

	async getPublicReviews(bookId: string) {
		return this.callAgent('/review/list', {
			bookId,
			reviewListType: 0,
			count: 30
		});
	}

	async getUserInfo(userVid: string) {
		return this.callAgent('/user/info', { userVid });
	}

	/**
	 * 获取当前 API Key 对应的用户信息
	 * 通过 /_list + /review/list/mine 的 author 字段提取
	 */
	async getCurrentUser(): Promise<Record<string, unknown> | undefined> {
		// 先从书架拿一个 bookId
		const shelf = await this.callAgent<{ books: any[] }>('/_list');
		if (!shelf?.books?.length) {
			console.warn('[weread plugin] getCurrentUser: 书架为空');
			return undefined;
		}

		// 遍历书架中的书，找到有评论的书，从中提取 author 信息
		const booksToTry = shelf.books.slice(0, 10);
		for (const book of booksToTry) {
			const result = await this.callAgent<{
				reviews?: any[];
				totalCount?: number;
			}>('/review/list/mine', { bookid: book.bookId, count: 1 });

			if (result?.reviews?.length) {
				const author = result.reviews[0]?.review?.author;
				if (author?.name) {
					return author;
				}
			}
		}

		console.warn('[weread plugin] getCurrentUser: 前 10 本书均无评论');
		return undefined;
	}

	/**
	 * 校验 API Key 有效性（轻量级调用 /_list）
	 */
	async validateApiKey(): Promise<{ valid: boolean }> {
		const result = await this.callAgent<{ errcode?: number }>('/_list');
		return { valid: result != null && (result.errcode === undefined || result.errcode === 0) };
	}

	/**
	 * 获取笔记本列表（所有有笔记/在书架的书）
	 * 格式与 V1 /api/user/notebook 兼容
	 * 自动处理分页，每页 300 本
	 */
	async getNotebooks() {
		const books = new Map<string, any>();
		const cursors = new Set<number>();
		let lastSort: number | undefined;
		for (let pageIndex = 0; pageIndex < 1000; pageIndex++) {
			const params: Record<string, unknown> = { count: 300 };
			if (lastSort !== undefined) params.lastSort = lastSort;
			const page = await this.callAgent<{
				books: any[];
				hasMore?: number | string | boolean;
			}>('/user/notebooks', params, true);
			if (!page || !Array.isArray(page.books))
				throw new Error('笔记本列表加载失败，未返回完整数据');
			for (const item of page.books) {
				const id = item?.bookId ?? item?.book?.bookId;
				if (id === undefined || id === null || String(id) === '')
					throw new Error('笔记本列表缺少书籍标识');
				books.set(String(id), item);
			}
			if (Number(page.hasMore) !== 1) return { books: Array.from(books.values()) };
			const rawCursor = page.books[page.books.length - 1]?.sort;
			const next = rawCursor === undefined || rawCursor === null ? NaN : Number(rawCursor);
			if (!page.books.length || !Number.isFinite(next) || cursors.has(next)) {
				throw new Error('笔记本分页游标异常，已停止加载以避免遗漏');
			}
			cursors.add(next);
			lastSort = next;
		}
		throw new Error('笔记本分页过多，请稍后重试');
	}
}

export default ApiV2Manager;
