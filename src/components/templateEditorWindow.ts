import { Modal, App, Notice, MarkdownRenderer } from 'obsidian';
import { Renderer } from '../renderer';
import type { Notebook } from '../models';
import templateInstructions from '../assets/templateInstructions.html';
import { settingsStore } from '../settings';
import { get } from 'svelte/store';

export class TemplateEditorWindow extends Modal {
	private initialTemplate: string;
	private onSave: (template: string) => void;
	private renderer: Renderer;
	private editorEl: HTMLTextAreaElement;
	private previewEl: HTMLElement;
	private errorEl: HTMLElement;
	private debounceTimer: NodeJS.Timeout | null = null;
	private isMarkdownRendered = false;
	private trimBlocks: boolean;

	constructor(app: App, initialTemplate: string, onSave: (template: string) => void) {
		super(app);
		this.initialTemplate = initialTemplate;
		this.onSave = onSave;
		this.renderer = new Renderer();
		// 从 settings 读取 trimBlocks 配置
		this.trimBlocks = get(settingsStore).trimBlocks;
	}

	// 禁用点击外部或按 ESC 关闭
	shouldCloseOnEsc(): boolean {
		return false;
	}

	onOpen() {
		const { contentEl, modalEl } = this;

		// 禁用点击外部关闭模态框
		modalEl.addEventListener('click', (e: MouseEvent) => {
			if (e.target === modalEl) {
				e.stopPropagation();
			}
		});

		// 设置模态框样式
		modalEl.addClass('weread-template-editor-modal');
		modalEl.style.width = '95vw';
		modalEl.style.height = '90vh';
		modalEl.style.maxWidth = '95vw';
		modalEl.style.maxHeight = '90vh';

		// 创建标题栏
		const titleBar = contentEl.createDiv('weread-editor-titlebar');
		titleBar.createEl('h2', { text: '📝 模板编辑器' });

		const buttonGroup = titleBar.createDiv('weread-editor-buttons');
		const cancelBtn = buttonGroup.createEl('button', { text: '取消', cls: 'mod-cancel' });
		const saveBtn = buttonGroup.createEl('button', { text: '保存', cls: 'mod-cta' });

		cancelBtn.onclick = () => this.handleCancel();
		saveBtn.onclick = () => this.handleSave();

		// 创建三栏布局容器
		const container = contentEl.createDiv('weread-editor-container');

		// 左侧：说明文档
		const instructionsPanel = container.createDiv('weread-editor-instructions');
		instructionsPanel.innerHTML = templateInstructions;

		// 中间：编辑器
		const editorPanel = container.createDiv('weread-editor-panel');
		editorPanel.createEl('div', { text: '📄 模板编辑 (Nunjucks)', cls: 'panel-header' });

		this.editorEl = editorPanel.createEl('textarea', { cls: 'weread-editor-textarea' });
		this.editorEl.value = this.initialTemplate;

		// 右侧：预览
		const previewPanel = container.createDiv('weread-editor-preview');
		const previewHeader = previewPanel.createDiv('panel-header');
		previewHeader.createSpan({ text: '👁️ 实时预览' });

		// 创建开关容器
		const toggleContainer = previewHeader.createDiv('weread-toggle-container');

		// 添加 trimBlocks 切换开关
		const trimToggleWrapper = toggleContainer.createDiv('weread-toggle-wrapper');
		trimToggleWrapper.createSpan({ text: '✂️ 自动去空白', cls: 'weread-toggle-label' });
		const trimToggleSwitch = trimToggleWrapper.createDiv('weread-toggle-switch');
		if (this.trimBlocks) {
			trimToggleSwitch.addClass('is-enabled');
		}
		trimToggleSwitch.addEventListener('click', () => {
			this.trimBlocks = !this.trimBlocks;
			if (this.trimBlocks) {
				trimToggleSwitch.addClass('is-enabled');
			} else {
				trimToggleSwitch.removeClass('is-enabled');
			}
			// 保存到 settings
			settingsStore.actions.setTrimBlocks(this.trimBlocks);
			this.updatePreview();
		});

		// 添加渲染模式切换开关
		const renderToggleWrapper = toggleContainer.createDiv('weread-toggle-wrapper');
		renderToggleWrapper.createSpan({ text: '📝 Markdown渲染', cls: 'weread-toggle-label' });
		const renderToggleSwitch = renderToggleWrapper.createDiv('weread-toggle-switch');
		if (this.isMarkdownRendered) {
			renderToggleSwitch.addClass('is-enabled');
		}
		renderToggleSwitch.addEventListener('click', () => {
			this.isMarkdownRendered = !this.isMarkdownRendered;
			if (this.isMarkdownRendered) {
				renderToggleSwitch.addClass('is-enabled');
			} else {
				renderToggleSwitch.removeClass('is-enabled');
			}
			this.updatePreview();
		});

		const previewContent = previewPanel.createDiv('preview-content');
		this.previewEl = previewContent.createEl('div', { cls: 'preview-text' });
		this.errorEl = previewContent.createDiv('error-message');

		// 初始预览
		this.updatePreview();

		// 监听编辑器输入
		this.editorEl.addEventListener('input', () => {
			if (this.debounceTimer) {
				clearTimeout(this.debounceTimer);
			}
			this.debounceTimer = setTimeout(() => {
				this.updatePreview();
			}, 300);
		});
	}

