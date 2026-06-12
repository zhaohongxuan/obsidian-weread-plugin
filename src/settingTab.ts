import WereadPlugin from '../main';
import {
	App,
	ExtraButtonComponent,
	FuzzySuggestModal,
	Modal,
	Notice,
	Platform,
	PluginSettingTab,
	Setting,
	TFolder,
	TextComponent
} from 'obsidian';
import type { Metadata } from './models';
import { parseMetadata } from './parser/parseResponse';
import { settingsStore } from './settings';
import { get } from 'svelte/store';
import WereadLoginModel from './components/wereadLoginModel';
import WereadLogoutModel from './components/wereadLogoutModel';
import CookieCloudConfigModal from './components/cookieCloudConfigModel';
import { ThemeManagerModal } from './components/themeManagerModal';

import ApiRouter from './api-router';
import { parseBookIdList } from './utils/bookIdUtils';
import { formatTimestampToDate } from './utils/dateUtil';
import type { ReadingOpenMode, SyncMode, BookshelfSortMode, BookOpenMode } from './settings';

const UNLIMITED_NOTE_COUNT = -1;

const getSyncModeText = (syncMode: SyncMode) =>
	syncMode === 'blacklist' ? '黑名单模式' : '白名单模式';

const getBookLastReadText = (book: Metadata) => {
	if (book.readInfo?.finishedDate) {
		return `完成时间：${formatTimestampToDate(book.readInfo.finishedDate)}`;
	}
	if (book.readInfo?.readingBookDate) {
		return `最近阅读：${formatTimestampToDate(book.readInfo.readingBookDate)}`;
	}
	if (book.lastReadDate) {
		return `最近阅读：${book.lastReadDate}`;
	}
	return '最近阅读：暂无';
};

export class WereadSettingsTab extends PluginSettingTab {
	private plugin: WereadPlugin;
	private selectableBooksCache: Metadata[] = [];
	private selectableBooksLoadingPromise: Promise<void> | null = null;
	private syncSettingsHeadingEl: HTMLElement | null = null;

