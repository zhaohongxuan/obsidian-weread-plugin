import * as nunjucks from 'nunjucks';
import type { Notebook, RenderTemplate } from './models';
import { settingsStore } from './settings';
import { get } from 'svelte/store';
import {formatTimeDuration, formatTimestampToDate} from "./utils/dateUtil";
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
		const { metaData, chapterHighlights, bookReview } = entry;
		// 增加格式化阅读数据
		metaData.readInfo.readingTimeStr = formatTimeDuration(metaData.readInfo.readingTime);
		metaData.readInfo.readingTimeStr = formatTimestampToDate(metaData.readInfo.readingBookDate);
		if (metaData.readInfo.finishedDate) {
			metaData.readInfo.finishedDateStr = formatTimestampToDate(metaData.readInfo.finishedDate);
		}
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
