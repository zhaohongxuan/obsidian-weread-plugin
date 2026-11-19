import { App, Modal } from 'obsidian';

/**
 * Show a small confirmation dialog and resolve with the user's choice.
 * Replaces `window.confirm`, which Obsidian's plugin guidelines discourage.
 */
export function confirmAction(
	app: App,
	message: string,
	options: { okText?: string; cancelText?: string } = {}
): Promise<boolean> {
	return new Promise((resolve) => {
		let settled = false;
		const done = (value: boolean) => {
			if (settled) return;
			settled = true;
			resolve(value);
			modal.close();
		};
		const modal = new (class extends Modal {
			onOpen() {
				this.contentEl.createEl('p', { text: message });
				const buttons = this.contentEl.createDiv({ cls: 'modal-button-container' });
				buttons
					.createEl('button', { text: options.cancelText ?? '取消' })
					.addEventListener('click', () => done(false));
				buttons
					.createEl('button', { cls: 'mod-cta', text: options.okText ?? '确定' })
					.addEventListener('click', () => done(true));
			}
			onClose() {
				this.contentEl.empty();
				// Closing via ESC / mask counts as cancel.
				done(false);
			}
		})(app);
		modal.open();
	});
}
