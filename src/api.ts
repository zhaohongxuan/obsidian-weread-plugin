import { Notice, requestUrl, RequestUrlParam } from 'obsidian';
import { settingsStore } from './settings';
import { get } from 'svelte/store';
import { getCookieString } from './utils/cookiesUtil';
import { parse } from 'set-cookie-parser';
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
			method: 'GET',
			headers: this.getHeaders()
		};
		const resp = await requestUrl(req);
		const respCookie: string = resp.headers['set-cookie'];
		this.updateCookies(respCookie);
	}

	async getNotebooksWithRetry(){
		let noteBookResp: [] = await this.getNotebooks();
		if(noteBookResp === undefined){
			//retry get notebooks
			noteBookResp =  await this.getNotebooks(); 
		}
		return noteBookResp;
	}

	async getNotebooks() {
		let noteBooks = [];
		const req: RequestUrlParam = {
			url: this.baseUrl + '/user/notebooks',
			method: 'GET',
			headers: this.getHeaders()
		};
		let resp = await requestUrl(req);
		if (resp.status === 401) {
			if (resp.json.errcode == -2012) {
				console.log("weread cookie expire retry refresh cookie... ")
				await this.refreshCookie();
			
			} else {
				new Notice('微信读书未登录或者用户异常，请在设置中重新登录！');
				console.log('微信读书未登录或者用户异常，请重新登录', resp.json.errcode);
				settingsStore.actions.clearCookies();
			}
		}
		noteBooks = resp.json.books;
		return noteBooks;
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
			console.error(e);
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
			console.error(e);
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
			console.error(e);
		}
	}

	private updateCookies(respCookie: string) {
		const cookies = get(settingsStore).cookies;
		parse(respCookie).forEach((cookie) => {
			cookies
				.filter((localCookie) => localCookie.name == cookie.name)
				.forEach((localCookie) => {
					localCookie.value = cookie.value;
				});
		});
		settingsStore.actions.setCookies(cookies);
	}
}
