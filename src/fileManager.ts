import type { Vault, MetadataCache, TFile } from 'obsidian';
import { Renderer } from './renderer';
import { sanitizeTitle } from './utils/sanitizeTitle';
import type { Notebook } from './models';
import { frontMatterDocType, addFrontMatter } from "./utils/frontmatter"

type AnnotationFile = {
  url?: string;
  file: TFile;
};

const notebookFolderPath = (notebook: Notebook): string => {
  // todo get path from setting
  return '/Hypothesis/weread/';
};

export default class FileManager {
  private vault: Vault;
  private metadataCache: MetadataCache;
  private renderer: Renderer;

  constructor(vault: Vault, metadataCache: MetadataCache) {
    this.vault = vault;
    this.metadataCache = metadataCache;
    this.renderer = new Renderer();
  }

  // Save an notebook as markdown file, replacing its existing file if present
  public async saveNotebook(notebook: Notebook): Promise<boolean> {
    const existingFile = await this.getNotebookFile(notebook);
    console.log("existingFile",existingFile)
    if (existingFile) {
      console.debug(`Updating ${existingFile.path}`);

      const newMarkdownContent = this.renderer.render(notebook, false);
      const existingFileContent = await this.vault.cachedRead(existingFile);
      const fileContent = existingFileContent + newMarkdownContent;
      console.log("fileContent")
      await this.vault.modify(existingFile, fileContent);
      return false;
    } else {
      const newFilePath = await this.getNewNotebookFilePath(notebook);
      console.debug(`Creating ${newFilePath}`);

      const markdownContent = this.renderer.render(notebook, true);
      console.log("markdown", markdownContent)
      // const fileContent = addFrontMatter(markdownContent, notebook);

      await this.vault.create(newFilePath, markdownContent);
      return true;
    }
  }

  public async createFolder(folderPath: string): Promise<void> {
    await this.vault.createFolder(folderPath);
  }


  private async getNotebookFile(notebook:Notebook): Promise<TFile | null> {
    const files = await this.getNotebookFiles()
    return files.find((file) => file.url === notebook.metaData.url)?.file || null;
  }

  private async getNotebookFiles(): Promise<AnnotationFile[]> {
    const files = this.vault.getMarkdownFiles();

    return files
      .map((file) => {
        const cache = this.metadataCache.getFileCache(file);
        return { file, frontmatter: cache?.frontmatter };
      })
      .filter(({ frontmatter }) => frontmatter?.["doc_type"] === frontMatterDocType)
      .map(({ file, frontmatter }): AnnotationFile => ({ file, url: frontmatter["url"] }))
  }

  public async getNewNotebookFilePath(notebook: Notebook): Promise<string> {
    const folderPath = notebookFolderPath(notebook);
    console.log("folderPath:",folderPath)
    if (!(await this.vault.adapter.exists(folderPath))) {
      console.info(`Folder ${folderPath} not found. Will be created`);
      await this.createFolder(folderPath);
    }

    const fileName = `${sanitizeTitle(notebook.metaData.title)}.md`;
    console.log("fileName:",fileName)

    const filePath = `${folderPath}/${fileName}`
    return filePath;
  }


}