	constructor(app: App, plugin: WereadPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display() {
		const { containerEl } = this;
		containerEl.empty();
		this.syncSettingsHeadingEl = null;
		containerEl.createEl('h2', { text: '设置微信读书插件' });
		this.preloadSelectableBooks();

		// API Key 设置始终可见（桌面端和移动端）
		this.showApiKeySetting();

		this.notebookFolder();
		this.bookshelfSettings();
		this.syncModeSettings();
		this.scheduledSync();

		new Setting(this.containerEl).setName('文件设置').setHeading();
		this.fileNameType();
		this.removeParens();
		this.filterInlineImages();
		this.subFolderType();

		new Setting(this.containerEl).setName('日记设置').setHeading();
		this.dailyNotes();
		const dailyNotesToggle = get(settingsStore).dailyNotesToggle;
		if (dailyNotesToggle) {
			this.dailyNotesFolder();
			this.dailyNoteFormat();
			this.insertAfter();
		}
		this.template();
		this.readingStatsSettings();
		if (Platform.isDesktopApp) {
			this.showDebugHelp();
		}
	}

	private showMobileLogin() {
		const container = this.containerEl.createDiv({
			cls: 'weread-mobile-login-container'
		});
		container.createDiv({
			cls: 'weread-mobile-login-text',
			text: '微信读书未登录'
		});
		container.createDiv({
			cls: 'weread-mobile-login-desc',
			text: '请先在电脑端登录'
		});
	}

	private showMobileLogout() {
		const container = this.containerEl.createDiv();
		const userAvatar = get(settingsStore).userAvatar;
		const userName = get(settingsStore).user;
		const settings = get(settingsStore);
		const isCookieValid = settings.isCookieValid;
		const hasCookies = settings.cookies && settings.cookies.length > 0;
		const lastCookieTime = settings.lastCookieTime;

		// Cookie 状态文本
		let statusText: string;
		if (isCookieValid) {
			statusText = '✅ Cookie 有效';
		} else if (hasCookies) {
			statusText = '⚠️ Cookie 已失效';
		} else {
			statusText = '❌ 未登录';
		}
		if (lastCookieTime > 0) {
			const lastRefreshStr = new Date(lastCookieTime).toLocaleString();
			statusText += `，上次刷新时间：${lastRefreshStr}`;
		}

		// 创建用户信息容器
		const userInfo = container.createDiv({ cls: 'weread-user-info' });

		// 头像图片
		if (userAvatar) {
			const avatarImg = userInfo.createEl('img', {
				cls: 'weread-user-avatar'
			});
			avatarImg.src = userAvatar;
			avatarImg.alt = '用户头像';
		}

		// 用户名
		userInfo.createDiv({
			cls: 'weread-user-name',
			text: `微信读书已登录，用户名：${userName}`
		});

		// Cookie 状态
		userInfo.createDiv({
			cls: 'weread-cookie-status',
			text: statusText
		});
	}

	private getFolderPaths(): string[] {
		const folders = this.app.vault
			.getAllLoadedFiles()
			.filter((file): file is TFolder => file instanceof TFolder);
		const folderPaths = folders.map((folder) => (folder.path === '' ? '/' : folder.path));
		if (!folderPaths.includes('/')) {
			folderPaths.unshift('/');
		}
		return Array.from(new Set(folderPaths)).sort();
	}

	private notebookFolder(): void {
		let inputRef: TextComponent | null = null;
		new Setting(this.containerEl)
			.setName('笔记保存位置')
			.setDesc('请选择Obsidian Vault中微信读书笔记存放的位置，例如：/ 或 Books/Weread')
			.addText((text) => {
				inputRef = text;
				return text
					.setPlaceholder('例如：/ 或 Books/Weread')
					.setValue(get(settingsStore).noteLocation)
					.onChange((value: string) => {
						const nextValue = value.trim() === '' ? '/' : value.trim();
						settingsStore.actions.setNoteLocationFolder(nextValue);
					});
			})
			.addButton((button) => {
				return button.setButtonText('选择').onClick(() => {
					const modal = this.createFolderSuggestModal((value: string) => {
						const nextValue = value.trim() === '' ? '/' : value.trim();
						settingsStore.actions.setNoteLocationFolder(nextValue);
						inputRef?.setValue(nextValue);
					});
					modal.open();
				});
			});
	}

	private bookOpenModeSetting(): void {
		new Setting(this.containerEl)
			.setName('书架阅读入口')
			.setDesc('点击书架"阅读此书"按钮及详情页阅读链接时，跳转到网页版还是 App')
			.addDropdown((dropdown) => {
				return dropdown
					.addOption('web', '网页版')
					.addOption('app', 'App（deeplink）')
					.setValue(get(settingsStore).bookOpenMode ?? 'web')
					.onChange((value: string) => {
						settingsStore.actions.setBookOpenMode(value as BookOpenMode);
					});
			});
	}

	private readingOpenModeSetting(): void {
		new Setting(this.containerEl)
			.setName('网页版打开方式')
			.setDesc(
				'控制书架中的”进入网页版”和详情页中的”打开网页版详情”默认在新标签页还是新窗口打开'
			)
			.addDropdown((dropdown) => {
				return dropdown
					.addOption('TAB', '新标签页')
					.addOption('WINDOW', '新窗口')
					.setValue(get(settingsStore).readingOpenMode)
					.onChange((value: string) => {
						settingsStore.actions.setReadingOpenMode(value as ReadingOpenMode);
					});
			});
	}

	private bookshelfSettings(): void {
		new Setting(this.containerEl).setName('书架设置').setHeading();
			this.readingOpenModeSetting();
			this.bookOpenModeSetting();


		new Setting(this.containerEl)
			.setName('书架排序方式')
			.setDesc('控制书架中书籍的默认排序方式')
			.addDropdown((dropdown) => {
				return dropdown
					.addOption('recent', '时间排序')
					.addOption('title', '按标题排序')
					.setValue(get(settingsStore).bookshelfSortMode)
					.onChange((value: string) => {
						settingsStore.actions.setBookshelfSortMode(value as BookshelfSortMode);
					});
			});

		new Setting(this.containerEl)
			.setName('按年份分组')
			.setDesc('在时间排序时，按照阅读年份对书架进行分组展示')
			.addToggle((toggle) => {
				return toggle
					.setValue(get(settingsStore).bookshelfGroupByYear)
					.onChange((value) => {
						settingsStore.actions.setBookshelfGroupByYear(value);
					});
			});

		new Setting(this.containerEl)
			.setName('默认书架状态')
			.setDesc('初次打开书架时的默认筛选状态')
			.addDropdown((dropdown) => {
				return dropdown
					.addOption('all', '全部状态')
					.addOption('synced', '已同步')
					.addOption('remoteOnly', '仅远程')
					.addOption('localOnly', '仅本地')
					.setValue(get(settingsStore).bookshelfDefaultSyncStatusFilter)
					.onChange((value: string) => {
						settingsStore.actions.setBookshelfDefaultSyncStatusFilter(
							value as 'all' | 'remoteOnly' | 'synced' | 'localOnly'
						);
					});
			});
	}

	private syncModeSettings(): void {
		this.syncSettingsHeadingEl = this.containerEl.createEl('h3', { text: '同步设置' });

		new Setting(this.containerEl)
			.setName('同步模式')
			.setDesc('切换后，下方会展示对应模式的书籍选择器。')
			.addDropdown((dropdown) => {
				return dropdown
					.addOption('blacklist', '黑名单模式')
					.addOption('whitelist', '白名单模式')
					.setValue(get(settingsStore).syncMode)
					.onChange((value: SyncMode) => {
						settingsStore.actions.setSyncMode(value);
						this.display();
					});
			});

		const syncMode = get(settingsStore).syncMode;
		if (syncMode === 'blacklist') {
			this.saveArticleToggle();
			this.noteCountLimit();
		}
		this.syncPopularHighlightsToggle();
		this.renderSyncModeBookSelection(syncMode);
	}

	scrollToSection(section: 'sync'): void {
		if (section === 'sync') {
			this.syncSettingsHeadingEl?.scrollIntoView({ behavior: 'smooth', block: 'start' });
		}
	}

	private renderSyncModeBookSelection(syncMode: SyncMode): void {
		const selectedBookIds = this.getSelectedBookIds(syncMode);
		const isBlacklistMode = syncMode === 'blacklist';
		const description = isBlacklistMode
			? selectedBookIds.size > 0
				? `当前已排除 ${selectedBookIds.size} 本书，同步时将跳过这些书籍`
				: '当前未排除任何书籍，同步时会处理全部书籍'
			: selectedBookIds.size > 0
			? `当前已选择 ${selectedBookIds.size} 本书，同步时仅处理这些书籍`
			: '当前未选择任何书籍，同步时不会处理任何书籍';

		new Setting(this.containerEl)
			.setName(`${getSyncModeText(syncMode)}书籍`)
			.setDesc(description)
			.addButton((button) => {
				return button
					.setButtonText('选择书籍')
					.setCta()
					.onClick(async () => {
						button.setDisabled(true);
						button.setButtonText('加载中...');
						try {
							const books = await this.fetchSelectableBooks();
							const modal = new ManualSyncBookSelectorModal(
								this.app,
								books,
								syncMode,
								{
									hideArticles: !get(settingsStore).saveArticleToggle,
									noteCountLimit:
										syncMode === 'blacklist'
											? get(settingsStore).noteCountLimit
											: UNLIMITED_NOTE_COUNT
								},
								selectedBookIds,
								(nextSelectedBookIds) => {
									this.setSelectedBookIds(syncMode, nextSelectedBookIds);
									this.display();
								}
							);
							modal.open();
						} catch (error: unknown) {
							const message =
								error instanceof Error
									? error.message
									: '获取书籍列表失败，请稍后重试';
							new Notice(message);
						} finally {
							button.setDisabled(false);
							button.setButtonText('选择书籍');
						}
					});
			})
			.addButton((button) => {
				return button.setButtonText('刷新书籍').onClick(() => {
					this.selectableBooksCache = [];
					new Notice('已清空书籍缓存，请重新打开选择器获取最新列表');
					this.preloadSelectableBooks();
					this.display();
				});
			})
			.addButton((button) => {
				return button.setButtonText('清空').onClick(() => {
					this.setSelectedBookIds(syncMode, []);
					this.display();
				});
			});

		if (selectedBookIds.size > 0) {
			this.renderSyncModePreview(syncMode, selectedBookIds);
		}
	}

	private getSelectedBookIds(syncMode: SyncMode): Set<string> {
		const settings = get(settingsStore);
		return parseBookIdList(
			syncMode === 'blacklist' ? settings.notesBlacklist : settings.notesWhitelist
		);
	}

	private setSelectedBookIds(syncMode: SyncMode, bookIds: string[]): void {
		const value = bookIds.join(',');
		if (syncMode === 'blacklist') {
			settingsStore.actions.setNoteBlacklist(value);
			return;
		}
		settingsStore.actions.setNotesWhitelist(value);
	}

	private preloadSelectableBooks(): void {
		const settings = get(settingsStore);
		if (
			this.selectableBooksCache.length > 0 ||
			this.selectableBooksLoadingPromise
		) {
			return;
		}
		const hasApiKey = Boolean(settings.wereadApiKey);
		const hasCookie = settings.isCookieValid && settings.cookies.length > 0;
		if (!hasCookie && !hasApiKey) {
			return;
		}
		this.selectableBooksLoadingPromise = this.fetchSelectableBooks()
			.then(() => {
				if (this.containerEl.isConnected) {
					this.display();
				}
			})
			.catch((error: unknown) => {
				console.debug('[weread plugin] preload selectable books failed', error);
			})
			.finally(() => {
				this.selectableBooksLoadingPromise = null;
			});
	}

	private showLogin(): void {
		const container = this.containerEl.createDiv({
			cls: 'weread-login-action'
		});

		// 左边：说明文案
		const textInfo = container.createDiv({
			cls: 'weread-login-text-info'
		});
		textInfo.createDiv({
			cls: 'weread-login-title',
			text: '微信读书未登录'
		});
		const desc = document
			.createRange()
			.createContextualFragment(`点击【登录】按钮，在弹出页面【扫码登录】`);
		textInfo
			.createDiv({
				cls: 'weread-login-desc-inline'
			})
			.appendChild(desc);

		// 右边：登录按钮
		const loginBtn = container.createEl('button', {
			cls: 'weread-action-button weread-login-btn',
			text: '登录'
		});
		loginBtn.addEventListener('click', async () => {
			loginBtn.disabled = true;
			const loginModel = new WereadLoginModel(this);
			await loginModel.doLogin();
			this.display();
		});
	}

	private saveArticleToggle(): void {
		const settings = get(settingsStore);
		const isCookieValid = settings.isCookieValid && settings.cookies.length > 0;
		const hasApiKeyOnly = Boolean(settings.wereadApiKey) && !isCookieValid;

		new Setting(this.containerEl)
			.setName('同步公众号内容')
			.setDesc(
				isCookieValid
					? '关闭后将过滤公众号内容；在黑名单模式的选择器中会单独展示这些自动排除项。'
					: hasApiKeyOnly
					? '⚠️ 此功能需要 Cookie（扫码登录获取），手动填入 API Key 无法使用。'
					: '关闭后将过滤公众号内容；在黑名单模式的选择器中会单独展示这些自动排除项。注意：公众号类型数据依赖 Cookie（需扫码登录）。'
			)
			.addToggle((toggle) => {
				if (!isCookieValid) {
					toggle.setDisabled(true);
					toggle.setValue(false);
					toggle.toggleEl.onclick = () => {
						new Notice('同步公众号内容需要 Cookie，请使用扫码登录');
					};
					return toggle;
				}
				return toggle.setValue(get(settingsStore).saveArticleToggle).onChange((value) => {
					settingsStore.actions.setSaveArticleToggle(value);
					this.display();
				});
			});
	}

	private syncPopularHighlightsToggle(): void {
		new Setting(this.containerEl)
			.setName('同步热门划线')
			.setDesc('开启后同步每本书最多 20 条热门划线（按热度排序），需要 API Key，仅 V2 支持')
			.addToggle((toggle) => {
				return toggle
					.setValue(get(settingsStore).syncPopularHighlightsToggle)
					.onChange((value) => {
						settingsStore.actions.setSyncPopularHighlightsToggle(value);
					});
			});
	}
	private saveReadingInfoToggle(): void {
		new Setting(this.containerEl)
			.setName('保存阅读元数据?')
			.setDesc('开启此选项会阅读数据写入frontmatter')
			.addToggle((toggle) => {
				return toggle
					.setValue(get(settingsStore).saveReadingInfoToggle)
					.onChange((value) => {
						settingsStore.actions.setSaveReadingInfoToggle(value);
						this.display();
					});
			});
	}
	private convertTagToggle(): void {
		new Setting(this.containerEl)
			.setName('将标签转换为双链？')
			.setDesc('开启此选项会笔记中的 #标签 转换为：[[标签]]')
			.addToggle((toggle) => {
				return toggle.setValue(get(settingsStore).convertTags).onChange((value) => {
					settingsStore.actions.setConvertTags(value);
					this.display();
				});
			});
	}

	private dailyNotes(): void {
		new Setting(this.containerEl).setName('是否保存笔记到 DailyNotes？').addToggle((toggle) => {
			return toggle.setValue(get(settingsStore).dailyNotesToggle).onChange((value) => {
				console.debug('set daily notes toggle to', value);
				settingsStore.actions.setDailyNotesToggle(value);
				this.display();
			});
		});
	}

	private dailyNotesFolder() {
		let inputRef: TextComponent | null = null;
		new Setting(this.containerEl)
			.setName('Daily Notes文件夹')
			.setDesc('请选择Daily Notes文件夹')
			.addText((text) => {
				inputRef = text;
				return text
					.setPlaceholder('例如：/ 或 Daily Notes')
					.setValue(get(settingsStore).dailyNotesLocation)
					.onChange((value: string) => {
						const nextValue = value.trim() === '' ? '/' : value.trim();
						settingsStore.actions.setDailyNotesFolder(nextValue);
					});
			})
			.addButton((button) => {
				return button.setButtonText('选择').onClick(() => {
					const modal = this.createFolderSuggestModal((value: string) => {
						const nextValue = value.trim() === '' ? '/' : value.trim();
						settingsStore.actions.setDailyNotesFolder(nextValue);
						inputRef?.setValue(nextValue);
					});
					modal.open();
				});
			});
	}

	private dailyNoteFormat() {
		new Setting(this.containerEl)
			.setName('Daily Notes Format')
			.setDesc(
				'请填写Daily Notes文件名格式，支持官方Daily Notes插件的格式，比如：YYYY-MM-DD \
				 和 Periodic Notes的嵌套格式，比如 YYYY/[W]ww/YYYY-MM-DD'
			)
			.addText((input) => {
				input.setValue(get(settingsStore).dailyNotesFormat).onChange((value: string) => {
					settingsStore.actions.setDailyNotesFormat(value);
				});
			});
	}

	private insertAfter() {
		new Setting(this.containerEl)
			.setName('在特定区间之内插入')
			.setDesc(
				'请填写Daily Notes中希望读书笔记插入的区间，使用前记得修改Daily Notes模板🫡, 💥注意: 区间之内的内容会被覆盖，请不要在区间内修改内容，'
			)
			.addText((input) => {
				input.setValue(get(settingsStore).insertAfter).onChange((value: string) => {
					settingsStore.actions.setInsertAfter(value);
				});
			})
			.addButton((btn) => {
				return (btn.setButtonText('至').buttonEl.style.borderStyle = 'none');
			})
			.addText((input) => {
				input.setValue(get(settingsStore).insertBefore).onChange((value: string) => {
					settingsStore.actions.setInsertBefore(value);
				});
			});
	}

	private subFolderType(): void {
		new Setting(this.containerEl)
			.setName('文件夹分类')
			.setDesc('请选择按照哪个维度对笔记文件进行分类')
			.addDropdown((dropdown) => {
				dropdown.addOptions({
					'-1': '无分类',
					title: '书名',
					category: '图书分类'
				});
				return dropdown
					.setValue(get(settingsStore).subFolderType)
					.onChange(async (value) => {
						settingsStore.actions.setSubFolderType(value);
					});
			});
	}

	private fileNameType(): void {
		new Setting(this.containerEl)
			.setName('文件名模板')
			.setDesc('你选择你喜欢的文件名模板，重复的书会在文件名后加上ID')
			.addDropdown((dropdown) => {
				dropdown.addOptions({
					BOOK_ID: 'bookId',
					BOOK_NAME: '书名',
					BOOK_NAME_AUTHOR: '书名-作者名',
					BOOK_NAME_BOOKID: '书名-bookId'
				});
				return dropdown
					.setValue(get(settingsStore).fileNameType)
					.onChange(async (value) => {
						settingsStore.actions.setFileNameType(value);
					});
			});
	}

	private removeParens(): void {
		new Setting(this.containerEl)
			.setName('移除书名中的括号内容')
			.setDesc('是否移除书名中的括号及其内部文字（注：谨慎启用，可能导致重名）')
			.addToggle((toggle) => {
				return toggle.setValue(get(settingsStore).removeParens).onChange((value) => {
					settingsStore.actions.setRemoveParens(value);
					this.display();
				});
			});
		// 白名单 textarea，仅在启用移除括号时显示
		if (get(settingsStore).removeParens) {
			new Setting(this.containerEl)
				.setName('括号移除白名单')
				.setDesc('如文件名包含下列任意文本，则不移除括号。每行一个关键词。')
				.addTextArea((text) => {
					text.setValue(get(settingsStore).removeParensWhitelist || '').onChange(
						(value: string) => {
							settingsStore.actions.setRemoveParensWhitelist(value);
						}
					);
				});
		}
	}

	private filterInlineImages(): void {
		new Setting(this.containerEl)
			.setName('过滤弹注图片占位符')
			.setDesc(
				'启用后，书摘中的 [图片]、[插图] 等弹注占位符将被自动移除，适合古诗文等配有大量弹注的书籍'
			)
			.addToggle((toggle) => {
				return toggle.setValue(get(settingsStore).filterInlineImages).onChange((value) => {
					settingsStore.actions.setFilterInlineImages(value);
				});
			});
	}

	private template(): void {
		new Setting(this.containerEl).setName('模板设置').setHeading();
		this.convertTagToggle();
		this.saveReadingInfoToggle();
		this.showEmptyChapterTitleToggle();

		// Theme management button - opens theme manager modal
		new Setting(this.containerEl)
			.setName('主题管理')
			.setDesc('管理模板主题，包括内置主题、自定义主题和社区主题')
			.addButton((button) => {
				return button
					.setButtonText('打开主题管理')
					.setCta()
					.onClick(() => {
						new ThemeManagerModal(this.app).open();
					});
			});

		// Show current theme info
		const activeTheme = settingsStore.actions.getActiveTheme();
		const themeType = activeTheme.isBuiltIn
			? '内置'
			: activeTheme.isReadOnly
			? '社区'
			: '自定义';
		new Setting(this.containerEl)
			.setName('当前使用')
			.setDesc(`${activeTheme.name} (${themeType})`);
	}

	private noteCountLimit() {
		new Setting(this.containerEl)
			.setName('笔记划线数量最小值')
			.setDesc('划线数量小于该值的书籍将被自动排除，并在黑名单选择器中单独展示')
			.addDropdown((dropdown) => {
				dropdown
					.addOptions({
						'-1': '无限制',
						'3': '3条',
						'5': '5条',
						'10': '10条',
						'15': '15条',
						'30': '30条'
					})
					.setValue(get(settingsStore).noteCountLimit.toString())
					.onChange(async (value) => {
						console.log('[weread plugin] new note count limit', value);
						settingsStore.actions.setNoteCountLimit(+value);
					});
			});
	}

	private readingStatsSettings(): void {
		new Setting(this.containerEl).setName('阅读统计').setHeading();

		new Setting(this.containerEl)
			.setName('Heatmap 起始年份')
			.setDesc('全部 Tab 的 Heatmap 从该年份开始展示，留空则使用注册时间。例如：2019')
			.addText((text) =>
				text
					.setPlaceholder('例如：2019')
					.setValue(get(settingsStore).statsStartYear ? String(get(settingsStore).statsStartYear) : '')
					.onChange((value) => {
						const year = parseInt(value.trim());
						settingsStore.actions.setStatsStartYear(isNaN(year) ? 0 : year);
					})
			);

	}
	private showApiKeySetting(): void {
		let apiKeyText: TextComponent;
		let statusBtn: ExtraButtonComponent;

		const applyStatus = (valid: boolean | null, btn?: ExtraButtonComponent) => {
			const b = btn ?? statusBtn;
			if (!b) return;
			if (valid === true) {
				b.setIcon('check-circle').setTooltip('API Key 有效');
				b.extraSettingsEl.style.color = 'var(--color-green)';
			} else if (valid === false) {
				b.setIcon('x-circle').setTooltip('API Key 无效，请检查或重新获取');
				b.extraSettingsEl.style.color = 'var(--color-red)';
			} else {
				b.setIcon('help-circle').setTooltip('API Key 状态未知，点击验证');
				b.extraSettingsEl.style.color = 'var(--text-muted)';
			}
		};

		const descFrag = document
			.createRange()
			.createContextualFragment(
				`用于调用微信读书 Agent API，支持同步笔记、划线、阅读统计等功能。点击「扫码获取」扫码登录后自动获取，也可在 <a href="https://weread.qq.com/r/weread-skills">weread.qq.com/r/weread-skills</a> 手动申请。格式：wrk-xxxxxxxx。<br><strong>注意：</strong>手动填写 API Key 无法使用公众号同步功能（需扫码登录获取 Cookie）。`
			);

		const setting = new Setting(this.containerEl)
			.setName('微信读书 API Key')
			.setDesc(descFrag)
			.addText((text) => {
				text.setPlaceholder('wrk-xxxxxxxx')
					.setValue(get(settingsStore).wereadApiKey ?? '')
					.onChange((value) => {
						settingsStore.actions.setWereadApiKey(value.trim());
						settingsStore.actions.setApiKeyValid(null);
						applyStatus(null);
					});
				text.inputEl.type = 'password';
				text.inputEl.style.width = '220px';
				apiKeyText = text;
				return text;
			})
			.addExtraButton((button) => {
				button.setIcon('eye')
					.setTooltip('显示/隐藏 API Key')
					.onClick(() => {
						const inputEl = apiKeyText.inputEl;
						const isPassword = inputEl.type === 'password';
						inputEl.type = isPassword ? 'text' : 'password';
						button.setIcon(isPassword ? 'eye-off' : 'eye');
					});
				return button;
			})
			.addExtraButton((button) => {
				statusBtn = button;
				applyStatus(get(settingsStore).apiKeyValid, button);
				return button;
			});

		const apiKey = get(settingsStore).wereadApiKey;
		const settings = get(settingsStore);
		const isCookieValid = settings.isCookieValid;
		const hasCookies = settings.cookies && settings.cookies.length > 0;

		if (apiKey) {
			// 只有存在 Cookie 时才显示 Cookie 状态图标
			if (hasCookies) {
				setting.addExtraButton((button) => {
					if (isCookieValid) {
						button.setIcon('cookie').setTooltip('Cookie 有效');
						button.extraSettingsEl.style.color = 'var(--color-green)';
					} else {
						button.setIcon('cookie').setTooltip('Cookie 已失效');
						button.extraSettingsEl.style.color = 'var(--color-red)';
					}
					return button;
				});
			}

			// 只有 Cookie 有效时才显示注销按钮
			if (isCookieValid) {
				setting.addButton((button) => {
					button.setButtonText('注销')
						.setTooltip('清除 API Key 和登录状态')
						.onClick(async () => {
							settingsStore.actions.clearCookies();
							settingsStore.actions.setWereadApiKey('');
							settingsStore.actions.setApiKeyValid(null);
							new Notice('已注销，API Key 已清除');
							this.display();
						});
					return button;
				});
			}

			// 进入设置页时自动校验一次，结果更新到状态图标
			statusBtn.setIcon('loader-2').setTooltip('验证中...');
			statusBtn.extraSettingsEl.style.color = 'var(--text-muted)';
			new ApiRouter().validateApiKey().then((result) => {
				settingsStore.actions.setApiKeyValid(result.valid);
				applyStatus(result.valid);
			});
		} else if (Platform.isDesktopApp) {
			setting.addButton((button) => {
				button.setButtonText('扫码获取')
					.setTooltip('扫码登录获取 API Key')
					.onClick(async () => {
						await this.handleScanApiKey(button);
					});
				return button;
			});
		}
	}

	private async handleScanApiKey(button: any): Promise<void> {
		if (!Platform.isDesktopApp) {
			new Notice('扫码登录仅支持桌面端，请在移动端手动粘贴 API Key');
			return;
		}

		const settings = get(settingsStore);
		const isLoggedIn = settings.isCookieValid && settings.cookies.length > 0;

		button.setDisabled(true);
		button.setButtonText('获取中...');

		try {
			if (isLoggedIn) {
				const apiRouter = new ApiRouter();
				const result = await apiRouter.fetchApiKey();
				if (result?.apikey) {
					settingsStore.actions.setApiKeyValid(true);
					new Notice('API Key 获取成功');
				} else {
					new Notice('API Key 获取失败，请尝试重新扫码登录');
				}
			} else {
				const loginModel = new WereadLoginModel(this);
				await loginModel.doLogin();
			}
		} catch (e) {
			console.error('[weread plugin] 扫码获取 API Key 失败', e);
			new Notice('扫码获取 API Key 失败，请查看控制台');
		} finally {
			button.setDisabled(false);
			button.setButtonText('扫码获取');
			this.display();
		}
	}

	private showDebugHelp() {
		const info = this.containerEl.createDiv();
		info.setAttr('align', 'center');
		info.setText(
			'查看控制台日志: 使用以下快捷键快速打开控制台，查看本插件以及其他插件的运行日志'
		);

		const keys = this.containerEl.createDiv();
		keys.setAttr('align', 'center');
		keys.style.margin = '10px';
		if (Platform.isMacOS === true) {
			keys.createEl('kbd', { text: 'CMD (⌘) + OPTION (⌥) + I' });
		} else {
			keys.createEl('kbd', { text: 'CTRL + SHIFT + I' });
		}
	}

	private showEmptyChapterTitleToggle(): void {
		new Setting(this.containerEl)
			.setName('展示空白章节标题？')
			.setDesc('如果启用，则章节内没有划线也将展示章节标题')
			.addToggle((toggle) => {
				return toggle
					.setValue(get(settingsStore).showEmptyChapterTitleToggle)
					.onChange((value) => {
						console.debug('set empty chapter title toggle to', value);
						settingsStore.actions.setEmptyChapterTitleToggle(value);
						this.display();
					});
			});
	}

	private showLoginMethod(): void {
		new Setting(this.containerEl)
			.setName('登录设置')
			.setHeading()
			.addDropdown((dropdown) => {
				dropdown.addOptions({
					scan: '扫码登录',
					cookieCloud: 'CookieCloud 登录'
				});
				return dropdown.setValue(get(settingsStore).loginMethod).onChange(async (value) => {
					console.debug('set login method to', value);
					settingsStore.actions.setLoginMethod(value);
					if (value !== 'apiKey') {
						settingsStore.actions.clearCookies();
					}
					this.display();
				});
			});
	}

	private showCookieCloudInfo(): void {
		const isCookieValid = get(settingsStore).isCookieValid;
		let name = '配置 CookieCloud';
		if (isCookieValid) {
			name = `微信读书已登录，用户名：  ${get(settingsStore).user}`;
		}

		new Setting(this.containerEl).setName(name).addButton((button) => {
			return button.setIcon('settings-2').onClick(async () => {
				button.setDisabled(true);
				const configModel = new CookieCloudConfigModal(this.app, this);
				configModel.open();
				this.display();
			});
		});
	}

	private showCookieStatus(): void {
		const settings = get(settingsStore);
		const isCookieValid = settings.isCookieValid;
		const hasCookies = settings.cookies && settings.cookies.length > 0;
		const lastCookieTime = settings.lastCookieTime;
		const loginMethod = settings.loginMethod;

		// 扫码登录时，Cookie 状态由登录/登出面板显示，不再单独显示
		if (loginMethod === 'scan') {
			return;
		}

		let statusText: string;
		if (isCookieValid) {
			statusText = '✅ Cookie 有效';
		} else if (hasCookies) {
			if (Platform.isDesktopApp) {
				statusText = '⚠️ Cookie 已失效，请点击刷新或重新登录';
			} else {
				statusText = '⚠️ Cookie 已失效，请在电脑端登录';
			}
		} else {
			if (Platform.isDesktopApp) {
				statusText = '❌ 未登录';
			} else {
				statusText = '❌ 未登录，请在电脑端登录';
			}
		}
		if (lastCookieTime > 0) {
			const lastRefreshStr = new Date(lastCookieTime).toLocaleString();
			statusText += `，上次刷新时间：${lastRefreshStr}`;
		}

		const setting = new Setting(this.containerEl).setName('Cookie 状态').setDesc(statusText);

		if (Platform.isDesktopApp) {
			setting.addButton((button) => {
				return button
					.setButtonText('立即刷新 Cookie')
					.setCta()
					.onClick(async () => {
						button.setDisabled(true);
						button.setButtonText('刷新中...');
						const apiRouter2 = new ApiRouter();
						await apiRouter2.refreshCookie();
						this.display();
					});
			});
		}
	}



	private scheduledSync(): void {
		new Setting(this.containerEl)
			.setName('定时同步')
			.setDesc('开启后，插件将按照设定的时间间隔自动同步微信读书笔记')
			.addToggle((toggle) => {
				return toggle.setValue(get(settingsStore).scheduledSyncToggle).onChange((value) => {
					settingsStore.actions.setScheduledSyncToggle(value);
					this.plugin.setupScheduledSync();
					this.display();
				});
			});

		if (get(settingsStore).scheduledSyncToggle) {
			this.scheduledSyncInterval();
		}
	}

	private scheduledSyncInterval(): void {
		new Setting(this.containerEl)
			.setName('定时同步间隔（分钟）')
			.setDesc('设置自动同步的时间间隔，单位为分钟（最小 1 分钟）')
			.addText((text) => {
				return text
					.setPlaceholder('5')
					.setValue(String(get(settingsStore).scheduledSyncInterval))
					.onChange((value) => {
						const num = parseInt(value, 10);
						if (!isNaN(num) && num >= 1) {
							settingsStore.actions.setScheduledSyncInterval(num);
							this.plugin.setupScheduledSync();
						}
					});
			});
	}

	private createFolderSuggestModal(onSelect: (value: string) => void) {
		const folders = this.getFolderPaths();
		return new FolderSuggestModal(this.app, folders, onSelect);
	}

	private async fetchSelectableBooks(): Promise<Metadata[]> {
		if (this.selectableBooksCache.length > 0) {
			return this.selectableBooksCache;
		}
		const settings = get(settingsStore);
		const hasApiKey2 = Boolean(settings.wereadApiKey);
		const hasCookie2 = settings.isCookieValid && settings.cookies.length > 0;
		if (!hasCookie2 && !hasApiKey2) {
			throw new Error('请先登录微信读书或配置 API Key 后再加载书籍列表');
		}
		const apiRouter2 = new ApiRouter();
		const notebookResp = await apiRouter2.getNotebooksWithRetry();
		this.selectableBooksCache = notebookResp.map((noteBook) => parseMetadata(noteBook));
		return this.selectableBooksCache;
	}

	private renderSyncModePreview(syncMode: SyncMode, selectedBookIds: Set<string>): void {
		const previewContainer = this.containerEl.createDiv({ cls: 'weread-manual-sync-preview' });
		const selectedBooks = this.selectableBooksCache.filter((book) =>
			selectedBookIds.has(book.bookId)
		);

		if (selectedBooks.length === 0) {
			previewContainer.createDiv({
				cls: 'setting-item-description',
				text:
					this.selectableBooksLoadingPromise !== null
						? '正在异步加载书籍信息，请稍候...'
						: `${getSyncModeText(syncMode)}已选书籍共 ${
								selectedBookIds.size
						  } 本（部分书籍信息尚未加载）`
			});
			return;
		}

		for (const book of selectedBooks) {
			const card = previewContainer.createDiv({ cls: 'weread-selected-book-card' });
			const cover = card.createEl('img', { cls: 'weread-selected-book-cover' });
			cover.src = book.cover;
			cover.alt = book.title;

			const details = card.createDiv({ cls: 'weread-selected-book-details' });
			details.createDiv({ cls: 'weread-selected-book-title', text: book.title });
			details.createDiv({ cls: 'weread-selected-book-author', text: book.author });
			details.createDiv({
				cls: 'weread-book-selector-meta',
				text: `划线：${book.noteCount} 条`
			});
			details.createDiv({
				cls: 'weread-book-selector-meta',
				text: getBookLastReadText(book)
			});
		}
	}
}

class FolderSuggestModal extends FuzzySuggestModal<string> {
	private folders: string[];
	private onSelectFolder: (value: string) => void;

