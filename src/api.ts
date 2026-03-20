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
		const cookieString = getCookieString(get(settingsStore).cookies);

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

		// iOS 端可能因为平台特性导致 401，尝试删除可能引起差异的头部
		if (!Platform.isDesktopApp) {
			console.log('[weread plugin] iOS 端 - 移除可能导致差异的头部');
			delete headers['Accept-Encoding'];
		}

		if (cookieString) {
			headers['Cookie'] = cookieString;
			console.log('[weread plugin] 请求头 Cookie 长度:', cookieString.length, '字节');
			console.log(
				'[weread plugin] 平台信息: ' +
					(Platform.isDesktopApp ? 'Mac/Desktop' : 'iOS/Mobile') +
					', User-Agent: ' +
					headers['User-Agent'].substring(0, 50) +
					'...'
			);
		} else {
			console.warn('[weread plugin] 警告: 未找到 Cookie，请求头为空');
		}

		return headers;
	}

	async refreshCookie(): Promise<boolean> {
		try {
			const req: RequestUrlParam = {
				url: this.baseUrl,
				method: 'HEAD',
				headers: this.getHeaders()
			};
			const resp = await requestUrl(req);
			const respCookie: string = resp.headers['set-cookie'] || resp.headers['Set-Cookie'];

			if (respCookie !== undefined && this.checkCookies(respCookie)) {
				new Notice('Cookie 刷新成功');
				this.updateCookies(respCookie);
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
				return true;
			}
		}

		// HEAD did not yield new cookies — verify actual validity via authenticated API
		const isValid = await this.verifyCookieValidity();
		if (!isValid) {
			const errorMsg = Platform.isDesktopApp
				? 'Cookie 已失效，请重新登录'
				: 'Cookie 已失效，请在电脑端重新登录';
			new Notice(errorMsg);
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

		console.log('[weread plugin] 开始验证 Cookie 有效性，Cookie 数量:', cookies.length);

		// 打印每个 Cookie 的详细信息（包括长度和哈希用于调试）
		console.log('[weread plugin] Cookie 详细列表:');
		cookies.forEach((cookie, index) => {
			const displayValue = cookie.value
				? cookie.value.substring(0, 50) + (cookie.value.length > 50 ? '...' : '')
				: '(空)';
			console.log(
				`  ${index + 1}. ${cookie.name} [长度:${cookie.value?.length || 0}]=${displayValue}`
			);
		});

		// 检查关键 Cookie
		const wr_skey = cookies.find((c) => c.name === 'wr_skey');
		const wr_vid = cookies.find((c) => c.name === 'wr_vid');
		const wr_name = cookies.find((c) => c.name === 'wr_name');
		console.log(
			'[weread plugin] 关键 Cookie: wr_skey=' +
				(wr_skey?.value || '❌ 缺失') +
				', wr_vid=' +
				(wr_vid?.value || '❌ 缺失') +
				', wr_name=' +
				(wr_name?.value || '❌ 缺失')
		);

		// 检查系统时间
		const systemTime = new Date();
		console.log('[weread plugin] 系统时间:', systemTime.toISOString());
		const platform = Platform.isDesktopApp ? 'Mac/Desktop' : 'iOS/Mobile';
		console.log('[weread plugin] 平台: ' + platform);

		try {
			const headers = this.getHeaders();
			const req: RequestUrlParam = {
				url: `${this.baseUrl}/api/user/notebook`,
				method: 'GET',
				headers: headers
			};
			console.log('[weread plugin] 发送验证请求到:', req.url);

			// 生成 cURL 命令用于调试 - 提前输出确保被看到
			let curlCmd = `curl ${req.url}`;
			Object.entries(headers).forEach(([key, value]) => {
				const val = String(value);
				if (key === 'Cookie') {
					curlCmd += ` -H 'Cookie: ${val}'`;
				} else if (key.toLowerCase() !== 'accept-encoding') {
					const displayVal = val.substring(0, 80);
					curlCmd += ` -H '${key}: ${displayVal}'`;
				}
			});
			curlCmd += ' --compressed';
			console.log('[weread plugin] === cURL 命令 ===');
			console.log(curlCmd);
			console.log('[weread plugin] === cURL 命令结束 ===');

			console.log(
				'[weread plugin] 请求头详情:',
				JSON.stringify(
					{
						'User-Agent': headers['User-Agent'].substring(0, 60) + '...',
						'Cookie 长度': headers['Cookie']?.length || 0,
						Accept: headers['accept'],
						'Content-Type': headers['Content-Type']
					},
					null,
					2
				)
			);

			const resp = await requestUrl(req);
			console.log(
				'[weread plugin] 验证响应 - 状态码:',
				resp.status,
				', 响应头:',
				JSON.stringify(resp.headers, null, 2)
			);

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

			// 响应状态 2xx 但数据不符合预期
			console.warn(
				'[weread plugin] 响应状态 2xx 但数据不符合预期，响应内容:',
				JSON.stringify(resp.json).substring(0, 200)
			);
		} catch (e: any) {
			console.error('[weread plugin] 验证异常 - 错误信息:', e.message);
			console.error('[weread plugin] 异常 - 状态码:', e.status);

			if (e.status === 401) {
				console.error(
					'[weread plugin] 收到 401 响应 - 完整错误信息:',
					JSON.stringify(e, null, 2)
				);
				console.log(
					'[weread plugin] 平台: ' +
						(Platform.isDesktopApp ? 'Mac/Desktop' : 'iOS/Mobile')
				);

				if (Platform.isDesktopApp) {
					console.log('[weread plugin] 桌面端 401，标记 Cookie 无效');
					settingsStore.actions.setIsCookieValid(false);
				} else {
					console.log('[weread plugin] ⚠️ iOS 端 401 - 排查清单:');
					console.log('  1. ✅ Cookie 内容已确认相同');
					console.log('  2. ✅ User-Agent 已设置为桌面版本');
					console.log('  3. ✅ Accept-Encoding 已移除');
					console.log('  ❓ 可能的原因:');
					console.log('    - 微信读书对 iOS 设备做了限制（设备绑定/IP 限制）');
					console.log('    - 系统时间不同步导致时间戳验证失败');
					console.log('    - Cookie 中某个字段在传输时被破坏');
					console.log('  📌 建议: 检查 iOS 系统时间是否正确');
					settingsStore.actions.markCookiesInvalid();
				}
				return false;
			}

			console.error('[weread plugin] 非 401 异常:', e);
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
