export type Notebook = {
    bookId: string;
    metaData: Metadata;
    highlights: Highlight[];
    reviews: Review[];
  
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
    markText: string;
  };

export type Review={
    bookId:string;
    chapterUid:number;
    chapterTitle:string;
    createTime:string;
    content:string;
}