import type { DataAdapter } from 'obsidian';
import type { FavoriteEntry } from './models';
import type { JournalNote } from './journalHelpers';
import {
	parseFavoritesCanvas,
	serializeFavoritesCanvas,
	needsFavoriteGraphUpdate,
	isLegacyFavoritesCanvas
} from './favoritesCanvas';
import type { FavoriteBookFiles } from './favoritesCanvas';

export const FAVORITES_DIRECTORY = 'WereadData/favorites';
export const FAVORITES_PATH = `${FAVORITES_DIRECTORY}/favorites.canvas`;
export const FAVORITES_BACKUP_PATH = `${FAVORITES_DIRECTORY}/favorites.canvas.previous.json`;
export const FAVORITES_STAGING_PATH = `${FAVORITES_DIRECTORY}/favorites.canvas.staging.json`;
export const LEGACY_FAVORITES_PATH = `${FAVORITES_DIRECTORY}/favorites.json`;
export const LEGACY_FAVORITES_BACKUP_PATH = `${FAVORITES_DIRECTORY}/favorites.previous.json`;
export const LEGACY_FAVORITES_STAGING_PATH = `${FAVORITES_DIRECTORY}/favorites.staging.json`;

export interface FavoritesDocument {
	schemaVersion: 1;
	revision: number;
	records: FavoriteEntry[];
}

export class FavoritesStorageError extends Error {}
export class FavoritesConflictError extends FavoritesStorageError {}
export class FutureSchemaError extends FavoritesStorageError {}
export class FavoritesCanvasMetadataError extends FavoritesStorageError {}

export function copyFavorite(entry: FavoriteEntry): FavoriteEntry {
	return { ...entry, note: { ...entry.note } };
}
const object = (value: unknown): Record<string, unknown> => {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new FavoritesStorageError('收藏数据格式无效');
	}
	return value as Record<string, unknown>;
};
const keys = (value: Record<string, unknown>, allowed: string[]): void => {
	if (Object.keys(value).some((key) => !allowed.includes(key))) {
		throw new FavoritesStorageError('收藏数据包含不支持的字段');
	}
};
const time = (value: unknown): value is number =>
	typeof value === 'number' && Number.isFinite(value) && value > 0 && value <= 8.64e15;

export function validateFavoriteNote(value: unknown): JournalNote {
	const note = object(value);
	keys(note, [
		'id',
		'bookId',
		'bookTitle',
		'author',
		'cover',
		'kind',
		'text',
		'createTime',
		'chapterTitle',
		'sourceUrl'
	]);
	if (
		typeof note.bookId !== 'string' ||
		!/^\S+$/.test(note.bookId) ||
		note.kind !== 'highlight' ||
		typeof note.id !== 'string' ||
		!note.id.startsWith(`${note.bookId}:highlight:`) ||
		!/^\S+$/.test(note.id.slice(`${note.bookId}:highlight:`.length)) ||
		typeof note.text !== 'string' ||
		!note.text.trim() ||
		typeof note.bookTitle !== 'string' ||
		typeof note.author !== 'string' ||
		!time(note.createTime) ||
		['cover', 'chapterTitle', 'sourceUrl'].some(
			(key) => note[key] !== undefined && typeof note[key] !== 'string'
		)
	)
		throw new FavoritesStorageError('只能收藏具有有效来源 ID 和时间的划线');
	// Pick only public journal fields. No settings, account identity or arbitrary data is persisted.
	return {
		id: note.id,
		bookId: note.bookId,
		bookTitle: note.bookTitle,
		author: note.author,
		kind: 'highlight',
		text: note.text,
		createTime: note.createTime,
		...(note.cover !== undefined ? { cover: note.cover as string } : {}),
		...(note.chapterTitle !== undefined ? { chapterTitle: note.chapterTitle as string } : {}),
		...(note.sourceUrl !== undefined ? { sourceUrl: note.sourceUrl as string } : {})
	};
}

export function validateFavorite(value: unknown): FavoriteEntry {
	const entry = object(value);
	keys(entry, ['id', 'note', 'favoritedAt', 'updatedAt', 'deletedAt']);
	const note = validateFavoriteNote(entry.note);
	if (
		entry.id !== note.id ||
		!time(entry.favoritedAt) ||
		!time(entry.updatedAt) ||
		entry.updatedAt < entry.favoritedAt ||
		(entry.deletedAt !== undefined &&
			(!time(entry.deletedAt) ||
				entry.deletedAt < entry.favoritedAt ||
				entry.deletedAt > entry.updatedAt))
	) {
		throw new FavoritesStorageError('收藏记录的 ID 或时间无效');
	}
	return {
		id: note.id,
		note,
		favoritedAt: entry.favoritedAt,
		updatedAt: entry.updatedAt,
		...(entry.deletedAt !== undefined ? { deletedAt: entry.deletedAt as number } : {})
	};
}

