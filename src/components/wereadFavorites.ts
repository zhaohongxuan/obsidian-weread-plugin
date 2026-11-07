import './wereadFavorites.css';
import { Notice, setIcon } from 'obsidian';
import { get } from 'svelte/store';
import type WereadPlugin from '../../main';
import type { WereadFavoritesService } from '../favorites';
import type { FavoriteEntry, FavoritesState } from '../models';
import { settingsStore } from '../settings';
import { WereadPanel } from './wereadPanel';
import { getPcUrl } from '../parser/parseResponse';
import { getJournalNoteBookmark, openJournalNoteOriginal } from '../utils/openWereadUrl';
import { setOriginalReadingIcon } from '../utils/readingActionIcon';

/** A single five-second undo opportunity, owned by the currently open panel. */
export class FavoritesUndoToast {
	private timer?: number;
	private element?: HTMLElement;
	private entry?: FavoriteEntry;
	private generation = 0;
	constructor(
		private root: HTMLElement,
		private favorites: WereadFavoritesService,
		private isActive: () => boolean
	) {}
	clear(): void {
		this.generation += 1;
		window.clearTimeout(this.timer);
		this.element?.remove();
		this.element = undefined;
		this.entry = undefined;
	}
	update(state: FavoritesState): void {
		if (
			this.entry &&
			(state.favorites.some((entry) => entry.id === this.entry.id) ||
				state.pendingIds.includes(this.entry.id))
		)
			this.clear();
	}
	show(entry: FavoriteEntry): void {
		this.clear();
		if (!this.isActive()) return;
		this.entry = entry;
		const generation = this.generation;
		const toast = this.root.createDiv({
			cls: 'weread-favorites-undo',
			attr: { role: 'status', 'aria-live': 'polite' }
		});
		this.element = toast;
		toast.createSpan({ text: '已取消收藏' });
		const undo = toast.createEl('button', { text: '撤销', attr: { type: 'button' } });
		undo.onclick = async () => {
			if (generation !== this.generation || !this.isActive()) return;
			const state = this.favorites.getSnapshot();
			if (
				!state.writable ||
				state.pendingIds.includes(entry.id) ||
				this.favorites.isFavorite(entry.id)
			) {
				this.clear();
				return;
			}
			this.clear();
			const restoring = this.generation;
			try {
				await this.favorites.restore(entry);
				if (this.isActive() && restoring === this.generation) new Notice('已恢复收藏');
			} catch (error) {
				if (this.isActive() && restoring === this.generation)
					new Notice(error instanceof Error ? error.message : '撤销失败，请重试');
			}
		};
		this.timer = window.setTimeout(() => this.clear(), 5000);
	}
}

