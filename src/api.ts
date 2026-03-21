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
		try {
			const req: RequestUrlParam = {
				url: this.baseUrl,
				method: 'HEAD',
				headers: this.getHeaders()
			};
			const resp = await requestUrl(req);
			const respCookie: string = resp.headers['set-cookie'] || resp.headers['Set-Cookie'];

			if (respCookie !== undefined && this.checkCookies(respCookie)) {
				if (showNotice) {
					new Notice('Cookie 刷新成功');
				}
				this.updateCookies(respCookie);
				settingsStore.actions.setIsCookieValid(true);
				return true;
			} else if (respCookie === undefined) {
				// 没有 set-cookie，说明 Cookie 已是最新
				if (showNotice) {
					new Notice('Cookie 已是最新，无须刷新');
				}
				settingsStore.actions.setIsCookieValid(true);
				return true;
			}
		} catch (e) {
			console.error('[weread plugin] Cookie 刷新 HEAD 请求失败', e);
		}

		const loginMethod = get(settingsStore).loginMethod;
		if (loginMethod === 'cookieCloud') {
			const cookieCloudManager = new CookieCloudManager();
			const isSuccess = await cookieCloudManager.getCookie();
			if (isSuccess) {
				// CookieCloud 获取成功后，更新刷新时间
				settingsStore.actions.updateCookieRefreshTime();
				return true;
			}
		}

		// HEAD did not yield new cookies — verify actual validity via authenticated API
		const isValid = await this.verifyCookieValidity();
		if (isValid) {
			// API 验证成功，提示用户 Cookie 已是最新
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
			return '\\u' + ('0000' + codeHex).substr(codeHex.length, 4);
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

	private checkCookies(respCookie: string): boolean {
		let refreshCookies: Cookie[];
		if (Array.isArray(respCookie)) {
			refreshCookies = parse(respCookie);
		} else {
			const arrCookies = splitCookiesString(respCookie);
			refreshCookies = parse(arrCookies);
		}

		const wrName = refreshCookies.find((cookie) => cookie.name == 'wr_name');
		return wrName !== undefined && wrName.value !== '';
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
}
