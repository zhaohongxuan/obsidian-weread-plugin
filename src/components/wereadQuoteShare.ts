/** Quote sharing owns its snapshot and preview; it never mutates journal or favorites data. */
import { App, Modal, Notice, requestUrl } from 'obsidian';
import { get } from 'svelte/store';
import { settingsStore } from '../settings';
import {
	QUOTE_SHARE_HEADING,
	QUOTE_SHARE_TEMPLATES,
	renderQuoteShareCard,
	resolveQuoteShareTemplate,
	type QuoteShareContent,
	type QuoteShareTemplate
} from '../quoteShareCard';
import './wereadQuoteShare.css';

export function quoteShareFilename(note: QuoteShareContent, template: QuoteShareTemplate): string {
	const title =
		Array.from(note.bookTitle.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '').trim())
			.slice(0, 28)
			.join('') || '书摘';
	return `${QUOTE_SHARE_HEADING}-${title}-${Date.now()}-${template}.png`;
}

async function loadCover(url?: string): Promise<HTMLImageElement | undefined> {
	if (!url || !/^https?:\/\//i.test(url)) return;
	let timeout: number | undefined;
	let objectUrl: string | undefined;
	try {
		// Native requests avoid cross-origin canvas taint. A failed cover must not block sharing.
		const response = await Promise.race([
			requestUrl({ url, method: 'GET' }),
			new Promise<never>((_, reject) => {
				timeout = window.setTimeout(() => reject(new Error('书封加载超时')), 8000);
			})
		]);
		if (response.status < 200 || response.status >= 300) return;
		const mime = response.headers['content-type']?.split(';')[0] || 'image/jpeg';
		objectUrl = URL.createObjectURL(new Blob([response.arrayBuffer], { type: mime }));
		const image = new Image();
		await new Promise<void>((resolve, reject) => {
			image.onload = () => resolve();
			image.onerror = () => reject(new Error('书封无法读取'));
			image.src = objectUrl!;
		});
		return image;
	} catch {
		return;
	} finally {
		window.clearTimeout(timeout);
		if (objectUrl) URL.revokeObjectURL(objectUrl);
	}
}

function pngBlob(canvas: HTMLCanvasElement): Promise<Blob> {
	return new Promise((resolve, reject) => {
		canvas.toBlob(
			(blob) => (blob ? resolve(blob) : reject(new Error('无法生成 PNG 图片'))),
			'image/png'
		);
	});
}

export class WereadQuoteShareModal extends Modal {
	private readonly note: QuoteShareContent;
	private template: QuoteShareTemplate;
	private username: string;
	private cover?: Promise<HTMLImageElement | undefined>;
	private preview!: HTMLElement;
	private status!: HTMLElement;
	private templateButtons: HTMLButtonElement[] = [];
	private exportButtons: HTMLButtonElement[] = [];
	private defaultButton!: HTMLButtonElement;
	private nativeButton!: HTMLButtonElement;
	private canvas?: HTMLCanvasElement;
	private blob?: Blob;
	private previewUrl?: string;
	private generation = 0;
	private closed = true;
	private saving = false;
	private inputTimer?: number;

	constructor(app: App, note: QuoteShareContent) {
		super(app);
		this.note = { ...note };
		const settings = get(settingsStore);
		this.template = resolveQuoteShareTemplate(settings.quoteShareTemplate);
		this.username = settings.quoteShareUsername?.trim() || settings.user?.trim() || '';
	}

	onOpen(): void {
		this.closed = false;
		this.modalEl.addClass('weread-quote-share-shell');
		this.contentEl.addClass('weread-quote-share-modal');
		this.contentEl.createEl('h2', { text: '分享卡片' });
		const layout = this.contentEl.createDiv({ cls: 'weread-quote-share-layout' });
		this.preview = layout.createDiv({
			cls: 'weread-quote-share-preview',
			attr: { 'aria-label': '分享卡片预览' }
		});
		const controls = layout.createDiv({ cls: 'weread-quote-share-controls' });
		controls.createEl('h3', { text: '选择模板' });
		const templates = controls.createDiv({
			cls: 'weread-quote-share-templates',
			attr: { role: 'group', 'aria-label': '分享卡片模板' }
		});
		for (const template of QUOTE_SHARE_TEMPLATES) {
			const button = templates.createEl('button', {
				cls: 'weread-quote-share-template',
				attr: { type: 'button', 'data-template': template.id }
			});
			button.createSpan({
				cls: `weread-quote-share-swatch is-${template.id}`,
				attr: { 'aria-hidden': 'true' }
			});
			const labels = button.createSpan();
			labels.createEl('strong', { text: template.name });
			labels.createEl('small', { text: template.description });
			button.onclick = () => {
				this.template = template.id;
				void this.refreshPreview();
			};
			this.templateButtons.push(button);
		}
		const nameLabel = controls.createEl('label', { cls: 'weread-quote-share-name' });
		nameLabel.createSpan({ text: '分享署名' });
		const name = nameLabel.createEl('input', {
			type: 'text',
			attr: { placeholder: '填写用户名', 'aria-label': '分享署名', maxlength: '80' }
		});
		name.value = this.username;
		name.oninput = () => {
			this.username = name.value;
			window.clearTimeout(this.inputTimer);
			this.setBusy();
			this.inputTimer = window.setTimeout(() => {
				this.inputTimer = undefined;
				void this.refreshPreview();
			}, 150);
		};
		name.onchange = async () => {
			try {
				await settingsStore.actions.setQuoteShareUsername(name.value);
			} catch {
				new Notice('分享署名保存失败，请重试');
			}
		};
		this.defaultButton = controls.createEl('button', {
			cls: 'weread-quote-share-default',
			attr: { type: 'button' }
		});
		this.defaultButton.onclick = async () => {
			try {
				await settingsStore.actions.setQuoteShareTemplate(this.template);
				if (!this.closed) this.updateControls();
			} catch {
				new Notice('默认模板保存失败，请重试');
			}
		};
		this.status = controls.createEl('p', {
			cls: 'weread-quote-share-status',
			attr: { role: 'status' }
		});
		const actions = controls.createDiv({ cls: 'weread-quote-share-export' });
		this.addExportButton(actions, '保存图片', () => this.saveLocal(), 'mod-cta');
		this.addExportButton(actions, '保存到笔记库', () => {
			void this.saveToVault();
		});
		this.nativeButton = this.addExportButton(actions, '系统分享', () => {
			void this.shareNative();
		});
		this.nativeButton.hidden = true;
		controls.createEl('p', {
			cls: 'weread-quote-share-hint',
			text: 'PNG 图片 · 完整保留原文，长内容自动延长'
		});
		this.cover = loadCover(this.note.cover);
		void this.refreshPreview();
	}

	private addExportButton(
		parent: HTMLElement,
		text: string,
		action: () => void,
		cls = ''
	): HTMLButtonElement {
		const button = parent.createEl('button', { text, cls, attr: { type: 'button' } });
		button.onclick = action;
		this.exportButtons.push(button);
		return button;
	}

	private setBusy(): void {
		this.generation += 1;
		this.blob = undefined;
		for (const button of this.exportButtons) button.disabled = true;
		if (this.status) this.status.setText('正在生成分享卡片…');
	}

	private updateControls(): void {
		for (const button of this.templateButtons) {
			const selected = button.dataset.template === this.template;
			button.classList.toggle('is-selected', selected);
			button.setAttribute('aria-pressed', String(selected));
		}
		const isDefault =
			resolveQuoteShareTemplate(get(settingsStore).quoteShareTemplate) === this.template;
		this.defaultButton.setText(isDefault ? '当前默认模板' : '设为默认模板');
		this.defaultButton.disabled = isDefault;
	}

	private async refreshPreview(): Promise<void> {
		if (this.closed) return;
		this.setBusy();
		this.updateControls();
		const generation = this.generation;
		try {
			const cover = await this.cover;
			if (this.closed || generation !== this.generation) return;
			const canvas = renderQuoteShareCard(this.note, {
				template: this.template,
				username: this.username.trim() || get(settingsStore).user?.trim() || '',
				cover
			});
			const blob = await pngBlob(canvas);
			if (this.closed || generation !== this.generation) return;
			const url = URL.createObjectURL(blob);
			const image = this.preview.ownerDocument.createElement('img');
			image.alt = `${QUOTE_SHARE_TEMPLATES.find((entry) => entry.id === this.template)!.name}分享卡片预览`;
			image.src = url;
			this.preview.replaceChildren(image);
			if (this.previewUrl) URL.revokeObjectURL(this.previewUrl);
			this.previewUrl = url;
			this.canvas = canvas;
			this.blob = blob;
			for (const button of this.exportButtons) button.disabled = this.saving;
			this.nativeButton.hidden = !this.canShare(blob);
			this.status.setText(
				`${canvas.width} × ${canvas.height} · PNG${this.note.cover && !cover ? ' · 使用文字书封' : ''}`
			);
		} catch (error) {
			if (this.closed || generation !== this.generation) return;
			this.status.setText(error instanceof Error ? error.message : '图片生成失败，请重试');
		}
	}

	private saveLocal(): void {
		if (!this.blob || !this.canvas || this.closed) return;
		try {
			const link = this.contentEl.ownerDocument.createElement('a');
			link.download = quoteShareFilename(this.note, this.template);
			link.href = this.canvas.toDataURL('image/png');
			this.contentEl.ownerDocument.body.append(link);
			link.click();
			link.remove();
		} catch {
			new Notice('图片保存失败，可尝试保存到笔记库');
		}
	}

	private async saveToVault(): Promise<void> {
		if (!this.blob || this.saving || this.closed) return;
		this.saving = true;
		for (const button of this.exportButtons) button.disabled = true;
		const blob = this.blob,
			template = this.template;
		try {
			const filename = quoteShareFilename(this.note, template);
			for (let attempt = 0; attempt < 5; attempt++) {
				const name = attempt ? filename.replace(/\.png$/, `-${attempt}.png`) : filename;
				// Attachment resolution was added in Obsidian 1.5.7; older supported apps use the vault root.
				const path =
					typeof this.app.fileManager?.getAvailablePathForAttachment === 'function'
						? await this.app.fileManager.getAvailablePathForAttachment(name)
						: name;
				if (this.app.vault.getAbstractFileByPath(path)) continue;
				try {
					await this.app.vault.createBinary(path, await blob.arrayBuffer());
					new Notice(`图片已保存：${path}`);
					return;
				} catch (error) {
					if (!this.app.vault.getAbstractFileByPath(path)) throw error;
				}
			}
			throw new Error('文件名已被占用，请重试');
		} catch (error) {
			new Notice(error instanceof Error ? error.message : '图片保存失败，请重试');
		} finally {
			this.saving = false;
			if (!this.closed) for (const button of this.exportButtons) button.disabled = !this.blob;
		}
	}

	private canShare(blob: Blob): boolean {
		try {
			return (
				typeof navigator.canShare === 'function' &&
				navigator.canShare({ files: [new File([blob], '书摘.png', { type: 'image/png' })] })
			);
		} catch {
			return false;
		}
	}

	private async shareNative(): Promise<void> {
		if (!this.blob || this.closed || !this.canShare(this.blob)) return;
		try {
			// The image is prepared before the click, preserving the native share user gesture.
			await navigator.share({
				files: [
					new File([this.blob], quoteShareFilename(this.note, this.template), {
						type: 'image/png'
					})
				],
				title: this.note.bookTitle
			});
		} catch (error) {
			if (!(error instanceof Error && error.name === 'AbortError'))
				new Notice('系统分享失败，可先保存图片');
		}
	}

	onClose(): void {
		this.closed = true;
		this.generation += 1;
		window.clearTimeout(this.inputTimer);
		if (this.previewUrl) URL.revokeObjectURL(this.previewUrl);
		this.previewUrl = undefined;
		this.blob = undefined;
		this.canvas = undefined;
		this.contentEl.empty();
	}
}
