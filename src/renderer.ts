import * as nunjucks from 'nunjucks';
import type { Notebook, RenderTemplate } from './models';
import { settingsStore } from './settings';
import { get } from 'svelte/store';
export class Renderer {
	constructor() {
		nunjucks.configure({ autoescape: false })
			// 自定义函数 https://mozilla.github.io/nunjucks/api.html#addfilter
			.addFilter('replace', function (str, pattern, replacement) {
				if (!str)
					return ''

				if (typeof pattern === 'string') {
					try {
						// 如果 pattern 以 /.../ 开头和结尾，解析为正则表达式
						if (pattern.startsWith('/') && pattern.lastIndexOf('/') > 0) {
							const regexBody = pattern.slice(1, pattern.lastIndexOf('/'));
							const flags = pattern.slice(pattern.lastIndexOf('/') + 1);
							pattern = new RegExp(regexBody, flags);
						} else {
							return str.replaceAll(pattern, replacement);
						}
					} catch (e) {
						// 如果正则表达式无效，回退到字符串替换
						return str.replaceAll(pattern, replacement);
					}
				} else if (pattern instanceof RegExp) {
					return str.replace(pattern, replacement);
				}
				return str.replaceAll(pattern, replacement);
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
