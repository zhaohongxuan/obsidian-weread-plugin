import { Modal } from 'obsidian';
import { get } from 'svelte/store';
import type WereadPlugin from '../../main';
import type { JournalState } from '../journal';
import { normalizeJournalExcludedBookIds, settingsStore } from '../settings';
import './wereadReencounterBooksModal.css';

interface BookOption {
	id: string;
	title: string;
	author: string;
	missing: boolean;
}

/** A draft picker over the same personal-highlight cache used by Today and Review. */
export class WereadReencounterBooksModal extends Modal {
	private selected = new Set<string>();
	private books = new Map<string, BookOption>();
	private state: JournalState;
	private unsubscribe?: () => void;
	private active = false;
	private generation = 0;
	private loading = false;
	private loadError = false;
	private searchEl: HTMLInputElement;
	private statusEl: HTMLElement;
	private countEl: HTMLElement;
	private listEl: HTMLElement;
	private emptyEl: HTMLElement;
	private rows = new Map<
		string,
		{
			row: HTMLElement;
			checkbox: HTMLInputElement;
			title: HTMLElement;
			author: HTMLElement;
		}
	>();

	constructor(
		private plugin: WereadPlugin,
		private onSaved?: (ids: string[]) => void
	) {
		super(plugin.app);
	}

	onOpen(): void {
		this.active = true;
		const generation = ++this.generation;
		this.selected = new Set(
			normalizeJournalExcludedBookIds(get(settingsStore).journalExcludedBookIds)
		);
		this.rows.clear();
		this.contentEl.empty();
		this.contentEl.addClass('weread-reencounter-books');
		this.contentEl.createEl('h2', { text: '旧句重逢排除书籍' });
		this.contentEl.createEl('p', {
			text: '选中的书籍将不再出现在「今日」和「回顾」的旧句重逢中。书籍列表来自已有的个人划线缓存。'
		});
		this.searchEl = this.contentEl.createEl('input', {
			type: 'search',
			attr: { placeholder: '搜索书名或作者', 'aria-label': '搜索书名或作者' }
		});
		this.searchEl.addEventListener('input', () => this.render());
		this.statusEl = this.contentEl.createDiv({
			attr: { role: 'status', 'aria-live': 'polite' }
		});
		const toolbar = this.contentEl.createDiv({ cls: 'weread-reencounter-books-toolbar' });
		this.countEl = toolbar.createSpan();
		const clear = toolbar.createEl('button', { text: '清空选择' });
		clear.addEventListener('click', () => {
			this.selected.clear();
			this.render();
		});
		this.listEl = this.contentEl.createDiv({
			cls: 'weread-reencounter-books-list',
			attr: { 'aria-label': '可排除书籍' }
		});
		this.emptyEl = this.contentEl.createDiv({ cls: 'weread-reencounter-books-empty' });
		const footer = this.contentEl.createDiv({ cls: 'weread-reencounter-books-footer' });
		footer.createEl('button', { text: '取消' }).addEventListener('click', () => this.close());
		footer
			.createEl('button', { text: '保存', cls: 'mod-cta' })
			.addEventListener('click', () => {
				const ids = [...this.selected];
				settingsStore.actions.setJournalExcludedBookIds(ids);
				this.onSaved?.(ids);
				this.close();
			});

		const service = this.plugin.getJournalService();
		this.setState(service.getSnapshot());
		this.loading = true;
		this.loadError = false;
		this.unsubscribe = service.subscribe((state) => {
			if (!this.active || this.generation !== generation) return;
			this.setState(state);
			this.render();
		});
		this.render();
		// The singleton hydrates/reuses its cache and coalesces refreshes with other views.
		void service
			.load(false)
			.then((state) => {
				if (!this.active || this.generation !== generation) return;
				this.setState(state);
				this.loading = false;
				this.render();
			})
			.catch(() => {
				if (!this.active || this.generation !== generation) return;
				this.loading = false;
				this.loadError = true;
				this.render();
			});
	}

	onClose(): void {
		this.active = false;
		this.generation++;
		this.unsubscribe?.();
		this.unsubscribe = undefined;
		this.rows.clear();
		this.contentEl.empty();
	}

	private setState(state: JournalState): void {
		this.state = state;
		this.books.clear();
		for (const note of state.notes) {
			if (note.kind !== 'highlight') continue;
			const id = normalizeJournalExcludedBookIds([note.bookId])[0];
			if (!id || this.books.has(id)) continue;
			this.books.set(id, {
				id,
				title: note.bookTitle || id,
				author: note.author || '',
				missing: false
			});
		}
	}

	private bookOptions(): BookOption[] {
		const books = new Map(this.books);
		for (const id of this.selected) {
			if (!books.has(id))
				books.set(id, {
					id,
					title: `书籍 ID：${id}`,
					author: '当前缓存中暂无此书，可取消排除',
					missing: true
				});
		}
		return [...books.values()];
	}

	private render(): void {
		if (!this.active) return;
		const query = this.searchEl.value.trim().toLocaleLowerCase();
		const options = this.bookOptions();
		const ids = new Set(options.map((book) => book.id));
		for (const [id, entry] of this.rows) {
			if (ids.has(id)) continue;
			if (entry.checkbox === entry.checkbox.ownerDocument.activeElement)
				this.searchEl.focus();
			entry.row.remove();
			this.rows.delete(id);
		}
		let visible = 0;
		for (const book of options) {
			let entry = this.rows.get(book.id);
			if (!entry) {
				const row = this.listEl.createEl('label', { cls: 'weread-reencounter-books-row' });
				const checkbox = row.createEl('input', { type: 'checkbox' });
				checkbox.dataset.bookId = book.id;
				const info = row.createSpan();
				const title = info.createSpan({ cls: 'weread-reencounter-books-title' });
				const author = info.createSpan({ cls: 'weread-reencounter-books-author' });
				checkbox.addEventListener('change', () => {
					if (checkbox.checked) this.selected.add(book.id);
					else this.selected.delete(book.id);
					this.render();
				});
				entry = { row, checkbox, title, author };
				this.rows.set(book.id, entry);
			}
			entry.title.setText(book.title);
			entry.author.setText(book.author);
			entry.checkbox.checked = this.selected.has(book.id);
			// Missing selections remain discoverable/removable even during a search.
			const matches =
				book.missing || `${book.title}\n${book.author}`.toLocaleLowerCase().includes(query);
			entry.row.hidden = !matches;
			if (matches) visible++;
		}
		this.countEl.setText(`已排除 ${this.selected.size} 本`);
		this.statusEl.setText(
			this.state.syncing
				? `正在整理书籍缓存（${this.state.scannedBooks}/${this.state.totalBooks}）…`
				: this.loading
					? '正在读取书籍缓存…'
					: this.loadError
						? '读取缓存失败，请关闭后重试；已有选择仍会保留。'
						: this.state.error ||
							`个人划线缓存中有 ${options.filter((book) => !book.missing).length} 本书`
		);
		this.emptyEl.hidden = visible > 0;
		this.emptyEl.setText(
			query
				? '没有匹配的书籍'
				: this.loading || this.state.syncing
					? '正在加载，已有排除项会保留。'
					: '暂无个人划线书籍。已有排除项会保留，可稍后再来选择。'
		);
	}
}
