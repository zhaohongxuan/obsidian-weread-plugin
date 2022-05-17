import * as express from 'express';
import { Server, ServerResponse } from 'http';
import { createProxyMiddleware } from 'http-proxy-middleware';
import { Notice } from 'obsidian';
import ApiManager from './api';
import { parse } from 'set-cookie-parser';
import { get } from 'svelte/store';
import { settingsStore } from './settings';
import { getEncodeCookieString } from './utils/cookiesUtil';

export default class NetworkManager {
	private app: any;
	private apiManager: ApiManager;

	constructor(apiManager: ApiManager) {
		this.app = express();
		this.apiManager = apiManager;
	}

	public async startMiddleServer(): Promise<Server> {

		const updateCookies = (cookies: string[]) => {
			this.updateCookies(cookies);
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
					const cookie = getEncodeCookieString();
					proxyReq.setHeader('Cookie', cookie);
				},
				onProxyRes: function (proxyRes, req, res: ServerResponse) {
					proxyRes.headers['Access-Control-Allow-Origin'] = '*';
					proxyRes.headers['Access-Control-Allow-Methods'] = '*';
					const respCookie: string[] = proxyRes.headers['set-cookie'];
					if (respCookie) {
						updateCookies(respCookie);
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
						const cookie = getEncodeCookieString();
						proxyReq.setHeader('Cookie', cookie);
					} catch (error) {
						new Notice('cookie 设置失败，检查Cookie格式');
					}
				},
				onProxyRes: function (proxyRes, req, res: ServerResponse) {
					proxyRes.headers['Access-Control-Allow-Origin'] = '*';
					proxyRes.headers['Access-Control-Allow-Methods'] = '*';
				}
			})
		);
		const server = this.app.listen(12011);
		return server;
	}

	private updateCookies(respCookie: string[]) {
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

	public async shutdownMiddleServer(server: Server) {
		server.close(() => {
			console.log('HTTP server closed');
		});
	}

	async refreshCookie(force = false) {
		const cookieTime = get(settingsStore).lastCookieTime;
		if (
			cookieTime === -1 ||
			new Date().getTime() - cookieTime > 1800 * 1000 ||
			force
		) {
			console.log('cookie is expired try to refresh cookie ');
			console.log(
				'last cookie time ',
				new Date(cookieTime).toString(),
				'try to refresh...'
			);
			await this.apiManager.refreshCookie();
		}
	}
}