export function parseFavorites(raw: string): FavoritesDocument {
	return parseFavoritesCanvas(raw);
}

export function parseLegacyFavorites(raw: string): FavoritesDocument {
	let value: Record<string, unknown>;
	try {
		value = object(JSON.parse(raw));
	} catch {
		throw new FavoritesStorageError('收藏文件无法解析');
	}
	if (typeof value.schemaVersion === 'number' && value.schemaVersion > 1) {
		throw new FutureSchemaError('收藏文件来自更新版本，请升级插件；当前为只读');
	}
	keys(value, ['schemaVersion', 'revision', 'records']);
	if (
		value.schemaVersion !== 1 ||
		!Number.isSafeInteger(value.revision) ||
		(value.revision as number) < 0 ||
		!Array.isArray(value.records)
	) {
		throw new FavoritesStorageError('收藏文件版本或结构无效');
	}
	const records = value.records.map(validateFavorite);
	if (new Set(records.map((entry) => entry.id)).size !== records.length) {
		throw new FavoritesStorageError('收藏文件含重复来源 ID');
	}
	return { schemaVersion: 1, revision: value.revision as number, records };
}

/** Exact text comparison detects external edits; adapters do not offer cross-device CAS. */
export class FavoritesRepository {
	private expected: string | null = null;
	private initialized = false;
	private unique = 0;
	constructor(private adapter: DataAdapter) {}

	private async read(path: string): Promise<string | null> {
		return (await this.adapter.exists(path)) ? this.adapter.read(path) : null;
	}
	private async directories(): Promise<void> {
		for (const path of ['WereadData', FAVORITES_DIRECTORY]) {
			if (!(await this.adapter.exists(path))) await this.adapter.mkdir(path);
		}
	}
	private async verifiedWrite(path: string, raw: string): Promise<void> {
		await this.adapter.write(path, raw);
		const saved = await this.adapter.read(path);
		if (saved !== raw) throw new FavoritesStorageError('收藏写入校验失败');
		parseFavorites(saved);
	}
	private async checkExpected(): Promise<void> {
		if ((await this.read(FAVORITES_PATH)) !== this.expected) {
			this.initialized = false;
			throw new FavoritesConflictError('收藏文件已被外部修改，已重新加载；请重试操作');
		}
	}

	async load(): Promise<{ document: FavoritesDocument; warning: string }> {
		this.initialized = false;
		const raw = await this.read(FAVORITES_PATH);
		let document: FavoritesDocument;
		let warning = '';
		if (raw === null) {
			if (
				this.expected !== null ||
				(await this.read(FAVORITES_BACKUP_PATH)) !== null ||
				(await this.read(FAVORITES_STAGING_PATH)) !== null
			) {
				throw new FavoritesStorageError(
					'收藏主画布已移走或删除；已保护备份，请手动恢复画布后重新读取'
				);
			}
			const migrated = await this.migrateLegacy();
			document = migrated?.document ?? { schemaVersion: 1, revision: 0, records: [] };
			this.expected = migrated?.raw ?? null;
			if (migrated) warning = '已将旧收藏转换为 Canvas；原 JSON 文件已原样保留';
			this.initialized = true;
			return { document, warning };
		}
		try {
			document = parseFavorites(raw);
		} catch (error) {
			if (error instanceof FutureSchemaError || error instanceof FavoritesCanvasMetadataError)
				throw error;
			const backup = await this.read(FAVORITES_BACKUP_PATH);
			if (backup !== null) {
				document = parseFavorites(backup);
				// Preserve the original bytes before attempting recovery, without renaming or deleting.
				const quarantine = await this.uniquePath('favorites.corrupt');
				await this.adapter.write(quarantine, raw);
				if ((await this.adapter.read(quarantine)) !== raw) {
					throw new FavoritesStorageError('无法安全保留损坏的收藏文件；未恢复');
				}
				if ((await this.read(FAVORITES_PATH)) !== raw) {
					throw new FavoritesConflictError('恢复期间收藏文件发生变化；未覆盖');
				}
				await this.verifiedWrite(FAVORITES_PATH, backup);
				warning = '已从上一份有效备份恢复收藏；原损坏文件已保留（如存在）';
				this.expected = backup;
			} else {
				throw new FavoritesStorageError(
					'收藏文件损坏或仅有未完成写入；已保护原文件，禁止写入'
				);
			}
			this.initialized = true;
			return { document, warning };
		}
		this.expected = raw;
		this.initialized = true;
		return { document, warning };
	}

