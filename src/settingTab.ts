import WereadPlugin from 'main';
import {
	App,
	FuzzySuggestModal,
	Platform,
	PluginSettingTab,
	Setting,
	TFolder,
	TextComponent
} from 'obsidian';
import { settingsStore } from './settings';
import { get } from 'svelte/store';
import WereadLoginModel from './components/wereadLoginModel';
import WereadLogoutModel from './components/wereadLogoutModel';
import CookieCloudConfigModal from './components/cookieCloudConfigModel';
import { TemplateEditorWindow } from './components/templateEditorWindow';

import { Renderer } from './renderer';
import { getEncodeCookieString } from './utils/cookiesUtil';
import { Notice } from 'obsidian';
import ApiManager from './api';

export class WereadSettingsTab extends PluginSettingTab {
	private plugin: WereadPlugin;
	private renderer: Renderer;

	constructor(app: App, plugin: WereadPlugin) {
		super(app, plugin);
		this.plugin = plugin;
		this.renderer = new Renderer();
	}

	display() {
		const { containerEl } = this;
		containerEl.empty();
		containerEl.createEl('h2', { text: '设置微信读书插件' });

		// 登录设置仅在桌面端显示
		if (Platform.isDesktopApp) {
			this.showLoginMethod();
		}

		const isCookieValid = get(settingsStore).isCookieValid;
		const loginMethod = get(settingsStore).loginMethod;

		if (loginMethod === 'scan') {
			if (Platform.isDesktopApp) {
				if (isCookieValid) {
					this.showLogout();
				} else {
					this.showLogin();
				}
			} else {
				if (isCookieValid) {
					this.showMobileLogout();
				} else {
					this.showMobileLogin();
				}
			}
		} else {
			this.showCookieCloudInfo();
		}

		this.showCookieStatus();
		if (Platform.isDesktopApp) {
			this.cookieAutoRefresh();
			if (get(settingsStore).cookieAutoRefreshToggle) {
				this.cookieRefreshInterval();
			}
		}

		this.notebookFolder();
		this.notebookBlacklist();
		this.noteCountLimit();
		this.fileNameType();
		this.removeParens();
		this.subFolderType();
		this.convertTagToggle();
		this.saveArticleToggle();
		this.saveReadingInfoToggle();
		this.showEmptyChapterTitleToggle();
		this.dailyNotes();
		const dailyNotesToggle = get(settingsStore).dailyNotesToggle;
		if (dailyNotesToggle) {
			this.dailyNotesFolder();
			this.dailyNoteFormat();
			this.insertAfter();
		}
		this.template();
		if (Platform.isDesktopApp) {
			this.showDebugHelp();
		}
	}

	private showMobileLogin() {
		const container = this.containerEl.createDiv({
			cls: 'weread-mobile-login-container'
		});
		container.createEl('div', {
			cls: 'weread-mobile-login-text',
			text: '微信读书未登录'
		});
		container.createEl('div', {
			cls: 'weread-mobile-login-desc',
			text: '请先在电脑端登录'
		});
	}

