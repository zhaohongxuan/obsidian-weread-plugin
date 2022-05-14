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
			const localNotebookFile = await this.getLocalNotebookFile(
				metaData,
				localFiles
			);
			if (localNotebookFile && !localNotebookFile.new) {
				continue;
			}

			const bookDetail = await apiManager.getBook(bookId);
			metaData['category'] = bookDetail['category'];
			metaData['publisher'] = bookDetail['publisher'];
			metaData['isbn'] = bookDetail['isbn'];

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
				localNotebookFile
			);
		}
	}

	async getLocalNotebookFile(
		notebookMeta: Metadata,
		localFiles: AnnotationFile[]
	): Promise<AnnotationFile> {
		const localFile =
			localFiles.find((file) => file.bookId === notebookMeta.bookId) ||
			null;
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

	private async syncNotebook(
		notebook: Notebook,
		localFile: AnnotationFile
	): Promise<void> {
		console.log('sync notebook: ', notebook.metaData.title, localFile);
		try {
			await this.fileManager.saveNotebook(notebook, localFile);
		} catch (e) {
			console.log('sync note book error', notebook.metaData.title, e);
		}
	}
}
