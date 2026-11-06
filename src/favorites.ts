import type { Plugin } from 'obsidian';
import type { JournalNote } from './journalHelpers';
import type { FavoriteEntry, FavoritesState } from './models';
import {
	copyFavorite,
	FavoritesConflictError,
	FavoritesRepository,
	validateFavorite,
	validateFavoriteNote
} from './favoritesRepository';
import type { FavoritesDocument } from './favoritesRepository';

export type { FavoriteEntry, FavoritesState } from './models';
type Listener = (state: FavoritesState) => void;

/** Vault-owned personal snapshots, deliberately independent of authentication and journal caches. */
export class WereadFavoritesService {
	private repository: FavoritesRepository;
	private document: FavoritesDocument = { schemaVersion: 1, revision: 0, records: [] };
	private state: FavoritesState = {
		favorites: [],
		loaded: false,
		loading: false,
		writable: false,
		error: '',
		warning: '',
		pendingIds: []
	};
	private hydration?: Promise<void>;
	private tail: Promise<unknown> = Promise.resolve();
	private listeners = new Set<Listener>();
	private activeIds = new Set<string>();
	private pending = new Map<string, number>();
	private disposed = false;

	constructor(plugin: Plugin) {
		this.repository = new FavoritesRepository(plugin.app.vault.adapter);
	}

	getSnapshot(): FavoritesState {
		return {
			...this.state,
			favorites: this.state.favorites.map(copyFavorite),
			pendingIds: [...this.state.pendingIds]
		};
	}
	subscribe(listener: Listener): () => void {
		if (this.disposed) return () => undefined;
		this.listeners.add(listener);
		this.notify(listener);
		return () => this.listeners.delete(listener);
	}
	isFavorite(id: string): boolean {
		return this.activeIds.has(id);
	}

	async load(): Promise<FavoritesState> {
		if (this.disposed) throw this.failure('收藏服务已关闭');
		await this.hydrate();
		return this.getSnapshot();
	}
	private hydrate(): Promise<void> {
		if (!this.hydration) {
			this.state.loading = true;
			// Install the flight before notifying listeners, which may call load again.
			this.hydration = Promise.resolve().then(async () => {
				try {
					const result = await this.repository.load();
					this.document = result.document;
					this.state.warning = result.warning;
					this.state.error = '';
					this.state.writable = true;
					this.refreshFavorites();
				} catch (error) {
					this.state.writable = false;
					this.state.error = this.message(error);
					this.hydration = undefined;
				} finally {
					this.state.loaded = true;
					this.state.loading = false;
					this.emit();
				}
			});
			this.emit();
		}
		return this.hydration;
	}

	setFavorite(note: JournalNote, active: boolean): Promise<void> {
		// Capture the operation at acceptance; later caller changes cannot alter queued writes.
		const captured = { ...note };
		return this.mutate(captured.id, () => {
			if (typeof active !== 'boolean') throw new Error('收藏状态必须是布尔值');
			const valid = validateFavoriteNote(captured);
			const existing = this.document.records.find((entry) => entry.id === valid.id);
			if (!active) return this.deleted(existing);
			if (existing && existing.deletedAt === undefined) return undefined;
			const now = Math.max(Date.now(), (existing?.updatedAt || 0) + 1);
			return existing
				? {
						id: existing.id,
						note: { ...existing.note },
						favoritedAt: existing.favoritedAt,
						updatedAt: now
					}
				: { id: valid.id, note: valid, favoritedAt: now, updatedAt: now };
		});
	}
	remove(id: string): Promise<void> {
		return this.mutate(id, () =>
			this.deleted(this.document.records.find((entry) => entry.id === id))
		);
	}
	restore(entry: FavoriteEntry): Promise<void> {
		const captured = { ...entry, note: { ...entry?.note } };
		return this.mutate(captured.id, () => {
			const valid = validateFavorite(captured);
			const existing = this.document.records.find((record) => record.id === valid.id);
			if (existing && existing.deletedAt === undefined) return undefined;
			const source = existing || valid;
			return {
				id: source.id,
				note: { ...source.note },
				favoritedAt: source.favoritedAt,
				updatedAt: Math.max(Date.now(), source.updatedAt + 1)
			};
		});
	}
	private deleted(entry: FavoriteEntry | undefined): FavoriteEntry | undefined {
		if (!entry || entry.deletedAt !== undefined) return undefined;
		const now = Math.max(Date.now(), entry.updatedAt + 1);
		return { ...copyFavorite(entry), updatedAt: now, deletedAt: now };
	}
	private mutate(id: string, operation: () => FavoriteEntry | undefined): Promise<void> {
		return this.enqueue(id, async () => {
			await this.repository.verifyCurrent();
			if (typeof id !== 'string' || !/^.+:highlight:\S.*$/.test(id)) {
				throw new Error('收藏来源 ID 无效');
			}
			const entry = operation();
			if (!entry) return;
			const next: FavoritesDocument = {
				schemaVersion: 1,
				revision: this.document.revision + 1,
				records: this.document.records
					.filter((record) => record.id !== id)
					.map(copyFavorite)
					.concat(entry)
			};
			await this.repository.save(next);
			this.document = next;
			this.refreshFavorites();
		});
	}

