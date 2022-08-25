import ApiManager from './api';
import FileManager from './fileManager';
import { Metadata, Notebook, AnnotationFile } from './models';
import {
	parseHighlights,
	parseMetadata,
	parseChapterHighlights,
	parseChapterReviews,
	parseDailyNoteReferences,
	parseRecentBooks
} from './parser/parseResponse';
import { settingsStore } from './settings';
import { get } from 'svelte/store';
import { Notice } from 'obsidian';
export default class SyncNotebooks {
	private fileManager: FileManager;
	private apiManager: ApiManager;

	constructor(fileManager: FileManager, apiManeger: ApiManager) {
		this.fileManager = fileManager;
		this.apiManager = apiManeger;
	}

	async syncNotebooks(force = false, journalDate: string) {
		const metaDataArr = await this.getALlMetadata();
		const filterMetaArr = await this.filterNoteMetas(force, metaDataArr);
		const notebooks = [];
		for (const meta of filterMetaArr) {
			const notebook = await this.convertToNotebook(meta);
			notebooks.push(notebook);
		}

		for (const note of notebooks) {
			await this.syncNotebook(note);
		}

		this.saveToJounal(journalDate, metaDataArr);
		new Notice(`微信读书笔记同步完成!, 本次更新 ${notebooks.length} 本书`);
	}

	public async syncNotesToJounal(journalDate: string) {
		const metaDataArr = await this.getALlMetadata();
		this.saveToJounal(journalDate, metaDataArr);
	}

	private async convertToNotebook(metaData: Metadata): Promise<Notebook> {
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
		return {
			metaData: metaData,
			bookReview: bookReview,
			chapterHighlights: chapterHighlights
		};
	}

	private async filterNoteMetas(force = false, metaDataArr: Metadata[]): Promise<Metadata[]> {
		const localFiles: AnnotationFile[] = await this.fileManager.getNotebookFiles();
		let skipCount = 0;
		const duplicateBookSet = this.getDuplicateBooks(metaDataArr);
		const filterMetaArr: Metadata[] = [];
		for (const metaData of metaDataArr) {
			if (metaData.noteCount < +get(settingsStore).noteCountLimit) {
				console.debug(
					`[weread plugin] skip book ${metaData.title} note count: ${metaData.noteCount}`
				);
				skipCount++;
				continue;
			}
			const localNotebookFile = await this.getLocalNotebookFile(metaData, localFiles);
			if (localNotebookFile && !localNotebookFile.new && !force) {
				skipCount++;
				continue;
			}
			metaData.file = localNotebookFile;
			if (duplicateBookSet.has(metaData.title)) {
				metaData.duplicate = true;
			}
			filterMetaArr.push(metaData);
		}
		new Notice('跳过更新' + skipCount + '本没有更新的书');
		return filterMetaArr;
	}

	private async getALlMetadata() {
		const noteBookResp: [] = await this.apiManager.getNotebooksWithRetry();
		const metaDataArr = noteBookResp.map((noteBook) => parseMetadata(noteBook));
		return metaDataArr;
	}

	private async saveToJounal(journalDate: string, metaDataArr: Metadata[]) {
		const books = await this.getBookReadInDate(journalDate);
		const metaDataArrInDate = metaDataArr.filter((meta) => books.contains(meta.bookId));

		const notebooksInDate = [];
		for (const meta of metaDataArrInDate) {
			const notebook = await this.convertToNotebook(meta);
			notebooksInDate.push(notebook);
		}

		if (get(settingsStore).dailyNotesToggle) {
			const dailyNoteRefereneces = parseDailyNoteReferences(notebooksInDate);
			const dailyNotePath = this.fileManager.getDailyNotePath(window.moment());
			console.log(
				'get daily note path',
				dailyNotePath,
				' size:',
				dailyNoteRefereneces.length
			);
			this.fileManager.saveDailyNotes(dailyNotePath, dailyNoteRefereneces);
		}
	}

	private async getBookReadInDate(journalDate: string): Promise<string[]> {
		const recentBookData: [] = await this.apiManager.getRecentBooks();
		const recentBooks = parseRecentBooks(recentBookData);
		const journalBookIds = recentBooks
			.filter(
				(book) => window.moment(book.recentTime * 1000).format('YYYY-MM-DD') === journalDate
			)
			.map((book) => book.bookId);
		return journalBookIds;
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

	private async syncNotebook(notebook: Notebook): Promise<void> {
		try {
			await this.fileManager.saveNotebook(notebook);
		} catch (e) {
			console.log('[weread plugin] sync note book error', notebook.metaData.title, e);
		}
	}
}
