import ApiManager from './api';
import FileManager, { AnnotationFile } from './fileManager';
import { Metadata, Notebook } from './models';
import {
	parseHighlights,
	parseMetadata,
	parseChapterHighlights,
	parseChapterReviews
} from './parser/parseResponse';
import { settingsStore } from './settings';
import { get } from 'svelte/store';
export default class SyncNotebooks {
	private fileManager: FileManager;
	private apiManager: ApiManager;

	constructor(fileManager: FileManager, apiManeger: ApiManager) {
		this.fileManager = fileManager;
		this.apiManager = apiManeger;
	}

	async startSync(): Promise<number> {
		const noteBookResp: [] = await this.apiManager.getNotebooks();
		const localFiles: AnnotationFile[] = await this.fileManager.getNotebookFiles();
		let successCount = 0;
		const metaDataArr = noteBookResp.map((noteBook) => parseMetadata(noteBook));
		const duplicateBookSet = this.getDuplicateBooks(metaDataArr);
		for (const metaData of metaDataArr) {
			if (metaData.noteCount < +get(settingsStore).noteCountLimit) {
				console.debug(`skip book ${metaData.title} note count: ${metaData.noteCount}`);
				continue;
			}
			const localNotebookFile = await this.getLocalNotebookFile(metaData, localFiles);
			if (localNotebookFile && !localNotebookFile.new) {
				continue;
			}
			if (duplicateBookSet.has(metaData.title)) {
				metaData.duplicate = true;
			}
			const bookDetail = await this.apiManager.getBook(metaData.bookId);
			if (bookDetail) {
				metaData['category'] = bookDetail['category'];
				metaData['publisher'] = bookDetail['publisher'];
				metaData['isbn'] = bookDetail['isbn'];
				metaData['intro'] = bookDetail['intro'];
			}

			const highlightResp = await this.apiManager.getNotebookHighlights(metaData.bookId);
			const reviewResp = await this.apiManager.getNotebookReviews(metaData.bookId);
			const highlights = parseHighlights(highlightResp, reviewResp);
			const chapterHighlights = parseChapterHighlights(highlights);
			const bookReview = parseChapterReviews(reviewResp);
			await this.syncNotebook(
				{
					metaData: metaData,
					bookReview: bookReview,
					chapterHighlights: chapterHighlights
				},
				localNotebookFile
			);
			successCount++;
		}
		return successCount;
	}

	private getDuplicateBooks(metaDatas: Metadata[]): Set<string> {
		const bookArr = metaDatas.map((metaData) => metaData.title);
		const uniqueElements = new Set(bookArr);
		const filteredElements = bookArr.filter((item) => {
			if (uniqueElements.has(item)) {
				uniqueElements.delete(item);
			} else {
				return item;
			}
		});
		return new Set(filteredElements);
	}

	async getLocalNotebookFile(
		notebookMeta: Metadata,
		localFiles: AnnotationFile[]
	): Promise<AnnotationFile> {
		const localFile = localFiles.find((file) => file.bookId === notebookMeta.bookId) || null;
		if (localFile) {
			if (
				localFile.noteCount == notebookMeta.noteCount &&
				localFile.reviewCount == notebookMeta.reviewCount
			) {
				localFile.new = false;
			} else {
				localFile.new = true;
			}
			return localFile;
		}
		return null;
	}

	private async syncNotebook(notebook: Notebook, localFile: AnnotationFile): Promise<void> {
		try {
			await this.fileManager.saveNotebook(notebook, localFile);
		} catch (e) {
			console.log('sync note book error', notebook.metaData.title, e);
		}
	}
}
