import ApiManager from "./api";
import { Notebook } from "./models";
import { parseHighlights,parseMetadata,parseReviews } from "./parser/parseResponse";
export default class SyncNotebooks{
    
    async startSync() {
        let cookie: string = getCookie()
        const apiManager = new ApiManager(cookie);
        const noteBookResp:[] =  await apiManager.getNotebooks()

        const notebooks:Notebook[] =  await noteBookResp.map(noteBook=>{
            const bookId:string = noteBook["bookId"]
            const book = noteBook["book"]
            const metaData = parseMetadata(book)
            const highlightResp = apiManager.getNotebookHighlights(bookId)
            const highlights =parseHighlights(highlightResp)
            const reviewResp =  apiManager.getNotebookReviews(bookId)
            const reviews =parseReviews(reviewResp)
            return {
                bookId:bookId,
                metaData:metaData,
                highlights: highlights,
                reviews:reviews
            }
        })

        console.log("=======notebooks", notebooks)

    }
}

function getCookie():string {
    throw new Error("Function not implemented.");
}
