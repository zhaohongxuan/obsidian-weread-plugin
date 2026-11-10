/** Native Obsidian journal views share one persisted note cache across navigation. */
import './wereadJournal.css';
import { ItemView, Notice, WorkspaceLeaf, setIcon } from 'obsidian';
import { settingsStore } from '../settings';
import { get } from 'svelte/store';
import type WereadPlugin from '../../main';
import type ApiRouter from '../api-router';
import { isJournalArticle } from '../journalHelpers';
import type { JournalNote, JournalState, WereadJournalService } from '../journal';
import { WereadPanel } from './wereadPanel';
import type { WereadFavoritesService } from '../favorites';
import type { FavoritesState } from '../models';
import { FavoritesUndoToast } from './wereadFavorites';
import { getPcUrl } from '../parser/parseResponse';
import { getJournalNoteBookmark, openJournalNoteOriginal } from '../utils/openWereadUrl';
import { setOriginalReadingIcon } from '../utils/readingActionIcon';
import { formatNoteTimestamp } from '../utils/noteTime';

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
		return JSON.stringify([
			[...this.readExcludedBookIds()].sort(),
			get(settingsStore)?.journalIncludeArticles !== false
		]);
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
	private headerDate: HTMLElement;
	private refreshButton: HTMLButtonElement;
	private pendingLoads = 0;
	private selectedDay = dayKey(new Date());
	private month = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
	private query = '';
	private kind = 'all';
	private limit = 100;
	private noteSortOrder: 'desc' | 'asc' = 'desc';
	private quote?: JournalNote;
	private state: JournalState;
	private updateContent?: () => void;
	private renderedNotes = new WeakMap<HTMLElement, HTMLElement[]>();
	private noteUpdates = new WeakMap<HTMLElement, (note: JournalNote) => void>();
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
		this.contentEl.addClass(this.mode === 'today' ? 'is-today' : 'is-review');
		const heading = this.contentEl.createDiv({ cls: 'weread-journal-heading' });
		this.headerDate = heading.createEl('time', { cls: 'weread-journal-today-date' });
		this.status = heading.createDiv({
			cls: 'weread-journal-status',
			attr: { 'aria-live': 'polite' }
		});
		this.refreshButton = heading.createEl('button', {
			cls: 'clickable-icon weread-journal-refresh',
			attr: { type: 'button', title: '刷新笔记', 'aria-label': '刷新笔记' }
		});
		setIcon(this.refreshButton, 'refresh-cw');
		this.refreshButton.onclick = () => {
			void this.loadJournal(true);
			if (this.mode === 'today') {
				void this.loadStats();
				void this.loadTodayBooks();
			}
		};
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
			if (this.active) {
				if (!this.updateContent) this.render();
				else {
					this.renderHeader();
					this.updateContent();
				}
			}
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
				if (exclusionsChanged && this.active) {
					this.renderQuote(true);
					if (
						get(settingsStore).journalIncludeArticles === false &&
						this.state.notes.some((note) => note.bookType === undefined)
					)
						void this.loadJournal();
				}
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
		this.updateContent = undefined;
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
		this.pendingLoads += 1;
		this.refreshButton.disabled = true;
		try {
			await this.journal.load(force);
		} catch (error) {
			if (this.active) new Notice(error instanceof Error ? error.message : '笔记加载失败');
		} finally {
			this.pendingLoads -= 1;
			this.refreshButton.disabled = this.pendingLoads > 0 || this.state.syncing;
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
	private renderHeader(): void {
		if (!this.body) return;
		const state = this.state;
		this.status.setText(
			`${state.hasCache ? `已缓存 ${state.notes.length} 条笔记` : '首次整理笔记'}${state.syncing ? ` · 正在更新 ${state.scannedBooks}/${state.totalBooks} 本` : ''}${state.updatedAt ? ` · 上次更新 ${new Date(state.updatedAt).toLocaleString('zh-CN')}` : ''}${state.failedBooks ? ` · ${state.failedBooks} 本未完整获取` : ''}${state.error ? ` · ${state.error}` : ''}`
		);
		this.status.title = this.status.textContent ?? '';
		this.status.setAttribute('aria-label', this.status.textContent ?? '');
		this.headerDate.setText(
			new Date().toLocaleDateString('zh-CN', {
				year: 'numeric',
				month: 'long',
				day: 'numeric',
				weekday: 'long'
			})
		);
		this.headerDate.setAttribute('datetime', this.date);
		this.refreshButton.disabled = this.pendingLoads > 0 || state.syncing;
	}
	private render(): void {
		if (!this.body) return;
		this.renderHeader();
		this.updateContent = undefined;
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
		const summary = this.body.createDiv({ cls: 'weread-journal-summary' });
		const metrics = summary.createDiv({ cls: 'weread-journal-today-metrics' });
		metrics.createEl('h2', { text: '今日数据', cls: 'weread-journal-summary-title' });
		const metricsGrid = metrics.createDiv({ cls: 'weread-journal-today-metrics-grid' });
		const metricCards = ['阅读时长', '今日划线', '今日想法'].map((label) => {
			const card = metricsGrid.createDiv();
			card.createEl('span', { text: label });
			card.createEl('strong');
			return card;
		});
		const updateMetrics = () => {
			const notes = this.state.notes.filter((note) => noteDay(note) === this.date);
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
			for (const [index, value] of [
				duration,
				count('highlight'),
				count('thought')
			].entries()) {
				const card = metricCards[index];
				const strong = card.querySelector('strong')!;
				if (strong.textContent !== value) strong.setText(value);
				let status = card.querySelector<HTMLElement>('.weread-journal-metric-status');
				if (index && countStatus) {
					status ??= card.createEl('small', { cls: 'weread-journal-metric-status' });
					if (status.textContent !== countStatus) status.setText(countStatus);
				} else status?.remove();
			}
		};
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
		this.renderNotesHeading(traces, '今天留下的痕迹', 'today');
		this.updateContent = () => {
			updateMetrics();
			this.renderQuote();
			this.renderNotes(
				this.state.notes.filter((note) => noteDay(note) === this.date),
				this.state.hasCache &&
					!this.state.syncing &&
					!this.state.failedBooks &&
					!this.state.error
					? '今天还没有留下笔记，先读几页也很好。'
					: '已加载范围内暂无今日笔记；请留意上方缓存覆盖状态。',
				traces
			);
		};
		this.updateContent();
	}
	private quoteCandidates(): JournalNote[] {
		const today = this.date;
		const excluded = this.readExcludedBookIds();
		const includeArticles = get(settingsStore)?.journalIncludeArticles !== false;
		return this.state.notes.filter(
			(note) =>
				note.kind === 'highlight' &&
				note.text.trim() &&
				noteDay(note) < today &&
				!excluded.has(note.bookId) &&
				(includeArticles || (typeof note.bookType === 'number' && !isJournalArticle(note)))
		);
	}
	private renderQuote(replace = false): void {
		const today = this.date;
		const excluded = this.readExcludedBookIds();
		const includeArticles = get(settingsStore)?.journalIncludeArticles !== false;
		const highlights = this.quoteCandidates();
		const candidates = highlights;
		this.quote =
			highlights.find(
				(note) => note.bookId === this.quote?.bookId && note.id === this.quote?.id
			) ?? this.randomQuote(candidates);
		const previous = this.body.querySelector<HTMLElement>('.weread-journal-quote');
		const section =
			!replace && previous ? previous : this.body.createDiv({ cls: 'weread-journal-quote' });
		if (section !== previous) previous?.replaceWith(section);
		section.classList.toggle('is-empty', !this.quote);
		if (!section.querySelector('.weread-journal-quote-heading')) {
			const header = section.createDiv({
				cls: 'weread-journal-heading weread-journal-quote-heading'
			});
			header.createEl('h2', { text: '旧句重逢' });
			const actions = header.createDiv({ cls: 'weread-journal-actions' });
			const sameBook = highlights.filter(
				(n) => n.bookId === this.quote?.bookId && n.id !== this.quote?.id
			);
			const otherBooks = highlights.filter((n) => n.bookId !== this.quote?.bookId);
			const change = actions.createEl('button', {
				attr: { type: 'button', title: '换一句', 'aria-label': '换一句' }
			});
			setIcon(change, 'shuffle');
			change.querySelector('svg')?.setAttribute('aria-hidden', 'true');
			change.createSpan({ text: '换一句' });
			change.disabled = sameBook.length === 0;
			change.onclick = () => {
				this.quote = this.randomQuote(
					this.quoteCandidates().filter(
						(note) => note.bookId === this.quote?.bookId && note.id !== this.quote?.id
					)
				);
				this.render();
			};
			const book = actions.createEl('button', {
				attr: { type: 'button', title: '换一本', 'aria-label': '换一本' }
			});
			setIcon(book, 'book-open');
			book.querySelector('svg')?.setAttribute('aria-hidden', 'true');
			book.createSpan({ text: '换一本' });
			book.disabled = otherBooks.length === 0;
			book.onclick = () => {
				this.quote = this.randomQuote(
					this.quoteCandidates().filter((note) => note.bookId !== this.quote?.bookId)
				);
				this.render();
			};

			const blacklist = actions.createEl('button', {
				cls: 'clickable-icon weread-journal-blacklist',
				attr: {
					type: 'button',
					'aria-label': '加入旧句重逢黑名单',
					title: this.quote
						? `不再推荐《${this.quote.bookTitle}》的划线`
						: '加入旧句重逢黑名单'
				}
			});
			setIcon(blacklist, 'ban');
			blacklist.querySelector('svg')?.setAttribute('aria-hidden', 'true');
			blacklist.disabled = !this.quote;
			const articleToggle = actions.createEl('button', {
				cls: 'weread-journal-article-toggle',
				attr: {
					type: 'button',
					role: 'switch',
					'aria-label': '旧句重逢包含公众号',
					'aria-checked': String(includeArticles),
					title: '是否随机推荐公众号划线'
				}
			});
			articleToggle.createSpan({
				cls: 'weread-journal-toggle-track',
				attr: { 'aria-hidden': 'true' }
			});
			articleToggle.createSpan({ text: '包含公众号' });
			articleToggle.onclick = () => {
				if (!this.active) return;
				const focused = articleToggle.ownerDocument.activeElement === articleToggle;
				settingsStore.actions.setJournalIncludeArticles(
					get(settingsStore).journalIncludeArticles === false
				);
				if (focused)
					this.body
						.querySelector<HTMLButtonElement>('.weread-journal-article-toggle')
						?.focus();
			};
		}
		const change = section.querySelector<HTMLButtonElement>('button[aria-label="换一句"]')!;
		const book = section.querySelector<HTMLButtonElement>('button[aria-label="换一本"]')!;
		change.disabled = !highlights.some(
			(note) => note.bookId === this.quote?.bookId && note.id !== this.quote?.id
		);
		book.disabled = !highlights.some((note) => note.bookId !== this.quote?.bookId);
		const blacklist = section.querySelector<HTMLButtonElement>('.weread-journal-blacklist')!;
		blacklist.disabled = !this.quote;
		const blockedQuote = this.quote;
		blacklist.onclick = () => {
			if (!this.active || !blockedQuote || this.quote?.bookId !== blockedQuote.bookId) return;
			const ids = this.readExcludedBookIds();
			if (ids.has(blockedQuote.bookId)) return;
			ids.add(blockedQuote.bookId);
			settingsStore.actions.setJournalExcludedBookIds([...ids]);
			new Notice('已加入旧句重逢黑名单，可在设置中的「旧句重逢排除书籍」恢复');
		};
		blacklist.title = this.quote
			? `不再推荐《${this.quote.bookTitle}》的划线`
			: '加入旧句重逢黑名单';
		section
			.querySelector('.weread-journal-article-toggle')
			?.setAttribute('aria-checked', String(includeArticles));
		const empty =
			!includeArticles &&
			this.state.notes.some(
				(note) =>
					note.kind === 'highlight' &&
					note.bookType === undefined &&
					!excluded.has(note.bookId) &&
					noteDay(note) < today
			)
				? '部分书籍类型尚未获取，关闭公众号时暂不参与随机；可刷新笔记缓存后重试。'
				: excluded.size || !includeArticles
					? '当前没有符合条件的往日划线，可调整公众号开关或在设置中的「旧句重逢排除书籍」恢复书籍。'
					: '暂时没有可回顾的往日划线。';
		this.renderNotes(this.quote ? [this.quote] : [], empty, section);
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
		this.renderNotesHeading(past, '那年今日', 'anniversary', () => updateResults());
		this.renderNotesHeading(results, '', 'review', () => updateResults());
		const list = results.createDiv({
			cls: 'weread-journal-day-list',
			attr: { role: 'region', tabindex: '0' }
		});
		const updateResults = () => {
			for (const button of Array.from(
				this.body.querySelectorAll<HTMLButtonElement>('.weread-journal-sort')
			)) {
				if (button.dataset.sortOrder === this.noteSortOrder) continue;
				const label = `时间排序：${this.noteSortOrder === 'desc' ? '最新在前' : '最早在前'}`;
				button.dataset.sortOrder = this.noteSortOrder;
				button.title = label;
				button.setAttribute('aria-label', label);
				button.empty();
				setIcon(
					button,
					this.noteSortOrder === 'desc'
						? 'arrow-down-wide-narrow'
						: 'arrow-up-wide-narrow'
				);
				button.querySelector('svg')?.setAttribute('aria-hidden', 'true');
			}
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
			this.renderNotes(anniversaries, '往年今日暂无符合筛选的笔记。', past, true);
			const label = this.query.trim() ? '搜索全部已缓存笔记' : `${this.selectedDay} · 笔记`;
			const heading = results.querySelector('h2')!;
			if (heading.firstChild?.textContent !== label) heading.firstChild!.textContent = label;
			list.setAttribute('aria-label', label);
			const scrollKey = JSON.stringify([
				this.selectedDay,
				this.query,
				this.kind,
				this.noteSortOrder
			]);
			if (list.dataset.scrollKey !== scrollKey) list.scrollTop = 0;
			list.dataset.scrollKey = scrollKey;
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
		const latest = footer.createEl('button', {
			text: '最近笔记日',
			cls: 'weread-journal-latest'
		});
		latest.onclick = () => {
			const note = this.latestNote();
			if (note) jumpTo(new Date(note.createTime));
		};
		this.updateContent = () => {
			updateResults();
			const counts = new Map<string, number>();
			for (const note of this.state.notes)
				counts.set(noteDay(note), (counts.get(noteDay(note)) ?? 0) + 1);
			for (const button of Array.from(
				grid.querySelectorAll<HTMLButtonElement>('.weread-journal-day')
			)) {
				const key = button.getAttribute('aria-label')!.slice(0, 10);
				const count = counts.get(key) ?? 0;
				const label = `${key}，${count}条笔记`;
				button.classList.toggle('has-notes', count > 0);
				button.setAttribute('aria-label', label);
				button.title = label;
				button.dataset.noteCount = String(count);
				button.dataset.noteIntensity = String(
					count === 0 ? 0 : count <= 2 ? 1 : count <= 5 ? 2 : count <= 10 ? 3 : 4
				);
			}
			latest.hidden = !this.latestNote();
			this.renderQuote();
		};
		this.updateContent();
	}
	private latestNote(): JournalNote | undefined {
		return this.state.notes.reduce<JournalNote | undefined>(
			(result, note) =>
				noteDay(note) <= this.date && (!result || note.createTime > result.createTime)
					? note
					: result,
			undefined
		);
	}
	private renderNotesHeading(
		parent: HTMLElement,
		title: string,
		scope: 'today' | 'review' | 'anniversary',
		onSort = () => this.render()
	): void {
		const heading = parent.createEl('h2', {
			text: title || ' ',
			cls: 'weread-journal-notes-heading'
		});
		const label = `时间排序：${this.noteSortOrder === 'desc' ? '最新在前' : '最早在前'}`;
		const button = heading.createEl('button', {
			cls: 'clickable-icon weread-journal-sort',
			attr: {
				type: 'button',
				title: label,
				'aria-label': label,
				'data-sort-order': this.noteSortOrder,
				'data-sort-scope': scope
			}
		});
		setIcon(
			button,
			this.noteSortOrder === 'desc' ? 'arrow-down-wide-narrow' : 'arrow-up-wide-narrow'
		);
		button.querySelector('svg')?.setAttribute('aria-hidden', 'true');
		button.onclick = () => {
			const focused = parent.ownerDocument.activeElement;
			const buttonFocused = focused === button;
			const listFocused = focused === parent.querySelector('.weread-journal-day-list');
			this.noteSortOrder = this.noteSortOrder === 'desc' ? 'asc' : 'desc';
			this.limit = 100;
			onSort();
			if (buttonFocused)
				this.body
					.querySelector<HTMLButtonElement>(
						`.weread-journal-sort[data-sort-scope="${scope}"]`
					)
					?.focus({ preventScroll: true });
			else if (listFocused)
				this.body
					.querySelector<HTMLElement>('.weread-journal-day-list')
					?.focus({ preventScroll: true });
		};
	}
	/** Keep each region's own keyed articles connected while cache snapshots are cloned. */
	private reconcileNotes(parent: HTMLElement, nodes: HTMLElement[]): void {
		const previous = this.renderedNotes.get(parent) ?? [];
		const wanted = new Set(nodes);
		for (const node of previous) if (!wanted.has(node)) node.remove();
		let cursor =
			Array.from(parent.children).find((node) => wanted.has(node as HTMLElement)) ?? null;
		for (const node of nodes) {
			if (node === cursor) cursor = cursor.nextElementSibling;
			else parent.insertBefore(node, cursor);
		}
		this.renderedNotes.set(parent, nodes);
	}
	private renderNotes(
		notes: readonly JournalNote[],
		empty: string,
		parent = this.body,
		groupByYear = false
	): void {
		const previous = this.renderedNotes.get(parent) ?? [];
		const nodes: HTMLElement[] = [];
		if (!notes.length) {
			const message =
				previous.find((node) => node.tagName === 'P') ??
				parent.createEl('p', { cls: 'weread-journal-muted' });
			if (message.textContent !== empty) message.setText(empty);
			nodes.push(message);
		} else {
			const ordered = [...notes].sort((left, right) =>
				this.noteSortOrder === 'desc'
					? right.createTime - left.createTime
					: left.createTime - right.createTime
			);
			const visible = ordered.slice(0, this.limit);
			if (groupByYear) {
				const totals = new Map<number, number>();
				const groups = new Map<number, JournalNote[]>();
				for (const note of ordered) {
					const year = new Date(note.createTime).getFullYear();
					totals.set(year, (totals.get(year) ?? 0) + 1);
				}
				for (const note of visible) {
					const year = new Date(note.createTime).getFullYear();
					const group = groups.get(year) ?? [];
					group.push(note);
					groups.set(year, group);
				}
				const sections = new Map(previous.map((node) => [node.dataset.year, node]));
				for (const [year, entries] of groups) {
					let section = sections.get(String(year));
					if (!section) {
						section = parent.createEl('section', {
							cls: 'weread-journal-anniversary-year',
							attr: {
								'data-year': String(year),
								'aria-label': `${year} 年的那年今日`
							}
						});
						section
							.createEl('h3', {
								cls: 'weread-journal-anniversary-year-heading',
								text: `${year} 年`
							})
							.createSpan({ cls: 'weread-journal-anniversary-year-count' });
					}
					const total = totals.get(year)!;
					const count = section.querySelector('.weread-journal-anniversary-year-count')!;
					const label =
						entries.length < total ? `${entries.length} / ${total} 条` : `${total} 条`;
					if (count.textContent !== label) count.setText(label);
					this.renderNotes(entries, '', section);
					nodes.push(section);
				}
			} else {
				const cards = new Map(previous.map((node) => [node.dataset.noteKey, node]));
				for (const note of visible)
					nodes.push(
						this.renderNote(parent, note, cards.get(`${note.bookId}:${note.id}`))
					);
			}
			if (notes.length > this.limit) {
				const more =
					previous.find((node) => node.tagName === 'BUTTON') ?? parent.createEl('button');
				more.setText(`再看 ${Math.min(100, notes.length - this.limit)} 条`);
				more.onclick = () => {
					this.limit += 100;
					this.render();
				};
				nodes.push(more);
			}
		}
		this.reconcileNotes(parent, nodes);
	}
	private renderNote(
		parent: HTMLElement,
		note: JournalNote,
		existing?: HTMLElement
	): HTMLElement {
		if (existing) {
			this.noteUpdates.get(existing)?.(note);
			return existing;
		}
		note = { ...note };
		const card = parent.createEl('article', { cls: `weread-journal-note is-${note.kind}` });
		card.dataset.noteKey = `${note.bookId}:${note.id}`;
		let image: HTMLImageElement | undefined;
		if (note.cover && /^https?:\/\//.test(note.cover)) {
			image = card.createEl('img', {
				cls: 'weread-journal-note-cover',
				attr: { src: note.cover, alt: '', loading: 'lazy' }
			});
			const createdImage = image;
			image.onerror = () => createdImage.remove();
		}
		const content = card.createDiv();
		const metadata = content.createDiv({ cls: 'weread-journal-note-meta' });
		const timestamp = metadata.createEl('small', {
			text: `${note.kind === 'highlight' ? '划线' : '想法'} · ${formatNoteTimestamp(note.createTime)}`
		});
		const actions = metadata.createDiv({ cls: 'weread-journal-note-actions' });
		const label = getJournalNoteBookmark(note) ? '回到原文' : '打开书籍';
		const original = actions.createEl('a', {
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
		const copy = actions.createEl('button', {
			cls: 'clickable-icon weread-journal-note-action',
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
		let star: HTMLButtonElement | undefined;
		const updateStar = () => {
			if (note.kind !== 'highlight') {
				star?.remove();
				star = undefined;
				return;
			}
			if (star || !this.favorites) return;
			star = actions.createEl('button', {
				cls: 'clickable-icon weread-journal-note-action weread-journal-favorite',
				attr: { type: 'button', 'aria-label': '收藏', 'aria-pressed': 'false' }
			});
			star.dataset.favoriteId = note.id;
			setIcon(star, 'star');
			star.onclick = () => void this.toggleFavorite(note);
			this.updateFavoriteStars(star);
		};
		updateStar();
		const text = content.createEl('p', { text: note.text, cls: 'weread-journal-note-text' });
		const source = content.createEl('button', {
			text: `《${note.bookTitle}》 · ${note.author || '未知作者'}`,
			cls: 'weread-journal-source'
		});
		source.onclick = () => {
			void this.plugin.activateBookDetailView(note.bookId, note.bookTitle, note.cover);
		};
		const chapter = content.createEl('small', { text: note.chapterTitle || '' });
		chapter.hidden = !note.chapterTitle;
		this.noteUpdates.set(card, (next) => {
			const keys = Object.keys(next) as (keyof JournalNote)[];
			if (
				Object.keys(note).length === keys.length &&
				keys.every((key) => note[key] === next[key])
			)
				return;
			const previousCover = note.cover;
			note = { ...next };
			card.className = `weread-journal-note is-${note.kind}`;
			timestamp.setText(
				`${note.kind === 'highlight' ? '划线' : '想法'} · ${formatNoteTimestamp(note.createTime)}`
			);
			const label = getJournalNoteBookmark(note) ? '回到原文' : '打开书籍';
			original.href = getPcUrl(note.bookId);
			original.title = label;
			original.setAttribute('aria-label', label);
			if (previousCover !== note.cover) {
				if (note.cover && /^https?:\/\//.test(note.cover)) {
					if (!image?.isConnected) {
						image = card.createEl('img', {
							cls: 'weread-journal-note-cover',
							attr: { alt: '', loading: 'lazy' }
						});
						card.prepend(image);
						const createdImage = image;
						image.onerror = () => createdImage.remove();
					}
					image.src = note.cover;
				} else {
					image?.remove();
					image = undefined;
				}
			}
			text.setText(note.text);
			source.setText(`《${note.bookTitle}》 · ${note.author || '未知作者'}`);
			chapter.setText(note.chapterTitle || '');
			chapter.hidden = !note.chapterTitle;
			updateStar();
		});
		return card;
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
