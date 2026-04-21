import { App, Modal, Notice, TextComponent } from 'obsidian';
import { settingsStore } from '../settings';
import { TemplateEditorWindow } from './templateEditorWindow';
import type { Theme } from '../models';
import { get } from 'svelte/store';

export class ThemeManagerModal extends Modal {
	constructor(app: App) {
		super(app);
	}

	onOpen() {
		const { contentEl, modalEl } = this;
		contentEl.empty();

		modalEl.classList.add('weread-theme-manager-modal');
		modalEl.style.width = '80vw';
		modalEl.style.maxWidth = '800px';
		modalEl.style.height = '70vh';
		modalEl.style.maxHeight = '70vh';

		// Header
		const header = contentEl.createDiv('theme-manager-header');
		header.createEl('h2', { text: '主题管理' });

		// Theme list container
		const themeList = contentEl.createDiv('theme-manager-list');

		const settings = get(settingsStore);
		const themes = settings.themes;
		const activeThemeId = settings.activeThemeId;

		// Sort themes: active theme first, then the rest
		const sortedThemes = [...themes].sort((a, b) => {
			if (a.id === activeThemeId) return -1;
			if (b.id === activeThemeId) return 1;
			return 0;
		});

		sortedThemes.forEach((theme) => {
			const isActive = theme.id === activeThemeId;
			const card = themeList.createDiv('theme-card');
			if (isActive) {
				card.addClass('is-active');
			}

			// Theme header
			const cardHeader = card.createDiv('theme-card-header');
			const titleGroup = cardHeader.createDiv('theme-title-group');

			titleGroup.createEl('h3', { text: theme.name });
			const badge = titleGroup.createSpan('theme-badge');
			if (theme.source === 'legacy') {
				badge.textContent = '旧模板';
				badge.addClass('badge-legacy');
			} else if (theme.isBuiltIn) {
				badge.textContent = '内置';
				badge.addClass('badge-builtin');
			} else if (theme.isReadOnly) {
				badge.textContent = '社区';
				badge.addClass('badge-community');
			} else {
				badge.textContent = '自定义';
				badge.addClass('badge-custom');
			}

			// Active indicator
			if (isActive) {
				const activeBadge = titleGroup.createSpan('theme-active-badge');
				activeBadge.textContent = '✓ 使用中';
			}

			// Description
			if (theme.description) {
				card.createEl('p', { text: theme.description, cls: 'theme-description' });
			}

			// Author info
			if (theme.author) {
				card.createEl('p', { text: `作者: ${theme.author}`, cls: 'theme-author' });
			}

			// Actions
			const actions = card.createDiv('theme-card-actions');

			// Select button
			if (!isActive) {
				const selectBtn = actions.createEl('button', {
					text: '使用此主题',
					cls: 'theme-btn'
				});
				selectBtn.onclick = () => {
					settingsStore.actions.setActiveTheme(theme.id);
					new Notice(`已切换到: ${theme.name}`);
					this.onOpen(); // Refresh
				};
			}

			// Preview button
			const previewBtn = actions.createEl('button', { text: '预览', cls: 'theme-btn' });
			previewBtn.onclick = () => {
				// For legacy themes, use settings.template for preview
				const templateForPreview = (theme.source === 'legacy' || theme.id === 'legacy_template')
					? get(settingsStore).template
					: theme.template;
				const editorWindow = new TemplateEditorWindow(
					this.app,
					templateForPreview,
					() => {},
					theme.trimBlocks,
					undefined,
					true, // readOnly
					theme.name
				);
				editorWindow.open();
			};

			// Edit button (only for non-readonly themes)
			if (!theme.isReadOnly) {
				const editBtn = actions.createEl('button', { text: '编辑', cls: 'theme-btn' });
				editBtn.onclick = () => {
					const editorWindow = new TemplateEditorWindow(
						this.app,
						theme.template,
						(newTemplate: string) => {
							settingsStore.actions.saveTheme({
								...theme,
								template: newTemplate
							});
							new Notice('主题已保存');
						},
						theme.trimBlocks,
						(trimBlocks: boolean) => {
							settingsStore.actions.saveTheme({
								...theme,
								trimBlocks
							});
						},
						false,
						theme.name
					);
					editorWindow.open();
				};
			}

			// Rename button (only for custom themes, not built-in/readonly)
			if (!theme.isBuiltIn && !theme.isReadOnly) {
				const renameBtn = actions.createEl('button', { text: '重命名', cls: 'theme-btn' });
				renameBtn.onclick = () => {
					new RenameModal(this.app, theme.name, (newName) => {
						if (newName && newName.trim() && newName.trim() !== theme.name) {
							settingsStore.actions.saveTheme({
								...theme,
								name: newName.trim()
							});
							new Notice(`已重命名为: ${newName.trim()}`);
							this.onOpen();
						}
					}).open();
				};
			}

			// Duplicate button for all themes (except already custom themes)
			if (theme.isBuiltIn || theme.isReadOnly || theme.source === 'legacy') {
				const duplicateBtn = actions.createEl('button', {
					text: '复制并自定义',
					cls: 'theme-btn'
				});
				duplicateBtn.onclick = () => {
					const newName = `${theme.name} (副本)`;
					settingsStore.actions.duplicateTheme(theme.id, newName);
					new Notice(`已创建副本: ${newName}`);
					this.onOpen(); // Refresh
				};
			}

			// Delete button (only for user themes, not active)
			if (!theme.isBuiltIn && !isActive) {
				const deleteBtn = actions.createEl('button', {
					text: '删除',
					cls: 'theme-btn mod-danger'
				});
				deleteBtn.onclick = () => {
					if (confirm(`确定要删除 "${theme.name}" 吗？`)) {
						// For legacy themes, also clear the settings.template
						if (theme.source === 'legacy' || theme.id === 'legacy_template') {
							settingsStore.actions.clearLegacyTemplate();
						}
						settingsStore.actions.deleteTheme(theme.id);
						new Notice('主题已删除');
						this.onOpen(); // Refresh
					}
				};
			}

			// Export button
			const exportBtn = actions.createEl('button', { text: '导出', cls: 'theme-btn' });
			exportBtn.onclick = () => {
				const exportData = {
					manifest: {
						id: theme.id,
						name: theme.name,
						description: theme.description ?? '',
						author: theme.author ?? 'user',
						version: theme.version ?? '1.0.0'
					},
					theme: {
						template: theme.template,
						trimBlocks: theme.trimBlocks
					}
				};
				const blob = new Blob([JSON.stringify(exportData, null, 2)], {
					type: 'application/json'
				});
				const url = URL.createObjectURL(blob);
				const a = document.createElement('a');
				a.href = url;
				a.download = `${theme.name.replace(/\s+/g, '_')}_theme.json`;
				a.click();
				URL.revokeObjectURL(url);
				new Notice('主题已导出');
			};
		});

		// Import section
		const importSection = contentEl.createDiv('theme-import-section');
		importSection.createEl('h3', { text: '导入主题' });

		importSection.createEl('p', {
			text: '从 JSON 文件或 URL 导入社区主题'
		});

		const importBtnGroup = importSection.createDiv('theme-import-buttons');

		const importBtn = importBtnGroup.createEl('button', {
			text: '选择文件',
			cls: 'theme-btn mod-cta'
		});
		importBtn.onclick = () => {
			const input = document.createElement('input');
			input.type = 'file';
			input.accept = '.json';
			input.onchange = async () => {
				const file = input.files?.[0];
				if (!file) return;
				try {
					const text = await file.text();
					const data = JSON.parse(text);
					if (!data.manifest || !data.theme) {
						new Notice('无效的主题文件格式');
						return;
					}
					const importedTheme: Theme = {
						id: `user_${Date.now()}`,
						name: data.manifest.name,
						description: data.manifest.description,
						template: data.theme.template,
						trimBlocks: data.theme.trimBlocks ?? false,
						isBuiltIn: false,
						isReadOnly: false,
						source: 'custom',
						author: data.manifest.author,
						version: data.manifest.version
					};
					settingsStore.actions.saveTheme(importedTheme);
					settingsStore.actions.setActiveTheme(importedTheme.id);
					new Notice(`主题 "${importedTheme.name}" 导入成功`);
					this.onOpen();
				} catch (error) {
					new Notice(
						'导入失败: ' + (error instanceof Error ? error.message : String(error))
					);
				}
			};
			input.click();
		};

		const importUrlBtn = importBtnGroup.createEl('button', {
			text: '从 URL 导入',
			cls: 'theme-btn'
		});
		importUrlBtn.onclick = () => {
			new ImportUrlModal(this.app, (theme) => {
				settingsStore.actions.saveTheme(theme);
				settingsStore.actions.setActiveTheme(theme.id);
				new Notice(`主题 "${theme.name}" 导入成功`);
				this.onOpen();
			}).open();
		};

		// Close button
		const closeSection = contentEl.createDiv('theme-close-section');
		const closeBtn = closeSection.createEl('button', { text: '关闭', cls: 'mod-cancel' });
		closeBtn.onclick = () => this.close();
	}

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
	}
}

