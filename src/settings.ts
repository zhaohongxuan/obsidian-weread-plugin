import { Cookie } from 'set-cookie-parser';
import { writable } from 'svelte/store';
import notebookTemolate from './assets/notebookTemplate.njk';
import WereadPlugin from '../main';

interface WereadPluginSettings {
	cookies: Cookie[];
	noteLocation: string;
	lastCookieTime: number;
	isCookieValid: boolean;
	user: string;
	template: string;
	noteCountLimit: number;
	subFolderType: string;
}

const DEFAULT_SETTINGS: WereadPluginSettings = {
	cookies: [],
	noteLocation: '/',
	lastCookieTime: -1,
	isCookieValid: false,
	user: '',
	template: notebookTemolate,
	noteCountLimit: -1,
	subFolderType: '-1'
};

const createSettingsStore = () => {
	const store = writable(DEFAULT_SETTINGS as WereadPluginSettings);

	let _plugin!: WereadPlugin;

	const initialise = async (plugin: WereadPlugin): Promise<void> => {
		const data = Object.assign({}, DEFAULT_SETTINGS, await plugin.loadData());
		const settings: WereadPluginSettings = { ...data };
		if (settings.cookies.length > 1) {
			setUserName(settings.cookies);
		}
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

	const clearCookies = () => {
		store.update((state) => {
			state.cookies = [];
			state.lastCookieTime = new Date().getTime();
			state.user = '';
			state.isCookieValid = false;
			return state;
		});
	};

	const setCookies = (cookies: Cookie[]) => {
		store.update((state) => {
			state.cookies = cookies;
			state.lastCookieTime = new Date().getTime();
			state.isCookieValid = true;
			setUserName(cookies);
			return state;
		});
	};

	const setCookieFlag = (flag: boolean) => {
		store.update((state) => {
			state.isCookieValid = true;
			return state;
		});
	};

	const setUserName = (cookies: Cookie[]) => {
		const userName = cookies.find((cookie) => cookie.name == 'wr_name').value;
		if (userName !== '') {
			console.log('setting user name=>', userName);
			store.update((state) => {
				state.user = userName;
				return state;
			});
		}
	};

	const setNoteLocationFolder = (value: string) => {
		store.update((state) => {
			state.noteLocation = value;
			return state;
		});
	};
	const setTemplate = (template: string) => {
		store.update((state) => {
			state.template = template;
			return state;
		});
	};
	const setNoteCountLimit = (noteCountLimit: number) => {
		store.update((state) => {
			state.noteCountLimit = noteCountLimit;
			return state;
		});
	};

	const setSubFolderType = (subFolderType: string) => {
		store.update((state) => {
			state.subFolderType = subFolderType;
			return state;
		});
	};
	return {
		subscribe: store.subscribe,
		initialise,
		actions: {
			setNoteLocationFolder,
			setCookies,
			clearCookies,
			setCookieFlag,
			setTemplate,
			setNoteCountLimit,
			setSubFolderType
		}
	};
};

export const settingsStore = createSettingsStore();