	constructor(app: App, folders: string[], onSelect: (value: string) => void) {
		super(app);
		this.folders = folders;
		this.onSelectFolder = onSelect;
		this.setPlaceholder('选择或搜索文件夹路径');
	}

	getItems(): string[] {
		return this.folders;
	}

	getItemText(item: string): string {
		return item;
	}

	onChooseItem(item: string): void {
		this.onSelectFolder(item);
	}
}

class ManualSyncBookSelectorModal extends Modal {
	private searchKeyword = '';
	private selectionFilter: 'all' | 'selected' | 'unselected' = 'all';
	private selectedBookIds: Set<string>;
	private selectedCountEl: HTMLElement;
	private listEl: HTMLElement;
	private selectedListEl: HTMLElement;

	constructor(
		app: App,
		private books: Metadata[],
		private syncMode: SyncMode,
		private selectorOptions: {
			hideArticles: boolean;
			noteCountLimit: number;
		},
		selectedBookIds: Set<string>,
		private onSaveSelection: (bookIds: string[]) => void
	) {
		super(app);
		this.selectedBookIds = new Set(selectedBookIds);
	}

	onOpen() {
		const { contentEl, modalEl } = this;
		contentEl.empty();
		modalEl.addClass('weread-book-selector-modal');
		modalEl.style.width = '90vw';
		modalEl.style.maxWidth = '960px';
		modalEl.style.height = '80vh';
		modalEl.style.maxHeight = '80vh';
		const isBlacklistMode = this.syncMode === 'blacklist';
		if (isBlacklistMode) {
			for (const book of this.books) {
				if (this.isAutoExcluded(book)) {
					this.selectedBookIds.delete(book.bookId);
				}
			}
		}

		const header = contentEl.createDiv({ cls: 'weread-book-selector-header' });
		header.createEl('h2', { text: isBlacklistMode ? '选择要排除的书籍' : '选择要同步的书籍' });
		this.selectedCountEl = header.createDiv({ cls: 'weread-book-selector-count' });

		const toolbar = contentEl.createDiv({ cls: 'weread-book-selector-toolbar' });
		const searchInput = toolbar.createEl('input', {
			type: 'search',
			cls: 'weread-book-selector-search'
		});
		searchInput.placeholder = '搜索书名或作者';
		searchInput.addEventListener('input', () => {
			this.searchKeyword = searchInput.value.trim().toLowerCase();
			this.renderBooks();
		});

		const selectionSelect = toolbar.createEl('select', { cls: 'dropdown' });
		[
			['all', '全部书籍'],
			['selected', isBlacklistMode ? '仅看已排除' : '仅看已选'],
			['unselected', isBlacklistMode ? '仅看未排除' : '仅看未选']
		].forEach(([value, label]) => {
			selectionSelect.createEl('option', { value, text: label });
		});
		selectionSelect.addEventListener('change', () => {
			this.selectionFilter = selectionSelect.value as 'all' | 'selected' | 'unselected';
			this.renderBooks();
		});

		const toolbarActions = toolbar.createDiv({ cls: 'weread-book-selector-actions' });
		const selectFilteredButton = toolbarActions.createEl('button', {
			text: isBlacklistMode ? '排除当前结果' : '勾选当前结果'
		});
		selectFilteredButton.onclick = () => {
			for (const book of this.getFilteredBooks()) {
				this.selectedBookIds.add(book.bookId);
			}
			this.renderBooks();
		};

		const clearSelectionButton = toolbarActions.createEl('button', { text: '清空选择' });
		clearSelectionButton.onclick = () => {
			this.selectedBookIds.clear();
			this.renderBooks();
		};

		const body = contentEl.createDiv({ cls: 'weread-book-selector-panels' });
		const listPanel = body.createDiv({ cls: 'weread-book-selector-list-panel' });
		listPanel.createEl('h3', { text: '书籍列表' });
		this.listEl = listPanel.createDiv({ cls: 'weread-book-selector-grid' });
		const selectedPanel = body.createDiv({ cls: 'weread-book-selector-selected-panel' });
		selectedPanel.createEl('h3', {
			text: isBlacklistMode ? '已排除书籍' : '已选择书籍'
		});
		this.selectedListEl = selectedPanel.createDiv({
			cls: 'weread-book-selector-selected-list'
		});
		this.renderBooks();

		const footer = contentEl.createDiv({ cls: 'weread-book-selector-footer' });
		const cancelButton = footer.createEl('button', { text: '取消', cls: 'mod-cancel' });
		cancelButton.onclick = () => this.close();

		const saveButton = footer.createEl('button', { text: '保存选择', cls: 'mod-cta' });
		saveButton.onclick = () => {
			const orderedBookIds = this.books
				.filter((book) => this.selectedBookIds.has(book.bookId))
				.map((book) => book.bookId);
			this.onSaveSelection(orderedBookIds);
			this.close();
		};
	}

