import { Notice } from 'obsidian';
import axios from 'axios';
export default class ApiManager {
	//will proxy to  'https://i.weread.qq.com';
	readonly baseUrl: string = 'http://localhost:8081';

	private getHeaders() {
		return {
			Host: 'i.weread.qq.com',
			'User-Agent':
				'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/73.0.3683.103 Safari/537.36',
			Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3',
			// 'Accept-Encoding': 'gzip, deflate, br',
			'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
			'Content-Type': 'application/json'
		};
	}

	async getNotebooks() {
		try {
			let noteBooks = [];
			const resp = await axios.get(this.baseUrl + '/user/notebooks', {});

			noteBooks = resp.data.books;
			//todo test code
			noteBooks = noteBooks.slice(0, 30);
			return noteBooks;
		} catch (e) {
			new Notice(
				'Failed to fetch weread notebooks . Please check your API token and try again.'
			);
		}
	}
	async getNotebookHighlights(bookId: string) {
		try {
			const resp = await axios.get(
				this.baseUrl + '/book/bookmarklist?bookId=' + bookId,
				{}
			);
			return resp.data;
		} catch (e) {
			new Notice(
				'Failed to fetch weread notebook highlights . Please check your API token and try again.'
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
				'Failed to fetch weread notebook reviews . Please check your API token and try again.'
			);
			console.error(e);
		}
	}
}
