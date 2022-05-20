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
		for (const noteBook of noteBookResp) {
			const bookId: string = noteBook['bookId'];
			
			const metaData = parseMetadata(noteBook);
			if (metaData.noteCount < +get(settingsStore).noteCountLimit) {
				console.debug(`skip book ${metaData.title} note count: ${metaData.noteCount}`);
				continue;
			}
			const localNotebookFile = await this.getLocalNotebookFile(metaData, localFiles);
			if (localNotebookFile && !localNotebookFile.new) {
				continue;
			}

			const bookDetail = await this.apiManager.getBook(bookId);
			if(bookDetail){
				metaData['category'] = bookDetail['category'];
				metaData['publisher'] = bookDetail['publisher'];
				metaData['isbn'] = bookDetail['isbn'];
				metaData['intro'] = bookDetail['intro'];
			}

			const highlightResp = await this.apiManager.getNotebookHighlights(bookId);
			const reviewResp = await this.apiManager.getNotebookReviews(bookId);

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
