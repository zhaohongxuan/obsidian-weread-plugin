import type { Metadata, SyncFilterResult } from './models';
import type { SyncMode, WereadPluginSettings } from './settings';
import { parseBookIdList } from './utils/bookIdUtils';

export type SyncFilterContext = {
	saveArticleToggle: boolean;
	noteCountLimit: number;
	syncMode: SyncMode;
	blacklistedBookIds: Set<string>;
	whitelistedBookIds: Set<string>;
};

export const createSyncFilterContext = (
	settings: Pick<
		WereadPluginSettings,
		'saveArticleToggle' | 'noteCountLimit' | 'syncMode' | 'notesBlacklist' | 'notesWhitelist'
	>
): SyncFilterContext => {
	return {
		saveArticleToggle: settings.saveArticleToggle,
		noteCountLimit: settings.noteCountLimit,
		syncMode: settings.syncMode,
		blacklistedBookIds: parseBookIdList(settings.notesBlacklist),
		whitelistedBookIds: parseBookIdList(settings.notesWhitelist)
	};
};

export const evaluateMetadataSyncFilter = (
	metaData: Metadata,
	context: SyncFilterContext
): SyncFilterResult => {
	const excludedByArticleType = !context.saveArticleToggle && metaData.bookType === 3;
	const excludedByNoteCount = metaData.noteCount < context.noteCountLimit;
	const excludedByBlacklist =
		context.syncMode === 'blacklist' && context.blacklistedBookIds.has(metaData.bookId);
	const excludedByWhitelist =
		context.syncMode === 'whitelist' && !context.whitelistedBookIds.has(metaData.bookId);
	const includedByCurrentSettings =
		!excludedByArticleType &&
		!excludedByNoteCount &&
		!excludedByBlacklist &&
		!excludedByWhitelist;
	const reasonLabels: string[] = [];

	if (excludedByArticleType) {
		reasonLabels.push('公众号内容已过滤');
	}
	if (excludedByNoteCount) {
		const noteCountLimitText = Number.isInteger(context.noteCountLimit)
			? context.noteCountLimit.toString()
			: context.noteCountLimit.toFixed(1);
		reasonLabels.push(`划线少于 ${noteCountLimitText} 条`);
	}
	if (excludedByBlacklist) {
		reasonLabels.push('命中黑名单');
	}
	if (excludedByWhitelist) {
		reasonLabels.push('未在白名单');
	}

	return {
		excludedByArticleType,
		excludedByNoteCount,
		excludedByBlacklist,
		excludedByWhitelist,
		includedByCurrentSettings,
		reasonLabels
	};
};
