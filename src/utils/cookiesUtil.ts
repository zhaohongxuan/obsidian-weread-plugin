import { Cookie } from 'set-cookie-parser';
import { get } from 'svelte/store';
import { settingsStore } from '../settings';

export const parseCookies = (cookieInput: string): Cookie[] => {
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
};

export const getCookieString = (cookies: Cookie[]): string => {
	return cookies
		.map((cookie) => {
			const key = cookie.name;
			const value = cookie.value;
			const decodeValue = value.indexOf('%') !== -1 ? decodeURIComponent(value) : value;
			return key + '=' + decodeValue;
		})
		.join(';');
};

export const getEncodeCookieString = (): string => {
	const cookiesArr = get(settingsStore).cookies;
	return cookiesArr
		.map((cookie) => {
			const key = cookie.name;
			const value = cookie.value;
			return key + '=' + encodeURIComponent(value);
		})
		.join(';');
};