class RenameModal extends Modal {
	private onRename: (newName: string) => void;

	constructor(app: App, private currentName: string, onRename: (newName: string) => void) {
		super(app);
		this.onRename = onRename;
	}

	onOpen() {
		const { contentEl, modalEl } = this;
		contentEl.empty();

		modalEl.style.width = '400px';

		const header = contentEl.createDiv('theme-rename-header');
		header.createEl('h3', { text: '重命名主题' });

		const inputContainer = contentEl.createDiv('theme-rename-input');
		const input = new TextComponent(inputContainer);
		input.setValue(this.currentName);
		input.inputEl.style.width = '100%';
		input.setPlaceholder('请输入新的主题名称');

		const actions = contentEl.createDiv('theme-rename-actions');
		const cancelBtn = actions.createEl('button', { text: '取消', cls: 'mod-cancel' });
		cancelBtn.onclick = () => this.close();

		const confirmBtn = actions.createEl('button', { text: '确定', cls: 'mod-cta' });
		confirmBtn.onclick = () => {
			const newName = input.getValue();
			this.onRename(newName);
			this.close();
		};
	}

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
	}
}

class ImportUrlModal extends Modal {
	private onImport: (theme: Theme) => void;

	constructor(app: App, onImport: (theme: Theme) => void) {
		super(app);
		this.onImport = onImport;
	}

