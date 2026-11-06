import * as CryptoJS from 'crypto-js';
import type { Plugin } from 'obsidian';
import { get } from 'svelte/store';
import type ApiRouter from './api-router';
import { settingsStore } from './settings';
import {
	journalBookId,
	journalBooks,
	journalMetadata,
	journalObject,
	journalRevision,
	journalSourceComplete,
	parseJournalNotes,
	sameJournalRevision,
	sortJournalNotes,
	validJournalNote
} from './journalHelpers';
import type { JournalNote, JournalObject, JournalRevision } from './journalHelpers';

export type { JournalNote } from './journalHelpers';

export interface JournalState {
	notes: JournalNote[];
	totalBooks: number;
	scannedBooks: number;
	failedBooks: number;
	updatedAt: number;
	syncing: boolean;
	error: string;
	hasCache: boolean;
}

interface CachedBook {
	bookId: string;
	revision?: JournalRevision;
	notes: JournalNote[];
	complete: boolean;
}
interface JournalRecord {
	version: 1;
	updatedAt: number;
	books: CachedBook[];
}
type Listener = (state: JournalState) => void;
const RETRY_MS = 5 * 60 * 1000;
const emptyState = (): JournalState => ({
	notes: [],
	totalBooks: 0,
	scannedBooks: 0,
	failedBooks: 0,
	updatedAt: 0,
	syncing: false,
	error: '',
	hasCache: false
});

/**
 * Today and Review share one account-scoped cache and producer. The vault adapter
 * writes JSON only beneath the plugin directory; no synced Markdown or credentials
 * enter the record. Both counts and notes live in each book entry.
 */
export class WereadJournalService {
	private state = emptyState();
	private books = new Map<string, CachedBook>();
	private listeners = new Set<Listener>();
	private identity = '';
	private authenticated = false;
	private generation = 0;
	private disposed = false;
	private hydration?: Promise<void>;
	private inflight?: Promise<void>;
	private writes: Promise<void> = Promise.resolve();
	private lastAttempt = -Infinity;
	private unsubscribeSettings: () => void;

	constructor(
		private plugin: Plugin,
		private api: ApiRouter
	) {
		this.unsubscribeSettings = settingsStore.subscribe((settings) => {
			// Cookie order/expiry metadata do not change identity; actual values do.
			const cookies = settings.cookies
				.map((cookie) => [cookie.name, cookie.value])
				.sort((a, b) => a[0].localeCompare(b[0]) || a[1].localeCompare(b[1]));
			const identity = CryptoJS.SHA256(
				JSON.stringify([settings.wereadApiKey || '', settings.userVid || '', cookies])
			).toString();
			this.authenticated = Boolean(settings.wereadApiKey || settings.cookies.length);
			if (identity === this.identity) return;
			this.identity = identity;
			this.generation += 1;
			this.hydration = undefined;
			this.inflight = undefined;
			this.lastAttempt = -Infinity;
			this.books = new Map();
			this.state = emptyState();
			this.emit();
		});
	}

	getSnapshot(): JournalState {
		// Callers cannot mutate the service cache through a returned DTO.
		return { ...this.state, notes: this.state.notes.map((note) => ({ ...note })) };
	}

	subscribe(listener: Listener): () => void {
		if (this.disposed) return () => undefined;
		this.listeners.add(listener);
		this.notify(listener);
		return () => this.listeners.delete(listener);
	}

