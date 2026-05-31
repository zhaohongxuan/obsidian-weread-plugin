import { settingsStore } from './settings';
import { get } from 'svelte/store';
import type { PopularHighlight, PopularHighlightCache } from './models';

export default class PopularHighlightsCacheManager {
	private cacheDir: string = '.weread-cache';

	private getCachePath(bookId: string): string {
		return `${this.cacheDir}/popular-${bookId}.json`;
	}

	private isCacheExpired(cache: PopularHighlightCache): boolean {
		const settings = get(settingsStore);
		const ttlMs = (settings.popularHighlightsCacheTtl ?? 7) * 24 * 60 * 60 * 1000;
		return Date.now() > cache.cachedAt + ttlMs;
	}

	async get(bookId: string): Promise<PopularHighlightCache | null> {
		try {
			const cachePath = this.getCachePath(bookId);
			const exists = await this.fileExists(cachePath);
			if (!exists) return null;

			const content = await this.readFile(cachePath);
			const cache: PopularHighlightCache = JSON.parse(content);

			if (this.isCacheExpired(cache)) {
				console.log(`[weread plugin] 热门划线缓存已过期: ${bookId}`);
				return null;
			}

			console.log(`[weread plugin] 热门划线缓存命中: ${bookId}`);
			return cache;
		} catch (e) {
			console.error(`[weread plugin] 读取热门划线缓存失败: ${bookId}`, e);
			return null;
		}
	}

	async set(
		bookId: string,
		items: PopularHighlight[],
		chapters: PopularHighlightCache['chapters']
	): Promise<void> {
		try {
			const settings = get(settingsStore);
			const cache: PopularHighlightCache = {
				bookId,
				cachedAt: Date.now(),
				ttl: settings.popularHighlightsCacheTtl ?? 7,
				items,
				chapters
			};

			const cachePath = this.getCachePath(bookId);
			await this.ensureCacheDir();
			await this.writeFile(cachePath, JSON.stringify(cache, null, 2));
			console.log(`[weread plugin] 热门划线缓存已写入: ${bookId}`);
		} catch (e) {
			console.error(`[weread plugin] 写入热门划线缓存失败: ${bookId}`, e);
		}
	}

	async clear(bookId: string): Promise<void> {
		try {
			const cachePath = this.getCachePath(bookId);
			const exists = await this.fileExists(cachePath);
			if (exists) {
				await this.deleteFile(cachePath);
				console.log(`[weread plugin] 热门划线缓存已清除: ${bookId}`);
			}
		} catch (e) {
			console.error(`[weread plugin] 清除热门划线缓存失败: ${bookId}`, e);
		}
	}

	async clearExpired(): Promise<number> {
		try {
			const cacheDirPath = this.cacheDir;
			const exists = await this.fileExists(cacheDirPath);
			if (!exists) return 0;

			const files = await this.listFiles(cacheDirPath);
			let cleared = 0;

			for (const file of files) {
				if (!file.startsWith('popular-') || !file.endsWith('.json')) continue;

				try {
					const content = await this.readFile(`${cacheDirPath}/${file}`);
					const cache: PopularHighlightCache = JSON.parse(content);
					if (this.isCacheExpired(cache)) {
						await this.deleteFile(`${cacheDirPath}/${file}`);
						cleared++;
					}
				} catch (e) {
					// 忽略解析失败的文件
				}
			}

			if (cleared > 0) {
				console.log(`[weread plugin] 已清除 ${cleared} 个过期热门划线缓存`);
			}
			return cleared;
		} catch (e) {
			console.error('[weread plugin] 清除过期缓存失败', e);
			return 0;
		}
	}

	private async ensureCacheDir(): Promise<void> {
		try {
			const exists = await this.fileExists(this.cacheDir);
			if (!exists) {
				await this.createDir(this.cacheDir);
			}
		} catch (e) {
			// 目录已存在或其他错误，忽略
		}
	}

	// 抽象文件系统操作（由 Obsidian 实现）
	private async fileExists(path: string): Promise<boolean> {
		// @ts-ignore - Vault is available in Obsidian context
		return app.vault.getAbstractFileByPath(path) !== null;
	}

	private async readFile(path: string): Promise<string> {
		// @ts-ignore
		const file = app.vault.getAbstractFileByPath(path);
		if (!file) throw new Error('File not found');
		// @ts-ignore
		return await app.vault.read(file);
	}

	private async writeFile(path: string, content: string): Promise<void> {
		// @ts-ignore
		const file = app.vault.getAbstractFileByPath(path);
		if (file) {
			// @ts-ignore
			await app.vault.modify(file, content);
		} else {
			// @ts-ignore
			await app.vault.create(path, content);
		}
	}

	private async deleteFile(path: string): Promise<void> {
		// @ts-ignore
		const file = app.vault.getAbstractFileByPath(path);
		if (file) {
			// @ts-ignore
			await app.vault.delete(file);
		}
	}

	private async createDir(path: string): Promise<void> {
		// @ts-ignore
		await app.vault.createFolder(path);
	}

	private async listFiles(dirPath: string): Promise<string[]> {
		// @ts-ignore
		const folder = app.vault.getAbstractFileByPath(dirPath);
		if (!folder || folder.constructor.name !== 'TFolder') return [];
		// @ts-ignore
		return folder.children.filter((f) => f.constructor.name === 'TFile').map((f) => f.name);
	}
}