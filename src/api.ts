import { Notice, requestUrl, RequestUrlParam, Platform } from 'obsidian';
import { settingsStore } from './settings';
import { get } from 'svelte/store';
import { getCookieString } from './utils/cookiesUtil';
import { Cookie, parse, splitCookiesString } from 'set-cookie-parser';
import {
	HighlightResponse,
	BookReviewResponse,
	ChapterResponse,
	BookReadInfoResponse,
	BookDetailResponse,
	BookProgressResponse
} from './models';
import type { ReadingStatsResponse, ReadingStatsMode } from './models';
import CookieCloudManager from './cookieCloud';
export default class ApiManager {
	readonly baseUrl: string = 'https://weread.qq.com';

	private getHeaders() {
		let cookieString = getCookieString(get(settingsStore).cookies);

		// 根据平台选择合适的 User-Agent
		// Mac 版 Obsidian 会截断长的 User-Agent，所以使用短版本
		// iOS 版 Obsidian 会保留完整 User-Agent，所以也使用短版本保持一致
		const userAgent =
			'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko)';

		const headers: Record<string, string> = {
			'User-Agent': userAgent,
			'Accept-Encoding': 'gzip, deflate',
			'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
			accept: 'application/json, text/plain, */*',
			'Content-Type': 'application/json'
		};

		if (cookieString) {
			// iOS 端对中文字符有严格限制，需要 URL 编码处理
			if (!Platform.isDesktopApp) {
				const cookies = get(settingsStore).cookies;
				cookieString = cookies
					.map((cookie) => {
						return cookie.name + '=' + encodeURIComponent(cookie.value);
					})
					.join(';');
				console.log('[weread plugin] iOS 端使用 URL 编码的 Cookie');
			}

			headers['Cookie'] = cookieString;
		}

		return headers;
	}

	async refreshCookie(showNotice = false): Promise<boolean> {
		// Step 1: HEAD request to refresh cookies via set-cookie header
		// This does NOT set isCookieValid — only the API verification below is authoritative
		try {
			const req: RequestUrlParam = {
				url: this.baseUrl,
				method: 'HEAD',
				headers: this.getHeaders()
			};
			const resp = await requestUrl(req);
			const respCookie: string = resp.headers['set-cookie'] || resp.headers['Set-Cookie'];

			if (respCookie !== undefined) {
				this.updateCookies(respCookie);
			}
		} catch (e) {
			console.error('[weread plugin] Cookie 刷新 HEAD 请求失败', e);
		}

		// Step 2: If no cookies available, try CookieCloud as fallback
		const currentCookies = get(settingsStore).cookies;
		if (currentCookies.length === 0) {
			const loginMethod = get(settingsStore).loginMethod;
			if (loginMethod === 'cookieCloud') {
				const cookieCloudManager = new CookieCloudManager();
				await cookieCloudManager.getCookie();
			}
		}

		// Step 3: Always verify via authenticated API — the sole arbiter of isCookieValid
		const isValid = await this.verifyCookieValidity();
		if (isValid) {
			if (showNotice) {
				new Notice('Cookie 已是最新，无须刷新');
			}
		} else {
			const errorMsg = Platform.isDesktopApp
				? 'Cookie 已失效，请重新登录'
				: 'Cookie 已失效，请在电脑端重新登录';
			if (showNotice) {
				new Notice(errorMsg);
			}
			if (Platform.isDesktopApp) {
				settingsStore.actions.clearCookies();
			} else {
				settingsStore.actions.markCookiesInvalid();
			}
		}
		return isValid;
	}

