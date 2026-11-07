import type { FavoriteEntry } from './models';
import {
	FavoritesStorageError,
	FavoritesCanvasMetadataError,
	FutureSchemaError,
	validateFavorite,
	parseLegacyFavorites
} from './favoritesRepository';
import type { FavoritesDocument } from './favoritesRepository';

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
			!ids.has(edge.fromNode) ||
			!ids.has(edge.toNode) ||
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
	if (typeof value.schemaVersion === 'number' && value.schemaVersion > 1)
		throw new FutureSchemaError('收藏文件来自更新版本，请升级插件；当前为只读');
	if (value.schemaVersion !== 1) return fail();
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

function parseManaged(root: CanvasObject): FavoritesDocument {
	let revision = 0;
	let header = false;
	const records: FavoriteEntry[] = [];
	for (const node of root.nodes) {
		if (node.type !== 'text') continue;
		const metadata =
			node.text.lastIndexOf(HEADER) > node.text.lastIndexOf(CARD)
				? marker(node.text, HEADER)
				: undefined;
		if (metadata) {
			if (
				header ||
				node.text.includes(CARD) ||
				Object.keys(metadata.value).some(
					(key) => !['schemaVersion', 'revision', 'tombstones'].includes(key)
				)
			)
				fail();
			header = true;
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
const coverPrefix = (url: string): string =>
	`${COVER_START}\n\n![封面|80](<${url}>)\n\n${COVER_END}\n\n`;

function needsCover(node: CanvasObject, entry: FavoriteEntry): boolean {
	return !!coverUrl(entry.note.cover) && marker(node.text, CARD)?.value.cover !== true;
}

/** Presentation-only upgrade; quote snapshots and native layout remain untouched. */
export function hasMissingFavoriteCovers(raw: string): boolean {
	parseFavoritesCanvas(raw);
	return canvas(raw).nodes.some((node: CanvasObject) => {
		const entry = active(node);
		return entry !== undefined && needsCover(node, entry);
	});
}

const comment = (prefix: string, value: unknown): string =>
	`${prefix}${encodeURIComponent(JSON.stringify(value))} -->`;
function cardText(entry: FavoriteEntry): string {
	const cover = coverUrl(entry.note.cover);
	const footer = [`《${entry.note.bookTitle}》`, entry.note.author, entry.note.chapterTitle]
		.filter(Boolean)
		.join(' · ')
		.replace(/<!--/g, '&lt;!--');
	return `${cover ? coverPrefix(cover) : ''}${entry.note.text}\n\n${FOOTER}\n\n${footer}\n\n${comment(CARD, { schemaVersion: 1, record: entry, ...(cover ? { cover: true } : {}) })}`;
}

function retrofitCover(node: CanvasObject, entry: FavoriteEntry): CanvasObject {
	const cover = coverUrl(entry.note.cover);
	if (!cover || !needsCover(node, entry)) return node;
	const metadata = marker(node.text, CARD)!;
	return {
		...node,
		text: `${coverPrefix(cover)}${metadata.before}${comment(CARD, {
			...metadata.value,
			cover: true
		})}${node.text.slice(node.text.trimEnd().length)}`
	};
}
function stableId(id: string): string {
	// Unicode code-point hex is deterministic and collision-free, using ordinary Canvas ID characters.
	return (
		'weread-' +
		Array.from(id)
			.map((char) => char.codePointAt(0)!.toString(16))
			.join('-')
	);
}

/** Preserve native layout, free cards, groups, edges and unknown standard-extension properties. */
export function serializeFavoritesCanvas(
	document: FavoritesDocument,
	previousRaw?: string | null
): string {
	const valid = parseLegacyFavorites(JSON.stringify(document));
	const root = previousRaw == null ? { nodes: [], edges: [] } : canvas(previousRaw);
	if (previousRaw != null) parseFavoritesCanvas(previousRaw);
	const remaining = new Map(
		valid.records
			.filter((entry) => entry.deletedAt === undefined)
			.map((entry) => [entry.id, entry])
	);
	const removed = new Set<string>();
	let hasHeader = false;
	const ids = new Set<string>(root.nodes.map((node: CanvasObject) => node.id));
	const bottom = root.nodes.reduce(
		(max: number, node: CanvasObject) => Math.max(max, node.y + node.height),
		-40
	);
	let placed = 0;
	const allocate = (preferred: string): string => {
		let id = preferred;
		for (let suffix = 1; ids.has(id); suffix++) id = `${preferred}-${suffix}`;
		ids.add(id);
		return id;
	};
	const place = (id: string, text: string): CanvasObject => {
		const node = {
			id: allocate(id),
			type: 'text',
			x: (placed % 2) * 480,
			y: bottom + 40 + Math.floor(placed / 2) * 440,
			width: 440,
			height: 400,
			text
		};
		placed++;
		return node;
	};
	const headerText = `# 我的收藏\n\n可在画布中移动、连接和编辑收藏卡片。删除卡片即取消收藏。\n\n${comment(
		HEADER,
		{
			schemaVersion: 1,
			revision: valid.revision,
			tombstones: valid.records.filter((entry) => entry.deletedAt !== undefined)
		}
	)}`;
	const nodes: CanvasObject[] = [];
	for (const node of root.nodes) {
		if (
			node.type === 'text' &&
			node.text.lastIndexOf(HEADER) > node.text.lastIndexOf(CARD) &&
			marker(node.text, HEADER)
		) {
			hasHeader = true;
			nodes.push(node.text === headerText ? node : { ...node, text: headerText });
			continue;
		}
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
		nodes.push(
			JSON.stringify(old) === JSON.stringify(next)
				? retrofitCover(node, next)
				: { ...node, text: cardText(next) }
		);
	}
	if (!hasHeader) nodes.push(place('weread-favorites-header', headerText));
	for (const entry of remaining.values()) nodes.push(place(stableId(entry.id), cardText(entry)));
	const raw = JSON.stringify(
		{
			...root,
			nodes,
			edges: root.edges.filter(
				(edge: CanvasObject) => !removed.has(edge.fromNode) && !removed.has(edge.toNode)
			)
		},
		null,
		2
	);
	parseFavoritesCanvas(raw);
	return raw;
}
