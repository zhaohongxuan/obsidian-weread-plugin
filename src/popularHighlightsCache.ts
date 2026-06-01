import { Vault, TFile, TFolder } from 'obsidian';
import { settingsStore } from './settings';
import { get } from 'svelte/store';
import type { PopularHighlight, PopularHighlightCache } from './models';

export default class PopularHighlightsCacheManager {
	private cacheDir: string = '.weread-cache';
	private vault: Vault;

	constructor(vault: Vault) {
		this.vault = vault;
	}

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
			const exists = await this.vault.adapter.exists(cachePath);
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
			const exists = await this.vault.adapter.exists(cachePath);
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
			const exists = await this.vault.adapter.exists(cacheDirPath);
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
			const exists = await this.vault.adapter.exists(this.cacheDir);
			if (!exists) {
				await this.vault.createFolder(this.cacheDir);
			}
		} catch (e) {
			// 目录已存在或其他错误，忽略
		}
	}

	private async readFile(path: string): Promise<string> {
		const file = this.vault.getAbstractFileByPath(path);
		if (!file || !(file instanceof TFile)) throw new Error('File not found');
		return await this.vault.read(file);
	}

	private async writeFile(path: string, content: string): Promise<void> {
		const file = this.vault.getAbstractFileByPath(path);
		if (file instanceof TFile) {
			await this.vault.modify(file, content);
		} else {
			await this.vault.create(path, content);
		}
	}

	private async deleteFile(path: string): Promise<void> {
		const file = this.vault.getAbstractFileByPath(path);
		if (file instanceof TFile) {
			await this.vault.delete(file);
		}
	}

	private async listFiles(dirPath: string): Promise<string[]> {
		const folder = this.vault.getAbstractFileByPath(dirPath);
		if (!(folder instanceof TFolder)) return [];
		return folder.children
			.filter((f) => f instanceof TFile)
			.map((f) => (f as TFile).name);
	}
}