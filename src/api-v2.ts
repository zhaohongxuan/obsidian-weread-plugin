import { requestUrl, RequestUrlParam } from 'obsidian';
import { settingsStore } from './settings';
import { get } from 'svelte/store';

class ApiV2Manager {
	private readonly gatewayUrl: string = 'https://i.weread.qq.com/api/agent/gateway';

	private async callAgent<T>(apiName: string, params: Record<string, unknown> = {}): Promise<T | undefined> {
		const settings = get(settingsStore);

		if (!settings.wereadApiKey) {
			console.error('API Key 未配置，请在设置中填写。');
			return undefined;
		}

		const req: RequestUrlParam = {
			url: this.gatewayUrl,
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'Authorization': `Bearer ${settings.wereadApiKey}`
			},
			body: JSON.stringify({
				api_name: apiName,
				skill_version: '1.0.3',
				...params
			})
		};

		try {
			const resp = await requestUrl(req);
			if (resp.json?.errcode && resp.json.errcode !== 0) {
				console.error(`Agent API 错误: ${resp.json.errmsg}`);
				return undefined;
			}
			return resp.json as T;
		} catch (e) {
			console.error(`Agent API 调用失败: ${apiName}`, e);
			return undefined;
		}
	}

	async getBook(bookId: string) {
		return this.callAgent('/book/info', { bookId });
	}

	async getNotebookHighlights(bookId: string) {
		return this.callAgent('/book/bookmarklist', { bookId });
	}

	async getProgress(bookId: string) {
		return this.callAgent('/book/getprogress', { bookId });
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
			data: [{
				bookId: result.bookId,
				chapterUpdateTime: result.chapterUpdateTime,
				updated: result.chapters
			}]
		};
	}

	async getNotebookReviews(bookId: string) {
		return this.callAgent('/review/list/mine', {
			bookid: bookId,
			synckey: 0
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
		return { valid: result?.errcode === undefined || result?.errcode === 0 };
	}

	/**
	 * 获取笔记本列表（所有有笔记/在书架的书）
	 * 格式与 V1 /api/user/notebook 兼容
	 * 自动处理分页，每页 200 本
	 */
	async getNotebooks() {
		const PAGE_SIZE = 200;
		let allBooks: any[] = [];
		let lastSort: number | undefined;

		do {
			const params: Record<string, unknown> = { count: PAGE_SIZE };
			if (lastSort !== undefined) params.lastSort = lastSort;

			const page = await this.callAgent<{
				books: any[];
				hasMore: number;
			}>('/user/notebooks', params);

			if (!page?.books) break;

			allBooks = allBooks.concat(page.books);

			if (page.hasMore !== 1) break;

			// 取本页最后一条的 sort 作为下一页的游标
			const lastBook = page.books[page.books.length - 1];
			lastSort = lastBook?.sort;
		} while (lastSort !== undefined);

		return { books: allBooks };
	}
}

export default ApiV2Manager;
