import { Vault, MetadataCache, TFile } from 'obsidian';
import { Renderer } from './renderer';
import { sanitizeTitle } from './utils/sanitizeTitle';
import type { Metadata, Notebook } from './models';
import { frontMatterDocType, addFrontMatter } from './utils/frontmatter';
import { get } from 'svelte/store';
import { settingsStore } from './settings';

export type AnnotationFile = {
	bookId?: string;
	noteCount: number;
	reviewCount: number;
	new: boolean;
	file: TFile;
};

export default class FileManager {
	private vault: Vault;
	private metadataCache: MetadataCache;
	private renderer: Renderer;

	constructor(vault: Vault, metadataCache: MetadataCache) {
		this.vault = vault;
		this.metadataCache = metadataCache;
		this.renderer = new Renderer();
	}

	public async saveNotebook(notebook: Notebook, localFile: AnnotationFile): Promise<void> {
		if (localFile) {
			if (localFile.new) {
				const existingFile = localFile.file;
				console.log(`Updating ${existingFile.path}`);
				const freshContent = this.renderer.render(notebook);
				const fileContent = addFrontMatter(freshContent, notebook);
				await this.vault.modify(existingFile, fileContent);
			}
		} else {
			const newFilePath = await this.getNewNotebookFilePath(notebook);
			console.log(`Creating ${newFilePath}`);
			const markdownContent = this.renderer.render(notebook);
			const fileContent = addFrontMatter(markdownContent, notebook);
			await this.vault.create(newFilePath, fileContent);
		}
	}

	public async getNotebookFiles(): Promise<AnnotationFile[]> {
		const files = this.vault.getMarkdownFiles();
		return files
			.map((file) => {
				const cache = this.metadataCache.getFileCache(file);
				return { file, frontmatter: cache?.frontmatter };
			})
			.filter(({ frontmatter }) => frontmatter?.['doc_type'] === frontMatterDocType)
			.map(
				({ file, frontmatter }): AnnotationFile => ({
					file,
					bookId: frontmatter['bookId'],
					reviewCount: frontmatter['reviewCount'],
					noteCount: frontmatter['noteCount'],
					new: false
				})
			);
	}

	private async getNewNotebookFilePath(notebook: Notebook): Promise<string> {
		const folderPath = `${get(settingsStore).noteLocation}/${this.getCategoryPath(
			notebook.metaData
		)}`;
		if (!(await this.vault.adapter.exists(folderPath))) {
			console.info(`Folder ${folderPath} not found. Will be created`);
			await this.vault.createFolder(folderPath);
		}
		const fileName = `${sanitizeTitle(notebook.metaData.title)}-${notebook.metaData.bookId}`;
		const filePath = `${folderPath}/${fileName}.md`;
		return filePath;
	}

	private getCategoryPath(metaData: Metadata): string {
		if (metaData.category) {
			return metaData.category;
		} else {
			return metaData.author === '公众号' ? '公众号' : '未分类';
		}
	}
}
