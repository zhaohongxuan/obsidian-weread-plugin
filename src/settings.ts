import { Cookie } from 'set-cookie-parser';
import { writable } from 'svelte/store';
import { Platform } from 'obsidian';
import notebookTemolate from './assets/notebookTemplate.njk';
import WereadPlugin from '../main';

export type SyncMode = 'blacklist' | 'whitelist';
export type ReadingOpenMode = 'TAB' | 'WINDOW';

type LegacyWereadPluginSettings = Partial<WereadPluginSettings> & {
	manualSyncMode?: boolean;
};

export interface WereadPluginSettings {
	loginMethod: string;
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
	userAvatar: string;
	template: string;
	noteCountLimit: number;
	subFolderType: string;
	fileNameType: string;
	removeParens: boolean;
	removeParensWhitelist: string;
	dailyNotesToggle: boolean;
	notesBlacklist: string;
	notesWhitelist: string;
	syncMode: SyncMode;
	showEmptyChapterTitleToggle: boolean;
	convertTags: boolean;
	saveArticleToggle: boolean;
	saveReadingInfoToggle: boolean;
	readingOpenMode: ReadingOpenMode;
	trimBlocks: boolean;
	cookieCloudInfo: {
		serverUrl: string;
		uuid: string;
		password: string;
	};
	cookieAutoRefreshToggle: boolean;
	cookieRefreshInterval: number;
}

const DEFAULT_SETTINGS: WereadPluginSettings = {
	loginMethod: 'scan',
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
	userAvatar: '',
	template: notebookTemolate,
	noteCountLimit: -1,
	subFolderType: '-1',
	fileNameType: 'BOOK_NAME',
	removeParens: false,
	removeParensWhitelist: '',
	dailyNotesToggle: false,
	notesBlacklist: '',
	notesWhitelist: '',
	syncMode: 'blacklist',
	showEmptyChapterTitleToggle: false,
	convertTags: false,
	saveArticleToggle: true,
	saveReadingInfoToggle: true,
	readingOpenMode: 'TAB',
	trimBlocks: false,
	cookieCloudInfo: {
		serverUrl: '',
		uuid: '',
		password: ''
	},
	cookieAutoRefreshToggle: false,
	cookieRefreshInterval: 12
};

