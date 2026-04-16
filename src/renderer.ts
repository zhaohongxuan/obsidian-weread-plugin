import * as nunjucks from 'nunjucks';
import type { Notebook, RenderTemplate } from './models';
import { settingsStore } from './settings';
import { get } from 'svelte/store';

const addDateFilters = (env: nunjucks.Environment) => {
	env.addFilter('formatDate', function (timestamp: number, format?: string): string {
		if (!timestamp) return '';
		const dateStr = window.moment(timestamp * 1000).format(format ?? 'YYYY-MM-DD');
		return dateStr;
	});
	env.addFilter('formatDateTime', function (timestamp: number, format?: string): string {
		if (!timestamp) return '';
		return window.moment(timestamp * 1000).format(format ?? 'YYYY-MM-DD HH:mm:ss');
	});
	env.addFilter('formatTime', function (timestamp: number, format?: string): string {
		if (!timestamp) return '';
		return window.moment(timestamp * 1000).format(format ?? 'HH:mm:ss');
	});
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
};

export class Renderer {
	constructor() {
		const env = nunjucks.configure({ autoescape: false });
		addDateFilters(env);
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

		// Use active theme's template and trimBlocks, fallback to legacy settings
		const activeTheme = settings.themes?.find((t) => t.id === settings.activeThemeId);
		const template = activeTheme?.template ?? settings.template;
		const trimBlocks = activeTheme?.trimBlocks ?? settings.trimBlocks;

		// 如果启用了 trimBlocks，使用配置的环境
		if (trimBlocks) {
			const env = new nunjucks.Environment(null, {
				autoescape: false,
				trimBlocks: true,
				lstripBlocks: true
			});
			addDateFilters(env);

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
		addDateFilters(env);

		const content = env.renderString(templateStr, context);
		return content;
	}
}