	onClose() {
		this.contentEl.empty();
	}

	private renderBooks(): void {
		this.listEl.empty();
		this.selectedListEl.empty();
		const filteredBooks = this.getFilteredBooks();
		const selectedText = this.syncMode === 'blacklist' ? '已排除' : '已选择';
		this.selectedCountEl.setText(
			`${selectedText} ${this.selectedBookIds.size} 本 / 共 ${this.books.length} 本`
		);

		if (filteredBooks.length === 0) {
			this.listEl.createDiv({
				cls: 'weread-book-selector-empty',
				text: '没有找到匹配的书籍'
			});
		} else {
			for (const book of filteredBooks) {
				const isSelected = this.selectedBookIds.has(book.bookId);
				const card = this.listEl.createDiv({ cls: 'weread-book-selector-card' });
				if (isSelected) {
					card.addClass('is-selected');
				}
				card.onclick = () => {
					if (this.selectedBookIds.has(book.bookId)) {
						this.selectedBookIds.delete(book.bookId);
					} else {
						this.selectedBookIds.add(book.bookId);
					}
					this.renderBooks();
				};

				const checkbox = card.createEl('input', {
					type: 'checkbox',
					cls: 'weread-book-selector-checkbox'
				});
				checkbox.checked = isSelected;
				checkbox.onclick = (event) => event.stopPropagation();
				checkbox.onchange = () => {
					if (checkbox.checked) {
						this.selectedBookIds.add(book.bookId);
					} else {
						this.selectedBookIds.delete(book.bookId);
					}
					this.renderBooks();
				};

				this.renderBookCardDetails(card, book);
			}
		}
		this.renderSelectedBooks();
	}

