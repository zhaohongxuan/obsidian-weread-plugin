export interface QuoteShareContent {
	text: string;
	bookTitle: string;
	author?: string;
	cover?: string;
	chapterTitle?: string;
	createTime?: number;
}

export const QUOTE_SHARE_HEADING = '分享此刻';
export const QUOTE_SHARE_BRAND = 'OBSIDIAN WEREAD';

export const QUOTE_SHARE_TEMPLATES = [
	{ id: 'paper', name: '纸间', description: '纸本留白，以文字为主角' },
	{ id: 'cover', name: '书封', description: '书封侧栏，编辑式编排' },
	{ id: 'night', name: '夜读', description: '深色夜读，不对称引文' }
] as const;
export type QuoteShareTemplate = (typeof QUOTE_SHARE_TEMPLATES)[number]['id'];
export const DEFAULT_QUOTE_SHARE_TEMPLATE: QuoteShareTemplate = 'paper';
export function resolveQuoteShareTemplate(value: unknown): QuoteShareTemplate {
	return QUOTE_SHARE_TEMPLATES.some((template) => template.id === value)
		? (value as QuoteShareTemplate)
		: DEFAULT_QUOTE_SHARE_TEMPLATE;
}

const WIDTH = 1080;
const MAX_HEIGHT = 12000;
const SERIF = '"Songti SC", "STSong", "Noto Serif CJK SC", serif';
const SANS = '-apple-system, BlinkMacSystemFont, "PingFang SC", sans-serif';
const oversize = (): never => {
	throw new Error('这段划线或来源信息过长，超过分享图片的安全尺寸，请选择较短的划线。');
};

/** Grapheme boundaries keep emoji sequences and combining marks intact on Canvas. */
function graphemes(text: string): string[] {
	const Segmenter = (
		Intl as unknown as {
			Segmenter?: new (
				locale: string,
				options: { granularity: string }
			) => { segment: (value: string) => Iterable<{ segment: string }> };
		}
	).Segmenter;
	if (Segmenter) {
		return Array.from(
			new Segmenter('zh', { granularity: 'grapheme' }).segment(text),
			(s) => s.segment
		);
	}
	const result: string[] = [];
	for (const point of Array.from(text)) {
		if (
			result.length &&
			(/^[\u0300-\u036f\ufe00-\ufe0f\u200d]$/.test(point) ||
				result[result.length - 1].endsWith('\u200d'))
		) {
			result[result.length - 1] += point;
		} else result.push(point);
	}
	return result;
}

