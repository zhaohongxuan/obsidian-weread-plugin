import nunjucks from 'nunjucks';
import notebookTemplate from './assets/notebookTemplate.njk';
import type { Notebook, RenderTemplate } from './models';
export class Renderer {
  constructor() {
    nunjucks.configure({ autoescape: false });
  }

  validate(template: string): boolean {
    try {
      nunjucks.renderString(template, {});
      return true;
    } catch (error) {
      return false;
    }
  }

  render(entry: Notebook, isNew = true): string {
    const { metaData , highlights, reviews } = entry;

    const context: RenderTemplate = {
       isNewNote: isNew,
       ...metaData,
       highlights,
       reviews,
    };

    const content = nunjucks.renderString(notebookTemplate, context);
    return content;
  }
}