	private getFilteredBooks(): Metadata[] {
		return this.books.filter((book) => {
			if (this.isAutoExcluded(book)) {
				return false;
			}
			const searchTarget = `${book.title} ${book.author}`.toLowerCase();
			const selectionMatched =
				this.selectionFilter === 'all' ||
				(this.selectionFilter === 'selected' && this.selectedBookIds.has(book.bookId)) ||
				(this.selectionFilter === 'unselected' && !this.selectedBookIds.has(book.bookId));
			const searchMatched = !this.searchKeyword || searchTarget.includes(this.searchKeyword);
			return selectionMatched && searchMatched;
		});
	}

	private renderSelectedBooks(): void {
		const selectedBooks = this.books.filter((book) => this.selectedBookIds.has(book.bookId));
		const articleExcludedBooks = this.getAutoExcludedBooks('article');
		const noteCountExcludedBooks = this.getAutoExcludedBooks('noteCount');
		if (
			selectedBooks.length === 0 &&
			articleExcludedBooks.length === 0 &&
			noteCountExcludedBooks.length === 0
		) {
			this.selectedListEl.createDiv({
				cls: 'weread-book-selector-empty',
				text: this.syncMode === 'blacklist' ? '暂无已排除的书籍' : '暂无已选择的书籍'
			});
			return;
		}

		if (selectedBooks.length > 0) {
			const section = this.selectedListEl.createDiv({ cls: 'weread-book-selector-section' });
			section.createEl('h4', {
				text: this.syncMode === 'blacklist' ? '手动排除' : '已选择'
			});
			for (const book of selectedBooks) {
				const card = section.createDiv({
					cls: 'weread-book-selector-selected-card'
				});
				this.renderBookCardDetails(card, book);
				const removeButton = card.createEl('button', {
					cls: 'weread-book-selector-remove',
					text: '移除'
				});
				removeButton.onclick = () => {
					this.selectedBookIds.delete(book.bookId);
					this.renderBooks();
				};
			}
		}

		if (this.syncMode === 'blacklist' && articleExcludedBooks.length > 0) {
			this.renderAutoExcludedSection(
				'已自动排除的公众号',
				articleExcludedBooks,
				'由”同步公众号内容”设置自动排除'
			);
		}

		if (this.syncMode === 'blacklist' && noteCountExcludedBooks.length > 0) {
			const thresholdText =
				this.selectorOptions.noteCountLimit !== UNLIMITED_NOTE_COUNT
					? `划线少于 ${this.selectorOptions.noteCountLimit} 条，已自动排除`
					: '已自动排除';
			this.renderAutoExcludedSection(
				'已自动排除的低划线书籍',
				noteCountExcludedBooks,
				thresholdText
			);
		}
	}

