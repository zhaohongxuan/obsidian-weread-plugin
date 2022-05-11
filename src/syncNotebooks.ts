import ApiManager from "./api";
import FileManager from "./fileManager";
import { Notebook } from "./models";
import { parseHighlights,parseMetadata,parseReviews,parseChapterHighlights, parseChapterReviews } from "./parser/parseResponse";
export default class SyncNotebooks{
    
    private fileManager: FileManager;

    constructor(fileManager: FileManager) {
        this.fileManager = fileManager;
    }
    
    async startSync() {
        const apiManager = new ApiManager();
        const noteBookResp:[] =  await apiManager.getNotebooks()

        const noteBookArr = []

        for (const noteBook of noteBookResp) {
            const bookId:string = noteBook["bookId"]
            const book = noteBook["book"]
            const metaData = parseMetadata(book)
            const highlightResp = await apiManager.getNotebookHighlights(bookId)
            const highlights =parseHighlights(highlightResp)
            const reviewResp =  await apiManager.getNotebookReviews(bookId)
            const reviews =parseReviews(reviewResp)
            const chapterHighlights =parseChapterHighlights(highlights) 
            const chapterReviews =parseChapterReviews(reviews) 
            const newNotebook = {
                metaData:metaData,
                chapterHighlights:chapterHighlights,
                chapterReviews:chapterReviews
            }
            console.log("=====handle book:", metaData.title)
            noteBookArr.push(newNotebook)
        }

        if (noteBookArr.length > 0) {
            await this.syncNotebooks(noteBookArr);
        }
    }

    private async syncNotebooks(noteBooks: Notebook[]): Promise<void> {
        for (const notebook of noteBooks) {
            try {
                await this.syncNotebook(notebook);
            } catch (e) {
                console.error(`Error syncing ${notebook.metaData.title}`, e);
            }
        }
    }

    private async syncNotebook(notebook: Notebook): Promise<void> {
        console.log("start sync notebook ", notebook.metaData.title)
        const createdNewNotebook = await this.fileManager.saveNotebook(notebook);
        console.log("end sync notebook complete ", notebook.metaData.title, createdNewNotebook)
    }
}