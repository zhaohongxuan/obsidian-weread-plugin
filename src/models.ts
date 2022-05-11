export type Notebook = {
    metaData: Metadata;
    chapterHighlights: ChapterHighlight[];
    chapterReviews:ChapterReview[];
  
};

export type Metadata = {
    bookId:string;
    author: string;
    title: string;
    url: string;
    cover:string;
    publishTime:string;
  };

export type Highlight = {
    bookId: string;
    created: string;
    chapterUid:number;
    chapterTitle:string;
    markText: string;
    range:string;
  };
export type ChapterHighlight ={
   chapterUid:number;
   chapterTitle:string;
   highlights: Highlight[];
}

export type ChapterReview ={
    chapterUid:number;
    chapterTitle:string;
    reviews: Review[] 
 }

export type Review={
    bookId:string;
    chapterUid:number;
    chapterTitle:string;
    createTime:string;
    content:string;
    abstract:string;
    range:string
}

export type RenderTemplate = {
    isNewNote: boolean;
    title: string;
    author: string;
    url: string;
    cover:string;
    publishTime:string;
    chapterHighlights: ChapterHighlight[]
    chapterReviews: ChapterReview[]

  };