	exportBackup(): Promise<string> {
		return this.enqueue('', async () => {
			await this.repository.verifyCurrent();
			return this.repository.exportBackup(this.document);
		});
	}
	private enqueue<T>(id: string, work: () => Promise<T>): Promise<T> {
		if (this.disposed) return Promise.reject(this.failure('收藏服务已关闭'));
		if (id) this.pending.set(id, (this.pending.get(id) || 0) + 1);
		const result = this.tail.then(async () => {
			try {
				await this.hydrate();
				if (!this.state.writable) throw new Error(this.state.error || '收藏数据为只读');
				const value = await work();
				this.state.error = '';
				return value;
			} catch (error) {
				if (error instanceof FavoritesConflictError) {
					this.hydration = undefined;
					await this.hydrate();
				} else {
					// A partial write or transient adapter failure needs fresh hydration before retry.
					this.hydration = undefined;
				}
				throw this.failure(this.message(error));
			} finally {
				if (id) {
					const remaining = (this.pending.get(id) || 1) - 1;
					if (remaining) this.pending.set(id, remaining);
					else this.pending.delete(id);
				}
				this.updatePending();
			}
		});
		// A rejected operation must never poison subsequent accepted work.
		this.tail = result.catch((): void => undefined);
		this.updatePending();
		return result;
	}

	dispose(): void {
		this.disposed = true;
		this.listeners.clear();
		// Accepted operations retain their queue and complete persistence consistently.
	}
	private refreshFavorites(): void {
		this.state.favorites = this.document.records
			.filter((entry) => entry.deletedAt === undefined)
			.map(copyFavorite)
			.sort((a, b) => b.favoritedAt - a.favoritedAt || a.id.localeCompare(b.id));
		this.activeIds = new Set(this.state.favorites.map((entry) => entry.id));
	}
	private updatePending(): void {
		this.state.pendingIds = [...this.pending.keys()];
		this.emit();
	}
	private message(error: unknown): string {
		// Never echo adapter exceptions, which may contain arbitrary user data or credentials.
		return error instanceof Error &&
			((error.name === 'Error' && /^(收藏|只能收藏)/.test(error.message)) ||
				error instanceof FavoritesConflictError)
			? error.message
			: '收藏存储操作失败，请检查文件权限或可用空间后重试';
	}
	private failure(message: string): Error {
		this.state.error = message;
		this.emit();
		return new Error(message);
	}
	private emit(): void {
		if (!this.disposed) this.listeners.forEach((listener) => this.notify(listener));
	}
	private notify(listener: Listener): void {
		try {
			listener(this.getSnapshot());
		} catch {
			/* Subscribers cannot interrupt storage. */
		}
	}
}