	private renderBookCardDetails(card: HTMLElement, book: Metadata): void {
		const cover = card.createEl('img', { cls: 'weread-book-selector-cover' });
		cover.src = book.cover;
		cover.alt = book.title;

		const details = card.createDiv({ cls: 'weread-book-selector-card-details' });
		details.createDiv({ cls: 'weread-book-selector-title', text: book.title });
		details.createDiv({ cls: 'weread-book-selector-author', text: book.author });
		details.createDiv({
			cls: 'weread-book-selector-meta',
			text: `划线：${book.noteCount} 条`
		});
		details.createDiv({
			cls: 'weread-book-selector-meta',
			text: getBookLastReadText(book)
		});
	}

	private renderAutoExcludedSection(title: string, books: Metadata[], description: string): void {
		const section = this.selectedListEl.createDiv({ cls: 'weread-book-selector-section' });
		section.createEl('h4', { text: title });
		section.createDiv({
			cls: 'weread-book-selector-section-description',
			text: description
		});
		for (const book of books) {
			const card = section.createDiv({
				cls: 'weread-book-selector-selected-card is-disabled'
			});
			this.renderBookCardDetails(card, book);
		}
	}

	private getAutoExcludedBooks(reason: 'article' | 'noteCount'): Metadata[] {
		if (this.syncMode !== 'blacklist') {
			return [];
		}
		return this.books.filter((book) => {
			if (reason === 'article') {
				return this.selectorOptions.hideArticles && book.bookType === 3;
			}
			return (
				this.selectorOptions.noteCountLimit !== UNLIMITED_NOTE_COUNT &&
				book.bookType !== 3 &&
				book.noteCount < this.selectorOptions.noteCountLimit
			);
		});
	}

	private isAutoExcluded(book: Metadata): boolean {
		if (this.selectorOptions.hideArticles && book.bookType === 3) {
			return true;
		}
		return (
			this.syncMode === 'blacklist' &&
			this.selectorOptions.noteCountLimit !== UNLIMITED_NOTE_COUNT &&
			book.noteCount < this.selectorOptions.noteCountLimit
		);
	}
}