	async verifyCookieValidity(): Promise<boolean> {
		const cookies = get(settingsStore).cookies;
		if (!cookies || cookies.length === 0) {
			console.log('[weread plugin] Cookie 为空，标记无效');
			settingsStore.actions.setIsCookieValid(false);
			return false;
		}

		try {
			const headers = this.getHeaders();
			const req: RequestUrlParam = {
				url: `${this.baseUrl}/api/user/notebook`,
				method: 'GET',
				headers: headers
			};

			const resp = await requestUrl(req);
			// Absorb any session-cookie refresh the server sends back
			const respCookie: string = resp.headers['set-cookie'] || resp.headers['Set-Cookie'];
			if (respCookie) {
				console.log('[weread plugin] 收到新的 set-cookie 响应头，更新 Cookie');
				this.updateCookies(respCookie);
			}

			if (resp.json && resp.json.books !== undefined) {
				console.log('[weread plugin] Cookie 有效，书籍数:', resp.json.books.length);
				settingsStore.actions.setIsCookieValid(true);
				return true;
			}

			if (resp.json && resp.json.errcode === -2012) {
				console.log('[weread plugin] Cookie 超时错误 (-2012)');
				settingsStore.actions.setIsCookieValid(false);
				return false;
			}
		} catch (e: any) {
			console.error('[weread plugin] 验证异常 - 错误信息:', e.message);
			if (e.status === 401) {
				if (Platform.isDesktopApp) {
					console.log('[weread plugin] 桌面端 401，标记 Cookie 无效');
					settingsStore.actions.setIsCookieValid(false);
				} else {
					settingsStore.actions.markCookiesInvalid();
				}
				return false;
			}
		}

		// Network error or ambiguous response — preserve current state and log a warning
		const currentValidity = get(settingsStore).isCookieValid;
		return currentValidity;
	}

	async getNotebooksWithRetry() {
		let noteBookResp: [] = await this.getNotebooks();
		if (noteBookResp === undefined) {
			//retry get notebooks
			noteBookResp = await this.getNotebooks();
		}
		if (noteBookResp === undefined) {
			const errorMsg = Platform.isDesktopApp
				? '长时间未登录，Cookie已失效，请重新扫码登录！'
				: '长时间未登录，Cookie已失效，请在电脑端登录！';
			new Notice(errorMsg);
			if (Platform.isDesktopApp) {
				settingsStore.actions.clearCookies();
			} else {
				settingsStore.actions.markCookiesInvalid();
			}
			throw Error('get weread note book error after retry');
		}
		return noteBookResp;
	}

	async getNotebooks() {
		let noteBooks = [];
		const req: RequestUrlParam = {
			url: `${this.baseUrl}/api/user/notebook`,
			method: 'GET',
			headers: this.getHeaders()
		};

		try {
			const resp = await requestUrl(req);
			if (resp.status === 401) {
				if (resp.json.errcode == -2012) {
					// 登录超时 -2012
					console.log('weread cookie expire retry refresh cookie... ');
					await this.refreshCookie();
				} else {
					if (Platform.isDesktopApp) {
						new Notice('微信读书未登录或者用户异常，请在设置中重新登录！');
					} else {
						new Notice('微信读书未登录或者用户异常，请在电脑端重新登录！');
					}
					console.log(
						'微信读书未登录或者用户异常，请重新登录, http status code:',
						resp.json.errcode
					);
					if (Platform.isDesktopApp) {
						settingsStore.actions.clearCookies();
					} else {
						settingsStore.actions.markCookiesInvalid();
					}
				}
			} else {
				if (resp.json.errcode == -2012) {
					console.log('weread cookie expire retry refresh cookie... ');
					await this.refreshCookie();
				}
			}

			// CookieCloud 请求到的 cookie 时间过长时，需要获取 set-cookie 更新 wr_skey，否则请求 /web 的接口会返回登录超时
			const respCookie: string = resp.headers['set-cookie'] || resp.headers['Set-Cookie'];
			if (respCookie !== undefined) {
				this.updateCookies(respCookie);
			}

			noteBooks = resp.json.books;
		} catch (e: any) {
			if (e.status == 401) {
				console.log(`parse request to cURL for debug: ${this.parseToCurl(req)}`);
				await this.refreshCookie();
			}
		}

		return noteBooks;
	}