/** Never truncate: retreat to a legal punctuation/word boundary before committing a soft line. */
function wrap(context: CanvasRenderingContext2D, text: string, width: number): string[] {
	const lines: string[] = [];
	const closing = /^[，。！？、；：）》」』】〉〕］｝,.!?;:%‰…—)\]}”’]/;
	const opening = /^[（《「『【〈〔［｛(\[{“‘]/;
	const latin = /^[a-zA-Z0-9_'’-]+$/;
	for (const paragraph of text.replace(/\r\n?/g, '\n').split('\n')) {
		const parts = graphemes(paragraph);
		if (!parts.length) lines.push('');
		let start = 0;
		while (start < parts.length) {
			let end = start;
			let value = '';
			while (end < parts.length && context.measureText(value + parts[end]).width <= width) {
				value += parts[end++];
			}
			if (end === start) oversize();
			if (end < parts.length) {
				const legal = (boundary: number, keepWords: boolean): boolean =>
					!closing.test(parts[boundary]) &&
					!opening.test(parts[boundary - 1]) &&
					(!keepWords ||
						!latin.test(parts[boundary - 1]) ||
						!latin.test(parts[boundary]));
				let boundary = end;
				while (boundary > start && !legal(boundary, true)) boundary--;
				// An over-wide Latin word may split, but never split an emoji/grapheme or strand punctuation.
				if (boundary === start) {
					boundary = end;
					while (boundary > start && !legal(boundary, false)) boundary--;
				}
				if (boundary === start) {
					throw new Error('这段文字包含无法在卡片宽度内排版的连续标点，请选择其他划线。');
				}
				end = boundary;
			}
			lines.push(parts.slice(start, end).join(''));
			start = end;
			if (lines.length > 160) oversize();
		}
		if (lines.length > 160) oversize();
	}
	return lines;
}

/** Fixed export colors are intentional: previews and downloaded PNGs share one artifact. */
export function renderQuoteShareCard(
	note: QuoteShareContent,
	options: { template?: QuoteShareTemplate; username?: string; cover?: CanvasImageSource } = {}
): HTMLCanvasElement {
	// DOM access stays inside this function so settings can import the template catalog in Node.
	const canvas = document.createElement('canvas');
	canvas.width = WIDTH;
	const ctx = canvas.getContext('2d');
	if (!ctx) throw new Error('无法创建分享图片，请稍后重试。');
	const template = resolveQuoteShareTemplate(options.template);
	const night = template === 'night';
	const editorial = template === 'cover';
	const background = night ? '#24312d' : editorial ? '#eeece1' : '#f4efe3';
	const ink = night ? '#e9eadc' : '#414437';
	const muted = night ? '#a6b49e' : '#838b73';
	const rule = night ? '#52604e' : '#c7cbb6';
	const x = editorial ? 395 : night ? 178 : 98;
	const textWidth = WIDTH - x - 98;
	const fontSize = editorial ? 48 : 56;
	const lineHeight = editorial ? 90 : 106;
	const bodyY = editorial ? 280 : night ? 366 : 410;
	ctx.font = `${fontSize}px ${SERIF}`;
	const quote = wrap(ctx, note.text, textWidth);
	const metadataWidth = WIDTH - x - 340;
	ctx.font = `30px ${SERIF}`;
	const title = wrap(ctx, `《${note.bookTitle || '未命名书籍'}》`, metadataWidth);
	ctx.font = `23px ${SANS}`;
	const author = note.author ? wrap(ctx, note.author, metadataWidth) : [];
	const chapter = note.chapterTitle ? wrap(ctx, note.chapterTitle, metadataWidth) : [];
	const username = wrap(ctx, options.username?.trim() || '阅读者', textWidth);
	const date = new Date(note.createTime ?? NaN);
	const dateText =
		typeof note.createTime === 'number' && note.createTime > 0 && Number.isFinite(date.getTime())
			? `${date.getFullYear()}.${String(date.getMonth() + 1).padStart(2, '0')}.${String(date.getDate()).padStart(2, '0')}`
			: '';
	const metadataHeight =
		title.length * 47 + (author.length + chapter.length) * 36 + (dateText ? 41 : 0);
	const sourceHeight = Math.max(250, metadataHeight);
	const footerHeight = sourceHeight + 90 + username.length * 35 + 76;
	ctx.font = `54px ${SERIF}`;
	const spine = editorial ? wrap(ctx, note.bookTitle || '未命名书籍', 234) : [];
	const height = Math.max(
		1440,
		bodyY + quote.length * lineHeight + 140 + footerHeight,
		spine.length * 86 + 500
	);
	if (height > MAX_HEIGHT) oversize();
	canvas.height = Math.ceil(height);
	ctx.textBaseline = 'top';
	ctx.fillStyle = background;
	ctx.fillRect(0, 0, WIDTH, canvas.height);
	const text = (
		value: string,
		left: number,
		top: number,
		size: number,
		color = ink,
		serif = false
	): void => {
		ctx.fillStyle = color;
		ctx.font = `${size}px ${serif ? SERIF : SANS}`;
		ctx.fillText(value, left, top);
	};
	const brand = (top: number, size: number): void => {
		ctx.font = `${size}px ${SANS}`;
		text(QUOTE_SHARE_BRAND, 982 - ctx.measureText(QUOTE_SHARE_BRAND).width, top, size, muted);
	};
	const line = (left: number, top: number, right: number, color = rule): void => {
		ctx.strokeStyle = color;
		ctx.lineWidth = 1.5;
		ctx.beginPath();
		ctx.moveTo(left, top);
		ctx.lineTo(right, top);
		ctx.stroke();
	};
	if (editorial) {
		ctx.fillStyle = '#b7c3aa';
		ctx.fillRect(0, 0, 330, height);
		line(48, 110, 282, '#7c8c6f');
		text('READING', 48, 140, 17, '#526647');
		text('COLLECTION', 48, 169, 17, '#526647');
		spine.forEach((value, i) => text(value, 48, 290 + i * 86, 54, '#34412e', true));
		line(48, height - 115, 282, '#7c8c6f');
		text(QUOTE_SHARE_HEADING, 48, 62, 23, '#526647');
		brand(92, 19);
		text('书页有尽，回响悠长。', x, 165, 25, muted, true);
	} else if (night) {
		ctx.fillStyle = '#c4b28b';
		ctx.beginPath();
		ctx.arc(115, 112, 18, 0, Math.PI * 2);
		ctx.fill();
		ctx.fillStyle = background;
		ctx.beginPath();
		ctx.arc(106, 107, 18, 0, Math.PI * 2);
		ctx.fill();
		text(QUOTE_SHARE_HEADING, 158, 98, 21, '#c4c9b4');
		brand(102, 19);
		text('留一盏灯，给心里的句子。', 98, 267, 22, muted, true);
		ctx.strokeStyle = '#899271';
		ctx.beginPath();
		ctx.moveTo(129, bodyY - 12);
		ctx.lineTo(129, bodyY + quote.length * lineHeight);
		ctx.stroke();
	} else {
		text(QUOTE_SHARE_HEADING, 98, 105, 24, muted, true);
		brand(110, 15);
		line(98, 174, 982);
		text('“', 98, 266, 116, '#a2a58b', true);
	}
	quote.forEach((value, i) => text(value, x, bodyY + i * lineHeight, fontSize, ink, true));
	const sourceY = height - footerHeight;
	let y = sourceY;
	title.forEach((value) => {
		text(value, x, y, 30, ink, true);
		y += 47;
	});
	if (author.length) y += 10;
	author.forEach((value) => {
		text(value, x, y, 23, muted);
		y += 36;
	});
	chapter.forEach((value) => {
		text(value, x, y, 23, muted);
		y += 36;
	});
	if (dateText) text(dateText, x, y + 5, 21, muted);
	const box = { x: 802, y: sourceY + sourceHeight - 250, width: 180, height: 250 };
	let drawn = false;
	if (options.cover) {
		const source = options.cover as unknown as Record<string, unknown>;
		const dimension = (keys: string[]): number => {
			for (const key of keys) {
				const value = source[key];
				if (typeof value === 'number' && value > 0) return value;
				if (value && typeof value === 'object' && 'baseVal' in value) {
					const length = (value as { baseVal: { value: number } }).baseVal.value;
					if (length > 0) return length;
				}
			}
			return 0;
		};
		const width = dimension(['naturalWidth', 'videoWidth', 'displayWidth', 'width']);
		const coverHeight = dimension(['naturalHeight', 'videoHeight', 'displayHeight', 'height']);
		if (width && coverHeight) {
			const scale = Math.min(box.width / width, box.height / coverHeight);
			try {
				ctx.drawImage(
					options.cover,
					box.x + (box.width - width * scale) / 2,
					box.y + (box.height - coverHeight * scale),
					width * scale,
					coverHeight * scale
				);
				drawn = true;
			} catch {
				/* A failed image still yields a readable typographic source card. */
			}
		}
	}
	if (!drawn) {
		ctx.fillStyle = night ? '#37483c' : '#dce0cf';
		ctx.fillRect(box.x, box.y, box.width, box.height);
		line(box.x + 20, box.y + 32, box.x + box.width - 20, muted);
		text('书', box.x + 55, box.y + 77, 72, muted, true);
		text('阅读 · 留存', box.x + 28, box.y + 204, 18, muted);
	}
	const footerY = sourceY + sourceHeight + 46;
	line(x, footerY, 982);
	username.forEach((value, i) =>
		text(value, x, footerY + 34 + i * 35, 23, night ? '#c4b28b' : muted)
	);
	return canvas;
}
