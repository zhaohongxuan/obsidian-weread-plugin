/** Native Obsidian journal views share one persisted note cache across navigation. */
import './wereadJournal.css';
import { ItemView, Notice, WorkspaceLeaf, setIcon } from 'obsidian';
import { settingsStore } from '../settings';
import { get } from 'svelte/store';
import type WereadPlugin from '../../main';
import type ApiRouter from '../api-router';
import type { JournalNote, JournalState, WereadJournalService } from '../journal';
import { WereadPanel } from './wereadPanel';
import type { WereadFavoritesService } from '../favorites';
import type { FavoritesState } from '../models';
import { FavoritesUndoToast } from './wereadFavorites';
import { getPcUrl } from '../parser/parseResponse';
import { getJournalNoteBookmark, openJournalNoteOriginal } from '../utils/openWereadUrl';
import { setOriginalReadingIcon } from '../utils/readingActionIcon';

export const WEREAD_TODAY_VIEW_ID = 'weread-today-view';
export const WEREAD_REVIEW_VIEW_ID = 'weread-review-view';
export type JournalMode = 'today' | 'review';

function dayKey(date: Date): string {
	return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
function noteDay(note: JournalNote): string {
	return dayKey(new Date(note.createTime));
}

export class WereadJournalPanel extends WereadPanel {
	private unsubscribe?: () => void;
	private unsubscribeSettings?: () => void;
	private unsubscribeFavorites?: () => void;
	private favorites?: WereadFavoritesService;
	private favoritesUndo?: FavoritesUndoToast;
	private favoriteState?: FavoritesState;
	private favoritesGeneration = 0;
	private updateFavoriteStars(initialStar?: HTMLButtonElement): void {
		if (!this.active || !this.favoriteState) return;
		const state = this.favoriteState;
		const ids = new Set(state.favorites.map((entry) => entry.id));
		const stars = initialStar
			? [initialStar]
			: Array.from(
					this.contentEl.querySelectorAll<HTMLButtonElement>('.weread-journal-favorite')
				);
		for (const star of stars) {
			const id = star.dataset.favoriteId!;
			const favorite = ids.has(id);
			const label = favorite ? '取消收藏' : '收藏';
			const pressed = String(favorite);
			const disabled =
				!state.loaded || state.loading || !state.writable || state.pendingIds.includes(id);
			const title = !state.writable
				? state.error || state.warning || '收藏当前为只读'
				: !state.loaded || state.loading
					? '正在读取收藏…'
					: label;
			if (star.getAttribute('aria-pressed') !== pressed)
				star.setAttribute('aria-pressed', pressed);
			if (star.getAttribute('aria-label') !== label) star.setAttribute('aria-label', label);
			if (star.disabled !== disabled) star.disabled = disabled;
			if (star.title !== title) star.title = title;
		}
	}
	private async toggleFavorite(note: JournalNote): Promise<void> {
		const favorites = this.favorites;
		if (!favorites) return;
		const state = favorites.getSnapshot();
		if (!state.loaded || state.loading || !state.writable || state.pendingIds.includes(note.id))
			return;
		const entry = state.favorites.find((entry) => entry.id === note.id);
		const generation = this.favoritesGeneration;
		this.favoritesUndo?.clear();
		try {
			await favorites.setFavorite(note, !entry);
			if (!this.active || generation !== this.favoritesGeneration) return;
			if (entry) this.favoritesUndo?.show(entry);
			else new Notice('已收藏');
		} catch (error) {
			if (this.active)
				new Notice(error instanceof Error ? error.message : '收藏保存失败，请重试');
		}
	}
	private credentialGeneration = 0;
	private credentialKey = '';
	private exclusionsKey = '';
	private readExcludedBookIds(): Set<string> {
		const value: unknown = get(settingsStore)?.journalExcludedBookIds;
		return new Set(
			Array.isArray(value)
				? value
						.map((id) =>
							typeof id === 'string'
								? id.trim()
								: typeof id === 'number' && Number.isFinite(id)
									? String(id)
									: ''
						)
						.filter(Boolean)
				: []
		);
	}
	private readExclusionsKey(): string {
		return JSON.stringify([...this.readExcludedBookIds()].sort());
	}
	private readCredentialKey(): string {
		const settings = get(settingsStore);
		return JSON.stringify([
			settings.wereadApiKey,
			settings.userVid,
			settings.cookies.map((cookie) => [cookie.name, cookie.value]).sort()
		]);
	}
	private body: HTMLElement;
	private status: HTMLElement;
	private selectedDay = dayKey(new Date());
	private month = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
	private query = '';
	private kind = 'all';
	private limit = 100;
	private quote?: JournalNote;
	private state: JournalState;
	private todaySeconds?: number;
	private statsError = '';
	private statsLoading = true;
	private shelfLoading = true;
	private todayBooks: { bookId: string; title: string; cover?: string; author: string }[] = [];
	private shelfError = '';
	private async loadTodayBooks(force = false): Promise<void> {
		const date = this.date;
		const generation = this.credentialGeneration;
		this.shelfLoading = true;
		try {
			const shelf = await this.api.getShelf(force);
			if (!this.active || date !== this.date || generation !== this.credentialGeneration)
				return;
			this.todayBooks = shelf.books
				.filter(
					(book) =>
						Number(book.readUpdateTime) > 0 &&
						dayKey(new Date(Number(book.readUpdateTime) * 1000)) === date
				)
				.sort((left, right) => Number(right.readUpdateTime) - Number(left.readUpdateTime))
				.slice(0, 3)
				.map((book) => ({
					bookId: String(book.bookId),
					title: String(book.title || '未命名书籍'),
					author: String(book.author || ''),
					cover: typeof book.cover === 'string' ? book.cover : undefined
				}));
			this.shelfError = '';
		} catch (error) {
			if (generation === this.credentialGeneration)
				this.shelfError = error instanceof Error ? error.message : '今日书架暂不可用';
		}
		if (this.active && date === this.date && generation === this.credentialGeneration) {
			this.shelfLoading = false;
			this.render();
		}
	}
	private active = false;
	private refreshTimer?: number;
	private date = dayKey(new Date());

	constructor(
		contentEl: HTMLElement,
		private plugin: WereadPlugin,
		private journal: WereadJournalService,
		private api: ApiRouter,
		private mode: JournalMode
	) {
		super(contentEl, plugin.app);
		this.state = journal.getSnapshot();
	}
	getViewType(): string {
		return this.mode === 'today' ? WEREAD_TODAY_VIEW_ID : WEREAD_REVIEW_VIEW_ID;
	}
	getDisplayText(): string {
		return this.mode === 'today' ? '微信读书 · 今日' : '微信读书 · 回顾';
	}
	getIcon(): string {
		return this.mode === 'today' ? 'sun' : 'history';
	}

	async onOpen(): Promise<void> {
		this.active = true;
		this.contentEl.empty();
		this.contentEl.addClass('weread-journal-view');
		if (this.mode === 'review') this.contentEl.addClass('is-review');
		const heading = this.contentEl.createDiv({ cls: 'weread-journal-heading' });
		heading.createEl('h1', {
			text: this.mode === 'today' ? '把今天，读进生活里。' : '与读过的时光重逢。'
		});
		heading.createEl('button', { text: '刷新笔记' }).onclick = () => {
			void this.loadJournal(true);
			if (this.mode === 'today') {
				void this.loadStats();
				void this.loadTodayBooks();
			}
		};
		this.status = this.contentEl.createDiv({
			cls: 'weread-journal-status',
			attr: { 'aria-live': 'polite' }
		});
		this.body = this.contentEl.createDiv({ cls: 'weread-journal-body' });
		this.favorites = this.plugin.favoritesService;
		if (this.favorites) {
			this.favoritesUndo = new FavoritesUndoToast(
				this.contentEl,
				this.favorites,
				() => this.active
			);
			this.favoriteState = this.favorites.getSnapshot();
			this.unsubscribeFavorites = this.favorites.subscribe((state) => {
				this.favoriteState = state;
				if (!this.active) return;
				this.favoritesUndo?.update(state);
				this.updateFavoriteStars();
			});
			void this.favorites.load().catch((error: unknown) => {
				if (this.active)
					new Notice(error instanceof Error ? error.message : '收藏加载失败');
			});
		}
		this.unsubscribe = this.journal.subscribe((state) => {
			this.state = state;
			if (this.active) this.render();
		});
		this.credentialKey = this.readCredentialKey();
		this.exclusionsKey = this.readExclusionsKey();
		this.unsubscribeSettings = settingsStore.subscribe(() => {
			const key = this.readCredentialKey();
			const exclusionsKey = this.readExclusionsKey();
			const exclusionsChanged = exclusionsKey !== this.exclusionsKey;
			this.exclusionsKey = exclusionsKey;
			if (key === this.credentialKey) {
				// Only replace the quote: Review controls, focus and scroll stay intact.
				if (exclusionsChanged && this.active) this.renderQuote();
				return;
			}
			this.credentialKey = key;
			this.credentialGeneration += 1;
			this.todayBooks = [];
			this.todaySeconds = undefined;
			this.statsError = '';
			this.shelfError = '';
			this.statsLoading = true;
			this.shelfLoading = true;
			this.quote = undefined;
			this.state = this.journal.getSnapshot();
			this.render();
			void this.loadJournal();
			if (this.mode === 'today') {
				void this.loadStats();
				void this.loadTodayBooks();
			}
		});
		await this.loadJournal();
		if (!this.active) return;
		if (this.mode === 'today') {
			void this.loadStats();
			void this.loadTodayBooks();
		}
		this.refreshTimer = window.setInterval(() => {
			const date = dayKey(new Date());
			if (date !== this.date) {
				this.date = date;
				this.todayBooks = [];
				this.todaySeconds = undefined;
				this.statsLoading = true;
				this.shelfLoading = true;
				this.quote = undefined;
				this.render();
				if (this.mode === 'today') {
					void this.loadStats();
					void this.loadTodayBooks();
				}
			}
			void this.loadJournal();
		}, 60_000);
	}
	async onClose(): Promise<void> {
		this.active = false;
		this.favoritesGeneration += 1;
		this.unsubscribe?.();
		this.unsubscribeSettings?.();
		this.unsubscribeFavorites?.();
		this.unsubscribeFavorites = undefined;
		this.favoritesUndo?.clear();
		this.credentialGeneration += 1;
		window.clearInterval(this.refreshTimer);
	}
	private async loadJournal(force = false): Promise<void> {
		try {
			await this.journal.load(force);
		} catch (error) {
			if (this.active) new Notice(error instanceof Error ? error.message : '笔记加载失败');
		}
	}
	private async loadStats(): Promise<void> {
		const date = this.date;
		const generation = this.credentialGeneration;
		this.statsLoading = true;
		this.todaySeconds = undefined;
		this.statsError = '';
		try {
			const response = await this.api.getReadingStats(
				'monthly',
				Math.floor(Date.now() / 1000)
			);
			if (!response) throw new Error('今日阅读时长暂不可用');
			if (!this.active || date !== this.date || generation !== this.credentialGeneration)
				return;
			const values = Object.entries(response.readTimes ?? {}).filter(
				([timestamp]) => dayKey(new Date(Number(timestamp) * 1000)) === date
			);
			this.todaySeconds = values.length
				? values.reduce((sum, [, seconds]) => sum + Math.max(0, Number(seconds) || 0), 0)
				: undefined;
		} catch (error) {
			if (generation === this.credentialGeneration)
				this.statsError = error instanceof Error ? error.message : '阅读统计加载失败';
		}
		if (this.active && date === this.date && generation === this.credentialGeneration) {
			this.statsLoading = false;
			this.render();
		}
	}
	private render(): void {
		if (!this.body) return;
		const state = this.state;
		this.status.setText(
			`${state.hasCache ? `已缓存 ${state.notes.length} 条笔记` : '首次整理笔记'}${state.syncing ? ` · 正在更新 ${state.scannedBooks}/${state.totalBooks} 本` : ''}${state.updatedAt ? ` · 上次更新 ${new Date(state.updatedAt).toLocaleString('zh-CN')}` : ''}${state.failedBooks ? ` · ${state.failedBooks} 本未完整获取` : ''}${state.error ? ` · ${state.error}` : ''}`
		);
		const focused = this.body.ownerDocument.activeElement;
		const search =
			focused instanceof HTMLInputElement &&
			this.body.contains(focused) &&
			focused.type === 'search'
				? focused
				: undefined;
		const selection = search ? [search.selectionStart, search.selectionEnd] : undefined;
		const previousList = this.body.querySelector<HTMLElement>('.weread-journal-day-list');
		const scrollTop = previousList?.scrollTop ?? 0;
		const scrollKey = previousList?.dataset.scrollKey;
		const listFocused = focused === previousList;
		this.body.empty();
		if (this.mode === 'today') this.renderToday();
		else this.renderReview();
		const list = this.body.querySelector<HTMLElement>('.weread-journal-day-list');
		if (list && list.dataset.scrollKey === scrollKey) {
			list.scrollTop = scrollTop;
			if (listFocused) list.focus({ preventScroll: true });
		}
		if (selection) {
			const replacement = this.body.querySelector<HTMLInputElement>('input[type="search"]');
			replacement?.focus({ preventScroll: true });
			replacement?.setSelectionRange(selection[0], selection[1]);
		}
	}
	private renderToday(): void {
		const today = this.date;
		const notes = this.state.notes.filter((note) => noteDay(note) === today);
		this.body.createEl('p', {
			text: new Date().toLocaleDateString('zh-CN', {
				year: 'numeric',
				month: 'long',
				day: 'numeric',
				weekday: 'long'
			}),
			cls: 'weread-journal-muted'
		});
		const summary = this.body.createDiv({ cls: 'weread-journal-summary' });
		const seconds = this.todaySeconds;
		const duration = this.statsLoading
			? '加载中…'
			: seconds === undefined
				? this.statsError || '今日暂无时长记录'
				: `${Math.floor(seconds / 3600)}小时${Math.floor((seconds % 3600) / 60)}分钟`;
		const count = (kind: JournalNote['kind']) =>
			!this.state.hasCache && this.state.notes.length === 0
				? this.state.syncing
					? '加载中…'
					: '暂不可用'
				: `${notes.filter((n) => n.kind === kind).length} 条`;
		const countStatus = this.state.syncing
			? '统计中，当前为部分结果'
			: this.state.failedBooks
				? '部分书籍加载失败，当前为部分结果'
				: '';
		const metrics = summary.createDiv({ cls: 'weread-journal-today-metrics' });
		metrics.createEl('h2', { text: '今日数据', cls: 'weread-journal-summary-title' });
		const metricsGrid = metrics.createDiv({ cls: 'weread-journal-today-metrics-grid' });
		for (const [label, value] of [
			['阅读时长', duration],
			['今日划线', count('highlight')],
			['今日想法', count('thought')]
		]) {
			const card = metricsGrid.createDiv();
			card.createEl('span', { text: label });
			card.createEl('strong', { text: value });
			if (label !== '阅读时长' && countStatus) {
				card.createEl('small', {
					text: countStatus,
					cls: 'weread-journal-metric-status'
				});
			}
		}
		const booksSummary = summary.createDiv({ cls: 'weread-journal-today-books' });
		booksSummary.createEl('h2', {
			text: '今天翻开的书',
			cls: 'weread-journal-summary-title',
			attr: { title: '按书架最近阅读日期 · 电子书' }
		});
		const books = booksSummary.createDiv({
			cls: 'weread-journal-today-book-list',
			attr: { 'aria-label': '今天翻开的书' }
		});
		if (this.shelfLoading)
			books.createEl('p', { text: '正在查看今日书架…', cls: 'weread-journal-muted' });
		else if (this.shelfError)
			books.createEl('p', { text: this.shelfError, cls: 'weread-journal-muted' });
		else if (!this.todayBooks.length)
			books.createEl('p', {
				text: '书架中暂无最近阅读日期为今天的书。',
				cls: 'weread-journal-muted'
			});
		for (const book of this.todayBooks) {
			const card = books.createDiv({ cls: 'weread-journal-note' });
			if (book.cover && /^https?:\/\//.test(book.cover))
				card.createEl('img', {
					cls: 'weread-journal-note-cover',
					attr: { src: book.cover, alt: '', loading: 'lazy' }
				});
			const content = card.createDiv();
			content.createEl('button', {
				text: `《${book.title}》`,
				cls: 'weread-journal-source'
			}).onclick = () => {
				void this.plugin.activateBookDetailView(book.bookId, book.title, book.cover);
			};
			content.createEl('small', { text: book.author });
			const reading = content.createEl('a', {
				text: '继续阅读 ↗',
				href: getPcUrl(book.bookId),
				cls: 'weread-journal-original'
			});
			reading.onclick = (event) => {
				event.preventDefault();
				void openJournalNoteOriginal(this.plugin, { bookId: book.bookId, text: '' }).catch(
					() => {
						new Notice('打开书籍失败，请重试');
					}
				);
			};
		}
		this.renderQuote();
		const traces = this.body.createDiv({ cls: 'weread-journal-today-notes' });
		traces.createEl('h2', { text: '今天留下的痕迹' });
		this.renderNotes(
			notes,
			this.state.hasCache &&
				!this.state.syncing &&
				!this.state.failedBooks &&
				!this.state.error
				? '今天还没有留下笔记，先读几页也很好。'
				: '已加载范围内暂无今日笔记；请留意上方缓存覆盖状态。',
			traces
		);
	}
	private renderQuote(): void {
		const today = this.date;
		const excluded = this.readExcludedBookIds();
		const highlights = this.state.notes.filter(
			(note) =>
				note.kind === 'highlight' &&
				note.text.trim() &&
				noteDay(note) < today &&
				!excluded.has(note.bookId)
		);
		const candidates = highlights;
		if (
			this.quote &&
			!highlights.some(
				(note) => note.bookId === this.quote.bookId && note.id === this.quote.id
			)
		)
			this.quote = undefined;
		if (!this.quote) this.quote = this.randomQuote(candidates);
		const previous = this.body.querySelector('.weread-journal-quote');
		const section = this.body.createDiv({ cls: 'weread-journal-quote' });
		previous?.replaceWith(section);
		const header = section.createDiv({ cls: 'weread-journal-heading' });
		header.createEl('h2', { text: '旧句重逢' });
		const actions = header.createDiv({ cls: 'weread-journal-actions' });
		const sameBook = highlights.filter(
			(n) => n.bookId === this.quote?.bookId && n.id !== this.quote?.id
		);
		const otherBooks = highlights.filter((n) => n.bookId !== this.quote?.bookId);
		const change = actions.createEl('button', { text: '换一句' });
		change.disabled = sameBook.length === 0;
		change.onclick = () => {
			this.quote = this.randomQuote(sameBook);
			this.render();
		};
		const book = actions.createEl('button', { text: '换一本' });
		book.disabled = otherBooks.length === 0;
		book.onclick = () => {
			this.quote = this.randomQuote(otherBooks);
			this.render();
		};
		if (this.quote) this.renderNote(section, this.quote);
		else
			section.createEl('p', {
				text: excluded.size
					? '当前没有可重逢的往日划线，可在设置中的「旧句重逢排除书籍」重新包含书籍。'
					: '暂时没有可回顾的往日划线。'
			});
	}
	private randomQuote(notes: readonly JournalNote[]): JournalNote | undefined {
		const ids = [...new Set(notes.map((note) => note.bookId))];
		const id = ids[Math.floor(Math.random() * ids.length)];
		const candidates = notes.filter((note) => note.bookId === id);
		return candidates[Math.floor(Math.random() * candidates.length)];
	}
	private renderReview(): void {
		const controls = this.body.createDiv({ cls: 'weread-journal-controls' });
		const query = controls.createEl('input', {
			type: 'search',
			attr: { placeholder: '搜索书名、作者或笔记内容', 'aria-label': '搜索回顾笔记' }
		});
		query.value = this.query;
		const filter = controls.createEl('select', { attr: { 'aria-label': '笔记类型' } });
		for (const [value, label] of [
			['all', '全部笔记'],
			['highlight', '划线'],
			['thought', '想法']
		])
			filter.createEl('option', { value, text: label });
		filter.value = this.kind;
		const layout = this.body.createDiv({ cls: 'weread-journal-retro-grid' });
		const calendar = layout.createEl('aside', {
			cls: 'weread-journal-calendar',
			attr: { 'aria-label': '笔记日历' }
		});
		const results = layout.createDiv({ cls: 'weread-journal-day-notes' });
		const past = this.body.createDiv({ cls: 'weread-journal-anniversaries' });
		const updateResults = () => {
			results.empty();
			past.empty();
			const matches = (note: JournalNote) =>
				(this.kind === 'all' || note.kind === this.kind) &&
				`${note.bookTitle} ${note.author} ${note.text}`
					.toLowerCase()
					.includes(this.query.toLowerCase());
			const anniversaries = this.state.notes.filter((note) => {
				const date = new Date(note.createTime);
				const now = new Date();
				return (
					date.getFullYear() < now.getFullYear() &&
					date.getMonth() === now.getMonth() &&
					date.getDate() === now.getDate() &&
					matches(note)
				);
			});
			past.createEl('h2', { text: '那年今日' });
			this.renderNotes(anniversaries, '往年今日暂无符合筛选的笔记。', past);
			const label = this.query.trim() ? '搜索全部已缓存笔记' : `${this.selectedDay} · 笔记`;
			results.createEl('h2', { text: label });
			const list = results.createDiv({
				cls: 'weread-journal-day-list',
				attr: { role: 'region', 'aria-label': label, tabindex: '0' }
			});
			list.dataset.scrollKey = JSON.stringify([this.selectedDay, this.query, this.kind]);
			this.renderNotes(
				this.state.notes.filter(
					(note) =>
						(this.query.trim() || noteDay(note) === this.selectedDay) && matches(note)
				),
				'这个范围内还没有笔记。',
				list
			);
		};
		query.oninput = () => {
			this.query = query.value;
			this.limit = 100;
			updateResults();
		};
		filter.onchange = () => {
			this.kind = filter.value;
			this.limit = 100;
			updateResults();
		};
		const jumpTo = (date: Date) => {
			this.month = new Date(date.getFullYear(), date.getMonth(), 1);
			this.selectedDay = dayKey(date);
			this.limit = 100;
			this.render();
		};
		const header = calendar.createDiv({ cls: 'weread-journal-month' });
		header.createEl('button', {
			text: '‹',
			cls: 'weread-journal-month-nav',
			attr: { 'aria-label': '上个月' }
		}).onclick = () => {
			jumpTo(new Date(this.month.getFullYear(), this.month.getMonth() - 1, 1));
		};
		header.createEl('strong', {
			text: `${this.month.getFullYear()} 年 ${this.month.getMonth() + 1} 月`,
			attr: { 'aria-live': 'polite' }
		});
		const next = header.createEl('button', {
			text: '›',
			cls: 'weread-journal-month-nav',
			attr: { 'aria-label': '下个月' }
		});
		next.disabled = dayKey(this.month).slice(0, 7) >= this.date.slice(0, 7);
		next.onclick = () => {
			jumpTo(new Date(this.month.getFullYear(), this.month.getMonth() + 1, 1));
		};
		const monthJump = calendar.createEl('label', {
			cls: 'weread-journal-month-jump',
			text: '跳至月份'
		});
		const monthInput = monthJump.createEl('input', {
			type: 'month',
			attr: { 'aria-label': '跳至笔记月份', max: this.date.slice(0, 7) }
		});
		monthInput.value = dayKey(this.month).slice(0, 7);
		monthInput.onchange = () => {
			const value = monthInput.value;
			if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(value) || value > this.date.slice(0, 7)) return;
			const [year, month] = value.split('-').map(Number);
			jumpTo(new Date(year, month - 1, 1));
		};
		const grid = calendar.createDiv({ cls: 'weread-journal-calendar-grid' });
		for (const day of ['一', '二', '三', '四', '五', '六', '日'])
			grid.createEl('span', { text: day });
		const counts = new Map<string, number>();
		for (const note of this.state.notes)
			counts.set(noteDay(note), (counts.get(noteDay(note)) ?? 0) + 1);
		const offset = (this.month.getDay() + 6) % 7;
		for (let i = 0; i < offset; i++) grid.createSpan();
		const days = new Date(this.month.getFullYear(), this.month.getMonth() + 1, 0).getDate();
		for (let day = 1; day <= days; day++) {
			const key = dayKey(new Date(this.month.getFullYear(), this.month.getMonth(), day));
			const count = counts.get(key) ?? 0;
			const intensity =
				count === 0 ? 0 : count <= 2 ? 1 : count <= 5 ? 2 : count <= 10 ? 3 : 4;
			const label = `${key}，${count}条笔记`;
			const button = grid.createEl('button', {
				cls: `weread-journal-day${count ? ' has-notes' : ''}${key === this.selectedDay ? ' is-selected' : ''}`,
				attr: {
					'aria-label': label,
					title: label,
					'data-note-count': String(count),
					'data-note-intensity': String(intensity),
					'aria-pressed': String(key === this.selectedDay),
					...(key === this.date ? { 'aria-current': 'date' } : {})
				}
			});
			button.disabled = key > this.date;
			button.createEl('span', { text: String(day) });
			button.onclick = () => {
				this.selectedDay = key;
				this.limit = 100;
				this.render();
			};
		}
		calendar.createEl('p', {
			text: '日期底色越深，笔记越多；按笔记创建日期统计。',
			cls: 'weread-journal-calendar-caption'
		});
		const footer = calendar.createDiv({ cls: 'weread-journal-calendar-footer' });
		footer.createEl('button', { text: '回到今天', cls: 'weread-journal-today' }).onclick =
			() => {
				jumpTo(new Date());
			};
		const latest = this.state.notes.reduce<JournalNote | undefined>(
			(result, note) =>
				noteDay(note) <= this.date && (!result || note.createTime > result.createTime)
					? note
					: result,
			undefined
		);
		if (latest)
			footer.createEl('button', {
				text: '最近笔记日',
				cls: 'weread-journal-latest'
			}).onclick = () => {
				jumpTo(new Date(latest.createTime));
			};
		updateResults();
		this.renderQuote();
	}
	private renderNotes(notes: readonly JournalNote[], empty: string, parent = this.body): void {
		if (!notes.length) {
			parent.createEl('p', { text: empty, cls: 'weread-journal-muted' });
			return;
		}
		for (const note of notes.slice(0, this.limit)) this.renderNote(parent, note);
		if (notes.length > this.limit)
			parent.createEl('button', {
				text: `再看 ${Math.min(100, notes.length - this.limit)} 条`
			}).onclick = () => {
				this.limit += 100;
				this.render();
			};
	}
	private renderNote(parent: HTMLElement, note: JournalNote): void {
		const card = parent.createEl('article', { cls: `weread-journal-note is-${note.kind}` });
		if (note.cover && /^https?:\/\//.test(note.cover)) {
			const image = card.createEl('img', {
				cls: 'weread-journal-note-cover',
				attr: { src: note.cover, alt: '', loading: 'lazy' }
			});
			image.onerror = () => image.remove();
		}
		const content = card.createDiv();
		const metadata = content.createDiv({ cls: 'weread-journal-note-meta' });
		metadata.createEl('small', {
			text: `${note.kind === 'highlight' ? '划线' : '想法'} · ${new Date(note.createTime).toLocaleDateString('zh-CN')}`
		});
		const label = getJournalNoteBookmark(note) ? '回到原文' : '打开书籍';
		const original = metadata.createEl('a', {
			href: getPcUrl(note.bookId),
			cls: 'weread-journal-note-action',
			attr: { title: label, 'aria-label': label }
		});
		setOriginalReadingIcon(original);
		original.onclick = (event) => {
			event.preventDefault();
			void openJournalNoteOriginal(this.plugin, note).catch(() => {
				new Notice('打开原文失败，请重试');
			});
		};
		const copy = metadata.createEl('button', {
			cls: 'weread-journal-note-action',
			attr: { type: 'button', title: '复制正文', 'aria-label': '复制正文' }
		});
		setIcon(copy, 'copy');
		copy.onclick = async () => {
			try {
				await navigator.clipboard.writeText(note.text);
				new Notice('已复制');
			} catch {
				new Notice('复制失败，请重试');
			}
		};
		if (note.kind === 'highlight' && this.favorites) {
			const star = metadata.createEl('button', {
				cls: 'weread-journal-note-action weread-journal-favorite',
				attr: { type: 'button', 'aria-label': '收藏', 'aria-pressed': 'false' }
			});
			star.dataset.favoriteId = note.id;
			setIcon(star, 'star');
			star.onclick = () => void this.toggleFavorite(note);
			this.updateFavoriteStars(star);
		}
		content.createEl('p', { text: note.text, cls: 'weread-journal-note-text' });
		const source = content.createEl('button', {
			text: `《${note.bookTitle}》 · ${note.author || '未知作者'}`,
			cls: 'weread-journal-source'
		});
		source.onclick = () => {
			void this.plugin.activateBookDetailView(note.bookId, note.bookTitle, note.cover);
		};
		if (note.chapterTitle) content.createEl('small', { text: note.chapterTitle });
	}
}

/** Compatibility wrapper; normal navigation now uses WereadLibraryView. */
export class WereadJournalView extends ItemView {
	private panel: WereadJournalPanel;
	constructor(
		leaf: WorkspaceLeaf,
		plugin: WereadPlugin,
		journal: WereadJournalService,
		api: ApiRouter,
		private mode: JournalMode
	) {
		super(leaf);
		this.panel = new WereadJournalPanel(this.contentEl, plugin, journal, api, mode);
		this.addChild(this.panel);
	}
	getViewType(): string {
		return this.mode === 'today' ? WEREAD_TODAY_VIEW_ID : WEREAD_REVIEW_VIEW_ID;
	}
	getDisplayText(): string {
		return this.mode === 'today' ? '微信读书 · 今日' : '微信读书 · 回顾';
	}
	getIcon(): string {
		return this.mode === 'today' ? 'sun' : 'history';
	}
	async onOpen(): Promise<void> {
		await this.panel.onOpen();
	}
	async onClose(): Promise<void> {
		this.removeChild(this.panel);
	}
}
