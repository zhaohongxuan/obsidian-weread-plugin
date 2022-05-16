import { Cookie } from 'set-cookie-parser';
import { writable } from 'svelte/store';

import WereadPlugin from '../main';
import { getCookieString } from './utils/cookiesUtil';

interface WereadPluginSettings {
	cookies: string;
	noteLocation: string;
	cookieTime: number;
}

const DEFAULT_SETTINGS: WereadPluginSettings = {
	cookies: '',
	noteLocation: '/weread',
	cookieTime: -1
};

const createSettingsStore = () => {
	const store = writable(DEFAULT_SETTINGS as WereadPluginSettings);

	let _plugin!: WereadPlugin;

	const initialise = async (plugin: WereadPlugin): Promise<void> => {
		const data = Object.assign(
			{},
			DEFAULT_SETTINGS,
			await plugin.loadData()
		);
		const settings: WereadPluginSettings = { ...data };
		store.set(settings);
		_plugin = plugin;
	};

	store.subscribe(async (settings) => {
		if (_plugin) {
			const data = {
				...settings
			};
			await _plugin.saveData(data);
		}
	});

	const setCookies = (cookies: Cookie[]) => {
		store.update((state) => {
			state.cookies = getCookieString(cookies);
			state.cookieTime = new Date().getTime();
			return state;
		});
	};

	const setNoteLocationFolder = (value: string) => {
		store.update((state) => {
			state.noteLocation = value;
			return state;
		});
	};

	return {
		subscribe: store.subscribe,
		initialise,
		actions: {
			setNoteLocationFolder,
			setCookies
		}
	};
};

export const settingsStore = createSettingsStore();