export class WereadFavoritesPanel extends WereadPanel {
	private active = false;
	private generation = 0;
	private unsubscribe?: () => void;
	private state: FavoritesState;
	private status: HTMLElement;
	private results: HTMLElement;
	private undo: FavoritesUndoToast;
	private query = '';
	private sortAscending = false;
	private sortButton: HTMLButtonElement;
	private mode: 'cards' | 'list' = 'cards';
	private limit = 30;
	private expanded = new Set<string>();
	private modeButtons = new Map<string, HTMLButtonElement>();
	private canvasButton: HTMLButtonElement;
	private openingCanvas = false;
	private masonryObserver?: ResizeObserver;
	private masonryFrame: number | null = null;
	private masonryWindow?: Window;
	constructor(
		contentEl: HTMLElement,
		private plugin: WereadPlugin,
		private favorites: WereadFavoritesService
	) {
		super(contentEl, plugin.app);
		this.state = favorites.getSnapshot();
		this.undo = new FavoritesUndoToast(contentEl, favorites, () => this.active);
	}
	async onOpen(): Promise<void> {
		this.active = true;
		this.mode = get(settingsStore).favoritesViewMode === 'list' ? 'list' : 'cards';
		this.contentEl.empty();
		this.contentEl.addClass('weread-favorites-view');
		const controls = this.contentEl.createDiv({ cls: 'weread-favorites-controls' });
		const search = controls.createEl('input', {
			type: 'search',
			attr: { placeholder: '搜索正文、书名、作者或章节', 'aria-label': '搜索收藏' }
		});
		search.value = this.query;
		search.oninput = () => {
			this.query = search.value;
			this.limit = 30;
			this.render();
		};
		const actions = controls.createDiv({ cls: 'weread-favorites-toolbar-actions' });
		this.sortButton = actions.createEl('button', {
			cls: 'weread-favorites-sort',
			attr: { type: 'button' }
		});
		this.sortButton.onclick = () => {
			this.sortAscending = !this.sortAscending;
			this.limit = 30;
			this.render();
		};
		this.modeButtons.clear();
		for (const [mode, label, icon] of [
			['cards', '卡片视图', 'layout-grid'],
			['list', '列表视图', 'list']
		] as const) {
			const button = actions.createEl('button', {
				cls: 'weread-favorites-toolbar-icon',
				attr: { type: 'button', 'aria-label': label, title: label }
			});
			setIcon(button, icon);
			this.modeButtons.set(mode, button);
			button.onclick = () => {
				this.mode = mode;
				settingsStore.actions.setFavoritesViewMode(mode);
				this.render();
			};
		}
		this.canvasButton = actions.createEl('button', {
			cls: 'weread-favorites-toolbar-icon',
			attr: { type: 'button', 'aria-label': '在Canvas中打开收藏' }
		});
		setIcon(this.canvasButton, 'layout-dashboard');
		this.canvasButton.onclick = () => void this.openCanvas();
		this.status = this.contentEl.createDiv({
			cls: 'weread-favorites-status',
			attr: { 'aria-live': 'polite' }
		});
		this.results = this.contentEl.createDiv({ cls: 'weread-favorites-results' });
		this.unsubscribe = this.favorites.subscribe((state) => {
			this.state = state;
			if (!this.active) return;
			this.undo.update(state);
			this.render();
		});
		this.render();
		try {
			await this.favorites.load(true);
		} catch (error) {
			if (this.active) new Notice(error instanceof Error ? error.message : '收藏加载失败');
		}
	}
	async onClose(): Promise<void> {
		this.active = false;
		this.stopMasonry();
		this.generation += 1;
		this.openingCanvas = false;
		this.unsubscribe?.();
		this.unsubscribe = undefined;
		this.undo.clear();
	}
	private async openCanvas(): Promise<void> {
		if (
			this.openingCanvas ||
			!this.active ||
			!this.state.loaded ||
			this.state.loading ||
			!this.state.writable
		)
			return;
		const generation = this.generation;
		this.openingCanvas = true;
		this.render();
		try {
			const path = await this.favorites.ensureCanvas();
			if (!this.active || generation !== this.generation) return;
			await this.plugin.app.workspace.openLinkText(path, '', true);
		} catch (error) {
			if (this.active && generation === this.generation)
				new Notice(error instanceof Error ? error.message : '打开Canvas失败，请重试');
		} finally {
			if (generation === this.generation) {
				this.openingCanvas = false;
				if (this.active) this.render();
			}
		}
	}
	private stopMasonry(): void {
		this.masonryObserver?.disconnect();
		this.masonryObserver = undefined;
		if (this.masonryFrame !== null) this.masonryWindow?.cancelAnimationFrame(this.masonryFrame);
		this.masonryFrame = null;
		this.masonryWindow = undefined;
	}
	private startMasonry(): void {
		const view = this.results.ownerDocument.defaultView;
		if (this.mode !== 'cards' || !view?.ResizeObserver) return;
		this.masonryWindow = view;
		this.results.addClass('is-masonry');
		const layout = (): void => {
			if (!this.active || this.masonryObserver !== observer || !this.results.clientWidth)
				return;
			// Electron zoom can resolve a 1px track to e.g. 0.992747px.
			const tracks = view.getComputedStyle(this.results);
			const rowHeight =
				parseFloat(tracks.gridTemplateRows) || parseFloat(tracks.gridAutoRows) || 1;
			for (const item of Array.from(this.results.children) as HTMLElement[]) {
				const style = view.getComputedStyle(item);
				const height = parseFloat(style.height) || item.offsetHeight;
				if (!height) continue;
				const outerHeight =
					height +
					(parseFloat(style.marginTop) || 0) +
					(parseFloat(style.marginBottom) || 0);
				const span = `span ${Math.ceil(outerHeight / rowHeight)}`;
				if (item.style.gridRowEnd !== span) item.style.gridRowEnd = span;
			}
		};
		const observer = new view.ResizeObserver(() => {
			if (!this.active || this.masonryObserver !== observer || this.masonryFrame !== null)
				return;
			this.masonryFrame = view.requestAnimationFrame(() => {
				this.masonryFrame = null;
				layout();
			});
		});
		this.masonryObserver = observer;
		for (const item of Array.from(this.results.children)) observer.observe(item);
		layout();
	}
	private render(): void {
		if (!this.active || !this.results) return;
		this.stopMasonry();
		const state = this.state;
		const direction = this.sortAscending ? '从旧到新' : '从新到旧';
		this.sortButton.setAttribute('aria-label', `按收藏时间${direction}排序`);
		this.sortButton.title = `收藏时间${direction}；点击切换为${this.sortAscending ? '从新到旧' : '从旧到新'}`;
		this.sortButton.empty();
		this.sortButton.createSpan({ text: '收藏时间' });
		setIcon(this.sortButton.createSpan(), this.sortAscending ? 'arrow-up' : 'arrow-down');
		for (const [mode, button] of this.modeButtons)
			button.setAttribute('aria-pressed', String(mode === this.mode));
		this.canvasButton.disabled =
			this.openingCanvas || !state.loaded || state.loading || !state.writable;
		this.canvasButton.title = !state.writable
			? state.error || state.warning || '收藏当前为只读，请重新读取后打开Canvas'
			: this.openingCanvas
				? '正在打开Canvas…'
				: '在新的Canvas标签页中打开收藏；收藏保存在当前笔记库的Canvas，可直接打开整理卡片。';
		this.status.empty();
		if (state.loading || !state.loaded)
			this.status.createEl('p', { text: '正在读取本地收藏…' });
		if (state.error) {
			this.status.createEl('p', { text: state.error, cls: 'weread-favorites-error' });
			this.status.createEl('button', { text: '重新读取收藏' }).onclick = async () => {
				try {
					await this.favorites.load(true);
				} catch (error) {
					if (this.active)
						new Notice(error instanceof Error ? error.message : '收藏加载失败');
				}
			};
		}
		if (state.warning) this.status.createEl('p', { text: state.warning });
		if (state.loaded && !state.writable)
			this.status.createEl('p', {
				text: '当前收藏为只读，已有记录仍可阅读。请解决上方问题后重新读取。'
			});
		const query = this.query.trim().toLocaleLowerCase();
		const entries = state.favorites
			.filter(({ note }) =>
				`${note.text} ${note.bookTitle} ${note.author} ${note.chapterTitle || ''}`
					.toLocaleLowerCase()
					.includes(query)
			)
			.sort(
				(a, b) =>
					(this.sortAscending
						? a.favoritedAt - b.favoritedAt
						: b.favoritedAt - a.favoritedAt) || a.id.localeCompare(b.id)
			);
		if (state.loaded) {
			const counts = this.status.createEl('p', { cls: 'weread-favorites-counts' });
			const bookCount = new Set(
				entries.map(({ note }) => String(note.bookId ?? '').trim()).filter(Boolean)
			).size;
			for (const [icon, text] of [
				['star', `${entries.length} 条收藏`],
				['book-open', `${bookCount} 本书`]
			]) {
				const count = counts.createSpan({ cls: 'weread-favorites-count' });
				setIcon(count.createSpan({ attr: { 'aria-hidden': 'true' } }), icon);
				count.createSpan({ text });
			}
			if (query) counts.createSpan({ text: `共 ${state.favorites.length} 条收藏` });
		}
		this.results.empty();
		this.results.className = `weread-favorites-results is-${this.mode}`;
		if (!entries.length && state.loaded)
			this.results.createEl('p', {
				text:
					state.error && !state.favorites.length
						? '收藏暂不可用，请解决上方存储问题后重新读取。'
						: query
							? '没有找到符合搜索的收藏。试试其他正文、书名、作者或章节。'
							: '还没有收藏。在今日或回顾的划线旁点亮星标，让喜欢的句子在这里相聚。',
				cls: 'weread-favorites-empty'
			});
		for (const entry of entries.slice(0, this.limit)) this.renderEntry(entry);
		if (entries.length > this.limit)
			this.results.createEl('button', {
				text: `再看 ${Math.min(30, entries.length - this.limit)} 条`,
				cls: 'weread-favorites-more'
			}).onclick = () => {
				this.limit += 30;
				this.render();
			};
		this.startMasonry();
	}
	private renderEntry(entry: FavoriteEntry): void {
		const note = entry.note;
		const card = this.results.createEl('article', { cls: 'weread-favorites-entry' });
		card.dataset.favoriteId = entry.id;
		if (this.mode === 'cards') {
			// Stable per favorite: filtering and sorting must not make colors jump.
			let hue = 2166136261;
			for (let index = 0; index < entry.id.length; index++) {
				hue = Math.imul(hue ^ entry.id.charCodeAt(index), 16777619);
			}
			hue ^= hue >>> 16;
			card.style.setProperty('--weread-favorite-hue', String((hue >>> 0) % 360));
		}
		if (this.mode === 'cards' && note.cover && /^https?:\/\//.test(note.cover)) {
			const cover = card.createEl('img', {
				cls: 'weread-favorites-cover',
				attr: { src: note.cover, alt: '', loading: 'lazy' }
			});
			cover.onerror = () => cover.remove();
		}
		const content = card.createDiv({ cls: 'weread-favorites-content' });
		const metadata = content.createDiv({ cls: 'weread-favorites-meta' });
		metadata.createEl('small', {
			text: `收藏于 ${new Date(entry.favoritedAt).toLocaleDateString('zh-CN')} · 划线于 ${new Date(note.createTime).toLocaleDateString('zh-CN')}`
		});
		const actions = metadata.createDiv({ cls: 'weread-favorites-note-actions' });
		const label = getJournalNoteBookmark(note) ? '回到原文' : '打开书籍';
		const original = actions.createEl('a', {
			href: getPcUrl(note.bookId),
			cls: 'weread-favorites-action',
			attr: { 'aria-label': label, title: label }
		});
		setOriginalReadingIcon(original);
		original.onclick = (event) => {
			event.preventDefault();
			void openJournalNoteOriginal(this.plugin, note).catch(() => {
				if (this.active) new Notice('打开原文失败，请重试');
			});
		};
		const copy = actions.createEl('button', {
			cls: 'weread-favorites-action',
			attr: { type: 'button', 'aria-label': '复制正文', title: '复制正文' }
		});
		setIcon(copy, 'copy');
		copy.onclick = async () => {
			try {
				await navigator.clipboard.writeText(note.text);
				if (this.active) new Notice('已复制');
			} catch {
				if (this.active) new Notice('复制失败，请重试');
			}
		};
		const remove = actions.createEl('button', {
			cls: 'weread-favorites-action',
			attr: { type: 'button', 'aria-label': '取消收藏', title: '取消收藏' }
		});
		setIcon(remove, 'star');
		remove.setAttribute('aria-pressed', 'true');
		remove.disabled =
			!this.state.loaded ||
			this.state.loading ||
			!this.state.writable ||
			this.state.pendingIds.includes(entry.id);
		if (!this.state.writable)
			remove.title = this.state.error || this.state.warning || '收藏当前为只读';
		remove.onclick = async () => {
			if (!this.active || remove.disabled) return;
			const generation = this.generation;
			this.undo.clear();
			try {
				await this.favorites.remove(entry.id);
				if (this.active && generation === this.generation) this.undo.show(entry);
			} catch (error) {
				if (this.active && generation === this.generation)
					new Notice(error instanceof Error ? error.message : '取消收藏失败，请重试');
			}
		};
		if (this.mode === 'list') {
			const expanded = this.expanded.has(entry.id);
			const excerpt = note.text.replace(/\s+/g, ' ').slice(0, 120) || '空白划线';
			const summary = content.createEl('button', {
				cls: 'weread-favorites-summary',
				text: expanded ? '收起全文' : excerpt,
				attr: { type: 'button', 'aria-expanded': String(expanded) }
			});
			const full = content.createEl('p', { text: note.text, cls: 'weread-favorites-text' });
			full.hidden = !expanded;
			summary.onclick = () => {
				const next = !this.expanded.has(entry.id);
				if (next) this.expanded.add(entry.id);
				else this.expanded.delete(entry.id);
				summary.setAttribute('aria-expanded', String(next));
				summary.textContent = next ? '收起全文' : excerpt;
				full.hidden = !next;
			};
		} else content.createEl('p', { text: note.text, cls: 'weread-favorites-text' });
		const source = content.createEl('button', {
			text: `《${note.bookTitle}》 · ${note.author || '未知作者'}`,
			cls: 'weread-favorites-source'
		});
		source.disabled = typeof this.plugin.activateBookDetailView !== 'function';
		source.onclick = () => {
			void this.plugin.activateBookDetailView?.(note.bookId, note.bookTitle, note.cover);
		};
		if (note.chapterTitle) content.createEl('small', { text: note.chapterTitle });
	}
}
