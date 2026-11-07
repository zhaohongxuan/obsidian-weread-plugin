import * as CryptoJS from 'crypto-js';
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

export const LEGACY_FAVORITES_DIRECTORY = 'WereadData/favorites';
export const LEGACY_CANVAS_PATH = `${LEGACY_FAVORITES_DIRECTORY}/favorites.canvas`;

/** Empty is the vault root. Validate before joining; never resolve traversal into a valid path. */
export function validateFavoritesCanvasFolder(value: unknown): string {
	if (typeof value !== 'string') throw new FavoritesStorageError('收藏画布目录无效');
	const folder = value.trim();
	if (
		folder &&
		(/[\\\u0000-\u001f\u007f]/.test(folder) ||
			/^([/~]|[a-z][a-z0-9+.-]*:)/i.test(folder) ||
			folder.split('/').some((part) => !part || part === '.' || part === '..'))
	)
		throw new FavoritesStorageError('收藏画布目录必须是笔记库内的相对路径，不能包含 . 或 ..');
	return folder;
}

export function favoritesPaths(value: unknown = '') {
	const folder = validateFavoritesCanvasFolder(value);
	const join = (name: string) => (folder ? `${folder}/${name}` : name);
	return Object.freeze({
		folder,
		primary: join('favorites.canvas'),
		backup: join('favorites.canvas.previous.json'),
		staging: join('favorites.canvas.staging.json'),
		legacy: join('favorites.json'),
		legacyBackup: join('favorites.previous.json'),
		legacyStaging: join('favorites.staging.json')
	});
}
export type FavoritesPaths = ReturnType<typeof favoritesPaths>;
export const FAVORITES_DIRECTORY = '';
export const FAVORITES_PATH = favoritesPaths().primary;
export const FAVORITES_BACKUP_PATH = favoritesPaths().backup;
export const FAVORITES_STAGING_PATH = favoritesPaths().staging;
export const LEGACY_FAVORITES_PATH = `${LEGACY_FAVORITES_DIRECTORY}/favorites.json`;
export const LEGACY_FAVORITES_BACKUP_PATH = `${LEGACY_FAVORITES_DIRECTORY}/favorites.previous.json`;
export const LEGACY_FAVORITES_STAGING_PATH = `${LEGACY_FAVORITES_DIRECTORY}/favorites.staging.json`;

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
	readonly paths: FavoritesPaths;
	constructor(
		private adapter: DataAdapter,
		folder: unknown = '',
		private allowLegacy = true
	) {
		this.paths = favoritesPaths(folder);
	}

	private async read(path: string): Promise<string | null> {
		return (await this.adapter.exists(path)) ? this.adapter.read(path) : null;
	}
	private async directories(): Promise<void> {
		const parts = this.paths.folder ? this.paths.folder.split('/') : [];
		for (let i = 1; i <= parts.length; i++) {
			const path = parts.slice(0, i).join('/');
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
		if ((await this.read(this.paths.primary)) !== this.expected) {
			this.initialized = false;
			throw new FavoritesConflictError('收藏文件已被外部修改，已重新加载；请重试操作');
		}
	}

	async load(): Promise<{ document: FavoritesDocument; warning: string }> {
		this.initialized = false;
		const raw = await this.read(this.paths.primary);
		let document: FavoritesDocument;
		let warning = '';
		if (raw === null) {
			if (
				this.expected !== null ||
				(await this.read(this.paths.backup)) !== null ||
				(await this.read(this.paths.staging)) !== null ||
				(await this.archivePaths()).length > 0
			) {
				throw new FavoritesStorageError(
					'收藏主画布已移走或删除；已保护备份，请手动恢复画布后重新读取'
				);
			}
			const migrated = this.allowLegacy ? await this.migrateLegacy() : null;
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
			const backup = await this.read(this.paths.backup);
			if (backup !== null) {
				document = parseFavorites(backup);
				// Preserve the original bytes before attempting recovery, without renaming or deleting.
				const quarantine = await this.uniquePath('favorites.corrupt');
				await this.adapter.write(quarantine, raw);
				if ((await this.adapter.read(quarantine)) !== raw) {
					throw new FavoritesStorageError('无法安全保留损坏的收藏文件；未恢复');
				}
				if ((await this.read(this.paths.primary)) !== raw) {
					throw new FavoritesConflictError('恢复期间收藏文件发生变化；未覆盖');
				}
				await this.verifiedWrite(this.paths.primary, backup);
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
				(await this.read(this.paths.primary)) !== null ||
				(await this.read(LEGACY_FAVORITES_PATH)) !== original ||
				(await this.read(LEGACY_FAVORITES_BACKUP_PATH)) !== backup
			) {
				throw new FavoritesConflictError('迁移期间收藏文件发生变化；未覆盖');
			}
		};
		await this.directories();
		await check();
		if (
			(await this.read(this.paths.backup)) !== null ||
			(await this.read(this.paths.staging)) !== null
		) {
			throw new FavoritesConflictError('迁移期间出现 Canvas 恢复文件；未覆盖');
		}
		await this.verifiedWrite(this.paths.staging, raw);
		await check();
		if ((await this.read(this.paths.backup)) !== null) {
			throw new FavoritesConflictError('迁移期间出现 Canvas 备份；未覆盖');
		}
		await this.verifiedWrite(this.paths.backup, raw);
		await check();
		await this.verifiedWrite(this.paths.primary, raw);
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
		return this.adapter.exists(this.paths.primary);
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
		await this.verifiedWrite(this.paths.staging, raw);
		await this.checkExpected();
		const previous =
			this.expected ??
			serializeFavoritesCanvas({ schemaVersion: 1, revision: 0, records: [] });
		if (document.revision !== parseFavorites(previous).revision + 1) {
			throw new FavoritesStorageError('收藏版本必须严格递增');
		}
		await this.verifiedWrite(this.paths.backup, previous);
		await this.checkExpected();
		await this.verifiedWrite(this.paths.primary, raw);
		this.expected = raw;
	}

	private join(name: string): string {
		return this.paths.folder ? `${this.paths.folder}/${name}` : name;
	}

	private async archivePaths(): Promise<string[]> {
		if (typeof this.adapter.list !== 'function') return [];
		if (this.paths.folder && !(await this.adapter.exists(this.paths.folder))) return [];
		const prefix = this.paths.folder ? `${this.paths.folder}/` : '';
		const listed = await this.adapter.list(this.paths.folder);
		return listed.files
			.filter(
				(path) =>
					path.startsWith(prefix) &&
					/^favorites\.(?:(?:corrupt|before-book-graph|before-location-change)\.[^/]+\.canvas|location-transfer\.[^/]+\.json)$/.test(
						path.slice(prefix.length)
					)
			)
			.sort();
	}

	/** Includes invalid recovery bytes: their presence must never mean a fresh collection. */
	private async storageSnapshot(): Promise<Map<string, string>> {
		const files = new Map<string, string>();
		const paths = [
			this.paths.primary,
			this.paths.backup,
			this.paths.staging,
			this.paths.legacy,
			this.paths.legacyBackup,
			this.paths.legacyStaging,
			...(await this.archivePaths())
		];
		for (const path of paths) {
			const raw = await this.read(path);
			if (raw !== null)
				files.set(path.slice(this.paths.folder ? this.paths.folder.length + 1 : 0), raw);
		}
		return files;
	}

	async hasStorage(): Promise<boolean> {
		return (await this.storageSnapshot()).size > 0;
	}

	/** Copy, never move: old bytes remain authoritative until the caller commits settings. */
	async copyTo(destination: FavoritesRepository): Promise<() => Promise<void>> {
		await this.verifyCurrent();
		if (this.paths.folder === destination.paths.folder) return () => this.verifyCurrent();
		if (typeof this.adapter.list !== 'function') {
			throw new FavoritesStorageError(
				'收藏目录迁移需要安全列出历史备份，请升级 Obsidian 后重试'
			);
		}
		const source = await this.storageSnapshot();
		if (await destination.hasStorage()) {
			const resumed = await destination.resumeCopyFrom(this);
			if (resumed) return resumed;
			throw new FavoritesConflictError(
				'收藏目标目录已有画布或恢复文件；未覆盖，请选择空目录'
			);
		}
		const written = new Map<string, string>();
		const equal = (a: Map<string, string>, b: Map<string, string>) =>
			a.size === b.size && [...a].every(([name, raw]) => b.get(name) === raw);
		const check = async () => {
			await this.verifyCurrent();
			if (
				!equal(source, await this.storageSnapshot()) ||
				!equal(written, await destination.storageSnapshot())
			) {
				throw new FavoritesConflictError(
					'收藏迁移期间文件发生变化；已保留原目录，请检查目标目录'
				);
			}
		};
		await check();
		await destination.directories();
		const copies = new Map(source);
		if (this.expected !== null) {
			// This immutable baseline outlives rotating previous/staging files.
			const baseline = await destination.uniquePath('favorites.before-location-change');
			copies.set(
				baseline.slice(destination.paths.folder ? destination.paths.folder.length + 1 : 0),
				this.expected
			);
			if (!copies.has('favorites.canvas.previous.json'))
				copies.set('favorites.canvas.previous.json', this.expected);
			if (!copies.has('favorites.canvas.staging.json'))
				copies.set('favorites.canvas.staging.json', this.expected);
		}
		const primary = copies.get('favorites.canvas');
		copies.delete('favorites.canvas');
		if (primary !== undefined) copies.set('favorites.canvas', primary);
		if (source.size) {
			const receiptPath = await destination.uniquePath('favorites.location-transfer', 'json');
			const receiptName = receiptPath.slice(
				destination.paths.folder ? destination.paths.folder.length + 1 : 0
			);
			const encode = (files: Map<string, string>) =>
				[...files].map(([name, raw]) => [name, CryptoJS.SHA256(raw).toString()]);
			const sourceFiles = encode(source);
			const destinationFiles = encode(copies);
			const raw = JSON.stringify({
				format: 'weread-favorites-location-transfer',
				schemaVersion: 1,
				sourceFolder: this.paths.folder,
				destinationFolder: destination.paths.folder,
				sourceFiles,
				destinationFiles
			});
			await check();
			if (await destination.adapter.exists(receiptPath))
				throw new FavoritesConflictError('收藏迁移凭据已存在；未覆盖');
			await destination.adapter.write(receiptPath, raw);
			if ((await destination.adapter.read(receiptPath)) !== raw)
				throw new FavoritesStorageError('收藏迁移凭据校验失败；原目录已保留');
			written.set(receiptName, raw);
		}
		for (const [name, raw] of copies) {
			await check();
			const path = destination.join(name);
			if (await destination.adapter.exists(path))
				throw new FavoritesConflictError('收藏目标文件已存在；未覆盖');
			await destination.adapter.write(path, raw);
			if ((await destination.adapter.read(path)) !== raw)
				throw new FavoritesStorageError('收藏迁移写入校验失败；原目录已保留');
			written.set(name, raw);
		}
		await check();
		await destination.load();
		await destination.verifyCurrent();
		await check();
		return check;
	}

	private async resumeCopyFrom(
		source: FavoritesRepository
	): Promise<(() => Promise<void>) | null> {
		const current = await this.storageSnapshot();
		for (const [name, raw] of current) {
			if (!/^favorites\.location-transfer\.[^/]+\.json$/.test(name)) continue;
			let receipt: Record<string, any>;
			try {
				receipt = object(JSON.parse(raw));
			} catch {
				continue;
			}
			if (
				receipt.format !== 'weread-favorites-location-transfer' ||
				receipt.schemaVersion !== 1 ||
				receipt.sourceFolder !== source.paths.folder ||
				receipt.destinationFolder !== this.paths.folder
			)
				continue;
			const decode = (value: unknown): Map<string, string> | null => {
				if (!Array.isArray(value)) return null;
				const files = new Map<string, string>();
				for (const row of value) {
					if (
						!Array.isArray(row) ||
						row.length !== 2 ||
						typeof row[0] !== 'string' ||
						typeof row[1] !== 'string' ||
						!/^[a-f0-9]{64}$/.test(row[1]) ||
						files.has(row[0])
					)
						return null;
					files.set(row[0], row[1]);
				}
				return files;
			};
			const sourceFiles = decode(receipt.sourceFiles);
			const destinationFiles = decode(receipt.destinationFiles);
			if (
				!sourceFiles ||
				!destinationFiles ||
				!sourceFiles.has('favorites.canvas') ||
				destinationFiles.get('favorites.canvas') !== sourceFiles.get('favorites.canvas') ||
				destinationFiles.has(name)
			)
				continue;
			destinationFiles.set(name, CryptoJS.SHA256(raw).toString());
			const equal = (a: Map<string, string>, b: Map<string, string>) =>
				a.size === b.size &&
				[...a].every(
					([key, digest]) =>
						b.has(key) && CryptoJS.SHA256(b.get(key)).toString() === digest
				);
			const verify = async () => {
				await source.verifyCurrent();
				if (
					!equal(sourceFiles, await source.storageSnapshot()) ||
					!equal(destinationFiles, await this.storageSnapshot())
				) {
					throw new FavoritesConflictError(
						'收藏迁移凭据与文件不一致；已保护新旧目录，请手动检查'
					);
				}
			};
			await verify();
			await this.load();
			await this.verifyCurrent();
			await verify();
			return verify;
		}
		return null;
	}

	private async uniquePath(prefix: string, extension = 'canvas'): Promise<string> {
		let path: string;
		do {
			path = this.join(`${prefix}.${Date.now()}.${this.unique++}.${extension}`);
		} while (await this.adapter.exists(path));
		return path;
	}
}
