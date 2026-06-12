import { Modal, App, Notice, MarkdownRenderer } from 'obsidian';
import { Renderer } from '../renderer';
import type { Notebook } from '../models';
import templateInstructions from '../assets/templateInstructions.html';
import { settingsStore } from '../settings';
import { get } from 'svelte/store';

export class TemplateEditorWindow extends Modal {
	private initialTemplate: string;
	private onSave: (template: string, trimBlocks: boolean) => void;
	private renderer: Renderer;
	private editorEl: HTMLTextAreaElement;
	private previewEl: HTMLElement;
	private errorEl: HTMLElement;
	private debounceTimer: NodeJS.Timeout | number | null = null;
	private isMarkdownRendered = false;
	private trimBlocks: boolean;
	private readOnly: boolean;
	private themeName: string;

	constructor(
		app: App,
		initialTemplate: string,
		onSave: (template: string, trimBlocks: boolean) => void,
		initialTrimBlocks?: boolean,
		readOnly = false,
		themeName?: string
	) {
		super(app);
		this.initialTemplate = initialTemplate;
		this.onSave = onSave;
		this.renderer = new Renderer();
		// Use provided trimBlocks or fall back to settings
		this.trimBlocks = initialTrimBlocks ?? get(settingsStore).trimBlocks;
		this.readOnly = readOnly;
		this.themeName = themeName ?? '';
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
		titleBar.createEl('h2', {
			text: this.readOnly ? `预览: ${this.themeName}` : `编辑: ${this.themeName}`
		});

		const buttonGroup = titleBar.createDiv('weread-editor-buttons');
		const cancelBtn = buttonGroup.createEl('button', { text: '关闭', cls: 'mod-cancel' });
		cancelBtn.onclick = () => this.handleCancel();

		// 仅在非只读模式下显示保存按钮
		if (!this.readOnly) {
			const saveBtn = buttonGroup.createEl('button', { text: '保存', cls: 'mod-cta' });
			saveBtn.onclick = () => this.handleSave();
		}

		// 创建布局容器
		const container = contentEl.createDiv('weread-editor-container');

		// 左侧：说明文档（仅编辑模式显示）
		if (!this.readOnly) {
			const instructionsPanel = container.createDiv('weread-editor-instructions');
			instructionsPanel.innerHTML = templateInstructions;
		}

		// 中间：编辑器
		const editorPanel = container.createDiv('weread-editor-panel');
		editorPanel.createDiv({
			text: this.readOnly ? '模板内容' : '模板编辑 (Nunjucks)',
			cls: 'panel-header'
		});

		this.editorEl = editorPanel.createEl('textarea', { cls: 'weread-editor-textarea' });
		this.editorEl.value = this.initialTemplate;
		if (this.readOnly) {
			this.editorEl.disabled = true;
			this.editorEl.style.backgroundColor = 'var(--background-secondary)';
			this.editorEl.style.cursor = 'default';
		}

		// 右侧：预览
		const previewPanel = container.createDiv('weread-editor-preview');
		const previewHeader = previewPanel.createDiv('panel-header');
		previewHeader.createSpan({ text: '实时预览' });

		// 预览面板的开关容器
		const toggleContainer = previewHeader.createDiv('weread-toggle-container');

		// 自动去空白切换开关（只读模式下展示但禁用）
		const trimToggleWrapper = toggleContainer.createDiv('weread-toggle-wrapper');
		trimToggleWrapper.createSpan({ text: '✂️ 自动去空白', cls: 'weread-toggle-label' });
		const trimToggleSwitch = trimToggleWrapper.createDiv('weread-toggle-switch');
		if (this.trimBlocks) {
			trimToggleSwitch.addClass('is-enabled');
		}
		if (this.readOnly) {
			trimToggleSwitch.addClass('is-disabled');
		} else {
			trimToggleSwitch.addEventListener('click', () => {
				this.trimBlocks = !this.trimBlocks;
				if (this.trimBlocks) {
					trimToggleSwitch.addClass('is-enabled');
				} else {
					trimToggleSwitch.removeClass('is-enabled');
				}
				this.updatePreview();
			});
		}

		// 添加渲染模式切换开关（编辑和预览模式都显示）
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
		this.previewEl = previewContent.createDiv({ cls: 'preview-text' });
		this.errorEl = previewContent.createDiv('error-message');

		// 初始预览
		this.updatePreview();

		// 监听编辑器输入
		this.editorEl.addEventListener('input', () => {
			if (this.debounceTimer) {
				activeWindow.clearTimeout(this.debounceTimer as unknown as number);
			}
			this.debounceTimer = activeWindow.setTimeout(() => {
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
			this.errorEl.removeClass('weread-error-visible');
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
			this.errorEl.addClass('weread-error-visible');
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
		this.onSave(template, this.trimBlocks);
		new Notice('模板已保存！');
		this.close();
	}

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
		if (this.debounceTimer) {
			activeWindow.clearTimeout(this.debounceTimer as unknown as number);
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
				noteCount: 11,
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
					chapterUid: 33,
					chapterIdx: 4,
					chapterTitle: '第一章 中国哲学的精神',
					level: 1,
					isMPChapter: 0,
					highlights: [
						{
							bookmarkId: '651358_33_3905-3956',
							created: 1580201316,
							createTime: '2020-01-28 16:41:50',
							chapterUid: 33,
							chapterIdx: 4,
							chapterTitle: '第一章 中国哲学的精神',
							markText: '所以在西方，宗教与科学向来有冲突。科学前进一步，宗教就后退一步；在科学进展的面前，宗教的权威降低了。',
							style: 0,
							colorStyle: 1,
							range: '3905-3956',
							reviewContent: '以笛卡尔为代表的一批思想家为了打破教会黑暗的统治开始探究科学，所以科学的尽头是哲学完全正确'
						},
						{
							bookmarkId: '651358_33_938-962',
							created: 1580041310,
							createTime: '2020-01-28 16:41:50',
							chapterUid: 33,
							chapterIdx: 4,
							chapterTitle: '第一章 中国哲学的精神',
							markText: '我所说的哲学，就是对于人生的有系统的反思的思想。',
							style: 0,
							colorStyle: 2,
							range: '938-962',
							isPopular: true,
							popularCount: 7208,
							isUserHighlight: true
						},
						{
							bookmarkId: '651358_33_1819-1919',
							created: 1580052228,
							createTime: '2020-01-28 22:06:21',
							chapterUid: 33,
							chapterIdx: 4,
							chapterTitle: '第一章 中国哲学的精神',
							markText: '宗教也和人生有关系。每种大宗教的核心都有一种哲学。事实上，每种大宗教就是一种哲学加上一定的上层建筑，包括迷信、教条、仪式和组织。这就是我所说的宗教。',
							style: 0,
							colorStyle: 1,
							range: '1819-1919',
							isPopular: true,
							popularCount: 7146,
							isUserHighlight: true
						},
						{
							bookmarkId: '651358_33_8387-8441',
							created: 1580048348,
							createTime: '2020-01-28 16:52:28',
							chapterUid: 33,
							chapterIdx: 4,
							chapterTitle: '第一章 中国哲学的精神',
							markText: '学哲学的目的，是使人作为人能够成为人，而不是成为某种人。',
							style: 0,
							colorStyle: 3,
							range: '8387-8441',
							isPopular: true,
							popularCount: 7125,
							isUserHighlight: true
						},
						{
							bookmarkId: '651358_33_4202-4275',
							created: 1580060000,
							createTime: '2020-01-29 10:00:00',
							chapterUid: 33,
							chapterIdx: 4,
							chapterTitle: '第一章 中国哲学的精神',
							markText: '在未来的世界，人类将要以哲学代宗教。这是与中国传统相合的。人不一定应当是宗教的，但是他一定应当是哲学的。他一旦是哲学的，他也就有了正是宗教的洪福。',
							style: 0,
							colorStyle: 1,
							range: '4202-4275',
							isPopular: true,
							popularCount: 2424,
							isUserHighlight: false
						},
						{
							bookmarkId: '651358_33_9049-9090',
							created: 1580100000,
							createTime: '2020-02-01 09:00:00',
							chapterUid: 33,
							chapterIdx: 4,
							chapterTitle: '第一章 中国哲学的精神',
							markText: '富于暗示，而不是明晰得一览无遗，是一切中国艺术的理想，诗歌、绘画以及其他无不如此。',
							style: 0,
							colorStyle: 2,
							range: '9049-9090',
							isPopular: true,
							popularCount: 4081,
							isUserHighlight: false
						}
					]
				},
				{
					chapterUid: 34,
					chapterIdx: 5,
					chapterTitle: '第二章 中国哲学的背景',
					level: 1,
					isMPChapter: 0,
					highlights: [
						{
							bookmarkId: '651358_34_2846-2942',
							created: 1580105000,
							createTime: '2020-02-01 12:00:00',
							chapterUid: 34,
							chapterIdx: 5,
							chapterTitle: '第二章 中国哲学的背景',
							markText: '在自然界和人类社会的任何事物，发展到了一个极端，就反向另一个极端；这就是说，借用黑格尔的说法，一切事物都包含着它自己的否定。这是老子哲学的主要论点之一，也是儒家所解释的《易经》的主要论点之一。',
							style: 0,
							colorStyle: 1,
							range: '2846-2942',
							isPopular: true,
							popularCount: 2608,
							isUserHighlight: false
						},
						{
							bookmarkId: '651358_34_9546-9595',
							created: 1580105000,
							createTime: '2020-02-01 12:00:00',
							chapterUid: 34,
							chapterIdx: 5,
							chapterTitle: '第二章 中国哲学的背景',
							markText: '说西方侵略东方，这样说并不准确。事实上，正是现代侵略中世纪。要生存在现代世界里，中国就必须现代化。',
							style: 0,
							colorStyle: 2,
							range: '9546-9595',
							isPopular: true,
							popularCount: 4590,
							isUserHighlight: false
						}
					]
				},
				{
					chapterUid: 36,
					chapterIdx: 7,
					chapterTitle: '第四章 孔子：第一位教师',
					level: 1,
					isMPChapter: 0,
					highlights: [
						{
							bookmarkId: '651358_36_5369-5420',
							created: 1580105000,
							createTime: '2020-02-01 12:00:00',
							chapterUid: 36,
							chapterIdx: 7,
							chapterTitle: '第四章 孔子：第一位教师',
							markText: '所以我们能够做的，莫过于一心一意地尽力去做我们知道是我们应该做的事，而不计成败。这样做，就是"知命"。',
							style: 0,
							colorStyle: 1,
							range: '5369-5420',
							isPopular: true,
							popularCount: 1950,
							isUserHighlight: false
						}
					]
				},
				{
					chapterUid: 60,
					chapterIdx: 31,
					chapterTitle: '第二十八章 中国哲学在现代世界',
					level: 1,
					isMPChapter: 0,
					highlights: [
						{
							bookmarkId: '651358_60_8669-8685',
							created: 1580272972,
							createTime: '2020-01-29 12:02:52',
							chapterUid: 60,
							chapterIdx: 31,
							chapterTitle: '第二十八章 中国哲学在现代世界',
							markText: '人必须先说很多话，然后保持静默。\n',
							style: 0,
							colorStyle: 2,
							range: '8669-8685',
							reviewContent: '太有哲学意味了🧐',
							isPopular: true,
							popularCount: 6048,
							isUserHighlight: true
						}
					]
				}
			],
			popularHighlights: [
				{
					chapterUid: 33,
					chapterIdx: 4,
					chapterTitle: '第一章 中国哲学的精神',
					highlights: [
						{
							bookmarkId: '651358_33_938-962',
							chapterUid: 33,
							chapterTitle: '第一章 中国哲学的精神',
							range: '938-962',
							markText: '我所说的哲学，就是对于人生的有系统的反思的思想。',
							totalCount: 7208
						},
						{
							bookmarkId: '651358_33_1819-1919',
							chapterUid: 33,
							chapterTitle: '第一章 中国哲学的精神',
							range: '1819-1919',
							markText: '宗教也和人生有关系。每种大宗教的核心都有一种哲学。事实上，每种大宗教就是一种哲学加上一定的上层建筑，包括迷信、教条、仪式和组织。这就是我所说的宗教。',
							totalCount: 7146
						},
						{
							bookmarkId: '651358_33_8387-8441',
							chapterUid: 33,
							chapterTitle: '第一章 中国哲学的精神',
							range: '8387-8441',
							markText: '学哲学的目的，是使人作为人能够成为人，而不是成为某种人。',
							totalCount: 7125
						},
						{
							bookmarkId: '651358_33_9049-9090',
							chapterUid: 33,
							chapterTitle: '第一章 中国哲学的精神',
							range: '9049-9090',
							markText: '富于暗示，而不是明晰得一览无遗，是一切中国艺术的理想，诗歌、绘画以及其他无不如此。',
							totalCount: 4081
						},
						{
							bookmarkId: '651358_33_4202-4275',
							chapterUid: 33,
							chapterTitle: '第一章 中国哲学的精神',
							range: '4202-4275',
							markText: '在未来的世界，人类将要以哲学代宗教。这是与中国传统相合的。人不一定应当是宗教的，但是他一定应当是哲学的。他一旦是哲学的，他也就有了正是宗教的洪福。',
							totalCount: 2424
						}
					]
				},
				{
					chapterUid: 34,
					chapterIdx: 5,
					chapterTitle: '第二章 中国哲学的背景',
					highlights: [
						{
							bookmarkId: '651358_34_9546-9595',
							chapterUid: 34,
							chapterTitle: '第二章 中国哲学的背景',
							range: '9546-9595',
							markText: '说西方侵略东方，这样说并不准确。事实上，正是现代侵略中世纪。要生存在现代世界里，中国就必须现代化。',
							totalCount: 4590
						},
						{
							bookmarkId: '651358_34_2846-2942',
							chapterUid: 34,
							chapterTitle: '第二章 中国哲学的背景',
							range: '2846-2942',
							markText: '在自然界和人类社会的任何事物，发展到了一个极端，就反向另一个极端；这就是说，借用黑格尔的说法，一切事物都包含着它自己的否定。这是老子哲学的主要论点之一，也是儒家所解释的《易经》的主要论点之一。',
							totalCount: 2608
						}
					]
				},
				{
					chapterUid: 60,
					chapterIdx: 31,
					chapterTitle: '第二十八章 中国哲学在现代世界',
					highlights: [
						{
							bookmarkId: '651358_60_8669-8685',
							chapterUid: 60,
							chapterTitle: '第二十八章 中国哲学在现代世界',
							range: '8669-8685',
							markText: '人必须先说很多话，然后保持静默。\n',
							totalCount: 6048
						}
					]
				}
			],
			bookReview: {
				chapterReviews: [
					{
						chapterUid: 33,
						chapterTitle: '第一章 中国哲学的精神',
						reviews: [
							{
								reviewId: '15707910_7eIktLxIX',
								created: 1580201316,
								createTime: '2020-01-28 16:41:50',
								content: '以笛卡尔为代表的一批思想家为了打破教会黑暗的统治开始探究科学，所以科学的尽头是哲学完全正确',
								range: '3905-3956',
								type: 1
							}
						]
					},
					{
						chapterUid: 60,
						chapterTitle: '第二十八章 中国哲学在现代世界',
						reviews: [
							{
								reviewId: '15707910_7eJATFNqj',
								created: 1580273157,
								createTime: '2020-01-29 12:02:52',
								content: '太有哲学意味了🧐',
								range: '8669-8685',
								type: 1
							}
						]
					}
				],
				bookReviews: [
					{
						reviewId: '15707910_7eJErADUa',
						created: 1580276407,
						createTime: '2020-01-29 13:00:00',
						content: '哲学的意义\n很多人说中国人没有信仰，在看完这位本书之后我有了很大改观，中国人不是没有信仰，只是没有像基督教、伊斯兰教宗教那样得信仰罢了，但是中国人有自己的哲学体系，这种哲学思想贯穿在整个中华文化，甚至于日常生活中。\n这本书的分量很重，从儒家的孔子孟子到道家的杨朱、老子、庄子，以及墨家的墨子，再到名家、法家阴阳家，再到后来得玄学、新道家、佛教、禅宗到最后的新儒家（理学和心学）等等，极大的开拓了眼界。\n最后用冯先生的一句话总结一下：人必须先说很多话，然后保持静默。',
						mdContent: '## 总体评价\n\n这是一部影响深远的哲学经典著作，适合所有想要了解中国传统思想的读者。',
						type: 4
					}
				]
			}
		};
	}
}
