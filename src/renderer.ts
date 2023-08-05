import * as nunjucks from 'nunjucks';
import type { Notebook, RenderTemplate } from './models';
import { settingsStore } from './settings';
import { get } from 'svelte/store';
export class Renderer {
	constructor() {
		nunjucks.configure({ autoescape: false });
	}

	validate(template: string): boolean {
		try {
			nunjucks.renderString(template, {});
			return true;
		} catch (error) {
			console.error('validate weread template error,please check', error);
			return false;
		}
	}

	render(entry: Notebook): string {
		const { metaData, chapterHighlights, bookReview, chapterMarks } = entry;

		const context: RenderTemplate = {
			metaData,
			chapterHighlights,
			bookReview,
			chapterMarks
		};

		const template = get(settingsStore).template;
		const content = nunjucks.renderString(template, context);
		return content;
	}
}
