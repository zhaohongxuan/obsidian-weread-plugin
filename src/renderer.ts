import * as nunjucks from 'nunjucks';
import type { Notebook, RenderTemplate } from './models';
import { settingsStore } from './settings';
import { get } from 'svelte/store';
export class Renderer {
	constructor() {
		nunjucks.configure({ autoescape: false })
		// 自定义函数 https://mozilla.github.io/nunjucks/api.html#addfilter
		.addFilter('replace', function(str, regex, replacement) {
			if (!str) return ''; // 处理 undefined 或 null 情况
			return str.replace(regex, replacement);
		  })
		  ;
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
		const { metaData, chapterHighlights, bookReview } = entry;

		const context: RenderTemplate = {
			metaData,
			chapterHighlights,
			bookReview
		};
		const template = get(settingsStore).template;
		const content = nunjucks.renderString(template, context);
		return content;
	}
}
