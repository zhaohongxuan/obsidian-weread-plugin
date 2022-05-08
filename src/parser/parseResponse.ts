
import type { Highlight, Metadata,Review } from "src/models"; 

export const parseMetadata = (book:any): Metadata=> {
        const metaData:Metadata ={
            bookId: book["bookId"],
            author:book["author"],
            title:book["title"],
            url:book["url"],
            cover:book["cover"],
            publishTime:book["publishTime"]
        }
  return metaData;
}

export const parseHighlights = (data:any): Highlight[]=> {
        const chapters:[] = data["chapters"]
        var chapterMap = new Map(chapters.map(chapter => [chapter["chapterUid"], chapter["title"]] as [string, string]));  
        const highlights:[] = data["update"]
        return highlights.map(highlight=>{
            return {
                bookId: highlight["bookId"],
                created:highlight["author"],
                chapterUid:highlight["chapterUid"],
                chapterTitle: chapterMap.get(highlight["chapterUid"]),
                markText:highlight["publishTime"]
            }
        }) 
}

export const parseReviews = (data:any): Review[]=> {
        const reviews:[] = data["reviews"]
        return reviews.map(review =>{
            return {
                bookId: review["bookId"],
                createTime:review["createTime"],
                chapterUid:review["chapterUid"],
                chapterTitle: review["chapterTitle"],
                content:review["content"]
            }
        }) 
}