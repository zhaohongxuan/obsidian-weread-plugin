import { Notice, requestUrl, RequestUrlParam, Platform } from 'obsidian';
import { settingsStore } from './settings';
import { get } from 'svelte/store';
import { getCookieString } from './utils/cookiesUtil';
import { Cookie, parse, splitCookiesString } from 'set-cookie-parser';
export default class ApiManager {
	readonly baseUrl: string = 'https://i.weread.qq.com';

	private getHeaders() {
		return {
			'User-Agent':
				'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/73.0.3683.103 Safari/537.36',
			'Accept-Encoding': 'gzip, deflate, br',
			'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
			Cookie: getCookieString(get(settingsStore).cookies)
		};
	}

	async refreshCookie() {
		const req: RequestUrlParam = {
			url: `https://weread.qq.com`,
			method: 'HEAD',
			headers: this.getHeaders()
		};
		const resp = await requestUrl(req);
		const respCookie: string = resp.headers['set-cookie'] || resp.headers['Set-Cookie'];
		if (respCookie === undefined) {
			new Notice('尝试刷新Cookie失败');
		} else {
			new Notice('cookie已过期，尝试刷新Cookie成功');
			this.updateCookies(respCookie);
		}
	}

	async getNotebooksWithRetry() {
		let noteBookResp: [] = await this.getNotebooks();
		if (noteBookResp === undefined || noteBookResp.length === 0) {
			//retry get notebooks
			noteBookResp = await this.getNotebooks();
		}
		if (noteBookResp === undefined || noteBookResp.length === 0) {
			new Notice('长时间未登录，Cookie已失效，请重新扫码登录！');
			settingsStore.actions.clearCookies();
			throw Error('get weread note book error after retry');
		}
		return noteBookResp;
	}

	async getRecentBooks() {
		const vid = get(settingsStore).userVid;
		console.debug('get userVid settings', vid);
		const req: RequestUrlParam = {
			url: this.baseUrl + '/shelf/friendCommon?userVid=' + vid,
			method: 'GET',
			headers: this.getHeaders()
		};
		try {
			const resp = await requestUrl(req);
			return resp.json.recentBooks;
		} catch (e) {
			console.error('get recent books error: vid' + vid, e);
		}
	}

	async getNotebooks() {
		let noteBooks = [];
		const req: RequestUrlParam = {
			url: this.baseUrl + '/user/notebooks',
			method: 'GET',
			headers: this.getHeaders()
		};

		try {
			const resp = await requestUrl(req);
			if (resp.status === 401) {
				if (resp.json.errcode == -2012) {
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
					settingsStore.actions.clearCookies();
				}
			}
			noteBooks = resp.json.books;
		} catch (e) {
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
		const requestHeaders = req.headers;
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
		function escapeCharacter(x) {
			let code = x.charCodeAt(0);
			if (code < 256) {
				// Add leading zero when needed to not care about the next character.
				return code < 16 ? '\\x0' + code.toString(16) : '\\x' + code.toString(16);
			}
			code = code.toString(16);
			return '\\u' + ('0000' + code).substr(code.length, 4);
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

	async getBook(bookId: string) {
		try {
			const req: RequestUrlParam = {
				url: `${this.baseUrl}/book/info?bookId=${bookId}`,
				method: 'GET',
				headers: this.getHeaders()
			};
			const resp = await requestUrl(req);
			return resp.json;
		} catch (e) {
			console.error('get book detail error', e);
		}
	}

	async getNotebookHighlights(bookId: string) {
		try {
			const req: RequestUrlParam = {
				url: `${this.baseUrl}/book/bookmarklist?bookId=${bookId}`,
				method: 'GET',
				headers: this.getHeaders()
			};
			const resp = await requestUrl(req);
			return resp.json;
		} catch (e) {
			console.error('get book highlight error' + bookId, e);
		}
	}

	async getNotebookReviews(bookId: string) {
		try {
			const url = `${this.baseUrl}/review/list?bookId=${bookId}&listType=11&mine=1&synckey=0`;
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

	async getChapters(bookId: string) {
		try {
			const url = `${this.baseUrl}/book/chapterInfos?bookIds=${bookId}&synckey=0`;
			const req: RequestUrlParam = { url: url, method: 'GET', headers: this.getHeaders() };
			const resp = await requestUrl(req);
			return resp.json;
		} catch (e) {
			new Notice(
				'Failed to fetch weread notebook chapters . Please check your Cookies and try again.'
			);
			console.error('get book chapters error' + bookId, e);
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
}