	private updatePreview(): void {
		try {
			const templateStr = this.editorEl.value;
			const sampleNotebook = this.buildSampleNotebook();
			const preview = this.renderer.renderWithTemplate(
				templateStr,
				sampleNotebook,
				this.trimBlocks
			);

			// 清空预览容器
			this.previewEl.empty();
			this.errorEl.style.display = 'none';
			this.errorEl.textContent = '';

			if (this.isMarkdownRendered) {
				// 渲染模式：使用 Obsidian 的 Markdown 渲染器
				this.previewEl.addClass('markdown-preview-view');
				this.previewEl.removeClass('preview-source-mode');
				MarkdownRenderer.renderMarkdown(preview, this.previewEl, '', null);
			} else {
				// 源码模式：显示原始文本
				this.previewEl.removeClass('markdown-preview-view');
				this.previewEl.addClass('preview-source-mode');
				const preEl = this.previewEl.createEl('pre');
				preEl.textContent = preview;
			}
		} catch (error: any) {
			this.previewEl.empty();
			this.errorEl.style.display = 'block';
			this.errorEl.textContent = '❌ ' + (error.message || String(error));
		}
	}

	private handleCancel(): void {
		// 检查是否有未保存的更改
		if (this.editorEl.value !== this.initialTemplate) {
			const confirmed = confirm('模板已修改但未保存，确定要关闭吗？');
			if (!confirmed) {
				return;
			}
		}
		this.close();
	}

	private handleSave(): void {
		const template = this.editorEl.value;
		const isValid = this.renderer.validate(template);
		if (!isValid) {
			new Notice('模板语法错误，请检查后再保存！');
			return;
		}
		this.onSave(template);
		new Notice('模板已保存！');
		this.close();
	}

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
		if (this.debounceTimer) {
			clearTimeout(this.debounceTimer);
		}
	}

	private buildSampleNotebook(): Notebook {
		return {
			metaData: {
				bookId: '651358',
				title: '中国哲学简史',
				author: '冯友兰',
				cover: 'https://cdn.weread.qq.com/weread/cover/24/YueWen_651358/t7_YueWen_651358.jpg',
				url: 'https://weread.qq.com/web/reader/9f832d8059f05e9f8657f05',
				pcUrl: 'https://weread.qq.com/web/reader/9f832d8059f05e9f8657f05',
				bookType: 1,
				publishTime: '2013-01-01',
				noteCount: 128,
				reviewCount: 11,
				isbn: '9787301215692',
				category: '哲学宗教-东方哲学',
				publisher: '北京大学出版社',
				intro: '《中国哲学简史》打通古今中外的相关知识，以宏观开阔的视野对中国哲学进行了深入浅出的、融会贯通的讲解。',
				lastReadDate: '2022-05-20',
				totalWords: 450000,
				rating: '9.2',
				readInfo: {
					readingTime: 21720,
					totalReadDay: 7,
					continueReadDays: 5,
					readingBookCount: 3,
					readingBookDate: 1579929600,
					finishedDate: 1580227200,
					readingProgress: 100,
					markedStatus: 1,
					finishedBookCount: 12,
					finishedBookIndex: 1
				}
			},
			chapterHighlights: [
				{
					chapterUid: 1001,
					chapterIdx: 1,
					chapterTitle: '第一章 中国哲学的精神',
					level: 1,
					isMPChapter: 0,
					highlights: [
						{
							bookmarkId: 'bookmark001',
							created: 1580041310,
							createTime: '2020-01-28 16:41:50',
							chapterUid: 1001,
							chapterIdx: 1,
							chapterTitle: '第一章 中国哲学的精神',
							markText:
								'宗教也和人生有关系。每种大宗教的核心都有一种哲学。事实上，每种大宗教就是一种哲学加上一定的上层建筑。',
							style: 0,
							colorStyle: 1,
							range: '0-50',
							reviewContent: '宗教与哲学的关系很深刻'
						},
						{
							bookmarkId: 'bookmark002',
							created: 1580052228,
							createTime: '2020-01-28 22:06:21',
							chapterUid: 1001,
							chapterIdx: 1,
							chapterTitle: '第一章 中国哲学的精神',
							markText: '知者不惑，仁者不忧，勇者不惧',
							style: 0,
							colorStyle: 2,
							range: '100-150'
						},
						{
							bookmarkId: 'bookmark003',
							created: 1580048348,
							createTime: '2020-01-28 16:52:28',
							chapterUid: 1001,
							chapterIdx: 1,
							chapterTitle: '第一章 中国哲学的精神',
							markText:
								'入世与出世是对立的，正如现实主义与理想主义也是对立的一样。中国哲学的任务，就是把这些反命题统一成一个合命题。',
							style: 0,
							colorStyle: 1,
							range: '150-200'
						}
					]
				}
			],
			bookReview: {
				chapterReviews: [],
				bookReviews: [
					{
						reviewId: 'bookReview001',
						created: 1580227200,
						createTime: '2020-01-29 00:00:00',
						content:
							'这是一部名副其实的可以影响大众一生的文化经典。冯友兰先生以宏观开阔的视野对中国哲学进行了深入浅出的讲解，融会了史与思的智慧结晶。',
						mdContent:
							'## 总体评价\n\n这是一部影响深远的哲学经典著作，适合所有想要了解中国传统思想的读者。',
						type: 3
					}
				]
			}
		};
	}
}