	onOpen() {
		const { contentEl, modalEl } = this;
		contentEl.empty();

		modalEl.style.width = '500px';

		const header = contentEl.createDiv('theme-import-url-header');
		header.createEl('h3', { text: '从 URL 导入主题' });

		const inputContainer = contentEl.createDiv('theme-import-url-input');
		const input = new TextComponent(inputContainer);
		input.setValue('');
		input.inputEl.style.width = '100%';
		input.setPlaceholder('请输入主题 JSON 的 URL 地址');

		const actions = contentEl.createDiv('theme-import-url-actions');
		const cancelBtn = actions.createEl('button', { text: '取消', cls: 'mod-cancel' });
		cancelBtn.onclick = () => this.close();

		const importBtn = actions.createEl('button', { text: '导入', cls: 'mod-cta' });
		importBtn.onclick = async () => {
			const url = input.getValue().trim();
			if (!url) {
				new Notice('请输入 URL 地址');
				return;
			}

			try {
				new Notice('正在下载...');
				const response = await fetch(url);
				if (!response.ok) {
					throw new Error(`HTTP ${response.status}`);
				}
				const text = await response.text();
				const data = JSON.parse(text);

				if (!data.manifest || !data.theme) {
					new Notice('无效的主题文件格式');
					return;
				}

				const importedTheme: Theme = {
					id: `user_${Date.now()}`,
					name: data.manifest.name,
					description: data.manifest.description,
					template: data.theme.template,
					trimBlocks: data.theme.trimBlocks ?? false,
					isBuiltIn: false,
					isReadOnly: false,
					source: 'custom',
					author: data.manifest.author,
					version: data.manifest.version
				};

				this.onImport(importedTheme);
				this.close();
			} catch (error) {
				new Notice('导入失败: ' + (error instanceof Error ? error.message : String(error)));
			}
		};
	}

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
	}
}
