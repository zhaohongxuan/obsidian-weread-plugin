import matter from "gray-matter"
import type {Notebook } from '../models';

type FrontMatterContent = {
    doc_type?: string;
    bookId?: string;
}

export const frontMatterDocType = "weread-highlights-reviews"

export const addFrontMatter = (markdownContent: string, noteBook: Notebook) => {
    const frontMatter: FrontMatterContent = {
        doc_type: frontMatterDocType,
        bookId: noteBook.metaData.bookId
    };
    return matter.stringify(markdownContent, frontMatter);
}
