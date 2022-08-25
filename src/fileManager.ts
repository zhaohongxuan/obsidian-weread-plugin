import { Vault, MetadataCache, TFile, TFolder, Notice, TAbstractFile } from 'obsidian';
import { Renderer } from './renderer';
import { sanitizeTitle } from './utils/sanitizeTitle';
import type { AnnotationFile, DailyNoteReferenece, Metadata, Notebook } from './models';
import { frontMatterDocType, buildFrontMatter } from './utils/frontmatter';
import { get } from 'svelte/store';
import { settingsStore } from './settings';
import { getLinesInString } from './utils/fileUtils';

export default class FileManager {
	private vault: Vault;
	private metadataCache: MetadataCache;
	private renderer: Renderer;

	constructor(vault: Vault, metadataCache: MetadataCache) {
		this.vault = vault;
		this.metadataCache = metadataCache;
		this.renderer = new Renderer();
	}

	public async saveDailyNotes(dailyNotePath: string, dailyNoteRefs: DailyNoteReferenece[]) {
		const fileExist = await this.fileExists(dailyNotePath);
		const toInsertContent = this.buildAppendContent(dailyNoteRefs);
		if (fileExist) {
			const dailyNoteFile = await this.getFileByPath(dailyNotePath);
			const existFileContent = await this.vault.cachedRead(dailyNoteFile);
			const freshContext = await this.insertAfter(existFileContent, toInsertContent);
			this.vault.modify(dailyNoteFile, freshContext);
		} else {
			new Notice('没有找到Daily Note，请先创建' + dailyNotePath);
			return;
			// todo toggle whether create auto
			// this.vault.create(dailyNotePath, toInsertContent);
		}
	}

	private buildAppendContent(dailyNoteRefs: DailyNoteReferenece[]): string {
		const appendContent = dailyNoteRefs
			.map((dailyNoteRef) => {
				const headContent: string = '\n### '.concat(dailyNoteRef.bookName).concat('\n');
				const blockList = dailyNoteRef.refBlocks.map((refBlock) => {
					return `![[${dailyNoteRef.bookName}#^${refBlock.refBlockId}]]`;
				});
				const bodyContent = blockList.join('\n');
				const finalContent = headContent + bodyContent;
				return finalContent;
			})
			.join('\n');

		return appendContent;
	}

	public getDailyNotePath(date: moment.Moment): string {
		let dailyNoteFileName;
		const dailyNotesFormat = get(settingsStore).dailyNotesFormat;

		try {
			dailyNoteFileName = date.format(dailyNotesFormat);
		} catch (e) {
			new Notice('Daily Notes 日期格式不正确' + dailyNotesFormat);
			throw e;
		}
		const dailyNotesLocation = get(settingsStore).dailyNotesLocation;
		return dailyNotesLocation + '/' + dailyNoteFileName + '.md';
	}

	private async fileExists(filePath: string): Promise<boolean> {
		return await this.vault.adapter.exists(filePath);
	}

	private async getFileByPath(filePath: string): Promise<TFile> {
		const file: TAbstractFile = await this.vault.getAbstractFileByPath(filePath);

		if (!file) {
			console.error(`${filePath} not found`);
			return null;
		}

		if (file instanceof TFolder) {
			console.error(`${filePath} found but it's a folder`);
			return null;
		}

		if (file instanceof TFile) {
			return file;
		}
	}

	private async insertAfter(fileContent: string, formatted: string): Promise<string> {
		const targetString: string = get(settingsStore).insertAfter;
		const targetRegex = new RegExp(`s*${targetString}s*`);
		const fileContentLines: string[] = getLinesInString(fileContent);
		const targetPosition = fileContentLines.findIndex((line) => targetRegex.test(line));
		const targetNotFound = targetPosition === -1;
		if (targetNotFound) {
			new Notice(`没有在Daily Note中找到区间开始：${targetString}！请检查Daily Notes设置`);
			throw new Error('cannot find ' + targetString);
		}
		return this.insertTextAfterPosition(formatted, fileContent, targetPosition);
	}

	private insertTextAfterPosition(text: string, body: string, pos: number): string {
		const splitContent = body.split('\n');
		const pre = splitContent.slice(0, pos + 1).join('\n');
		const remainContent = splitContent.slice(pos + 1);
		const insertBefore = get(settingsStore).insertBefore;
		const endPostion = remainContent.findIndex((line) =>
			new RegExp(`s*${insertBefore}s*`).test(line)
		);
		const targetNotFound = endPostion === -1;
		if (targetNotFound) {
			new Notice(`没有在Daily Note中找到区间结束：${insertBefore}！请检查Daily Notes设置`);
			throw new Error('cannot find ' + insertBefore);
		}

		const post = remainContent.slice(endPostion - 1).join('\n');
		return `${pre}\n${text}\n${post}`;
	}

	public async saveNotebook(notebook: Notebook): Promise<void> {
		const localFile = notebook.metaData.file;
		if (localFile) {
			if (localFile.new) {
				const existingFile = localFile.file;
				console.log(`Updating ${existingFile.path}`);
				const freshContent = this.renderer.render(notebook);
				const fileContent = buildFrontMatter(freshContent, notebook, existingFile);
				await this.vault.modify(existingFile, fileContent);
			}
		} else {
			const newFilePath = await this.getNewNotebookFilePath(notebook);
			console.log(`Creating ${newFilePath}`);
			const markdownContent = this.renderer.render(notebook);
			const fileContent = buildFrontMatter(markdownContent, notebook);
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
		const folderPath = `${get(settingsStore).noteLocation}/${this.getSubFolderPath(
			notebook.metaData
		)}`;
		if (!(await this.vault.adapter.exists(folderPath))) {
			console.info(`Folder ${folderPath} not found. Will be created`);
			await this.vault.createFolder(folderPath);
		}
		const fileName = this.getFileName(notebook.metaData);
		const filePath = `${folderPath}/${fileName}.md`;
		return filePath;
	}

	private getFileName(metaData: Metadata): string {
		const fileNameType = get(settingsStore).fileNameType;
		const baseFileName = sanitizeTitle(metaData.title);
		if (fileNameType == 'BOOK_NAME-AUTHOR') {
			if (metaData.duplicate) {
				return `${baseFileName}-${metaData.author}-${metaData.bookId}`;
			}
			return `${baseFileName}-${metaData.author}`;
		} else {
			if (metaData.duplicate || fileNameType == 'BOOK_NAME-BOOKID') {
				return `${baseFileName}-${metaData.bookId}`;
			}
			return baseFileName;
		}
	}

	private getSubFolderPath(metaData: Metadata): string {
		const folderType = get(settingsStore).subFolderType;
		if (folderType == 'title') {
			return metaData.title;
		} else if (folderType == 'category') {
			if (metaData.category) {
				return metaData.category.split('-')[0];
			} else {
				return metaData.author === '公众号' ? '公众号' : '未分类';
			}
		}
		return '';
	}
}
