import { Vault, MetadataCache, TFile } from 'obsidian';
import { Renderer } from './renderer';
import { sanitizeTitle } from './utils/sanitizeTitle';
import type { Notebook } from './models';
import { frontMatterDocType, addFrontMatter } from './utils/frontmatter';

export type AnnotationFile = {
	bookId?: string;
	noteCount: number;
	reviewCount: number;
	file: TFile;
};

export default class FileManager {
	private vault: Vault;
	private metadataCache: MetadataCache;
	private renderer: Renderer;
	private noteLocation: string;

	constructor(
		vault: Vault,
		metadataCache: MetadataCache,
		noteLocation: string
	) {
		this.vault = vault;
		this.metadataCache = metadataCache;
		this.renderer = new Renderer();
		this.noteLocation = noteLocation;
	}

	// Save an notebook as markdown file, replacing its existing file if present
	public async saveNotebook(
		notebook: Notebook,
		isNew: boolean,
		localFile: AnnotationFile
	): Promise<boolean> {
		if (isNew) {
			const newFilePath = await this.getNewNotebookFilePath(notebook);
			console.log(`Creating ${newFilePath}`);
			const markdownContent = this.renderer.render(notebook, true);
			const fileContent = addFrontMatter(markdownContent, notebook);

			await this.vault.create(newFilePath, fileContent);
			return true;
		} else {
			const existingFile = localFile.file;
			console.log(`Updating ${existingFile.path}`);
			const freshContent = this.renderer.render(notebook, false);
			await this.vault.modify(existingFile, freshContent);
			return false;
		}
	}

	public async createFolder(folderPath: string): Promise<void> {
		await this.vault.createFolder(folderPath);
	}

	async getNotebookFiles(): Promise<AnnotationFile[]> {
		const files = this.vault.getMarkdownFiles();

		return files
			.map((file) => {
				const cache = this.metadataCache.getFileCache(file);
				return { file, frontmatter: cache?.frontmatter };
			})
			.filter(
				({ frontmatter }) =>
					frontmatter?.['doc_type'] === frontMatterDocType
			)
			.map(
				({ file, frontmatter }): AnnotationFile => ({
					file,
					bookId: frontmatter['bookId'],
					reviewCount: frontmatter['reviewCount'],
					noteCount: frontmatter['noteCount']
				})
			);
	}

	public async getNewNotebookFilePath(notebook: Notebook): Promise<string> {
		const folderPath = this.noteLocation;
		if (!(await this.vault.adapter.exists(folderPath))) {
			console.info(`Folder ${folderPath} not found. Will be created`);
			await this.createFolder(folderPath);
		}

		const fileName = `${sanitizeTitle(notebook.metaData.title)}.md`;

		const filePath = `${folderPath}/${fileName}`;
		return filePath;
	}
}