	private parseToCurl(req: RequestUrlParam) {
		const command = ['curl'];
		command.push(req.url);
		const requestHeaders = req.headers || {};
		Object.keys(requestHeaders).forEach((name) => {
			command.push('-H');
			command.push(
				this.escapeStringPosix(name.replace(/^:/, '') + ': ' + requestHeaders[name])
			);
		});
		command.push('  --compressed');
		return command.join(' ');
	}

	private escapeStringPosix(str: string) {
		function escapeCharacter(x: string) {
			const code = x.charCodeAt(0);
			if (code < 256) {
				// Add leading zero when needed to not care about the next character.
				return code < 16 ? '\\x0' + code.toString(16) : '\\x' + code.toString(16);
			}
			const codeHex = code.toString(16);
			return '\\u' + ('0000' + codeHex).slice(codeHex.length, codeHex.length + 4);
		}

		if (/[^\x20-\x7E]|'/.test(str)) {
			// Use ANSI-C quoting syntax.
			return (
				"$'" +
				str
					.replace(/\\/g, '\\\\')
					.replace(/'/g, "\\'")
					.replace(/\n/g, '\\n')
					.replace(/\r/g, '\\r')
					.replace(/[^\x20-\x7E]/g, escapeCharacter) +
				"'"
			);
		} else {
			// Use single quote syntax.
			return "'" + str + "'";
		}
	}

	async getBook(bookId: string): Promise<BookDetailResponse | undefined> {
		try {
			const req: RequestUrlParam = {
				url: `${this.baseUrl}/web/book/info?bookId=${bookId}`,
				method: 'GET',
				headers: this.getHeaders()
			};
			const resp = await requestUrl(req);
			if (resp.json.errCode == -2012) {
				// 登录超时 -2012
				console.log('weread cookie expire retry refresh cookie... ');
				await this.refreshCookie();
			}
			return resp.json;
		} catch (e) {
			console.error('get book detail error', e);
		}
	}

	async getNotebookHighlights(bookId: string): Promise<HighlightResponse | undefined> {
		try {
			const req: RequestUrlParam = {
				url: `${this.baseUrl}/web/book/bookmarklist?bookId=${bookId}`,
				method: 'GET',
				headers: this.getHeaders()
			};
			const resp = await requestUrl(req);
			return resp.json;
		} catch (e) {
			console.error('get book highlight error' + bookId, e);
		}
	}

	async getNotebookReviews(bookId: string): Promise<BookReviewResponse | undefined> {
		try {
			const url = `${this.baseUrl}/web/review/list?bookId=${bookId}&listType=11&mine=1&synckey=0`;
			const req: RequestUrlParam = { url: url, method: 'GET', headers: this.getHeaders() };
			const resp = await requestUrl(req);
			return resp.json;
		} catch (e) {
			new Notice(
				'Failed to fetch weread notebook reviews . Please check your Cookies and try again.'
			);
			console.error('get book review error' + bookId, e);
		}
	}


	async getChapters(bookId: string): Promise<ChapterResponse | undefined> {
		try {
			const url = `${this.baseUrl}/web/book/chapterInfos`;
			const reqBody = {
				bookIds: [bookId]
			};

			const req: RequestUrlParam = {
				url: url,
				method: 'POST',
				headers: this.getHeaders(),
				body: JSON.stringify(reqBody)
			};

			const resp = await requestUrl(req);
			return resp.json;
		} catch (e) {
			new Notice(
				'Failed to fetch weread notebook chapters . Please check your Cookies and try again.'
			);
			console.error('get book chapters error' + bookId, e);
		}
	}
	/**
	 * 获取书籍阅读进度信息
	 * @param bookId 书籍ID
	 * @returns 书籍阅读进度信息
	 */
	async getProgress(bookId: string): Promise<BookProgressResponse | undefined> {
		try {
			const url = `${this.baseUrl}/web/book/getProgress?bookId=${bookId}`;
			const req: RequestUrlParam = { url: url, method: 'GET', headers: this.getHeaders() };
			const resp = await requestUrl(req);
			return resp.json;
		} catch (e) {
			new Notice('获取微信读书阅读进度信息失败，请检查您的 Cookies 并重试。');
			console.error('get book progress error for bookId: ' + bookId, e);
		}
	}

	/**
	 * @deprecated 该方法新 API 中已废弃，请使用 getProgress 方法代替
	 */
	async getBookReadInfo(bookId: string): Promise<BookReadInfoResponse | undefined> {
		try {
			const url = `${this.baseUrl}/web/book/readinfo?bookId=${bookId}&readingDetail=1&readingBookIndex=1&finishedDate=1`;
			const req: RequestUrlParam = { url: url, method: 'GET', headers: this.getHeaders() };
			const resp = await requestUrl(req);
			return resp.json;
		} catch (e) {
			new Notice(
				'Failed to fetch weread notebook read info . Please check your Cookies and try again.'
			);
			console.error('get book read info error' + bookId, e);
		}
	}

	private updateCookies(respCookie: string) {
		let refreshCookies: Cookie[];
		if (Array.isArray(respCookie)) {
			refreshCookies = parse(respCookie);
		} else {
			const arrCookies = splitCookiesString(respCookie);
			refreshCookies = parse(arrCookies);
		}
		const cookies = get(settingsStore).cookies;
		cookies.forEach((cookie) => {
			const newCookie = refreshCookies.find((freshCookie) => freshCookie.name == cookie.name);
			if (newCookie) {
				cookie.value = newCookie.value;
			}
		});
		settingsStore.actions.setCookies(cookies);
	}

	/**
	 * 通过 Agent API Gateway 调用微信读书接口（需要 API Key）
	 */
	async callAgentGateway<T = unknown>(apiName: string, params: Record<string, unknown> = {}): Promise<T | undefined> {
		const apiKey = get(settingsStore).wereadApiKey;
		if (!apiKey) {
			new Notice('未配置微信读书 API Key，请在设置中填写');
			return undefined;
		}
		try {
			const body = {
				api_name: apiName,
				skill_version: '1.0.3',
				...params
			};
			const req: RequestUrlParam = {
				url: 'https://i.weread.qq.com/api/agent/gateway',
				method: 'POST',
				headers: {
					'Authorization': `Bearer ${apiKey}`,
					'Content-Type': 'application/json'
				},
				body: JSON.stringify(body)
			};
			const resp = await requestUrl(req);
			if (resp.json?.errcode && resp.json.errcode !== 0) {
				console.error(`[weread plugin] Agent API error: ${resp.json.errmsg}`);
				return undefined;
			}
			return resp.json as T;
		} catch (e) {
			console.error(`[weread plugin] Agent API call failed: ${apiName}`, e);
			return undefined;
		}
	}

	/**
	 * 获取用户个人信息（含个性签名）
	 */
	async getUserInfo(userVid: string): Promise<Record<string, unknown> | undefined> {
		try {
			const resp = await requestUrl({
				url: `https://weread.qq.com/web/user?userVid=${userVid}`,
				method: 'GET',
				headers: this.getHeaders()
			});
			return resp.json;
		} catch (e) {
			console.warn('[weread] getUserInfo failed', e);
			return undefined;
		}
	}

	/**
	 * 获取阅读统计数据
	 */
	async getReadingStats(mode: ReadingStatsMode, baseTime?: number): Promise<ReadingStatsResponse | undefined> {
		const params: Record<string, unknown> = { mode };
		if (baseTime !== undefined) params.baseTime = baseTime;
		return this.callAgentGateway<ReadingStatsResponse>('/readdata/detail', params);
	}
}