const createSettingsStore = () => {
	const store = writable(DEFAULT_SETTINGS as WereadPluginSettings);

	let _plugin!: WereadPlugin;

	const initialise = async (plugin: WereadPlugin): Promise<void> => {
		const loadedData = await plugin.loadData();
		const rawData: LegacyWereadPluginSettings =
			loadedData && typeof loadedData === 'object' && !Array.isArray(loadedData)
				? loadedData
				: {};
		const data = Object.assign({}, DEFAULT_SETTINGS, rawData);
		const { manualSyncMode, ...restData } = data;
		const settings: WereadPluginSettings = {
			...restData,
			syncMode:
				data.syncMode === 'blacklist' || data.syncMode === 'whitelist'
					? data.syncMode
					: manualSyncMode
					? 'whitelist'
					: 'blacklist'
		};
		console.log('--------init cookie------', settings.cookies);
		console.log(
			'[weread plugin] Cookie 详情: 数量=' +
				settings.cookies.length +
				', 用户=' +
				settings.user +
				', 登录状态=' +
				settings.isCookieValid +
				', 平台=' +
				(typeof Platform !== 'undefined'
					? Platform.isDesktopApp
						? '桌面端'
						: '移动端'
					: '未知')
		);
		if (settings.cookies.length > 0) {
			console.log(
				'[weread plugin] Cookie 详细列表:',
				settings.cookies.map((c) => c.name).join(', ')
			);
		}
		if (settings.cookies.length > 1) {
			setUser(settings.cookies);
		}

		const wr_vid = settings.cookies.find((cookie) => cookie.name === 'wr_vid');
		if (wr_vid === undefined || wr_vid.value === '') {
			settings.userVid = '';
			// 仅在完全没有 Cookie 时才标记为无效
			if (settings.cookies.length === 0) {
				settings.isCookieValid = false;
			}
			// 否则保留已有状态，由后续验证过程更新
		}
		_plugin = plugin;
		store.set(settings);
	};

	store.subscribe(async (settings) => {
		if (_plugin) {
			const data = {
				...settings
			};
			await _plugin.saveData(data);
		}
	});

	const setLoginMethod = (method: string) => {
		store.update((settings) => {
			settings.loginMethod = method;
			return settings;
		});
	};

	const clearCookies = () => {
		console.log('[weread plugin] cookie已失效，清理cookie...');
		store.update((state) => {
			state.cookies = [];
			state.lastCookieTime = new Date().getTime();
			state.user = '';
			state.userVid = '';
			state.userAvatar = '';
			state.isCookieValid = false;
			return state;
		});
	};

	// 仅标记 Cookie 无效，不删除（用于移动端）
	const markCookiesInvalid = () => {
		console.log('[weread plugin] cookie标记为无效，保留数据等待重新登录...');
		store.update((state) => {
			state.isCookieValid = false;
			return state;
		});
	};

	const setIsCookieValid = (valid: boolean) => {
		store.update((state) => {
			state.isCookieValid = valid;
			return state;
		});
	};

	const updateCookieRefreshTime = () => {
		store.update((state) => {
			state.lastCookieTime = new Date().getTime();
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
			if (cookie.name == 'wr_avatar') {
				if (cookie.value !== '') {
					// Cookie 中的值已经是 URL 编码的，需要解码
					const avatarUrl = decodeURIComponent(cookie.value);
					console.log('[weread plugin] setting user avatar=>', avatarUrl);
					store.update((state) => {
						state.userAvatar = avatarUrl;
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

	const setRemoveParens = (removeParens: boolean) => {
		store.update((state) => {
			state.removeParens = removeParens;
			return state;
		});
	};

	const setRemoveParensWhitelist = (whitelist: string) => {
		store.update((state) => {
			state.removeParensWhitelist = whitelist;
			return state;
		});
	};

	const setNoteBlacklist = (notebookBlacklist: string) => {
		store.update((state) => {
			state.notesBlacklist = notebookBlacklist;
			return state;
		});
	};

	const setSyncMode = (syncMode: SyncMode) => {
		store.update((state) => {
			state.syncMode = syncMode;
			return state;
		});
	};

	const setNotesWhitelist = (notesWhitelist: string) => {
		store.update((state) => {
			state.notesWhitelist = notesWhitelist;
			return state;
		});
	};

	const setEmptyChapterTitleToggle = (emtpyChapterTitleToggle: boolean) => {
		store.update((state) => {
			state.showEmptyChapterTitleToggle = emtpyChapterTitleToggle;
			return state;
		});
	};

	const setConvertTags = (convertTags: boolean) => {
		store.update((state) => {
			state.convertTags = convertTags;
			return state;
		});
	};

	const setSaveArticleToggle = (saveArticleToggle: boolean) => {
		store.update((state) => {
			state.saveArticleToggle = saveArticleToggle;
			return state;
		});
	};

	const setSaveReadingInfoToggle = (saveReadingInfoToggle: boolean) => {
		store.update((state) => {
			state.saveReadingInfoToggle = saveReadingInfoToggle;
			return state;
		});
	};

	const setReadingOpenMode = (readingOpenMode: ReadingOpenMode) => {
		store.update((state) => {
			state.readingOpenMode = readingOpenMode;
			return state;
		});
	};

	const setCookieCloudInfo = (info: { serverUrl: string; uuid: string; password: string }) => {
		store.update((state) => {
			state.cookieCloudInfo = info;
			return state;
		});
	};

	const setTrimBlocks = (trimBlocks: boolean) => {
		store.update((state) => {
			state.trimBlocks = trimBlocks;
			return state;
		});
	};

	const setCookieAutoRefreshToggle = (cookieAutoRefreshToggle: boolean) => {
		store.update((state) => {
			state.cookieAutoRefreshToggle = cookieAutoRefreshToggle;
			return state;
		});
	};

	const setCookieRefreshInterval = (cookieRefreshInterval: number) => {
		store.update((state) => {
			state.cookieRefreshInterval = cookieRefreshInterval;
			return state;
		});
	};

	return {
		subscribe: store.subscribe,
		initialise,
		actions: {
			setLoginMethod,
			setNoteLocationFolder,
			setCookies,
			clearCookies,
			markCookiesInvalid,
			updateCookieRefreshTime,
			setTemplate,
			setNoteCountLimit,
			setSubFolderType,
			setFileNameType,
			setRemoveParens,
			setRemoveParensWhitelist,
			setDailyNotesToggle,
			setDailyNotesFolder,
			setDailyNotesFormat,
			setInsertAfter,
			setInsertBefore,
			setNoteBlacklist,
			setSyncMode,
			setNotesWhitelist,
			setEmptyChapterTitleToggle,
			setConvertTags,
			setSaveArticleToggle,
			setSaveReadingInfoToggle,
			setReadingOpenMode,
			setCookieCloudInfo,
			setTrimBlocks,
			setCookieAutoRefreshToggle,
			setCookieRefreshInterval,
			setIsCookieValid
		}
	};
};

export const settingsStore = createSettingsStore();
