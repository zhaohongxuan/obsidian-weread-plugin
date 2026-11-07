/** Capture the text actually painted by the reader; bookmark offsets are not canvas indexes. */
export const BOOKMARK_CANVAS_HOOK_SCRIPT = `(() => {
	if (window.__wereadBookmarkCanvasHookInstalled) return;
	window.__wereadBookmarkCanvasHookInstalled = true;
	const state = window.__wereadBookmarkCanvasState = { canvases: new Map(), revision: 0 };
	const active = new WeakSet();
	const isBookCanvas = canvas => canvas instanceof HTMLCanvasElement &&
		canvas.closest('.readerChapterContent, .renderTargetContainer') &&
		!canvas.closest('.preRenderContainer, .preRenderContent');
	const reset = (canvas, previous) => {
		const entry = { runs: [], revision: ++state.revision, lastPaint: 0, width: canvas.width, height: canvas.height };
		state.canvases.set(canvas, entry);
		for (const key of state.canvases.keys()) if (!key.isConnected) state.canvases.delete(key);
		if (state.canvases.size > 32) state.canvases.delete(state.canvases.keys().next().value);
		return entry;
	};
	const point = (matrix, x, y) => ({ x: matrix.a * x + matrix.c * y + matrix.e, y: matrix.b * x + matrix.d * y + matrix.f });
	const record = (ctx, text, x, y) => {
		const canvas = ctx.canvas;
		if (!isBookCanvas(canvas) || typeof text !== 'string' || !text.length) return;
		const now = performance.now();
		let entry = state.canvases.get(canvas);
		if (!entry || entry.width !== canvas.width || entry.height !== canvas.height || now - entry.lastPaint > 200) entry = reset(canvas, entry);
		const matrix = ctx.getTransform();
		const metrics = ctx.measureText(text);
		const ascent = metrics.actualBoundingBoxAscent || parseFloat(ctx.font) || 18;
		const descent = metrics.actualBoundingBoxDescent || ascent * .2;
		const top = point(matrix, Number(x), Number(y) - ascent);
		const bottom = point(matrix, Number(x) + metrics.width, Number(y) + descent);
		entry.runs.push({ text, x: Math.min(top.x, bottom.x), y: Math.min(top.y, bottom.y), width: Math.max(1, Math.abs(bottom.x - top.x)), height: Math.max(1, Math.abs(bottom.y - top.y)) });
		if (entry.runs.length > 30000) entry.runs.splice(0, entry.runs.length - 30000);
		entry.lastPaint = now;
		entry.revision = ++state.revision;
	};
	const clear = (ctx, x, y, width, height) => {
		const canvas = ctx.canvas;
		if (!isBookCanvas(canvas)) return;
		const matrix = ctx.getTransform();
		const a = point(matrix, Number(x), Number(y));
		const b = point(matrix, Number(x) + Number(width), Number(y) + Number(height));
		if (Math.min(a.x, b.x) <= 1 && Math.min(a.y, b.y) <= 1 && Math.max(a.x, b.x) >= canvas.width - 1 && Math.max(a.y, b.y) >= canvas.height - 1) reset(canvas);
	};
	const wrap = (original, kind) => function (...args) {
		if (active.has(this)) return original.apply(this, args);
		active.add(this);
		try {
			if (kind === 'fillText') record(this, ...args);
			else clear(this, ...args);
			return original.apply(this, args);
		} finally { active.delete(this); }
	};
	for (const name of ['fillText', 'clearRect', 'fillRect']) {
		const proto = CanvasRenderingContext2D.prototype;
		proto[name] = wrap(proto[name], name);
	}
	// Existing reader contexts can own wrappers installed before this script.
	for (const canvas of document.querySelectorAll('canvas')) {
		try {
			const ctx = canvas.getContext('2d');
			if (ctx) for (const name of ['fillText', 'clearRect', 'fillRect']) {
				if (Object.prototype.hasOwnProperty.call(ctx, name)) ctx[name] = wrap(ctx[name], name);
			}
		} catch { /* A WebGL canvas is unrelated to text navigation. */ }
	}
})()`;
