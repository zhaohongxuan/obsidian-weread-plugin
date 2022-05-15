import express from 'express';
import { Server, ServerResponse } from 'http';
import { createProxyMiddleware } from 'http-proxy-middleware';
import { Notice } from 'obsidian';
import ApiManager from './api';
import { parse, Cookie } from 'set-cookie-parser';

export default class NetworkManager {
	private cookies: Cookie[];
	private app: express;
	private apiManager: ApiManager;

	constructor(cookie: string, apiManager: ApiManager) {
		this.setCookie(cookie);
		this.app = new express();
		this.apiManager = apiManager;
	}

	private parseCookies(cookieInput: string): Cookie[] {
		if (cookieInput === '') {
			return [];
		}

		const pairs = cookieInput.split(';');
		const splittedPairs = pairs.map((cookie) => cookie.split('='));
		const cookieArr: Cookie[] = splittedPairs.map((pair) => {
			return {
				name: decodeURIComponent(pair[0].trim()),
				value: decodeURIComponent(pair[1].trim())
			};
		});
		return cookieArr;
	}

	public getCookieString(): string {
		return this.cookies
			.map((cookie) => {
				const key = cookie.name;
				const value = cookie.value;
				const decodeValue =
					value.indexOf('%') !== -1
						? decodeURIComponent(value)
						: value;
				return key + '=' + encodeURIComponent(decodeValue);
			})
			.join(';');
	}

	public setCookie(cookies: string) {
		this.cookies = this.parseCookies(cookies);
	}

	private updateCookie(cookie: Cookie) {
		this.cookies
			.filter((localCookie) => localCookie.name == cookie.name)
			.forEach((localCookie) => {
				localCookie.value = cookie.value;
			});
	}

	public async startMiddleServer(): Promise<Server> {
		const getCookie = () => {
			return this.getCookieString();
		};
		const updateCookie = (cookie: Cookie) => {
			this.updateCookie(cookie);
		};

		this.app.use(
			'/refresh',
			createProxyMiddleware({
				target: 'https://weread.qq.com',
				changeOrigin: true,
				pathRewrite: {
					'^/refresh': '/'
				},
				onProxyReq: function (proxyReq, req, res) {
					const cookie = getCookie();
					proxyReq.setHeader('Cookie', cookie);
				},
				onProxyRes: function (proxyRes, req, res: ServerResponse) {
					proxyRes.headers['Access-Control-Allow-Origin'] = '*';
					const respCookie: string[] = proxyRes.headers['set-cookie'];
					if (respCookie) {
						parse(respCookie).forEach((cookie) => {
							updateCookie(cookie);
						});
					}
				}
			})
		);

		this.app.use(
			'/',
			createProxyMiddleware({
				target: 'https://i.weread.qq.com',
				changeOrigin: true,
				onProxyReq: function (proxyReq, req, res) {
					try {
						const cookie = getCookie();
						proxyReq.setHeader('Cookie', cookie);
					} catch (error) {
						new Notice('cookie 设置失败，检查Cookie格式');
					}
				},
				onProxyRes: function (proxyRes, req, res: ServerResponse) {
					if (proxyRes.statusCode == 401) {
						new Notice('微信读书Cookie已失效~');
					} else if (proxyRes.statusCode != 200) {
						new Notice('获取微信读书服务器数据异常！');
					}
					proxyRes.headers['Access-Control-Allow-Origin'] = '*';
				}
			})
		);
		const server = this.app.listen(12011);
		return server;
	}

	public async shutdownMiddleServer(server: Server) {
		server.close(() => {
			console.log('HTTP server closed');
		});
	}

	async refreshCookie() {
		console.log('cookie is expired try to refresh cookie ');
		await this.apiManager.refreshCookie();
	}
}
