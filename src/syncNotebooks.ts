import { Notice } from 'obsidian';
import ApiManager from './api';
import FileManager, { AnnotationFile } from './fileManager';
import { Metadata, Notebook } from './models';
import {
	parseHighlights,
	parseMetadata,
	parseReviews,
	parseChapterHighlights,
	parseChapterReviews
} from './parser/parseResponse';
export default class SyncNotebooks {
	private fileManager: FileManager;

	constructor(fileManager: FileManager) {
		this.fileManager = fileManager;
	}

	async startSync() {
		const apiManager = new ApiManager();
		const noteBookResp: [] = await apiManager.getNotebooks();
		const localFiles: AnnotationFile[] =
			await this.fileManager.getNotebookFiles();

		for (const noteBook of noteBookResp) {
			const bookId: string = noteBook['bookId'];
			const metaData = parseMetadata(noteBook);
			const isNoteUpdate = this.isNotebookNew(metaData, localFiles);

			let isNew = true;
			const localFile =
				localFiles.find((file) => file.bookId === metaData.bookId) ||
				null;
			if (
				localFile &&
				localFile.noteCount == metaData.noteCount &&
				localFile.reviewCount == metaData.reviewCount
			) {
				isNew = false;
			}
			if (isNoteUpdate) {
				const highlightResp = await apiManager.getNotebookHighlights(
					bookId
				);
				const highlights = parseHighlights(highlightResp);
				const reviewResp = await apiManager.getNotebookReviews(bookId);
				const reviews = parseReviews(reviewResp);
				const chapterHighlights = parseChapterHighlights(highlights);
				const chapterReviews = parseChapterReviews(reviews);
				await this.syncNotebook(
					{
						metaData: metaData,
						chapterHighlights: chapterHighlights,
						chapterReviews: chapterReviews
					},
					isNew,
					localFile
				);
			}
		}
	}

	isNotebookNew(
		notebookMeta: Metadata,
		localFiles: AnnotationFile[]
	): boolean {
		const localFile =
			localFiles.find((file) => file.bookId === notebookMeta.bookId) ||
			null;
		if (localFile) {
			if (
				localFile.noteCount == notebookMeta.noteCount &&
				localFile.reviewCount == notebookMeta.reviewCount
			) {
				return false;
			}
		}
		return true;
	}

	private async syncNotebook(
		notebook: Notebook,
		isNew: boolean,
		localFile: AnnotationFile
	): Promise<void> {
		console.log('sync notebook start: ', notebook.metaData.title);
		try {
			this.fileManager.saveNotebook(notebook, isNew, localFile);
		} catch (e) {
			new Notice(`同步 ${notebook.metaData.title} 失败`);
		}
	}
}
