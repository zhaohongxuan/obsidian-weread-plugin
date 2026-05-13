import { requestUrl, Notice, RequestUrlParam } from 'obsidian';
import { parseCookies } from './utils/cookiesUtil';
import { settingsStore } from './settings';
import { get } from 'svelte/store';
import * as CryptoJS from 'crypto-js';

export default class CookieCloudManager {
	async getCookie() {
		const info = get(settingsStore).cookieCloudInfo;
		if (!info || info.serverUrl === '' || info.uuid === '' || info.password === '') {
			new Notice(`请检查 CookieCloud 配置`);
			return false;
		}

		const req: RequestUrlParam = {
			url: `${info.serverUrl}/get/${info.uuid}`,
			method: 'GET'
		};

		try {
			const resp = await requestUrl(req);
			console.debug('request cookiecloud server resp', resp);

			if (resp.status !== 200) {
				new Notice(`CookieCloud 获取失败，请检查配置`);
				return false;
			}

			const json = resp['json'];
			if (json && json.encrypted) {
				const { cookie_data } = this.cookieDecrypt(
					info.uuid,
					json.encrypted,
					info.password
				);

				for (const key in cookie_data) {
					const cookieStr = [
						...cookie_data[key].filter((item: { domain: string }) =>
							item.domain.endsWith('weread.qq.com')
						)
					]
						.map((item) => `${item.name}=${item.value}`)
						.join('; ');

					return this.updateCookies(cookieStr);
				}
			}

			new Notice(`CookieCloud 获取微信读书登录信息失败，请检查配置`);
			return false;
		} catch {
			new Notice(`CookieCloud 获取失败，请检查配置或网络连接`);
			return false;
		}
	}

	private cookieDecrypt(uuid: string, encrypted: string, password: string) {
		const the_key = CryptoJS.MD5(uuid + '-' + password)
			.toString()
			.substring(0, 16);

		try {
			const decrypted = CryptoJS.AES.decrypt(encrypted, the_key).toString(CryptoJS.enc.Utf8);
			const parsed = JSON.parse(decrypted);
			return parsed;
		} catch {
			new Notice(`解密失败，请检查配置`);
			return '';
		}
	}

	private updateCookies(cookies: string) {
		const cookieArr = parseCookies(cookies);
		const wrName = cookieArr.find((cookie) => cookie.name == 'wr_name');
		if (wrName !== undefined && wrName.value !== '') {
			settingsStore.actions.setCookies(cookieArr);
			new Notice(`CookieCloud 获取 cookie 成功`);
			return true;
		}

		new Notice(`CookieCloud 获取微信读书登录信息失败，请检查配置`);
		return false;
	}
}
