import type { FavoriteEntry } from './models';
import {
	FavoritesStorageError,
	FavoritesCanvasMetadataError,
	FutureSchemaError,
	validateFavorite,
	parseLegacyFavorites
} from './favoritesRepository';
import type { FavoritesDocument } from './favoritesRepository';
import { isFavoriteBookPath } from './favoriteBookFiles';

export type FavoriteBookFiles = Readonly<Record<string, string>>;

type CanvasObject = Record<string, any>;
const HEADER = '<!-- weread-favorites:';
const CARD = '<!-- weread-favorite:';
const FOOTER = '<!-- weread-favorite-footer -->';
const COVER_START = '<!-- weread-favorite-cover -->';
const COVER_END = '<!-- /weread-favorite-cover -->';
const fail = (): never => {
	throw new FavoritesCanvasMetadataError('收藏 Canvas 结构或元数据无效；已保护原文件');
};
const isObject = (value: unknown): value is CanvasObject =>
	!!value && typeof value === 'object' && !Array.isArray(value);
const string = (value: unknown): value is string => typeof value === 'string' && value.length > 0;
const color = (value: unknown): boolean =>
	value === undefined || (typeof value === 'string' && /^(#[0-9a-fA-F]{6}|[1-6])$/.test(value));

function canvas(raw: string): CanvasObject {
	let root: CanvasObject;
	try {
		root = JSON.parse(raw);
	} catch {
		throw new FavoritesStorageError('收藏 Canvas 文件无法解析');
	}
	if (!isObject(root)) fail();
	// Legacy favorites JSON is migration input, never an empty native Canvas.
	if (
		!('nodes' in root) &&
		!('edges' in root) &&
		'schemaVersion' in root &&
		'revision' in root &&
		'records' in root
	)
		fail();
	for (const key of ['nodes', 'edges']) {
		if (!(key in root)) root[key] = [];
		else if (!Array.isArray(root[key])) fail();
	}
	const ids = new Set<string>();
	for (const node of root.nodes) {
		if (
			!isObject(node) ||
			!string(node.id) ||
			ids.has(node.id) ||
			!['text', 'file', 'link', 'group'].includes(node.type) ||
			!['x', 'y', 'width', 'height'].every(
				(key) => typeof node[key] === 'number' && Number.isFinite(node[key])
			) ||
			node.width <= 0 ||
			node.height <= 0 ||
			!color(node.color)
		)
			fail();
		ids.add(node.id);
		if (
			(node.type === 'text' && typeof node.text !== 'string') ||
			(node.type === 'file' && !string(node.file)) ||
			(node.type === 'link' && !string(node.url)) ||
			(node.type === 'group' && node.label !== undefined && typeof node.label !== 'string')
		)
			fail();
	}
	const edgeIds = new Set<string>();
	for (const edge of root.edges) {
		if (
			!isObject(edge) ||
			!string(edge.id) ||
			edgeIds.has(edge.id) ||
			!string(edge.fromNode) ||
			!string(edge.toNode) ||
			!color(edge.color) ||
			['fromSide', 'toSide'].some(
				(key) =>
					edge[key] !== undefined &&
					!['top', 'right', 'bottom', 'left'].includes(edge[key])
			) ||
			['fromEnd', 'toEnd'].some(
				(key) => edge[key] !== undefined && !['none', 'arrow'].includes(edge[key])
			) ||
			(edge.label !== undefined && typeof edge.label !== 'string')
		)
			fail();
		edgeIds.add(edge.id);
	}
	return root;
}

function marker(text: string, prefix: string): { value: CanvasObject; before: string } | undefined {
	const at = text.lastIndexOf(prefix);
	if (at < 0) return undefined;
	const suffix = text.slice(at).trimEnd();
	if (!suffix.endsWith(' -->') || suffix.slice(prefix.length, -4).includes(' -->')) return fail();
	let value: CanvasObject;
	try {
		value = JSON.parse(decodeURIComponent(suffix.slice(prefix.length, -4)));
	} catch {
		return fail();
	}
	if (!isObject(value)) return fail();
	const latest = prefix === HEADER ? 2 : 1;
	if (typeof value.schemaVersion === 'number' && value.schemaVersion > latest)
		throw new FutureSchemaError('收藏文件来自更新版本，请升级插件；当前为只读');
	if (value.schemaVersion !== 1 && !(prefix === HEADER && value.schemaVersion === 2))
		return fail();
	return { value, before: text.slice(0, at) };
}
function active(node: CanvasObject): FavoriteEntry | undefined {
	if (node.type !== 'text') return undefined;
	const metadata = marker(node.text, CARD);
	if (!metadata) return undefined;
	if (
		Object.keys(metadata.value).some(
			(key) => !['schemaVersion', 'record', 'cover'].includes(key)
		) ||
		(metadata.value.cover !== undefined && typeof metadata.value.cover !== 'boolean')
	)
		return fail();
	const entry = validateFavorite(metadata.value.record);
	if (entry.deletedAt !== undefined) return fail();
	const footer = metadata.before.lastIndexOf(`\n\n${FOOTER}\n\n`);
	if (footer < 0) return fail();
	// Only the final footer delimiter belongs to us; literal markers in a quotation are content.
	let body = metadata.before.slice(0, footer);
	if (metadata.value.cover === true) {
		if (!body.startsWith(`${COVER_START}\n\n`)) return fail();
		const end = body.indexOf(`\n\n${COVER_END}\n\n`, COVER_START.length + 2);
		if (end < 0) return fail();
		body = body.slice(end + `\n\n${COVER_END}\n\n`.length);
	}
	return validateFavorite({ ...entry, note: { ...entry.note, text: body } });
}

export function parseFavoritesCanvas(raw: string): FavoritesDocument {
	const root = canvas(raw);
	try {
		return parseManaged(root);
	} catch (error) {
		if (error instanceof FutureSchemaError) throw error;
		throw new FavoritesCanvasMetadataError('收藏 Canvas 元数据损坏；已保护原文件，当前为只读');
	}
}

function headerMetadata(node: CanvasObject): ReturnType<typeof marker> {
	return node.type === 'text' && node.text.lastIndexOf(HEADER) > node.text.lastIndexOf(CARD)
		? marker(node.text, HEADER)
		: undefined;
}

function graphMetadata(root: CanvasObject): {
	header?: CanvasObject;
	bookNodes: Record<string, string>;
	managedEdges: string[];
} {
	const result: {
		header?: CanvasObject;
		bookNodes: Record<string, string>;
		managedEdges: string[];
	} = {
		bookNodes: Object.create(null),
		managedEdges: []
	};
	for (const node of root.nodes) {
		const metadata = headerMetadata(node);
		if (!metadata) continue;
		if (result.header) fail();
		result.header = node;
		const value = metadata.value;
		const allowed =
			value.schemaVersion === 2
				? ['schemaVersion', 'revision', 'tombstones', 'bookNodes', 'managedEdges']
				: ['schemaVersion', 'revision', 'tombstones'];
		if (node.text.includes(CARD) || Object.keys(value).some((key) => !allowed.includes(key)))
			fail();
		if (value.schemaVersion === 1) continue;
		if (!isObject(value.bookNodes) || !Array.isArray(value.managedEdges)) fail();
		const references = new Set<string>();
		for (const [bookId, nodeId] of Object.entries(value.bookNodes)) {
			if (!/^\S+$/.test(bookId) || !string(nodeId) || references.has(nodeId)) return fail();
			references.add(nodeId);
			const book = root.nodes.find((candidate: CanvasObject) => candidate.id === nodeId);
			if (
				book &&
				(book.id === node.id ||
					!['file', 'text'].includes(book.type) ||
					(book.type === 'file' && !localMarkdown(book.file)) ||
					(book.type === 'text' &&
						(book.text.includes(CARD) || book.text.includes(HEADER))))
			)
				fail();
			result.bookNodes[bookId] = nodeId;
		}
		const edgeIds = new Set<string>();
		for (const id of value.managedEdges) {
			if (!string(id) || edgeIds.has(id)) fail();
			edgeIds.add(id);
			result.managedEdges.push(id);
		}
	}
	const ids = new Set(root.nodes.map((node: CanvasObject) => node.id));
	const derived = new Set(Object.values(result.bookNodes));
	for (const edge of root.edges) {
		const managed = result.managedEdges.includes(edge.id);
		if (
			(!ids.has(edge.fromNode) && !derived.has(edge.fromNode)) ||
			(!ids.has(edge.toNode) && !derived.has(edge.toNode) && !managed)
		)
			fail();
		if (managed) {
			if (edge.fromNode === result.header?.id) {
				if (!derived.has(edge.toNode)) fail();
			} else {
				if (!derived.has(edge.fromNode)) fail();
				const target = root.nodes.find((node: CanvasObject) => node.id === edge.toNode);
				if (target && !active(target)) fail();
			}
		}
	}
	return result;
}

function parseManaged(root: CanvasObject): FavoritesDocument {
	const graph = graphMetadata(root);
	let revision = 0;
	const records: FavoriteEntry[] = [];
	for (const node of root.nodes) {
		if (node.id === graph.header?.id) {
			const metadata = headerMetadata(node)!;
			const doc = parseLegacyFavorites(
				JSON.stringify({
					schemaVersion: 1,
					revision: metadata.value.revision,
					records: metadata.value.tombstones
				})
			);
			if (doc.records.some((entry) => entry.deletedAt === undefined)) fail();
			revision = doc.revision;
			records.push(...doc.records);
		} else {
			const entry = active(node);
			if (entry) records.push(entry);
		}
	}
	return parseLegacyFavorites(JSON.stringify({ schemaVersion: 1, revision, records }));
}

function localMarkdown(path: unknown): path is string {
	return string(path) && isFavoriteBookPath(path);
}

function validateBookFiles(bookFiles?: FavoriteBookFiles): void {
	if (bookFiles === undefined) return;
	if (!isObject(bookFiles)) fail();
	for (const [id, path] of Object.entries(bookFiles)) {
		if (!string(id) || !localMarkdown(path)) fail();
	}
}

function coverUrl(value: string | undefined): string | undefined {
	if (!value || /[\u0000-\u0020\u007f<>\\\\]/.test(value)) return undefined;
	const candidate = value.startsWith('//') ? `https:${value}` : value;
	if (!/^https?:\/\//i.test(candidate)) return undefined;
	try {
		const url = new URL(candidate);
		if (
			!['http:', 'https:'].includes(url.protocol) ||
			!url.hostname ||
			url.username ||
			url.password
		)
			return undefined;
		return url.href.replace(/\(/g, '%28').replace(/\)/g, '%29');
	} catch {
		return undefined;
	}
}

const comment = (prefix: string, value: unknown): string =>
	`${prefix}${encodeURIComponent(JSON.stringify(value))} -->`;
const safeText = (text: string): string => text.replace(/<!--/g, '&lt;!--');
function cardText(entry: FavoriteEntry): string {
	const footer = [
		entry.note.bookTitle && `《${entry.note.bookTitle}》`,
		entry.note.author,
		entry.note.chapterTitle
	]
		.filter(Boolean)
		.join(' · ');
	return `${entry.note.text}\n\n${FOOTER}\n\n${safeText(footer)}\n\n${comment(CARD, { schemaVersion: 1, record: entry })}`;
}

/** Remove only a positively identified legacy owned cover, retaining native edits and footer. */
function updateCard(node: CanvasObject, old: FavoriteEntry, next: FavoriteEntry): CanvasObject {
	const metadata = marker(node.text, CARD)!;
	let before = metadata.before;
	if (metadata.value.cover === true) {
		const end = before.indexOf(`\n\n${COVER_END}\n\n`, COVER_START.length + 2);
		before = before.slice(end + `\n\n${COVER_END}\n\n`.length);
	}
	if (old.note.text !== next.note.text) {
		const footer = before.lastIndexOf(`\n\n${FOOTER}\n\n`);
		before = next.note.text + before.slice(footer);
	}
	// Existing metadata can intentionally contain an older text snapshot after a native edit.
	// Leave it byte-identical unless record data changed or an owned cover was removed.
	if (metadata.value.cover !== true && JSON.stringify(old) === JSON.stringify(next)) return node;
	const text = `${before}${comment(CARD, { schemaVersion: 1, record: next })}${node.text.slice(node.text.trimEnd().length)}`;
	return text === node.text ? node : { ...node, text };
}
function stableId(id: string): string {
	return (
		'weread-' +
		Array.from(id)
			.map((char) => char.codePointAt(0)!.toString(16))
			.join('-')
	);
}
function bookLink(path: string): string {
	// Full vault-relative paths resolve through Obsidian's internal Markdown-link resolver.
	// Encode each segment so literal fragments, queries and Markdown punctuation stay filenames.
	const target = path
		.split('/')
		.map((part) =>
			encodeURIComponent(part).replace(
				/[!'()*]/g,
				(char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`
			)
		)
		.join('/');
	return `[打开本地笔记](<${target}>)`;
}
function bookText(entry: FavoriteEntry, local?: string): string {
	const cover = coverUrl(entry.note.cover);
	return [
		cover ? `![封面|80](<${cover}>)` : '',
		`## ${safeText(entry.note.bookTitle)}`,
		safeText(entry.note.author || ''),
		local ? bookLink(local) : ''
	]
		.filter(Boolean)
		.join('\n\n');
}

function quoteHeight(text: string): number {
	const lines = text.split(/\r?\n/).reduce((count, line) => {
		const width = line.replace(/[^\u0000-\u00ff]/g, 'xx').length;
		return count + Math.max(1, Math.ceil(width / 38));
	}, 0);
	return Math.min(280, Math.max(160, lines * 22 + 88));
}

/** Preserve native layout, free cards, groups, custom edges and extension properties. */
export function serializeFavoritesCanvas(
	document: FavoritesDocument,
	previousRaw?: string | null,
	bookFiles?: FavoriteBookFiles
): string {
	validateBookFiles(bookFiles);
	const valid = parseLegacyFavorites(JSON.stringify(document));
	const root = previousRaw == null ? { nodes: [], edges: [] } : canvas(previousRaw);
	if (previousRaw != null) parseFavoritesCanvas(previousRaw);
	const graph = graphMetadata(root);
	const remaining = new Map(
		valid.records
			.filter((entry) => entry.deletedAt === undefined)
			.map((entry) => [entry.id, entry])
	);
	const books = new Map<string, FavoriteEntry>();
	for (const entry of remaining.values())
		if (!books.has(entry.note.bookId)) books.set(entry.note.bookId, entry);
	const nodes: CanvasObject[] = [];
	const quotes = new Map<string, CanvasObject>();
	const oldBooks = new Set(Object.values(graph.bookNodes));
	const removed = new Set<string>();
	const ids = new Set<string>([
		...root.nodes.map((node: CanvasObject) => node.id),
		...root.edges.map((edge: CanvasObject) => edge.id)
	]);
	const allocate = (preferred: string): string => {
		let id = preferred;
		for (let suffix = 1; ids.has(id); suffix++) id = `${preferred}-${suffix}`;
		ids.add(id);
		return id;
	};
	for (const node of root.nodes) {
		if (node.id === graph.header?.id || oldBooks.has(node.id)) continue;
		const old = active(node);
		if (!old) {
			nodes.push(node);
			continue;
		}
		const next = remaining.get(old.id);
		if (!next) {
			removed.add(node.id);
			continue;
		}
		remaining.delete(old.id);
		const card = updateCard(node, old, next);
		const updated =
			node.width === 440 && node.height === 400
				? { ...card, width: 360, height: quoteHeight(next.note.text) }
				: card;
		nodes.push(updated);
		quotes.set(next.id, updated);
	}
	const overlaps = (a: CanvasObject, b: CanvasObject): boolean =>
		a.x < b.x + b.width + 40 &&
		a.x + a.width + 40 > b.x &&
		a.y < b.y + b.height + 40 &&
		a.y + a.height + 40 > b.y;
	const collides = (node: CanvasObject): boolean =>
		nodes.some((other) => overlaps(node, other)) ||
		!!(graph.header && overlaps(node, graph.header));
	const anchor = (
		id: string,
		x: number,
		y: number,
		width: number,
		height: number
	): CanvasObject => {
		const node = { id, type: 'text', x, y, width, height };
		while (collides(node)) node.y -= height + 80;
		return node;
	};
	const bookNodes: Record<string, string> = Object.create(null);
	const bookObjects = new Map<string, CanvasObject>();
	let column = 0;
	for (const [bookId, entry] of books) {
		const oldId = graph.bookNodes[bookId];
		const existing = root.nodes.find((node: CanvasObject) => node.id === oldId);
		const local =
			bookFiles === undefined
				? existing?.type === 'file'
					? existing.file
					: undefined
				: Object.prototype.hasOwnProperty.call(bookFiles, bookId)
					? bookFiles[bookId]
					: undefined;
		const cluster = valid.records
			.filter((record) => record.deletedAt === undefined && record.note.bookId === bookId)
			.map((record) => quotes.get(record.id))
			.filter((node): node is CanvasObject => !!node);
		const x = cluster.length ? Math.min(...cluster.map((node) => node.x)) : column * 520;
		const y = cluster.length ? Math.min(...cluster.map((node) => node.y)) - 380 : 240;
		const node = existing || anchor(allocate(stableId(`book:${bookId}`)), x, y, 440, 300);
		const { file: _file, subpath: _subpath, ...rest } = node;
		const text =
			bookFiles === undefined && existing?.type === 'text'
				? existing.text
				: bookText(entry, local);
		const updated = { ...rest, type: 'text', text };
		nodes.push(updated);
		bookNodes[bookId] = updated.id;
		bookObjects.set(bookId, updated);
		column++;
	}
	for (const id of oldBooks) if (!Object.values(bookNodes).includes(id)) removed.add(id);
	for (const entry of remaining.values()) {
		const book = bookObjects.get(entry.note.bookId)!;
		const node: CanvasObject = {
			id: allocate(stableId(entry.id)),
			type: 'text',
			x: book.x,
			y: book.y + book.height + 80,
			width: 360,
			height: quoteHeight(entry.note.text),
			text: cardText(entry)
		};
		while (collides(node)) node.y += node.height + 80;
		nodes.push(node);
		quotes.set(entry.id, node);
	}
	const headerNode =
		graph.header ||
		anchor(
			allocate('weread-favorites-header'),
			bookObjects.size
				? Math.min(...Array.from(bookObjects.values()).map((node) => node.x))
				: 0,
			bookObjects.size
				? Math.min(...Array.from(bookObjects.values()).map((node) => node.y)) - 220
				: 0,
			440,
			140
		);
	const present = new Set(nodes.map((node) => node.id));
	present.add(headerNode.id);
	const oldManaged = new Set(graph.managedEdges);
	const edges: CanvasObject[] = root.edges.filter(
		(edge: CanvasObject) =>
			!oldManaged.has(edge.id) &&
			!removed.has(edge.fromNode) &&
			!removed.has(edge.toNode) &&
			present.has(edge.fromNode) &&
			present.has(edge.toNode)
	);
	const managedEdges: string[] = [];
	const connect = (fromNode: string, toNode: string): void => {
		const previous = root.edges.find(
			(edge: CanvasObject) =>
				oldManaged.has(edge.id) && edge.fromNode === fromNode && edge.toNode === toNode
		);
		const edge = previous || {
			id: allocate(stableId(`edge:${fromNode}:${toNode}`)),
			fromNode,
			toNode,
			fromSide: 'bottom',
			toSide: 'top',
			toEnd: 'arrow'
		};
		edges.push(edge);
		managedEdges.push(edge.id);
	};
	for (const [bookId, book] of bookObjects) {
		for (const entry of valid.records) {
			if (entry.deletedAt === undefined && entry.note.bookId === bookId)
				connect(book.id, quotes.get(entry.id)!.id);
		}
	}
	const headerText = `# 我的收藏\n\n删除摘录卡片即取消收藏；书籍卡片用于组织收藏。\n\n${comment(
		HEADER,
		{
			schemaVersion: 2,
			revision: valid.revision,
			tombstones: valid.records.filter((entry) => entry.deletedAt !== undefined),
			bookNodes,
			managedEdges
		}
	)}`;
	nodes.push({ ...headerNode, text: headerText });
	const originalOrder = new Map<string, number>(
		root.nodes.map((node: CanvasObject, index: number) => [node.id, index])
	);
	nodes.sort(
		(a, b) => (originalOrder.get(a.id) ?? Infinity) - (originalOrder.get(b.id) ?? Infinity)
	);
	const edgeOrder = new Map<string, number>(
		root.edges.map((edge: CanvasObject, index: number) => [edge.id, index])
	);
	edges.sort((a, b) => (edgeOrder.get(a.id) ?? Infinity) - (edgeOrder.get(b.id) ?? Infinity));
	const raw = JSON.stringify({ ...root, nodes, edges }, null, 2);
	parseFavoritesCanvas(raw);
	return raw;
}

/** Detect derived graph changes without writing or changing native favorite identity. */
export function needsFavoriteGraphUpdate(raw: string, bookFiles?: FavoriteBookFiles): boolean {
	const document = parseFavoritesCanvas(raw);
	const root = canvas(raw);
	validateBookFiles(bookFiles);
	// A native empty Canvas stays untouched until an explicit save.
	if (!root.nodes.length && !root.edges.length) return false;
	if (
		!graphMetadata(root).header &&
		!document.records.some((entry) => entry.deletedAt === undefined)
	)
		return false;
	const next = JSON.parse(serializeFavoritesCanvas(document, raw, bookFiles));
	return JSON.stringify(root) !== JSON.stringify(next);
}

/** Identify validated pre-book-graph Canvas bytes for an immutable migration archive. */
export function isLegacyFavoritesCanvas(raw: string): boolean {
	parseFavoritesCanvas(raw);
	const header = graphMetadata(canvas(raw)).header;
	return !header || headerMetadata(header)!.value.schemaVersion !== 2;
}
