import * as nunjucks from 'nunjucks';
import type { Notebook, RenderTemplate } from './models';
import { settingsStore } from './settings';
import { get } from 'svelte/store';
export class Renderer {
	constructor() {
		nunjucks
			.configure({ autoescape: false })
			// 自定义函数 https://mozilla.github.io/nunjucks/api.html#addfilter
			.addFilter('replace', function (str, pattern, replacement) {
				if (!str) return '';

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
						return String(str).replaceAll(pattern, replacement);
					}
				} else if (pattern instanceof RegExp) {
					return String(str).replace(pattern, replacement);
				}
				return String(str).replaceAll(pattern, replacement);
			});
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
		const settings = get(settingsStore);
		const template = settings.template;
		const trimBlocks = settings.trimBlocks;

		// 如果启用了 trimBlocks，使用配置的环境
		if (trimBlocks) {
			const env = new nunjucks.Environment(null, {
				autoescape: false,
				trimBlocks: true,
				lstripBlocks: true
			});

			// 添加自定义过滤器
			env.addFilter('replace', function (str, pattern, replacement) {
				if (!str) return '';

				if (typeof pattern === 'string') {
					try {
						if (pattern.startsWith('/') && pattern.lastIndexOf('/') > 0) {
							const regexBody = pattern.slice(1, pattern.lastIndexOf('/'));
							const flags = pattern.slice(pattern.lastIndexOf('/') + 1);
							pattern = new RegExp(regexBody, flags);
						} else {
							return str.replaceAll(pattern, replacement);
						}
					} catch (e) {
						return String(str).replaceAll(pattern, replacement);
					}
				} else if (pattern instanceof RegExp) {
					return String(str).replace(pattern, replacement);
				}
				return String(str).replaceAll(pattern, replacement);
			});

			const content = env.renderString(template, context);
			return content;
		} else {
			// 使用默认配置（不去空白）
			const content = nunjucks.renderString(template, context);
			return content;
		}
	}

	/**
	 * Render a notebook with a custom template string (without using global settings)
	 * @param templateStr - The template string to use for rendering
	 * @param entry - The notebook data to render
	 * @param trimBlocks - Whether to automatically remove newlines after template tags
	 * @returns The rendered content
	 */
	renderWithTemplate(templateStr: string, entry: Notebook, trimBlocks = false): string {
		const { metaData, chapterHighlights, bookReview } = entry;

		const context: RenderTemplate = {
			metaData,
			chapterHighlights,
			bookReview
		};

		// 创建临时环境以支持 trimBlocks 配置
		const env = new nunjucks.Environment(null, {
			autoescape: false,
			trimBlocks: trimBlocks,
			lstripBlocks: trimBlocks
		});

		// 添加自定义过滤器
		env.addFilter('replace', function (str, pattern, replacement) {
			if (!str) return '';

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
					return String(str).replaceAll(pattern, replacement);
				}
			} else if (pattern instanceof RegExp) {
				return String(str).replace(pattern, replacement);
			}
			return String(str).replaceAll(pattern, replacement);
		});

		const content = env.renderString(templateStr, context);
		return content;
	}
}