	private showMobileLogout() {
		const container = this.containerEl.createDiv();
		const userAvatar = get(settingsStore).userAvatar;
		const userName = get(settingsStore).user;

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
		userInfo.createEl('div', {
			cls: 'weread-user-name',
			text: `微信读书已登录，用户名：${userName}`
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

	private notebookBlacklist(): void {
		new Setting(this.containerEl)
			.setName('书籍黑名单')
			.setDesc('请填写不同步的bookId，bookId可在meta信息中找到，多本书使用逗号「，」隔开')
			.addTextArea((input) => {
				input.setValue(get(settingsStore).notesBlacklist).onChange((value: string) => {
					settingsStore.actions.setNoteBlacklist(value);
				});
			});
	}

	private showLogin(): void {
		const container = this.containerEl.createDiv({
			cls: 'weread-login-action'
		});
		const desc = document
			.createRange()
			.createContextualFragment(`点击【登录】按钮，在弹出页面【扫码登录】`);

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

		const descContainer = this.containerEl.createDiv({
			cls: 'weread-login-desc'
		});
		descContainer.appendChild(desc);
	}

	private saveArticleToggle(): void {
		new Setting(this.containerEl)
			.setName('同步公众号文章?')
			.setDesc('开启此选项会将同步公众号文章到单独的笔记中')
			.addToggle((toggle) => {
				return toggle.setValue(get(settingsStore).saveArticleToggle).onChange((value) => {
					settingsStore.actions.setSaveArticleToggle(value);
					this.display();
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
		new Setting(this.containerEl)
			.setName('是否保存笔记到 DailyNotes？')
			.setHeading()
			.addToggle((toggle) => {
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

	private showLogout(): void {
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

		const desc = document
			.createRange()
			.createContextualFragment(
				`点击【注销】按钮，在弹出书架页面右上角点击头像，下拉菜单选择【退出登录】`
			);

		// 创建自定义容器而不是使用 Setting 的默认名称
		const userContainer = this.containerEl.createDiv({
			cls: 'weread-user-logout-container'
		});

		// 左边：头像 + 用户信息
		const userInfoLeft = userContainer.createDiv({
			cls: 'weread-user-info-left'
		});

		// 头像
		if (userAvatar) {
			const avatarImg = userInfoLeft.createEl('img', {
				cls: 'weread-user-avatar-desktop'
			});
			avatarImg.src = userAvatar;
			avatarImg.alt = '用户头像';
		}

		// 用户名和描述
		const userTextInfo = userInfoLeft.createDiv({
			cls: 'weread-user-text-info'
		});
		userTextInfo.createEl('div', {
			cls: 'weread-user-name-title',
			text: `微信读书已登录`
		});
		userTextInfo.createEl('div', {
			cls: 'weread-user-name-value',
			text: `用户名：${userName}`
		});
		// Cookie 状态
		userTextInfo.createEl('div', {
			cls: 'weread-cookie-status',
			text: statusText
		});
		// 注销说明
		userTextInfo
			.createEl('div', {
				cls: 'weread-logout-desc-inline'
			})
			.appendChild(desc);

		// 右边：按钮
		const buttonGroup = userContainer.createDiv({
			cls: 'weread-button-group'
		});

		// 刷新 Cookie 按钮（仅桌面端）
		if (Platform.isDesktopApp) {
			const refreshBtn = buttonGroup.createEl('button', {
				cls: 'weread-action-button weread-refresh-btn',
				text: '刷新 Cookie'
			});
			refreshBtn.addEventListener('click', async () => {
				refreshBtn.disabled = true;
				refreshBtn.textContent = '刷新中...';
				const apiManager = new ApiManager();
				await apiManager.refreshCookie(true);
				this.display();
			});
		}

		// 注销按钮
		const logoutBtn = buttonGroup.createEl('button', {
			cls: 'weread-action-button weread-logout-btn',
			text: '注销'
		});
		logoutBtn.addEventListener('click', async () => {
			logoutBtn.disabled = true;
			const logoutModel = new WereadLogoutModel(this);
			await logoutModel.doLogout();
			this.display();
		});
	}

	private template(): void {
		new Setting(this.containerEl)
			.setName('笔记模板设置')
			.setHeading()
			.addButton((button) => {
				return button
					.setButtonText('编辑模板')
					.setCta()
					.onClick(() => {
						const editorWindow = new TemplateEditorWindow(
							this.app,
							get(settingsStore).template,
							(newTemplate: string) => {
								settingsStore.actions.setTemplate(newTemplate);
							}
						);
						editorWindow.open();
					});
			});
	}

	private noteCountLimit() {
		new Setting(this.containerEl)
			.setName('笔记划线数量最小值')
			.setDesc('划线数量小于该值的笔记将不会被同步')
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
			.setHeading()
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
					cookieCloud: 'CookieCloud登录'
				});
				return dropdown.setValue(get(settingsStore).loginMethod).onChange(async (value) => {
					console.debug('set login method to', value);
					settingsStore.actions.setLoginMethod(value);
					settingsStore.actions.clearCookies();
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

		// 扫码登录且已登录时，Cookie 状态已显示在头像卡片中，不再单独显示
		if (loginMethod === 'scan' && isCookieValid) {
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
						const apiManager = new ApiManager();
						await apiManager.refreshCookie();
						this.display();
					});
			});
		}
	}

	private cookieAutoRefresh(): void {
		new Setting(this.containerEl)
			.setName('自动刷新 Cookie')
			.setDesc('启动 Obsidian 时自动刷新 Cookie，并按照设定的时间间隔定期刷新')
			.addToggle((toggle) => {
				return toggle
					.setValue(get(settingsStore).cookieAutoRefreshToggle)
					.onChange((value) => {
						settingsStore.actions.setCookieAutoRefreshToggle(value);
						this.plugin.setupCookieRefresh();
						this.display();
					});
			});
	}

	private cookieRefreshInterval(): void {
		new Setting(this.containerEl)
			.setName('Cookie 刷新间隔（小时）')
			.setDesc('设置自动刷新 Cookie 的时间间隔，单位为小时（最小 1 小时）')
			.addText((text) => {
				return text
					.setPlaceholder('12')
					.setValue(String(get(settingsStore).cookieRefreshInterval))
					.onChange((value) => {
						const num = parseInt(value, 10);
						if (!isNaN(num) && num >= 1) {
							settingsStore.actions.setCookieRefreshInterval(num);
							this.plugin.setupCookieRefresh();
						}
					});
			});
	}

	private createFolderSuggestModal(onSelect: (value: string) => void) {
		const folders = this.getFolderPaths();
		return new FolderSuggestModal(this.app, folders, onSelect);
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
