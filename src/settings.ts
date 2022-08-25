import { Cookie } from 'set-cookie-parser';
import { writable } from 'svelte/store';
import notebookTemolate from './assets/notebookTemplate.njk';
import WereadPlugin from '../main';

interface WereadPluginSettings {
	cookies: Cookie[];
	noteLocation: string;
	dailyNotesLocation: string;
	dailyNotesFormat: string;
	insertAfter: string;
	insertBefore: string;
	lastCookieTime: number;
	isCookieValid: boolean;
	user: string;
	userVid: string;
	template: string;
	noteCountLimit: number;
	subFolderType: string;
	fileNameType: string;
	dailyNotesToggle: boolean;
}

const DEFAULT_SETTINGS: WereadPluginSettings = {
	cookies: [],
	noteLocation: '/',
	dailyNotesLocation: '/',
	insertAfter: '<!-- start of weread -->',
	insertBefore: '<!-- end of weread -->',
	dailyNotesFormat: 'YYYY-MM-DD',
	lastCookieTime: -1,
	isCookieValid: false,
	user: '',
	userVid: '',
	template: notebookTemolate,
	noteCountLimit: -1,
	subFolderType: '-1',
	fileNameType: 'BOOK_NAME',
	dailyNotesToggle: false
};

const createSettingsStore = () => {
	const store = writable(DEFAULT_SETTINGS as WereadPluginSettings);

	let _plugin!: WereadPlugin;

	const initialise = async (plugin: WereadPlugin): Promise<void> => {
		const data = Object.assign({}, DEFAULT_SETTINGS, await plugin.loadData());
		const settings: WereadPluginSettings = { ...data };
		console.log('--------init cookie------', settings.cookies);
		if (settings.cookies.length > 1) {
			setUser(settings.cookies);
		}

		const wr_vid = settings.cookies.find((cookie) => cookie.name === 'wr_vid');
		if (wr_vid === undefined || wr_vid.value === '') {
			settings.userVid = '';
			settings.isCookieValid = false;
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
		console.log('[weread plugin] cookie已失效，清理cookie...');
		store.update((state) => {
			state.cookies = [];
			state.lastCookieTime = new Date().getTime();
			state.user = '';
			state.userVid = '';
			state.isCookieValid = false;
			return state;
		});
	};

	const setCookies = (cookies: Cookie[]) => {
		store.update((state) => {
			state.cookies = cookies;
			state.lastCookieTime = new Date().getTime();
			state.isCookieValid = true;
			setUser(cookies);
			return state;
		});
	};

	const setUser = (cookies: Cookie[]) => {
		for (const cookie of cookies) {
			if (cookie.name == 'wr_name') {
				if (cookie.value !== '') {
					console.log('[weread plugin] setting user name=>', cookie.value);
					store.update((state) => {
						state.user = cookie.value;
						return state;
					});
				}
			}
			if (cookie.name == 'wr_vid') {
				if (cookie.value !== '') {
					console.log('[weread plugin] setting user vid=>', cookie.value);
					store.update((state) => {
						state.userVid = cookie.value;
						return state;
					});
				}
			}
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

	const setDailyNotesToggle = (dailyNotesToggle: boolean) => {
		store.update((state) => {
			state.dailyNotesToggle = dailyNotesToggle;
			return state;
		});
	};

	const setDailyNotesFolder = (value: string) => {
		store.update((state) => {
			state.dailyNotesLocation = value;
			return state;
		});
	};

	const setDailyNotesFormat = (value: string) => {
		store.update((state) => {
			state.dailyNotesFormat = value;
			return state;
		});
	};

	const setInsertAfter = (value: string) => {
		store.update((state) => {
			state.insertAfter = value;
			return state;
		});
	};

	const setInsertBefore = (value: string) => {
		store.update((state) => {
			state.insertBefore = value;
			return state;
		});
	};

	const setFileNameType = (fileNameType: string) => {
		store.update((state) => {
			state.fileNameType = fileNameType;
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
			setTemplate,
			setNoteCountLimit,
			setSubFolderType,
			setFileNameType,
			setDailyNotesToggle,
			setDailyNotesFolder,
			setDailyNotesFormat,
			setInsertAfter,
			setInsertBefore
		}
	};
};

export const settingsStore = createSettingsStore();
