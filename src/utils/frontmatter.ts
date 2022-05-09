import matter from "gray-matter"
import type {Notebook } from '../models';

type FrontMatterContent = {
    doc_type?: string;
    url?: string;
}

export const frontMatterDocType = "weread-highlights-reviews"

export const addFrontMatter = (markdownContent: string, noteBook: Notebook) => {
    const frontMatter: FrontMatterContent = {
        doc_type: frontMatterDocType,
        url: noteBook.metaData.url,
    };
    return matter.stringify(markdownContent, frontMatter);
}