	/** Hydrate once, return cached data, and publish background refresh progress. */
	async load(force = false): Promise<JournalState> {
		if (this.disposed) return this.getSnapshot();
		const generation = this.generation;
		if (!this.authenticated) {
			this.state = { ...emptyState(), error: '请先登录微信读书或配置 API Key' };
			this.emit();
			return this.getSnapshot();
		}
		if (!this.hydration) {
			this.hydration = this.hydrate(generation, this.identity);
		}
		await this.hydration;
		if (!this.current(generation)) return this.getSnapshot();
		const settings = get(settingsStore) as { journalRefreshHours?: number };
		const hours = settings.journalRefreshHours;
		const ttl =
			(typeof hours === 'number' && Number.isFinite(hours) && hours > 0 ? hours : 24) *
			60 *
			60 *
			1000;
		const now = Date.now();
		const fresh = this.state.updatedAt > 0 && now - this.state.updatedAt < ttl;
		const incomplete = this.state.failedBooks > 0 || !this.state.hasCache;
		if (
			!this.inflight &&
			(force || ((!fresh || incomplete) && now - this.lastAttempt >= RETRY_MS))
		) {
			const previous = this.state;
			this.lastAttempt = now;
			this.state = {
				...this.state,
				syncing: true,
				scannedBooks: 0,
				failedBooks: 0,
				error: ''
			};
			// Assign before notifying or invoking a producer: listeners may call load().
			const task = Promise.resolve().then(() =>
				this.refresh(generation, this.identity, previous)
			);
			this.inflight = task;
			void task.finally(() => {
				if (this.current(generation) && this.inflight === task) this.inflight = undefined;
			});
			this.emit();
		}
		return this.getSnapshot();
	}

	dispose(): void {
		if (this.disposed) return;
		this.disposed = true;
		this.generation += 1;
		this.unsubscribeSettings();
		this.listeners.clear();
	}

	private current(generation: number): boolean {
		return !this.disposed && generation === this.generation;
	}

	private notify(listener: Listener): void {
		// A view failure must not interrupt persistence or other subscribers.
		try {
			listener(this.getSnapshot());
		} catch {
			// UI owns its rendering errors; never log credential-bearing exceptions.
		}
	}

	private emit(): void {
		for (const listener of this.listeners) this.notify(listener);
	}

	private cacheDirectory(): string {
		const directory = this.plugin.manifest.dir;
		if (!directory || directory.split('/').includes('..') || directory.startsWith('/')) {
			throw new Error('Plugin directory unavailable');
		}
		return `${directory}/journal-cache`;
	}

	private async hydrate(generation: number, identity: string): Promise<void> {
		try {
			const adapter = this.plugin.app.vault.adapter;
			const path = `${this.cacheDirectory()}/${identity}.json`;
			if (!(await adapter.exists(path))) return;
			const raw = journalObject(JSON.parse(await adapter.read(path)));
			if (
				raw.version !== 1 ||
				!Array.isArray(raw.books) ||
				typeof raw.updatedAt !== 'number' ||
				!Number.isFinite(raw.updatedAt) ||
				raw.updatedAt < 0
			) {
				return;
			}
			const books = new Map<string, CachedBook>();
			for (const value of raw.books) {
				const book = journalObject(value);
				if (
					typeof book.bookId !== 'string' ||
					!book.bookId ||
					typeof book.complete !== 'boolean' ||
					!Array.isArray(book.notes) ||
					!book.notes.every((note) => validJournalNote(note, book.bookId as string))
				)
					return;
				books.set(book.bookId, {
					bookId: book.bookId,
					complete: book.complete,
					notes: book.notes as JournalNote[],
					revision: journalRevision(journalObject(book.revision))
				});
			}
			if (!this.current(generation)) return;
			this.books = books;
			const failedBooks = [...books.values()].filter((book) => !book.complete).length;
			this.state = {
				notes: sortJournalNotes([...books.values()].flatMap((book) => book.notes)),
				totalBooks: books.size,
				scannedBooks: books.size,
				failedBooks,
				updatedAt: raw.updatedAt,
				syncing: false,
				error: failedBooks ? `${failedBooks} 本书的笔记未完整同步，请稍后重试` : '',
				hasCache: true
			};
			this.emit();
		} catch {
			if (this.current(generation)) {
				this.state = { ...this.state, error: '笔记缓存读取失败，将重新获取笔记' };
				this.emit();
			}
		}
	}

