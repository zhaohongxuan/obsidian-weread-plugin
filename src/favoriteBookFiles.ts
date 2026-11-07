import type { MetadataCache, Vault } from 'obsidian';
import type { FavoriteEntry } from './models';
import type { FavoriteBookFiles } from './favoritesCanvas';
import { journalId } from './journalHelpers';

/** Only canonical vault-relative Markdown paths may become native Canvas file references. */
export function isFavoriteBookPath(path: unknown): path is string {
	return (
		typeof path === 'string' &&
		/\.md$/i.test(path) &&
		!/[\\\u0000-\u001f\u007f]/.test(path) &&
		!/^([/ ~]|[a-z][a-z0-9+.-]*:)/i.test(path) &&
		path.split('/').every((part) => !!part && part !== '.' && part !== '..')
	);
}

/** Resolve once per write transaction from Obsidian's in-memory Markdown/metadata indexes. */
export function resolveFavoriteBookFiles(
	records: readonly FavoriteEntry[],
	vault: Pick<Vault, 'getMarkdownFiles'>,
	metadataCache: Pick<MetadataCache, 'getFileCache'>
): FavoriteBookFiles {
	const wanted = new Set(
		records.filter((entry) => entry.deletedAt === undefined).map((entry) => entry.note.bookId)
	);
	const candidates = new Map<string, Set<string>>();
	if (
		!wanted.size ||
		typeof vault.getMarkdownFiles !== 'function' ||
		typeof metadataCache?.getFileCache !== 'function'
	)
		return {};
	for (const file of vault.getMarkdownFiles()) {
		if (file.extension.toLowerCase() !== 'md' || !isFavoriteBookPath(file.path)) continue;
		const frontmatter = metadataCache.getFileCache(file)?.frontmatter;
		// Same identity convention as FileManager.getWereadNoteAnnotationFile/getNotebookFiles.
		if (frontmatter?.['doc_type'] !== 'weread-highlights-reviews') continue;
		const id = journalId(frontmatter['bookId']);
		if (!wanted.has(id)) continue;
		if (!candidates.has(id)) candidates.set(id, new Set());
		candidates.get(id).add(file.path);
	}
	// Never choose arbitrarily when more than one synced Markdown claims a book ID.
	const resolved: Record<string, string> = Object.create(null);
	for (const [id, paths] of candidates) {
		if (paths.size === 1) resolved[id] = paths.values().next().value;
	}
	return resolved;
}