	private async migrateLegacy(): Promise<{ document: FavoritesDocument; raw: string } | null> {
		const original = await this.read(LEGACY_FAVORITES_PATH);
		const backup = await this.read(LEGACY_FAVORITES_BACKUP_PATH);
		if (original === null && backup === null) {
			if ((await this.read(LEGACY_FAVORITES_STAGING_PATH)) !== null) {
				throw new FavoritesStorageError('旧收藏仅有未完成写入；已保护原文件，禁止写入');
			}
			return null;
		}
		let document: FavoritesDocument;
		try {
			if (original === null) throw new FavoritesStorageError('旧收藏主文件不存在');
			document = parseLegacyFavorites(original);
		} catch (error) {
			if (error instanceof FutureSchemaError || backup === null) throw error;
			document = parseLegacyFavorites(backup);
		}
		const raw = serializeFavoritesCanvas(document);
		const check = async (): Promise<void> => {
			if (
				(await this.read(FAVORITES_PATH)) !== null ||
				(await this.read(LEGACY_FAVORITES_PATH)) !== original ||
				(await this.read(LEGACY_FAVORITES_BACKUP_PATH)) !== backup
			) {
				throw new FavoritesConflictError('迁移期间收藏文件发生变化；未覆盖');
			}
		};
		await this.directories();
		await check();
		if (
			(await this.read(FAVORITES_BACKUP_PATH)) !== null ||
			(await this.read(FAVORITES_STAGING_PATH)) !== null
		) {
			throw new FavoritesConflictError('迁移期间出现 Canvas 恢复文件；未覆盖');
		}
		await this.verifiedWrite(FAVORITES_STAGING_PATH, raw);
		await check();
		if ((await this.read(FAVORITES_BACKUP_PATH)) !== null) {
			throw new FavoritesConflictError('迁移期间出现 Canvas 备份；未覆盖');
		}
		await this.verifiedWrite(FAVORITES_BACKUP_PATH, raw);
		await check();
		await this.verifiedWrite(FAVORITES_PATH, raw);
		return { document, raw };
	}

	needsPresentationUpdate(bookFiles?: FavoriteBookFiles): boolean {
		return (
			this.initialized &&
			this.expected !== null &&
			needsFavoriteGraphUpdate(this.expected, bookFiles)
		);
	}

	async hasPrimary(): Promise<boolean> {
		return this.adapter.exists(FAVORITES_PATH);
	}

	async verifyCurrent(): Promise<void> {
		if (!this.initialized) throw new FavoritesStorageError('收藏尚未安全加载，禁止写入');
		await this.checkExpected();
	}

	async save(document: FavoritesDocument, bookFiles?: FavoriteBookFiles): Promise<void> {
		if (!this.initialized) throw new FavoritesStorageError('收藏尚未安全加载，禁止写入');
		const raw = serializeFavoritesCanvas(document, this.expected, bookFiles);
		parseFavorites(raw);
		await this.checkExpected();
		await this.directories();
		if (this.expected !== null && isLegacyFavoritesCanvas(this.expected)) {
			const original = this.expected;
			const archive = await this.uniquePath('favorites.before-book-graph');
			await this.checkExpected();
			await this.verifiedWrite(archive, original);
			await this.checkExpected();
		}
		await this.verifiedWrite(FAVORITES_STAGING_PATH, raw);
		await this.checkExpected();
		const previous =
			this.expected ??
			serializeFavoritesCanvas({ schemaVersion: 1, revision: 0, records: [] });
		if (document.revision !== parseFavorites(previous).revision + 1) {
			throw new FavoritesStorageError('收藏版本必须严格递增');
		}
		await this.verifiedWrite(FAVORITES_BACKUP_PATH, previous);
		await this.checkExpected();
		await this.verifiedWrite(FAVORITES_PATH, raw);
		this.expected = raw;
	}

	private async uniquePath(prefix: string): Promise<string> {
		let path: string;
		do {
			path = `${FAVORITES_DIRECTORY}/${prefix}.${Date.now()}.${this.unique++}.canvas`;
		} while (await this.adapter.exists(path));
		return path;
	}
}
