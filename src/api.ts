import { Notice } from 'obsidian';
import axios from 'axios';
import axiosRetry from 'axios-retry';

export default class ApiManager {
	//will proxy to  'https://i.weread.qq.com';
	readonly baseUrl: string = 'http://localhost:12011';

	private getHeaders() {
		return {
			Host: 'i.weread.qq.com',
			'User-Agent':
				'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/73.0.3683.103 Safari/537.36',
			Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3',
			'Accept-Encoding': 'gzip, deflate, br',
			'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
			'Content-Type': 'application/json'
		};
	}

	async refreshCookie() {
		try {
			await axios.head(this.baseUrl + '/refresh');
		} catch (e) {
			console.error(e);
			new Notice('刷新Cookie失败');
		}
	}

	async getNotebooks() {
		try {
			let noteBooks = [];
			const client = axios.create();
			axiosRetry(client, {
				retries: 3,
				retryDelay: (retryCount) => {
					console.log(
						`weread retry get notebooks attempt: ${retryCount}`
					);
					return retryCount * 1000;
				},
				retryCondition: (error) => {
					return error.response.status === 401;
				}
			});

			const resp = await client.get(this.baseUrl + '/user/notebooks');
			if (resp.status === 401) {
				console.log('微信读书Cookie已失效');
				new Notice('微信读书Cookie已失效~');
			}
			noteBooks = resp.data.books;
			return noteBooks;
		} catch (e) {
			console.error(e);
		}
	}

	async getBook(bookId: string) {
		try {
			const resp = await axios.get(
				`${this.baseUrl}/book/info?bookId=${bookId}`
			);
			return resp.data;
		} catch (e) {
			new Notice(
				'Failed to fetch weread book detail. Please check your Cookies and try again.'
			);
			console.error(e);
		}
	}

	async getNotebookHighlights(bookId: string) {
		try {
			const resp = await axios.get(
				`${this.baseUrl}/book/bookmarklist?bookId=${bookId}`
			);
			return resp.data;
		} catch (e) {
			new Notice(
				'Failed to fetch weread notebook highlights . Please check your Cookies and try again.'
			);
			console.error(e);
		}
	}

	async getNotebookReviews(bookId: string) {
		try {
			const requestUrl = `${this.baseUrl}/review/list?bookId=${bookId}&listType=11&mine=1&synckey=0`;
			const resp = await axios.get(requestUrl);
			return resp.data;
		} catch (e) {
			new Notice(
				'Failed to fetch weread notebook reviews . Please check your Cookies and try again.'
			);
			console.error(e);
		}
	}
}
