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

		this.showLoginMethod();

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
		this.cookieAutoRefresh();
		if (get(settingsStore).cookieAutoRefreshToggle) {
			this.cookieRefreshInterval();
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
		const info = this.containerEl.createDiv();
		info.setText('微信读书未登录，请先在电脑端登录！');
	}

	private showMobileLogout() {
		const info = this.containerEl.createDiv();
		info.setText(`微信读书已登录，用户名：${get(settingsStore).user}`);
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
		new Setting(this.containerEl).setName('登录微信读书').addButton((button) => {
			return button
				.setButtonText('登录')
				.setCta()
				.onClick(async () => {
					button.setDisabled(true);
					const logoutModel = new WereadLoginModel(this);
					await logoutModel.doLogin();
					this.display();
				});
		});
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
		document.createRange().createContextualFragment;
		const desc = document.createRange().createContextualFragment(
			`1. 登录：点击登录按钮，在弹出页面【扫码登录】。
             2. 注销：点击注销，在弹出书架页面右上角点击头像，下拉菜单选择【退出登录】`
		);

		new Setting(this.containerEl)
			.setName(`微信读书已登录，用户名：  ${get(settingsStore).user}`)
			.setDesc(desc)
			.addButton((button) => {
				return button
					.setButtonText('注销')
					.setCta()
					.onClick(async () => {
						button.setDisabled(true);
						const logoutModel = new WereadLogoutModel(this);
						await logoutModel.doLogout();
						this.display();
					});
			})
			.addButton((button) => {
				return button
					.setButtonText('拷贝Cookie')
					.setCta()
					.onClick(async () => {
						const cookieStr = getEncodeCookieString();
						navigator.clipboard.writeText(cookieStr).then(
							function () {
								new Notice('拷贝Cookie到剪切板成功！');
							},
							function (error) {
								new Notice('拷贝Cookie到剪切板失败！');
								console.error('拷贝微信读书Cookie失败', error);
							}
						);
					});
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
		new Setting(this.containerEl).setName('登录方式').addDropdown((dropdown) => {
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
		const lastCookieTime = settings.lastCookieTime;

		let statusText = isCookieValid ? '✅ Cookie 有效' : '❌ Cookie 无效或未登录';
		if (lastCookieTime > 0) {
			const lastRefreshStr = new Date(lastCookieTime).toLocaleString();
			statusText += `，上次刷新时间：${lastRefreshStr}`;
		}

		new Setting(this.containerEl)
			.setName('Cookie 状态')
			.setDesc(statusText)
			.addButton((button) => {
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
			.setName('Cookie 刷新间隔（分钟）')
			.setDesc('设置自动刷新 Cookie 的时间间隔，单位为分钟（最小 5 分钟）')
			.addText((text) => {
				return text
					.setPlaceholder('60')
					.setValue(String(get(settingsStore).cookieRefreshInterval))
					.onChange((value) => {
						const num = parseInt(value, 10);
						if (!isNaN(num) && num >= 5) {
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
