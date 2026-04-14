import { App, Modal, Notice, Platform, setIcon, TFile } from 'obsidian';
import type { SyncLogEntry } from '../models';
import { settingsStore } from '../settings';

const MODAL_WIDTH = '700px';
const MODAL_MAX_WIDTH = '90vw';
const MODAL_MAX_HEIGHT = '80vh';

export class SyncLogModal extends Modal {
	constructor(app: App) {
		super(app);
	}

	onOpen() {
		const { contentEl, modalEl } = this;
		contentEl.empty();
		modalEl.style.width = Platform.isDesktopApp ? MODAL_WIDTH : MODAL_MAX_WIDTH;
		modalEl.style.maxWidth = MODAL_MAX_WIDTH;
		modalEl.style.maxHeight = MODAL_MAX_HEIGHT;

		const header = contentEl.createDiv({ cls: 'sync-log-header' });
		header.createEl('h2', { text: '同步日志' });
		header.createDiv({ cls: 'sync-log-subtitle', text: '最近 10 次同步记录' });

		const logsContainer = contentEl.createDiv({ cls: 'sync-log-container' });

		const logs = settingsStore.actions.getSyncLogs();

		if (logs.length === 0) {
			logsContainer.createDiv({
				cls: 'sync-log-empty',
				text: '暂无同步记录'
			});
			return;
		}

		for (const log of logs) {
			const logItem = logsContainer.createDiv({ cls: 'sync-log-item' });
			this.renderLogEntry(logItem, log);
		}
	}

	private renderLogEntry(container: HTMLElement, log: SyncLogEntry) {
		// Header row with timestamp and status
		const header = container.createDiv({ cls: 'sync-log-item-header' });

		const timestamp = header.createDiv({ cls: 'sync-log-timestamp' });
		const date = new Date(log.timestamp);
		timestamp.createDiv({
			cls: 'sync-log-date',
			text: date.toLocaleDateString('zh-CN', {
				year: 'numeric',
				month: '2-digit',
				day: '2-digit'
			})
		});
		timestamp.createDiv({
			cls: 'sync-log-time',
			text: date.toLocaleTimeString('zh-CN', {
				hour: '2-digit',
				minute: '2-digit',
				second: '2-digit'
			})
		});

		const status = header.createDiv({
			cls: log.success ? 'sync-log-status sync-log-success' : 'sync-log-status sync-log-error'
		});
		setIcon(status, log.success ? 'check-circle' : 'x-circle');
		status.createSpan({ text: log.success ? '成功' : '失败' });

		// Stats row
		const stats = container.createDiv({ cls: 'sync-log-stats' });
		stats.createSpan({ text: `共 ${log.totalBooks} 本书` });
		stats.createSpan({ text: `同步 ${log.syncedBooks} 本` });
		stats.createSpan({ text: `跳过 ${log.skippedBooks} 本` });
		stats.createSpan({ text: `耗时 ${log.duration.toFixed(2)} 秒` });

		// Error message if failed
		if (!log.success && log.errorMessage) {
			container
				.createDiv({ cls: 'sync-log-error' })
				.createSpan({ text: `错误: ${log.errorMessage}` });
		}

		// Notes list
		if (log.notes && log.notes.length > 0) {
			const notesHeader = container.createDiv({ cls: 'sync-log-notes-header' });
			notesHeader.createSpan({ text: `同步的笔记 (${log.notes.length})` });

			const notesList = container.createDiv({ cls: 'sync-log-notes-list' });
			for (const note of log.notes) {
				const noteItem = notesList.createDiv({ cls: 'sync-log-note-item' });

				// Note title
				const noteTitle = noteItem.createDiv({ cls: 'sync-log-note-title' });
				noteTitle.createSpan({ text: note.title });

				// Open button
				const openBtn = noteItem.createEl('button', {
					cls: 'sync-log-note-btn',
					attr: { 'aria-label': '打开笔记' }
				});
				setIcon(openBtn, 'file-text');
				openBtn.onclick = async () => {
					await this.openNoteFile(note.filePath);
				};
			}
		}
	}

	private async openNoteFile(filePath: string) {
		try {
			const file = this.app.vault.getAbstractFileByPath(filePath);
			if (file && file instanceof TFile) {
				const leaf = this.app.workspace.getLeaf('tab');
				await leaf.openFile(file);
				this.close();
			} else {
				new Notice('未找到笔记文件: ' + filePath);
			}
		} catch (e) {
			new Notice('打开笔记失败: ' + (e instanceof Error ? e.message : String(e)));
		}
	}

	onClose() {
		this.contentEl.empty();
	}
}
