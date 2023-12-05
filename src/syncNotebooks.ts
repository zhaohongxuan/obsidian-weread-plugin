import ApiManager from './api';
import FileManager from './fileManager';
import { Metadata, Notebook, AnnotationFile } from './models';
import {
	parseHighlights,
	parseMetadata,
	parseChapterHighlightReview,
	parseChapterReviews,
	parseDailyNoteReferences,
	parseReviews
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
		const progressNotice = new Notice('微信读书笔记同步开始!', 60000);
		const syncStartTime = new Date().getTime();
		const metaDataArr = await this.getALlMetadata();
		const filterMetaArr = await this.filterNoteMetas(force, metaDataArr);
		let syncedNotebooks = 0;
		for (const meta of filterMetaArr) {
			const notebook = await this.convertToNotebook(meta);
			await this.saveNotebook(notebook);
			syncedNotebooks++;
			if (syncedNotebooks % 10 === 0 || syncedNotebooks === filterMetaArr.length) {
				const progress = (syncedNotebooks / filterMetaArr.length) * 100;
				progressNotice.setMessage(
					`微信读书笔记同步中, 请稍后！正在更新 ${
						filterMetaArr.length
					} 本书 ，更新进度 ${progress.toFixed(0)}%`
				);
			}
		}
		progressNotice.hide();
		this.saveToJounal(journalDate, metaDataArr);
		const syncEndTime = new Date().getTime();
		const syncTimeInMilliseconds = syncEndTime - syncStartTime;
		const syncTimeInSeconds = (syncTimeInMilliseconds / 1000).toFixed(2);

		new Notice(
			`微信读书笔记同步完成!, 总共 ${metaDataArr.length} 本书 ， 本次更新 ${filterMetaArr.length} 本书, 耗时${syncTimeInSeconds} 秒`
		);
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
			metaData['totalWords'] = bookDetail['totalWords'];
			const newRating = parseInt(bookDetail['newRating']);
			metaData['rating'] = `${newRating / 10}%`;
		}

		const highlightResp = await this.apiManager.getNotebookHighlights(metaData.bookId);
		const reviewResp = await this.apiManager.getNotebookReviews(metaData.bookId);
		const chapterResp = await this.apiManager.getChapters(metaData.bookId);

		const highlights = parseHighlights(highlightResp, reviewResp);
		const reviews = parseReviews(reviewResp);
		const chapterHighlightReview = parseChapterHighlightReview(
			chapterResp,
			highlights,
			reviews
		);
		const bookReview = parseChapterReviews(reviewResp);
		return {
			metaData: metaData,
			chapterHighlights: chapterHighlightReview,
			bookReview: bookReview
		};
	}

	private async filterNoteMetas(force = false, metaDataArr: Metadata[]): Promise<Metadata[]> {
		const localFiles: AnnotationFile[] = await this.fileManager.getNotebookFiles();
		const duplicateBookSet = this.getDuplicateBooks(metaDataArr);
		const filterMetaArr: Metadata[] = [];
		for (const metaData of metaDataArr) {
			// skip 公众号
			if (metaData.bookType === 3) {
				continue;
			}
			if (metaData.noteCount < +get(settingsStore).noteCountLimit) {
				console.info(
					`[weread plugin] skip book ${metaData.title} note count: ${metaData.noteCount}`
				);
				continue;
			}
			const localNotebookFile = await this.getLocalNotebookFile(metaData, localFiles);
			if (localNotebookFile && !localNotebookFile.new && !force) {
				continue;
			}
			const isNoteBlacklisted = get(settingsStore).notesBlacklist.includes(metaData.bookId);
			if (isNoteBlacklisted) {
				console.info(
					`[weread plugin] skip book ${metaData.title},id:${metaData.bookId}for blacklist`
				);
				continue;
			}
			metaData.file = localNotebookFile;
			if (duplicateBookSet.has(metaData.title)) {
				metaData.duplicate = true;
			}
			filterMetaArr.push(metaData);
		}
		return filterMetaArr;
	}

	private async getALlMetadata() {
		const noteBookResp: [] = await this.apiManager.getNotebooksWithRetry();
		const metaDataArr = noteBookResp.map((noteBook) => parseMetadata(noteBook));
		return metaDataArr;
	}

	private async saveToJounal(journalDate: string, metaDataArr: Metadata[]) {
		const metaDataArrInDate = metaDataArr.filter((meta) => meta.lastReadDate === journalDate);

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

	private async saveNotebook(notebook: Notebook): Promise<void> {
		try {
			await this.fileManager.saveNotebook(notebook);
		} catch (e) {
			console.log('[weread plugin] sync note book error', notebook.metaData.title, e);
		}
	}
}