	private async refresh(
		generation: number,
		identity: string,
		previous: JournalState
	): Promise<void> {
		try {
			if (!this.current(generation)) return;
			const response: unknown = await this.api.getNotebooksWithRetry();
			if (!this.current(generation)) return;
			if (!Array.isArray(response)) throw new Error('Missing notebooks');
			const books = journalBooks(response);
			const next = new Map<string, CachedBook>();
			let scannedBooks = 0;
			let failedBooks = 0;
			let index = 0;
			this.state = { ...this.state, totalBooks: books.length };
			this.emit();
			// Two book workers, at most four detail requests at a time.
			await Promise.all(
				Array.from({ length: Math.min(2, books.length) }, async () => {
					while (this.current(generation)) {
						const book = books[index++];
						if (!book) return;
						const bookId = journalBookId(book);
						const revision = journalRevision(book);
						const old = this.books.get(bookId);
						let entry: CachedBook;
						if (old?.complete && sameJournalRevision(old.revision, revision)) {
							const metadata = journalMetadata(book);
							entry = {
								...old,
								notes: old.notes.map((note) => ({ ...note, ...metadata }))
							};
						} else {
							entry = await this.fetchBook(book, old);
						}
						if (!this.current(generation)) return;
						next.set(bookId, entry);
						scannedBooks += 1;
						if (!entry.complete) failedBooks += 1;
						this.state = {
							...this.state,
							// Keep old books visible until all current book identities are known.
							notes: sortJournalNotes([
								...[...this.books.values()]
									.filter((cached) => !next.has(cached.bookId))
									.flatMap((cached) => cached.notes),
								...[...next.values()].flatMap((cached) => cached.notes)
							]),
							scannedBooks,
							failedBooks
						};
						this.emit();
					}
				})
			);
			if (!this.current(generation)) return;
			this.books = next;
			this.state = {
				notes: sortJournalNotes([...next.values()].flatMap((book) => book.notes)),
				totalBooks: books.length,
				scannedBooks,
				failedBooks,
				updatedAt: failedBooks ? previous.updatedAt : Date.now(),
				syncing: false,
				error: failedBooks ? `${failedBooks} 本书的笔记未完整同步，请稍后重试` : '',
				hasCache: true
			};
			const record: JournalRecord = {
				version: 1,
				updatedAt: this.state.updatedAt,
				books: [...next.values()]
			};
			try {
				const write = this.writes.then(async () => {
					if (!this.current(generation)) return;
					const adapter = this.plugin.app.vault.adapter;
					const directory = this.cacheDirectory();
					if (!(await adapter.exists(directory))) await adapter.mkdir(directory);
					if (!this.current(generation)) return;
					// Serialize even across A → B → A login switches: a started write cannot
					// finish after a newer snapshot for the same identity.
					await adapter.write(`${directory}/${identity}.json`, JSON.stringify(record));
				});
				this.writes = write.catch((): void => undefined);
				await write;
			} catch {
				if (this.current(generation))
					this.state = {
						...this.state,
						error: '笔记缓存写入失败，已保留内存中的笔记，请稍后重试'
					};
			}
			if (this.current(generation)) this.emit();
		} catch {
			if (!this.current(generation)) return;
			this.state = {
				...previous,
				syncing: false,
				error: '笔记同步失败，已保留缓存，请稍后重试'
			};
			this.emit();
		}
	}

	private async fetchBook(book: JournalObject, old?: CachedBook): Promise<CachedBook> {
		const bookId = journalBookId(book);
		const revision = journalRevision(book);
		const article = journalObject(book.book).type === 3;
		const [highlights, reviews] = await Promise.allSettled([
			book.noteCount === 0
				? Promise.resolve({ updated: [] })
				: this.api.getNotebookHighlights(bookId, article),
			book.reviewCount === 0
				? Promise.resolve({ reviews: [] })
				: this.api.getNotebookReviews(bookId, article)
		]);
		const h = highlights.status === 'fulfilled' ? highlights.value : undefined;
		const r = reviews.status === 'fulfilled' ? reviews.value : undefined;
		const complete =
			journalSourceComplete(h, 'highlight', revision?.noteCount) &&
			journalSourceComplete(r, 'thought', revision?.reviewCount);
		return {
			bookId,
			revision,
			complete,
			notes: !complete && old ? old.notes : parseJournalNotes(book, h, r)
		};
	}
}
