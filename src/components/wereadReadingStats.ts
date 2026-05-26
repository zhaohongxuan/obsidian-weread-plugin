import { ItemView, Menu, Modal, Notice, WorkspaceLeaf, setIcon, TFile, Vault } from 'obsidian';
import ApiRouter from '../api-router';
import FileManager from '../fileManager';
import { settingsStore } from '../settings';
import { get } from 'svelte/store';
import type { ReadingStatsResponse, ReadingStatsMode } from '../models';

export const WEREAD_READING_STATS_VIEW_ID = 'weread-reading-stats-view';

// ─── 格式化工具 ───────────────────────────────────────────────────────────────

function fmtDuration(seconds: number): string {
	if (!seconds) return '0分钟';
	const h = Math.floor(seconds / 3600);
	const m = Math.floor((seconds % 3600) / 60);
	if (h > 0 && m > 0) return `${h}小时${m}分钟`;
	if (h > 0) return `${h}小时`;
	return `${m}分钟`;
}

/** 计算"好看"的整数刻度：0、中间、最大值，尽量是整数分钟或整数小时 */
function niceTickLabel(seconds: number): string {
	if (seconds === 0) return '0';
	const mins = Math.round(seconds / 60);
	const hours = seconds / 3600;
	if (hours >= 1 && Number.isInteger(Math.round(hours))) return `${Math.round(hours)}小时`;
	if (mins >= 60) {
		const h = Math.floor(mins / 60);
		const m = mins % 60;
		return m === 0 ? `${h}小时` : `${h}小时${m}分`;
	}
	return `${mins}分钟`;
}

/** 用第 p 百分位数（0–100）代替 max，避免极值压平颜色分布 */
function percentile(values: number[], p: number): number {
	if (values.length === 0) return 1;
	const sorted = [...values].sort((a, b) => a - b);
	const idx = Math.floor((p / 100) * (sorted.length - 1));
	return sorted[idx] || 1;
}

/** 计算"好看"的最大刻度（向上取整到整数分钟/整数半小时/整数小时） */
function niceMax(seconds: number): number {
	if (seconds <= 0) return 60;
	const mins = seconds / 60;
	if (mins <= 10) return Math.ceil(mins) * 60;
	if (mins <= 60) return Math.ceil(mins / 5) * 5 * 60;
	if (mins <= 120) return Math.ceil(mins / 10) * 10 * 60;
	const hours = seconds / 3600;
	return Math.ceil(hours * 2) / 2 * 3600; // round up to half-hour
}

function fmtTs(ts: number): string {
	if (!ts) return '—';
	const d = new Date(ts * 1000);
	return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function fmtCompare(compare?: number): { text: string; up: boolean } | null {
	if (compare === undefined || compare === null) return null;
	const pct = Math.round(Math.abs(compare) * 100);
	return { text: `${pct}%`, up: compare >= 0 };
}

const HOUR_LABELS = ['6','7','8','9','10','11','12','13','14','15','16','17','18','19','20','21','22','23','0','1','2','3','4','5'];
const WEEK_LABELS = ['一', '二', '三', '四', '五', '六', '日'];

// ─── 时间偏移计算 ──────────────────────────────────────────────────────────────

function calcBaseTime(mode: ReadingStatsMode, offset: number): number | undefined {
	if (mode === 'overall') return undefined;
	const now = new Date();
	if (mode === 'weekly') {
		const dow = now.getDay() === 0 ? 6 : now.getDay() - 1;
		const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - dow);
		monday.setDate(monday.getDate() + offset * 7);
		return Math.floor(monday.getTime() / 1000);
	}
	if (mode === 'monthly') {
		const d = new Date(now.getFullYear(), now.getMonth() + offset, 1);
		return Math.floor(d.getTime() / 1000);
	}
	if (mode === 'annually') {
		const d = new Date(now.getFullYear() + offset, 0, 1);
		return Math.floor(d.getTime() / 1000);
	}
	return undefined;
}

function periodLabel(mode: ReadingStatsMode, offset: number): string {
	if (mode === 'overall') return '全部';
	const now = new Date();
	if (mode === 'weekly') {
		const dow = now.getDay() === 0 ? 6 : now.getDay() - 1;
		const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - dow + offset * 7);
		const sunday = new Date(monday.getTime() + 6 * 86400000);
		const fmt = (d: Date) => `${d.getMonth() + 1}/${d.getDate()}`;
		return `${monday.getFullYear()} · ${fmt(monday)} - ${fmt(sunday)}`;
	}
	if (mode === 'monthly') {
		const d = new Date(now.getFullYear(), now.getMonth() + offset, 1);
		return `${d.getFullYear()}年${d.getMonth() + 1}月`;
	}
	if (mode === 'annually') {
		return `${now.getFullYear() + offset}年`;
	}
	return '';
}

/**
 * 周模式：返回完整 7 天数组（一～日），每天对应秒数，
 * 日期不在 readTimes 里则为 0
 */
function buildWeekValues(
	readTimes: Record<string, number>,
	baseTime: number | undefined
): { values: number[]; labels: string[] } {
	// 找到本周一的 0:00
	let mondayTs: number;
	if (baseTime !== undefined) {
		mondayTs = baseTime;
	} else {
		const now = new Date();
		const dow = now.getDay() === 0 ? 6 : now.getDay() - 1;
		const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - dow);
		mondayTs = Math.floor(monday.getTime() / 1000);
	}

	const values: number[] = [];
	const labels: string[] = WEEK_LABELS.slice(); // 一二三四五六日
	for (let d = 0; d < 7; d++) {
		// readTimes key may be the exact day start timestamp
		const dayTs = mondayTs + d * 86400;
		// API may return any timestamp within that day as key; find closest match
		const key = Object.keys(readTimes).find(k => {
			const diff = Number(k) - dayTs;
			return diff >= 0 && diff < 86400;
		});
		values.push(key ? (readTimes[key] as number) : 0);
	}
	return { values, labels };
}

// ─── Daily stats disk cache ───────────────────────────────────────────────────

const CACHE_DIR = '.weread-cache';
const CACHE_FILE = `${CACHE_DIR}/daily-stats.json`;

interface DailyStatsCache {
	version: number;
	// key = "YYYY-M-D", value = seconds
	data: Record<string, number>;
	// tracks which months have been fetched: key = "YYYY-M"
	fetchedMonths: string[];
}

async function loadDailyCache(vault: Vault): Promise<DailyStatsCache> {
	try {
		const exists = await vault.adapter.exists(CACHE_FILE);
		if (exists) {
			const raw = await vault.adapter.read(CACHE_FILE);
			return JSON.parse(raw) as DailyStatsCache;
		}
	} catch (_) { /* ignore */ }
	return { version: 1, data: {}, fetchedMonths: [] };
}

async function saveDailyCache(vault: Vault, cache: DailyStatsCache): Promise<void> {
	try {
		const exists = await vault.adapter.exists(CACHE_DIR);
		if (!exists) await vault.adapter.mkdir(CACHE_DIR);
		const json = JSON.stringify(cache);
		// Use adapter.write to always overwrite, avoids "File already exists" race condition
		await vault.adapter.write(CACHE_FILE, json);
	} catch (e) {
		console.error('[weread] Failed to save daily stats cache', e);
	}
}



// ─── 导出 Loading Modal ───────────────────────────────────────────────────────
class ExportLoadingModal extends Modal {
	onOpen() {
		const { contentEl } = this;
		contentEl.addClass('weread-export-loading-modal');
		const wrap = contentEl.createDiv({ cls: 'weread-export-loading-wrap' });
		wrap.createDiv({ cls: 'weread-stats-spinner' });
		wrap.createDiv({ cls: 'weread-export-loading-text', text: '正在生成图片…' });
	}
	onClose() { this.contentEl.empty(); }
}

type ChartView = 'bar' | 'calendar' | 'heatmap';

// ─── 导出预览 Modal ────────────────────────────────────────────────────────────
class ExportPreviewModal extends Modal {
	private dataUrl: string;
	private filename: string;
	private vault: Vault;

	constructor(app: any, dataUrl: string, filename: string, vault: Vault) {
		super(app);
		this.dataUrl = dataUrl;
		this.filename = filename;
		this.vault = vault;
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.addClass('weread-export-modal');

		// Title
		const titleEl = contentEl.createEl('h2', { cls: 'weread-export-title' });
		const titleIcon = titleEl.createSpan({ cls: 'weread-export-title-icon' });
		setIcon(titleIcon, 'image-down');
		titleEl.createSpan({ text: '导出阅读统计图片' });

		// Preview image
		const preview = contentEl.createDiv({ cls: 'weread-export-preview' });
		const img = preview.createEl('img', { cls: 'weread-export-preview-img' });
		img.src = this.dataUrl;

		// Action buttons
		const actions = contentEl.createDiv({ cls: 'weread-export-actions' });

		// 1. Save to Vault
		const vaultBtn = actions.createEl('button', { cls: 'weread-export-action-btn mod-cta' });
		setIcon(vaultBtn.createSpan(), 'vault');
		vaultBtn.createSpan({ text: '保存到 Vault' });
		vaultBtn.addEventListener('click', async () => {
			try {
				const base64 = this.dataUrl.split(',')[1];
				const binary = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
				const settings = get(settingsStore);
				const folder = settings.noteLocation || '/';
				const filePath = folder.replace(/\/$/, '') + '/' + this.filename;
				await this.vault.adapter.writeBinary(filePath, binary.buffer);
				new Notice(`✅ 已保存到 Vault：${filePath}`);
				this.close();
			} catch (e) {
				new Notice('❌ 保存失败：' + e.message);
			}
		});

		// 2. Save to local disk
		const localBtn = actions.createEl('button', { cls: 'weread-export-action-btn' });
		setIcon(localBtn.createSpan(), 'download');
		localBtn.createSpan({ text: '保存到本地' });
		localBtn.addEventListener('click', () => {
			const link = document.createElement('a');
			link.download = this.filename;
			link.href = this.dataUrl;
			link.click();
			this.close();
		});

		// 3. Copy to clipboard
		const copyBtn = actions.createEl('button', { cls: 'weread-export-action-btn' });
		setIcon(copyBtn.createSpan(), 'copy');
		copyBtn.createSpan({ text: '复制到剪切板' });
		copyBtn.addEventListener('click', async () => {
			try {
				const base64 = this.dataUrl.split(',')[1];
				const binary = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
				const blob = new Blob([binary], { type: 'image/png' });
				await navigator.clipboard.write([
					new ClipboardItem({ 'image/png': blob })
				]);
				new Notice('✅ 已复制到剪切板');
				this.close();
			} catch (e) {
				new Notice('❌ 复制失败：' + e.message);
			}
		});
	}

	onClose() {
		this.contentEl.empty();
	}
}

export class WereadReadingStatsView extends ItemView {
	private apiManager: ApiRouter;
	private fileManager: FileManager;
	private currentMode: ReadingStatsMode = 'monthly';
	private currentOffset = 0;
	private data: ReadingStatsResponse | null = null;
	private loading = false;
	private statsEl: HTMLElement;
	// chart view preference per mode
	private chartView: Partial<Record<ReadingStatsMode, ChartView>> = {};
	// in-memory image cache: url -> base64 data url
	private imgCache: Map<string, string> = new Map();

	constructor(leaf: WorkspaceLeaf, apiManager: ApiRouter, fileManager: FileManager) {
		super(leaf);
		this.apiManager = apiManager;
		this.fileManager = fileManager;
	}

	getViewType(): string { return WEREAD_READING_STATS_VIEW_ID; }
	getDisplayText(): string { return '微信读书阅读统计'; }
	getIcon(): string { return 'bar-chart-2'; }

	onMoreOptionsMenu(menu: Menu) {
		menu.addItem((item) =>
			item
				.setTitle('刷新数据')
				.setIcon('refresh-ccw')
				.onClick(() => {
					this.data = null;
					this.loadData();
				})
		);
		menu.addSeparator();
	}

	async onOpen() {
		this.contentEl.empty();
		this.contentEl.addClass('weread-stats-view');
		this.statsEl = this.contentEl.createDiv({ cls: 'weread-stats-container' });
		this.render();
		this.loadData();
	}

	async onClose() {
		this.contentEl.empty();
	}


	private async loadData() {
		const settings = get(settingsStore);
		if (!settings.wereadApiKey) { this.renderNoApiKey(); return; }
		this.loading = true;
		this.renderLoading();

		// Fetch user signature (always refresh on open)
		if (settings.userVid) {
			const userInfo = await this.apiManager.getUserInfo(settings.userVid);
			const parts = [
				(userInfo as any)?.signature,
				(userInfo as any)?.vDesc
			].filter(Boolean);
			const sig = parts.join(' ｜ ');
			if (sig) settingsStore.actions.setUserSignature(sig);
		}

		const baseTime = calcBaseTime(this.currentMode, this.currentOffset);
		const data = await this.apiManager.getReadingStats(this.currentMode, baseTime);
		this.loading = false;
		if (!data) { this.renderError(); return; }
		this.data = data;
		this.render();
	}

	private render() {
		const el = this.statsEl;
		el.empty();
		if (!get(settingsStore).wereadApiKey) { this.renderNoApiKey(); return; }
		if (this.loading) { this.renderLoading(); return; }
		if (!this.data) return;

		this.renderHeader(el);
		this.renderTabBar(el);
		this.renderReadingTimeHero(el, this.data);
		this.renderKPICards(el, this.data);
		this.renderTimeSeries(el, this.data);
		this.renderTopBooks(el, this.data);
		this.renderPreferences(el, this.data);
	}

	// ── Header ────────────────────────────────────────────────────────
	private renderHeader(el: HTMLElement) {
		const header = el.createDiv({ cls: 'weread-stats-header' });
		// Single row: user info on left, export button on right
		const headerRow = header.createDiv({ cls: 'weread-stats-header-row' });

		// Left: avatar + name + signature
		const settings = get(settingsStore);
		const userName = settings.user;
		const userAvatar = settings.userAvatar;
		const userSignature = settings.userSignature;

		const userLeft = headerRow.createDiv({ cls: 'weread-stats-user-left' });
		if (userAvatar) {
			const avatarImg = userLeft.createEl('img', { cls: 'weread-stats-user-avatar' });
			avatarImg.src = userAvatar;
			avatarImg.alt = userName || '用户头像';
		}
		const userTextWrap = userLeft.createDiv({ cls: 'weread-stats-user-text' });
		userTextWrap.createSpan({ cls: 'weread-stats-user-name', text: userName || '微信读书用户' });
		if (userSignature) {
			userTextWrap.createSpan({ cls: 'weread-stats-user-sub', text: userSignature });
		}

		// Right: export button
		if (this.currentMode === 'overall' || this.currentMode === 'annually' || this.currentMode === 'monthly') {
			const exportBtn = headerRow.createEl('button', {
				cls: 'weread-stats-btn weread-stats-export-btn',
				attr: { title: '导出为图片' }
			});
			setIcon(exportBtn, 'image-down');
			exportBtn.createSpan({ text: '导出图片' });
			exportBtn.addEventListener('click', () => this.exportAsImage(exportBtn));
		}
	}

	private async exportAsImage(_btn: HTMLElement) {
		const { toPng } = require('html-to-image');
		const { requestUrl } = require('obsidian');

		// Show loading modal immediately
		const loadingModal = new ExportLoadingModal(this.app);
		loadingModal.open();

		// Hide export button
		const exportBtn = this.statsEl.querySelector<HTMLElement>('.weread-stats-export-btn');
		if (exportBtn) exportBtn.style.display = 'none';

		// Pre-fetch images — use in-memory cache to avoid re-fetching on repeat exports
		const imgs = Array.from(this.statsEl.querySelectorAll<HTMLImageElement>('img'));
		const origSrcs: string[] = imgs.map(img => img.src);
		await Promise.allSettled(imgs.map(async (img, i) => {
			const src = origSrcs[i];
			if (!src || src.startsWith('data:')) return;
			try {
				if (!this.imgCache.has(src)) {
					const resp = await requestUrl({ url: src, method: 'GET' });
					const mime = resp.headers['content-type'] || 'image/jpeg';
					const b64 = btoa(String.fromCharCode(...new Uint8Array(resp.arrayBuffer)));
					this.imgCache.set(src, `data:${mime};base64,${b64}`);
				}
				img.src = this.imgCache.get(src)!;
			} catch { /* keep original */ }
		}));

		// Inline SVG fill/stroke from computed styles
		type SvgRestore = { el: SVGElement; fill: string | null; stroke: string | null; style: string };
		const svgRestores: SvgRestore[] = [];
		this.statsEl.querySelectorAll<SVGElement>('svg, svg *').forEach(el => {
			const cs = getComputedStyle(el);
			const fill = cs.fill;
			const stroke = cs.stroke;
			svgRestores.push({ el, fill: el.getAttribute('fill'), stroke: el.getAttribute('stroke'), style: el.getAttribute('style') || '' });
			el.setAttribute('fill', fill || 'none');
			el.setAttribute('stroke', stroke || 'none');
			const styleAttr = el.getAttribute('style') || '';
			if (styleAttr.includes('var(') || styleAttr.includes('color-mix(')) {
				el.setAttribute('style', styleAttr
					.replace(/fill\s*:[^;]+/g, `fill:${fill}`)
					.replace(/stroke\s*:[^;]+/g, `stroke:${stroke}`)
				);
			}
		});

		// Capture dimensions BEFORE any style changes
		const captureWidth = this.statsEl.offsetWidth;
		const captureHeight = this.statsEl.scrollHeight;

		// Expand scroll container
		const scrollEl = this.contentEl as HTMLElement;
		const origOverflow = scrollEl.style.overflow;
		const origHeight = scrollEl.style.height;
		scrollEl.style.overflow = 'visible';
		scrollEl.style.height = 'auto';

		// Reset scroll offsets on ancestors
		const scrollParents: { el: Element; left: number; top: number }[] = [];
		let ancestor: Element | null = this.statsEl.parentElement;
		while (ancestor && ancestor !== document.body) {
			if (ancestor.scrollLeft !== 0 || ancestor.scrollTop !== 0) {
				scrollParents.push({ el: ancestor, left: ancestor.scrollLeft, top: ancestor.scrollTop });
				(ancestor as HTMLElement).scrollLeft = 0;
				(ancestor as HTMLElement).scrollTop = 0;
			}
			ancestor = ancestor.parentElement;
		}

		try {
			const dataUrl = await toPng(this.statsEl, {
				pixelRatio: 1.5,
				width: captureWidth,
				height: captureHeight,
				skipFonts: true,
				cacheBust: false,
				style: {
					overflow: 'visible',
					position: 'fixed',
					left: '0',
					top: '0',
					margin: '0',
				},
			});
			loadingModal.close();
			new ExportPreviewModal(this.app, dataUrl, this.exportFilename(), this.app.vault).open();
		} catch (e) {
			loadingModal.close();
			console.error('导出图片失败', e);
			new Notice('❌ 导出图片失败：' + e.message);
		} finally {
			if (exportBtn) exportBtn.style.display = '';
			imgs.forEach((img, i) => { img.src = origSrcs[i]; });
			svgRestores.forEach(({ el, fill, stroke, style }) => {
				if (fill === null) el.removeAttribute('fill'); else el.setAttribute('fill', fill);
				if (stroke === null) el.removeAttribute('stroke'); else el.setAttribute('stroke', stroke);
				if (style === '') el.removeAttribute('style'); else el.setAttribute('style', style);
			});
			scrollParents.forEach(({ el, left, top }) => {
				(el as HTMLElement).scrollLeft = left;
				(el as HTMLElement).scrollTop = top;
			});
			scrollEl.style.overflow = origOverflow;
			scrollEl.style.height = origHeight;
		}
	}

	private exportFilename(): string {
		const now = new Date();
		const date = `${now.getFullYear()}${String(now.getMonth()+1).padStart(2,'0')}${String(now.getDate()).padStart(2,'0')}`;
		const time = `${String(now.getHours()).padStart(2,'0')}${String(now.getMinutes()).padStart(2,'0')}${String(now.getSeconds()).padStart(2,'0')}`;
		return `weread-stats-${date}_${time}.png`;
	}

	// ── Tab bar + 时间导航 ────────────────────────────────────────────
	private renderTabBar(el: HTMLElement) {
		const tabs: { mode: ReadingStatsMode; label: string }[] = [
			{ mode: 'weekly', label: '周' },
			{ mode: 'monthly', label: '月' },
			{ mode: 'annually', label: '年' },
			{ mode: 'overall', label: '全部' },
		];
		const nav = el.createDiv({ cls: 'weread-stats-nav' });
		const bar = nav.createDiv({ cls: 'weread-stats-tabbar' });
		for (const tab of tabs) {
			const btn = bar.createEl('button', {
				text: tab.label,
				cls: 'weread-stats-tab' + (this.currentMode === tab.mode ? ' is-active' : '')
			});
			btn.addEventListener('click', () => {
				if (this.currentMode === tab.mode) return;
				this.currentMode = tab.mode;
				this.currentOffset = 0;
				this.data = null;
				this.render();
				this.loadData();
			});
		}

		if (this.currentMode !== 'overall') {
			const timePicker = nav.createDiv({ cls: 'weread-stats-timepicker' });
			const prevBtn = timePicker.createEl('button', { cls: 'weread-stats-timepicker-btn' });
			setIcon(prevBtn, 'chevron-left');
			prevBtn.addEventListener('click', () => { this.currentOffset--; this.data = null; this.render(); this.loadData(); });
			timePicker.createSpan({ cls: 'weread-stats-timepicker-label', text: periodLabel(this.currentMode, this.currentOffset) });
			const nextBtn = timePicker.createEl('button', { cls: 'weread-stats-timepicker-btn' + (this.currentOffset >= 0 ? ' is-disabled' : '') });
			setIcon(nextBtn, 'chevron-right');
			if (this.currentOffset >= 0) nextBtn.setAttribute('disabled', 'true');
			nextBtn.addEventListener('click', () => { if (this.currentOffset >= 0) return; this.currentOffset++; this.data = null; this.render(); this.loadData(); });
		}
	}

	// ── Hero 阅读时长 ──────────────────────────────────────────────────
	private renderReadingTimeHero(el: HTMLElement, data: ReadingStatsResponse) {
		const hero = el.createDiv({ cls: 'weread-stats-hero' });

		// 大数字：X小时 Y分钟，分别用不同字号
		const h = Math.floor(data.totalReadTime / 3600);
		const m = Math.floor((data.totalReadTime % 3600) / 60);
		const numRow = hero.createDiv({ cls: 'weread-stats-hero-num' });
		if (h > 0) {
			numRow.createSpan({ cls: 'weread-stats-hero-big', text: String(h) });
			numRow.createSpan({ cls: 'weread-stats-hero-unit', text: '小时' });
		}
		if (m > 0 || h === 0) {
			numRow.createSpan({ cls: 'weread-stats-hero-big', text: String(m) });
			numRow.createSpan({ cls: 'weread-stats-hero-unit', text: '分钟' });
		}

		// 副标题：不同模式展示不同信息
		// overall 模式 API 不返回 dayAverageReadTime，自己算
		const avgReadTime = data.dayAverageReadTime || (data.readDays > 0 ? Math.round(data.totalReadTime / data.readDays) : 0);
		const subtitleParts: string[] = [];
		if (this.currentMode === 'overall' && data.registTime) {
			subtitleParts.push(fmtTs(data.registTime) + '至今');
			subtitleParts.push(`日均阅读 ${fmtDuration(avgReadTime)}`);
			subtitleParts.push(`与微信读书相伴 ${data.readDays} 天`);
		} else if (this.currentMode === 'annually') {
			subtitleParts.push(`日均阅读 ${fmtDuration(avgReadTime)}`);
			if (data.compare !== undefined) {
				const c = fmtCompare(data.compare);
				if (c) subtitleParts.push(`比去年 ${c.up ? '↑' : '↓'}${c.text}`);
			}
		} else if (this.currentMode === 'monthly') {
			subtitleParts.push(`日均阅读 ${fmtDuration(avgReadTime)}`);
			if (data.compare !== undefined) {
				const c = fmtCompare(data.compare);
				if (c) subtitleParts.push(`比上月 ${c.up ? '↑' : '↓'}${c.text}`);
			}
		} else if (this.currentMode === 'weekly') {
			subtitleParts.push(`日均阅读 ${fmtDuration(avgReadTime)}`);
			if (data.compare !== undefined) {
				const c = fmtCompare(data.compare);
				if (c) subtitleParts.push(`比上周 ${c.up ? '↑' : '↓'}${c.text}`);
			}
		}

		if (subtitleParts.length > 0) {
			hero.createDiv({ cls: 'weread-stats-hero-sub', text: subtitleParts.join(' · ') });
		}
	}

	// ── KPI Cards（去掉阅读时长）─────────────────────────────────────
	private renderKPICards(el: HTMLElement, data: ReadingStatsResponse) {
		const grid = el.createDiv({ cls: 'weread-stats-kpi-grid' });
		this.makeKPICard(grid, '阅读天数', `${data.readDays} 天`, 'calendar');

		// overall 模式不返回 dayAverageReadTime，跳过
		if (this.currentMode !== 'overall') {
			this.makeKPICard(grid, '日均时长', fmtDuration(data.dayAverageReadTime), 'trending-up',
				data.compare !== undefined ? fmtCompare(data.compare) : null);
		}

		// 周模式不展示读过/读完/笔记（API 不返回有意义的数据）
		if (this.currentMode !== 'weekly') {
			const readStat = data.readStat ?? [];
			const readCount = readStat.find(s => s.stat === '读过')?.counts ?? '—';
			const finishCount = readStat.find(s => s.stat === '读完')?.counts ?? '—';
			const noteCount = readStat.find(s => s.stat === '笔记')?.counts ?? '—';
			this.makeKPICard(grid, '读过', readCount, 'book-open');
			this.makeKPICard(grid, '读完', finishCount, 'check-circle');
			this.makeKPICard(grid, '笔记', noteCount, 'pencil');
		}
	}

	private makeKPICard(parent: HTMLElement, label: string, value: string, iconName: string, compare?: { text: string; up: boolean } | null) {
		const card = parent.createDiv({ cls: 'weread-stats-kpi-card' });
		const iconEl = card.createDiv({ cls: 'weread-stats-kpi-icon' });
		setIcon(iconEl, iconName);
		const body = card.createDiv({ cls: 'weread-stats-kpi-body' });
		// Split number from unit so only the number is enlarged
		const valueEl = body.createDiv({ cls: 'weread-stats-kpi-value' });
		const match = value.match(/^([\d]+)(.*)/);
		if (match) {
			valueEl.createSpan({ cls: 'weread-stats-kpi-number', text: match[1] });
			if (match[2]) valueEl.createSpan({ cls: 'weread-stats-kpi-unit', text: match[2] });
		} else {
			valueEl.setText(value);
		}
		const labelRow = body.createDiv({ cls: 'weread-stats-kpi-label-row' });
		labelRow.createSpan({ text: label, cls: 'weread-stats-kpi-label' });
		if (compare) {
			labelRow.createSpan({
				cls: 'weread-stats-compare-badge ' + (compare.up ? 'is-up' : 'is-down'),
				text: (compare.up ? '↑' : '↓') + compare.text
			});
		}
	}

	// ── Time Series ───────────────────────────────────────────────────
	private renderTimeSeries(el: HTMLElement, data: ReadingStatsResponse) {
		if (!data.readTimes || Object.keys(data.readTimes).length === 0) return;

		const section = el.createDiv({ cls: 'weread-stats-section' });

		// Section title row with view toggle buttons
		const titleRow = section.createDiv({ cls: 'weread-stats-section-title-row' });
		const availableViews = this.getAvailableViews();
		const currentView = this.chartView[this.currentMode] ?? this.getDefaultView(this.currentMode);
		const modeLabel: Record<ReadingStatsMode, string> = {
			weekly: '每日阅读时长', monthly: '每日阅读时长',
			annually: '每月阅读时长', overall: '每年阅读时长'
		};
		// 年份tab下，heatmap视图显示每日，bar/calendar视图显示每月
		const sectionTitle = this.currentMode === 'annually' && currentView === 'heatmap'
			? '每日阅读时长'
			: modeLabel[this.currentMode];
		titleRow.createEl('h3', { text: sectionTitle, cls: 'weread-stats-section-title' });

		if (availableViews.length > 1) {
			const toggleGroup = titleRow.createDiv({ cls: 'weread-stats-view-toggle' });
			const viewIcons: Record<ChartView, string> = { bar: 'bar-chart-2', calendar: 'calendar-days', heatmap: 'layout-grid' };
			const viewTitles: Record<ChartView, string> = { bar: '柱状图', calendar: '日历', heatmap: '热力图' };
			for (const v of availableViews) {
				const btn = toggleGroup.createEl('button', {
					cls: 'weread-stats-view-toggle-btn' + (currentView === v ? ' is-active' : ''),
					attr: { title: viewTitles[v] }
				});
				setIcon(btn, viewIcons[v]);
				btn.addEventListener('click', () => {
					this.chartView[this.currentMode] = v;
					this.render();
				});
			}
		}

		const chartArea = section.createDiv({ cls: 'weread-stats-chart-area' });

		if (currentView === 'calendar' && this.currentMode === 'monthly') {
			this.renderMonthCalendar(chartArea, data.readTimes);
		} else if (currentView === 'heatmap' && this.currentMode === 'annually') {
			this.renderYearHeatmap(chartArea, data);
		} else if (currentView === 'heatmap' && this.currentMode === 'overall') {
			this.renderOverallHeatmap(chartArea, data);
		} else {
			// bar chart
			let values: number[];
			let labels: string[];
			if (this.currentMode === 'weekly') {
				const baseTime = calcBaseTime('weekly', this.currentOffset);
				const built = buildWeekValues(data.readTimes, baseTime);
				values = built.values;
				labels = built.labels;
			} else {
				if (this.currentMode === 'monthly') {
					// Build full month: all days including future/unread ones
					const baseTime = calcBaseTime('monthly', this.currentOffset);
					const refDate = baseTime ? new Date(baseTime * 1000) : new Date();
					const year = refDate.getFullYear();
					const month = refDate.getMonth();
					const daysInMonth = new Date(year, month + 1, 0).getDate();
					const dayMap: Record<number, number> = {};
					for (const [ts, secs] of Object.entries(data.readTimes)) {
						const d = new Date(Number(ts) * 1000);
						if (d.getFullYear() === year && d.getMonth() === month) {
							dayMap[d.getDate()] = secs as number;
						}
					}
					values = [];
					labels = [];
					for (let day = 1; day <= daysInMonth; day++) {
						values.push(dayMap[day] ?? 0);
						labels.push(String(day));
					}
				} else {
					const entries = Object.entries(data.readTimes).sort(([a], [b]) => Number(a) - Number(b));
					values = entries.map(([, v]) => v as number);
					labels = entries.map(([ts]) => {
						const d = new Date(Number(ts) * 1000);
						if (this.currentMode === 'overall') return `${d.getFullYear()}`;
						if (this.currentMode === 'annually') return `${d.getMonth() + 1}月`;
						return `${d.getDate()}`;
					});
				}
			}
			this.renderBarChart(chartArea, values, labels);
		}
	}

	private getAvailableViews(): ChartView[] {
		if (this.currentMode === 'monthly') return ['bar', 'calendar'];
		if (this.currentMode === 'annually') return ['heatmap', 'bar'];
		if (this.currentMode === 'overall') return ['heatmap', 'bar'];
		return ['bar'];
	}

	private getDefaultView(mode: ReadingStatsMode): ChartView {
		if (mode === 'monthly') return 'bar';
		if (mode === 'annually') return 'heatmap';
		if (mode === 'overall') return 'heatmap';
		return 'bar';
	}

	// ── Month Calendar ────────────────────────────────────────────────
	private renderMonthCalendar(parent: HTMLElement, readTimes: Record<string, number>) {
		// Determine year/month from baseTime or current date
		const baseTime = calcBaseTime('monthly', this.currentOffset);
		const refDate = baseTime ? new Date(baseTime * 1000) : new Date();
		const year = refDate.getFullYear();
		const month = refDate.getMonth(); // 0-indexed

		// Build a map: day (1-31) -> seconds
		const dayMap: Record<number, number> = {};
		for (const [ts, secs] of Object.entries(readTimes)) {
			const d = new Date(Number(ts) * 1000);
			if (d.getFullYear() === year && d.getMonth() === month) {
				dayMap[d.getDate()] = secs as number;
			}
		}
		const dayValues = Object.values(dayMap).filter(v => v > 0);
		const maxVal = percentile(dayValues, 95);

		const cal = parent.createDiv({ cls: 'weread-calendar' });

		// Weekday headers (Mon - Sun)
		const dayNames = ['一', '二', '三', '四', '五', '六', '日'];
		const headerRow = cal.createDiv({ cls: 'weread-calendar-header' });
		for (const d of dayNames) {
			headerRow.createDiv({ cls: 'weread-calendar-dow', text: d });
		}

		// First day of month (0=Sun..6=Sat) → convert to Mon-based (0=Mon..6=Sun)
		const firstDow = new Date(year, month, 1).getDay();
		const startOffset = firstDow === 0 ? 6 : firstDow - 1;
		const daysInMonth = new Date(year, month + 1, 0).getDate();
		const today = new Date();

		const grid = cal.createDiv({ cls: 'weread-calendar-grid' });

		// Empty cells before first day
		for (let i = 0; i < startOffset; i++) {
			grid.createDiv({ cls: 'weread-calendar-cell is-empty' });
		}

		for (let day = 1; day <= daysInMonth; day++) {
			const secs = dayMap[day] ?? 0;
			const intensity = maxVal > 0 ? Math.min(secs / maxVal, 1) : 0;
			const cell = grid.createDiv({ cls: 'weread-calendar-cell' });

			// Intensity level 0-4
			const level = secs === 0 ? 0 : Math.max(1, Math.ceil(intensity * 4));
			cell.addClass(`weread-cal-level-${level}`);

			const isToday = today.getFullYear() === year && today.getMonth() === month && today.getDate() === day;
			if (isToday) cell.addClass('is-today');

			cell.createDiv({ cls: 'weread-calendar-day', text: String(day) });
			if (secs > 0) {
				cell.createDiv({ cls: 'weread-calendar-duration', text: fmtDuration(secs) });
			}
			if (secs > 0) {
				cell.setAttribute('title', `${month + 1}月${day}日：${fmtDuration(secs)}`);
			}
		}

		// Fill trailing empty cells to complete the last row
		const totalCells = startOffset + daysInMonth;
		const remainder = totalCells % 7;
		if (remainder !== 0) {
			for (let i = 0; i < 7 - remainder; i++) {
				grid.createDiv({ cls: 'weread-calendar-cell is-empty' });
			}
		}

	}

	// ── Year Heatmap via cal-heatmap ──────────────────────────────────
	private renderYearHeatmap(parent: HTMLElement, data: ReadingStatsResponse) {
		if ((data as any)._dailyReadTimes) {
			this.renderCalHeatmap(parent, (data as any)._dailyReadTimes, data.readDays);
		} else {
			const placeholder = parent.createDiv({ cls: 'weread-heatmap-loading' });
			placeholder.createDiv({ cls: 'weread-stats-spinner weread-stats-spinner-sm' });
			placeholder.createDiv({ text: '正在加载全年日数据…', cls: 'weread-stats-empty-text' });
			this.loadAnnualDailyData(data);
		}
	}

	private async loadAnnualDailyData(data: ReadingStatsResponse) {
		const baseTime = calcBaseTime('annually', this.currentOffset);
		const refDate = baseTime ? new Date(baseTime * 1000) : new Date();
		const year = refDate.getFullYear();
		const today = new Date();

		const cache = await loadDailyCache(this.app.vault);
		let dirty = false;
		const BATCH = 6;

		const monthTimestamps = Array.from({ length: 12 }, (_, m) =>
			Math.floor(new Date(year, m, 1).getTime() / 1000)
		);

		// If cache has data for this year, render immediately
		const cachedYearData: Record<string, number> = {};
		for (const [k, v] of Object.entries(cache.data)) {
			if (k.startsWith(`${year}-`)) cachedYearData[k] = v;
		}
		if (Object.keys(cachedYearData).length > 0) {
			(data as any)._dailyReadTimes = cachedYearData;
			this.render();
		}

		// Only fetch months not yet cached (skip future months)
		const toFetch = monthTimestamps.filter(ts => {
			const d = new Date(ts * 1000);
			const key = `${d.getFullYear()}-${d.getMonth()}`;
			// Always re-fetch current month (data may change), skip past months if cached
			const isCurrentMonth = d.getFullYear() === today.getFullYear() && d.getMonth() === today.getMonth();
			const isFuture = d > today;
			return !isFuture && (isCurrentMonth || !cache.fetchedMonths.includes(key));
		});

		if (toFetch.length === 0) return;

		for (let i = 0; i < toFetch.length; i += BATCH) {
			const results = await Promise.all(
				toFetch.slice(i, i + BATCH).map(ts => this.apiManager.getReadingStats('monthly', ts))
			);
			for (let j = 0; j < results.length; j++) {
				const res = results[j];
				const ts = toFetch[i + j];
				const d = new Date(ts * 1000);
				const monthKey = `${d.getFullYear()}-${d.getMonth()}`;
				if (!res?.readTimes) continue;
				for (const [dayTs, secs] of Object.entries(res.readTimes)) {
					const dd = new Date(Number(dayTs) * 1000);
					cache.data[`${dd.getFullYear()}-${dd.getMonth()}-${dd.getDate()}`] = secs as number;
				}
				if (!cache.fetchedMonths.includes(monthKey)) {
					cache.fetchedMonths.push(monthKey);
				}
				dirty = true;
			}
		}

		if (dirty) await saveDailyCache(this.app.vault, cache);

		// Build dailyMap from cache for this year
		const dailyMap: Record<string, number> = {};
		for (const [k, v] of Object.entries(cache.data)) {
			if (k.startsWith(`${year}-`)) dailyMap[k] = v;
		}
		(data as any)._dailyReadTimes = dailyMap;
		this.render();
	}

	// ── Overall Heatmap (all years) ────────────────────────────────────
	private renderOverallHeatmap(parent: HTMLElement, data: ReadingStatsResponse) {
		if ((data as any)._allDailyReadTimes) {
			this.renderAllYearsHeatmap(parent, (data as any)._allDailyReadTimes, data);
		} else {
			const placeholder = parent.createDiv({ cls: 'weread-heatmap-loading' });
			placeholder.createDiv({ cls: 'weread-stats-spinner weread-stats-spinner-sm' });
			placeholder.createDiv({ text: '正在加载全部阅读数据…', cls: 'weread-stats-empty-text' });
			this.loadOverallDailyData(data);
		}
	}

	private async loadOverallDailyData(data: ReadingStatsResponse) {
		const today = new Date();
		const endYear = today.getFullYear();
		const settings = get(settingsStore);
		const startYear = settings.statsStartYear && settings.statsStartYear > 2000
			? settings.statsStartYear
			: data.registTime
				? new Date(data.registTime * 1000).getFullYear()
				: endYear - 2;

		// Collect all month timestamps from startYear to now
		const monthTimestamps: number[] = [];
		for (let y = startYear; y <= endYear; y++) {
			for (let m = 0; m < 12; m++) {
				monthTimestamps.push(Math.floor(new Date(y, m, 1).getTime() / 1000));
			}
		}

		const cache = await loadDailyCache(this.app.vault);
		let dirty = false;
		const BATCH = 6;

		// If cache has data, render immediately with cached data, then refresh current month in background
		const hasCachedData = Object.keys(cache.data).length > 0;
		if (hasCachedData) {
			(data as any)._allDailyReadTimes = { ...cache.data };
			(data as any)._statsStartYear = startYear;
			this.render();
		}

		// Only fetch uncached months (always re-fetch current month)
		const toFetch = monthTimestamps.filter(ts => {
			const d = new Date(ts * 1000);
			const key = `${d.getFullYear()}-${d.getMonth()}`;
			const isCurrentMonth = d.getFullYear() === today.getFullYear() && d.getMonth() === today.getMonth();
			const isFuture = d > today;
			return !isFuture && (isCurrentMonth || !cache.fetchedMonths.includes(key));
		});

		if (toFetch.length === 0) {
			// Everything cached, just ensure rendered
			if (!hasCachedData) {
				(data as any)._allDailyReadTimes = cache.data;
				(data as any)._statsStartYear = startYear;
				this.render();
			}
			return;
		}

		for (let i = 0; i < toFetch.length; i += BATCH) {
			const results = await Promise.all(
				toFetch.slice(i, i + BATCH).map(ts => this.apiManager.getReadingStats('monthly', ts))
			);
			for (let j = 0; j < results.length; j++) {
				const res = results[j];
				const ts = toFetch[i + j];
				const d = new Date(ts * 1000);
				const monthKey = `${d.getFullYear()}-${d.getMonth()}`;
				if (!res?.readTimes) continue;
				for (const [dayTs, secs] of Object.entries(res.readTimes)) {
					const dd = new Date(Number(dayTs) * 1000);
					cache.data[`${dd.getFullYear()}-${dd.getMonth()}-${dd.getDate()}`] = secs as number;
				}
				if (!cache.fetchedMonths.includes(monthKey)) {
					cache.fetchedMonths.push(monthKey);
				}
				dirty = true;
			}
			if (i + BATCH < toFetch.length) {
				await new Promise(r => setTimeout(r, 200));
			}
		}

		if (dirty) await saveDailyCache(this.app.vault, cache);

		(data as any)._allDailyReadTimes = cache.data;
		(data as any)._statsStartYear = startYear;
		this.render();
	}

	private renderAllYearsHeatmap(parent: HTMLElement, dailyMap: Record<string, number>, data: ReadingStatsResponse) {
		const today = new Date();
		const endYear = today.getFullYear();
		const settings = get(settingsStore);
		const startYear = (data as any)._statsStartYear
			?? (settings.statsStartYear && settings.statsStartYear > 2000
				? settings.statsStartYear
				: data.registTime
					? new Date(data.registTime * 1000).getFullYear()
					: endYear - 2);

		// dailyMap keys are already "YYYY-M-D" format from cache
		const dayMap = dailyMap;

		// Use p95 to avoid extreme outliers (e.g. all-day audio) skewing colours
		const globalMax = percentile(Object.values(dayMap).filter(v => v > 0), 95);
		const getLevel = (secs: number) => {
			if (secs === 0) return 0;
			const ratio = Math.min(secs / globalMax, 1);
			if (ratio < 0.25) return 1;
			if (ratio < 0.50) return 2;
			if (ratio < 0.75) return 3;
			return 4;
		};

		const wrap = parent.createDiv({ cls: 'weread-allheatmap-wrap' });

		for (let year = endYear; year >= startYear; year--) {
			const yearWrap = wrap.createDiv({ cls: 'weread-allheatmap-year' });
			yearWrap.createDiv({ cls: 'weread-allheatmap-yearlabel', text: String(year) });
			this.renderCalHeatmapInto(yearWrap, dayMap, year, today, getLevel);
		}

		// Legend
		const legend = wrap.createDiv({ cls: 'weread-ghmap-legend' });
		legend.createSpan({ cls: 'weread-ghmap-legend-text', text: '少' });
		for (let l = 0; l <= 4; l++) {
			legend.createDiv({ cls: `weread-ghmap-cell weread-ghmap-legend-cell level-${l}` });
		}
		legend.createSpan({ cls: 'weread-ghmap-legend-text', text: '多' });
	}

	private renderCalHeatmapInto(
		parent: HTMLElement,
		dayMap: Record<string, number>,
		year: number,
		today: Date,
		getLevel: (secs: number) => number
	) {
		const allDays: { date: Date; secs: number }[] = [];
		for (let m = 0; m < 12; m++) {
			const daysInMonth = new Date(year, m + 1, 0).getDate();
			for (let d = 1; d <= daysInMonth; d++) {
				const date = new Date(year, m, d);
				allDays.push({ date, secs: dayMap[`${year}-${m}-${d}`] ?? 0 });
			}
		}

		const firstDow = allDays[0].date.getDay();
		const startPad = firstDow === 0 ? 6 : firstDow - 1;
		const paddedDays: ({ date: Date; secs: number } | null)[] = [
			...Array(startPad).fill(null),
			...allDays,
		];
		const totalWeeks = Math.ceil(paddedDays.length / 7);

		// Month → first week index
		const monthWeek: Record<number, number> = {};
		for (let w = 0; w < totalWeeks; w++) {
			for (let dow = 0; dow < 7; dow++) {
				const item = paddedDays[w * 7 + dow];
				if (!item) continue;
				const mo = item.date.getMonth();
				if (!(mo in monthWeek)) monthWeek[mo] = w;
			}
		}

		const inner = parent.createDiv({ cls: 'weread-ghmap-inner' });

		// Weekday labels
		const labelsCol = inner.createDiv({ cls: 'weread-ghmap-daylabels' });
		const dayLabels = ['一', '三', '五'];
		const dayRows = [0, 2, 4];
		for (let i = 0; i < 7; i++) {
			const idx = dayRows.indexOf(i);
			labelsCol.createDiv({ cls: 'weread-ghmap-daylabel', text: idx >= 0 ? dayLabels[idx] : '' });
		}

		const rightCol = inner.createDiv({ cls: 'weread-ghmap-right' });

		// Month labels
		const monthRow = rightCol.createDiv({ cls: 'weread-ghmap-months' });
		for (let w = 0; w < totalWeeks; w++) {
			const mo = Object.entries(monthWeek).find(([, wk]) => wk === w);
			monthRow.createDiv({ cls: 'weread-ghmap-monthlabel', text: mo ? `${Number(mo[0]) + 1}月` : '' });
		}

		// Cell grid
		const grid = rightCol.createDiv({ cls: 'weread-ghmap-grid' });

		for (let w = 0; w < totalWeeks; w++) {
			const col = grid.createDiv({ cls: 'weread-ghmap-col' });
			for (let dow = 0; dow < 7; dow++) {
				const item = paddedDays[w * 7 + dow];
				if (!item) { col.createDiv({ cls: 'weread-ghmap-cell is-empty' }); continue; }
				const { date, secs } = item;
				const level = getLevel(secs);
				const isToday = date.toDateString() === today.toDateString();
				const cell = col.createDiv({ cls: `weread-ghmap-cell level-${level}${isToday ? ' is-today' : ''}` });
				const label = `${date.getMonth() + 1}月${date.getDate()}日`;
				cell.title = secs > 0 ? `${label}：${fmtDuration(secs)}` : label;
			}
		}
	}

	private renderCalHeatmap(parent: HTMLElement, dailyMap: Record<string, number>, apiReadDays?: number) {
		const baseTime = calcBaseTime('annually', this.currentOffset);
		const refDate = baseTime ? new Date(baseTime * 1000) : new Date();
		const year = refDate.getFullYear();
		const today = new Date();

		// Keys are already "year-month-day" strings (0-indexed month), use directly
		const dayMap: Record<string, number> = dailyMap;

		// Per-year p95 for colour scale (avoids outliers like all-day audio)
		const yearVals = Object.entries(dayMap)
			.filter(([k]) => k.startsWith(`${year}-`))
			.map(([, v]) => v).filter(v => v > 0);
		const maxVal = percentile(yearVals, 95);
		const getLevel = (secs: number) => {
			if (secs === 0) return 0;
			const ratio = Math.min(secs / maxVal, 1);
			if (ratio < 0.25) return 1;
			if (ratio < 0.50) return 2;
			if (ratio < 0.75) return 3;
			return 4;
		};

		const wrap = parent.createDiv({ cls: 'weread-ghmap-wrap' });
		this.renderCalHeatmapInto(wrap, dayMap, year, today, getLevel);

		// Legend
		const legend = wrap.createDiv({ cls: 'weread-ghmap-legend' });
		legend.createSpan({ cls: 'weread-ghmap-legend-text', text: '少' });
		for (let l = 0; l <= 4; l++) {
			legend.createDiv({ cls: `weread-ghmap-cell weread-ghmap-legend-cell level-${l}` });
		}
		legend.createSpan({ cls: 'weread-ghmap-legend-text', text: '多' });

		// Summary
		const allDays = Object.entries(dayMap).filter(([k]) => k.startsWith(`${year}-`));
		const displayReadDays = apiReadDays ?? allDays.filter(([, v]) => v > 0).length;
		const totalSecs = allDays.reduce((s, [, v]) => s + v, 0);
		wrap.createDiv({
			cls: 'weread-heatmap-summary',
			text: `${year} 年共阅读 ${displayReadDays} 天，累计 ${fmtDuration(totalSecs)}`
		});
	}


	// ── Bar Chart (SVG) with Y-axis scale ────────────────────────────
	private renderBarChart(parent: HTMLElement, values: number[], labels: string[]) {
		const rawMax = Math.max(...values, 1);
		const maxVal = niceMax(rawMax);
		const gap = 4;
		const chartH = 140;
		const topPad = 14;  // space above the top tick label
		const labelH = 22;
		const scaleW = 52; // left gutter

		const wrapper = parent.createDiv({ cls: 'weread-stats-chart-wrapper' });

		const n = values.length;
		const barAreaW = 600;
		const barW = Math.max(8, Math.floor(barAreaW / n) - gap);
		const totalViewW = scaleW + barAreaW;
		const totalViewH = topPad + chartH + labelH;

		const svg = wrapper.createSvg('svg', {
			attr: {
				viewBox: `0 0 ${totalViewW} ${totalViewH}`,
				width: '100%',
				height: totalViewH,
				class: 'weread-stats-bar-chart',
				preserveAspectRatio: 'xMidYMid meet'
			}
		});

		// Y-axis: 0, 50%, 100% — offset down by topPad
		const tickFractions = [0, 0.5, 1];
		for (const frac of tickFractions) {
			const tickVal = maxVal * frac;
			const yPos = topPad + chartH - frac * chartH;
			svg.createSvg('line', {
				attr: { x1: String(scaleW), y1: String(yPos), x2: String(totalViewW), y2: String(yPos), class: 'weread-stats-scale-line' }
			});
			const lbl = svg.createSvg('text', {
				attr: { x: String(scaleW - 4), y: String(yPos + 4), 'text-anchor': 'end', class: 'weread-stats-scale-label' }
			});
			lbl.textContent = niceTickLabel(tickVal);
		}

		// Bars
		values.forEach((v, i) => {
			const barH = Math.max((v / maxVal) * chartH, v > 0 ? 4 : 0);
			const slotW = barAreaW / n;
			const x = scaleW + i * slotW + (slotW - barW) / 2;
			const y = topPad + chartH - barH;

			const rect = svg.createSvg('rect', {
				attr: { x: String(x), y: String(y), width: String(barW), height: String(barH), rx: '4', class: 'weread-stats-bar' + (v === rawMax && v > 0 ? ' is-max' : '') }
			});
			rect.createSvg('title').textContent = `${labels[i]}: ${fmtDuration(v)}`;

			const text = svg.createSvg('text', {
				attr: { x: String(x + barW / 2), y: String(topPad + chartH + labelH - 2), 'text-anchor': 'middle', class: 'weread-stats-bar-label' }
			});
			text.textContent = labels[i];
		});
	}

	// ── Top Books ─────────────────────────────────────────────────────
	private renderTopBooks(el: HTMLElement, data: ReadingStatsResponse) {
		if (!data.readLongest?.length) return;

		const section = el.createDiv({ cls: 'weread-stats-section' });
		section.createEl('h3', { text: `阅读时长 Top ${data.readLongest.length}`, cls: 'weread-stats-section-title' });

		const maxTime = Math.max(...data.readLongest.map(b => b.readTime), 1);
		const list = section.createDiv({ cls: 'weread-stats-book-list' });

		data.readLongest.forEach((item, i) => {
			const title = item.book?.title ?? item.albumInfo?.name ?? '未知';
			const author = item.book?.author ?? item.albumInfo?.authorName ?? '';
			const cover = item.book?.cover ?? item.albumInfo?.cover ?? '';
			const bookId = item.book?.bookId ?? item.albumInfo?.albumId ?? '';
			const pct = (item.readTime / maxTime) * 100;

			const row = list.createDiv({ cls: 'weread-stats-book-row' });
			row.createDiv({ cls: 'weread-stats-book-rank', text: String(i + 1) });

			if (cover) {
				const img = row.createEl('img', { cls: 'weread-stats-book-cover' });
				img.src = cover; img.alt = title;
			} else {
				const ph = row.createDiv({ cls: 'weread-stats-book-cover weread-stats-book-cover-placeholder' });
				setIcon(ph, 'book');
			}

			const info = row.createDiv({ cls: 'weread-stats-book-info' });
			info.createDiv({ cls: 'weread-stats-book-title', text: title });
			if (author) info.createDiv({ cls: 'weread-stats-book-author', text: author });
			if (item.tags?.length) {
				const tagRow = info.createDiv({ cls: 'weread-stats-book-tags' });
				item.tags.forEach(tag => tagRow.createSpan({ cls: 'weread-stats-tag', text: tag }));
			}

			const right = row.createDiv({ cls: 'weread-stats-book-right' });
			right.createDiv({ cls: 'weread-stats-book-duration', text: fmtDuration(item.readTime) });
			const barTrack = right.createDiv({ cls: 'weread-stats-mini-bar-track' });
			barTrack.createDiv({ cls: 'weread-stats-mini-bar-fill' }).style.width = `${pct}%`;

			if (bookId) {
				row.addClass('weread-stats-book-row-clickable');
				row.addEventListener('click', async () => {
					const map = await this.fileManager.getNotebookFilesByBookId();
					const f = map.get(bookId);
					if (f?.file instanceof TFile) {
						await this.app.workspace.getLeaf(false).openFile(f.file);
					}
				});
			}
		});
	}

	// ── Preferences ───────────────────────────────────────────────────
	private renderPreferences(el: HTMLElement, data: ReadingStatsResponse) {
		const hasCat = data.preferCategory?.some(c => c.readingTime > 0);
		const hasAuthor = data.preferAuthor?.length;
		const hasTime = data.preferTime?.length === 24;
		const hasPublisher = data.preferPublisher?.length;
		if (!hasCat && !hasAuthor && !hasTime && !hasPublisher) return;

		const section = el.createDiv({ cls: 'weread-stats-section' });
		section.createEl('h3', { text: '偏好分析', cls: 'weread-stats-section-title' });
		const prefGrid = section.createDiv({ cls: 'weread-stats-pref-grid' });

		// ── 阅读时段（全宽柱状图）
		if (hasTime) {
			const timeCard = prefGrid.createDiv({ cls: 'weread-stats-pref-card weread-stats-pref-card-wide' });
			const timeHeader = timeCard.createDiv({ cls: 'weread-stats-pref-card-header' });
			setIcon(timeHeader.createSpan(), 'clock');
			timeHeader.createSpan({ text: '阅读时段分布' });
			if (data.preferTimeWord) {
				timeCard.createDiv({ cls: 'weread-stats-pref-subtitle', text: data.preferTimeWord });
			}
			this.renderHourBarChart(timeCard, data.preferTime!);
		}

		// ── 分类偏好（饼图）+ 出版方（标签云）并排
		if (hasCat || hasPublisher) {
			// 分类饼图
			if (hasCat) {
				const cats = data.preferCategory.filter(c => c.readingTime > 0);
				const catCard = prefGrid.createDiv({ cls: 'weread-stats-pref-card' });
				const catHeader = catCard.createDiv({ cls: 'weread-stats-pref-card-header' });
				setIcon(catHeader.createSpan(), 'tag');
				catHeader.createSpan({ text: '分类偏好' });
				if (data.preferCategoryWord) {
					catCard.createDiv({ cls: 'weread-stats-pref-subtitle', text: data.preferCategoryWord });
				}
				this.renderPieChart(catCard, cats.slice(0, 8).map(c => ({ label: c.categoryTitle, value: c.readingTime })));
			}

			// 出版方标签云（与分类同行，非全宽）
			if (hasPublisher) {
				const pubCard = prefGrid.createDiv({ cls: 'weread-stats-pref-card' });
				const pubHeader = pubCard.createDiv({ cls: 'weread-stats-pref-card-header' });
				setIcon(pubHeader.createSpan(), 'building-2');
				pubHeader.createSpan({ text: '偏好出版方' });
				this.renderTagCloud(pubCard, data.preferPublisher!.slice(0, 20));
			}
		}

		// ── 偏好作者（进度条）
		if (hasAuthor) {
			const authorCard = prefGrid.createDiv({ cls: 'weread-stats-pref-card' });
			const authorHeader = authorCard.createDiv({ cls: 'weread-stats-pref-card-header' });
			setIcon(authorHeader.createSpan(), 'user');
			authorHeader.createSpan({ text: '偏好作者' });
			const maxCount = Math.max(...data.preferAuthor!.map(a => a.count), 1);
			data.preferAuthor!.slice(0, 6).forEach(a => {
				const row = authorCard.createDiv({ cls: 'weread-stats-pref-row weread-stats-pref-row-author' });
				row.createSpan({ cls: 'weread-stats-pref-name', text: a.name });
				const barWrap = row.createDiv({ cls: 'weread-stats-pref-bar-track' });
				barWrap.createDiv({ cls: 'weread-stats-pref-bar-fill' }).style.width = `${(a.count / maxCount) * 100}%`;
				row.createSpan({ cls: 'weread-stats-pref-meta', text: `${a.count}本` });
			});
		}
	}

	/** 24h 阅读时段柱状图，带时段分区色 */
	private renderHourBarChart(parent: HTMLElement, preferTime: number[]) {
		const maxVal = Math.max(...preferTime, 1);
		const chartH = 60;
		const labelH = 18;
		const n = 24;
		const barAreaW = 600;
		const gap = 2;
		const barW = Math.floor(barAreaW / n) - gap;
		const totalViewW = barAreaW;

		// Time-of-day segments: 凌晨 0-5(idx 18-23), 上午 6-11(0-5), 下午 12-17(6-11), 晚上 18-23(12-17)
		const segColor = (i: number): string => {
			if (i < 6) return 'var(--weread-hour-morning)';   // 6-11
			if (i < 12) return 'var(--weread-hour-afternoon)'; // 12-17
			if (i < 18) return 'var(--weread-hour-evening)';   // 18-23
			return 'var(--weread-hour-night)';                  // 0-5
		};

		const wrapper = parent.createDiv({ cls: 'weread-stats-chart-wrapper' });
		const svg = wrapper.createSvg('svg', {
			attr: {
				viewBox: `0 0 ${totalViewW} ${chartH + labelH}`,
				width: '100%', height: chartH + labelH,
				class: 'weread-stats-bar-chart', preserveAspectRatio: 'xMidYMid meet'
			}
		});

		preferTime.forEach((v, i) => {
			const barH = Math.max((v / maxVal) * chartH, v > 0 ? 2 : 0);
			const slotW = barAreaW / n;
			const x = i * slotW + (slotW - barW) / 2;
			const y = chartH - barH;

			const rect = svg.createSvg('rect', {
				attr: { x: String(x), y: String(y), width: String(barW), height: String(barH), rx: '2', class: 'weread-stats-hour-seg-bar' }
			});
			(rect as SVGElement).setAttribute('style', `fill: ${segColor(i)}`);
			rect.createSvg('title').textContent = `${HOUR_LABELS[i]}时: ${fmtDuration(v)}`;

			// Show label every 3 hours
			if (i % 3 === 0) {
				const text = svg.createSvg('text', {
					attr: { x: String(x + barW / 2), y: String(chartH + labelH - 2), 'text-anchor': 'middle', class: 'weread-stats-bar-label' }
				});
				text.textContent = HOUR_LABELS[i];
			}
		});

		// Legend
		const legend = parent.createDiv({ cls: 'weread-stats-hour-legend' });
		[['凌晨', 'var(--weread-hour-night)'], ['上午', 'var(--weread-hour-morning)'], ['下午', 'var(--weread-hour-afternoon)'], ['晚上', 'var(--weread-hour-evening)']].forEach(([label, color]) => {
			const item = legend.createDiv({ cls: 'weread-stats-hour-legend-item' });
			const dot = item.createDiv({ cls: 'weread-stats-hour-legend-dot' });
			dot.style.background = color;
			item.createSpan({ text: label, cls: 'weread-stats-hour-legend-label' });
		});
	}

	/** SVG 雷达图（蜘蛛网图），带渐变填充 */
	private renderPieChart(parent: HTMLElement, items: { label: string; value: number }[]) {
		if (items.length < 3) return;
		const n = items.length;
		const size = 160;
		const cx = size / 2, cy = size / 2;
		const maxR = size / 2 - 28; // 留出边距给标签
		const maxVal = Math.max(...items.map(i => i.value), 1);

		const svg = parent.createSvg('svg', {
			attr: { width: '100%', viewBox: `0 0 ${size} ${size}`, class: 'weread-stats-radar-svg', preserveAspectRatio: 'xMidYMid meet', style: 'background:transparent' }
		});

		// 定义渐变
		const defs = svg.createSvg('defs');
		const grad = defs.createSvg('radialGradient');
		grad.setAttribute('id', 'radarGrad');
		grad.setAttribute('cx', '50%'); grad.setAttribute('cy', '50%'); grad.setAttribute('r', '50%');
		const stop1 = grad.createSvg('stop');
		stop1.setAttribute('offset', '0%'); stop1.setAttribute('stop-color', '#90c8f8'); stop1.setAttribute('stop-opacity', '0.9');
		const stop2 = grad.createSvg('stop');
		stop2.setAttribute('offset', '100%'); stop2.setAttribute('stop-color', '#c8e6fc'); stop2.setAttribute('stop-opacity', '0.4');

		// 坐标计算（从顶部开始，顺时针）
		const angle = (i: number) => (2 * Math.PI * i) / n - Math.PI / 2;
		const pt = (i: number, r: number) => ({
			x: cx + r * Math.cos(angle(i)),
			y: cy + r * Math.sin(angle(i))
		});

		// 背景网格圆（3 圈）
		for (let ring = 1; ring <= 3; ring++) {
			const r = (maxR * ring) / 3;
			const pts = Array.from({ length: n }, (_, i) => pt(i, r));
			const poly = svg.createSvg('polygon');
			poly.setAttribute('points', pts.map(p => `${p.x},${p.y}`).join(' '));
			poly.setAttribute('class', 'weread-stats-radar-ring');
		}

		// 轴线
		for (let i = 0; i < n; i++) {
			const end = pt(i, maxR);
			const line = svg.createSvg('line');
			line.setAttribute('x1', String(cx)); line.setAttribute('y1', String(cy));
			line.setAttribute('x2', String(end.x)); line.setAttribute('y2', String(end.y));
			line.setAttribute('class', 'weread-stats-radar-axis');
		}

		// 数据多边形
		const dataPts = items.map((item, i) => pt(i, (item.value / maxVal) * maxR));
		const poly = svg.createSvg('polygon');
		poly.setAttribute('points', dataPts.map(p => `${p.x},${p.y}`).join(' '));
		poly.setAttribute('class', 'weread-stats-radar-area');
		poly.setAttribute('fill', 'url(#radarGrad)');

		// 数据点
		dataPts.forEach((p, i) => {
			const circle = svg.createSvg('circle');
			circle.setAttribute('cx', String(p.x)); circle.setAttribute('cy', String(p.y));
			circle.setAttribute('r', '3'); circle.setAttribute('class', 'weread-stats-radar-dot');
			circle.createSvg('title').textContent = `${items[i].label}: ${fmtDuration(items[i].value)}`;
		});

		// 轴标签（大值加粗）
		const sortedVals = items.map(i => i.value).sort((a, b) => b - a);
		const top2 = new Set(sortedVals.slice(0, 2));
		items.forEach((item, i) => {
			const labelR = maxR + 14;
			const p = pt(i, labelR);
			const text = svg.createSvg('text');
			text.setAttribute('x', String(p.x)); text.setAttribute('y', String(p.y));
			text.setAttribute('text-anchor', 'middle'); text.setAttribute('dominant-baseline', 'middle');
			const isTop = top2.has(item.value);
			text.setAttribute('class', isTop ? 'weread-stats-radar-label is-top' : 'weread-stats-radar-label');
			text.textContent = item.label;
		});
	}

	/** 出版方标签云 */
	private renderTagCloud(parent: HTMLElement, publishers: { name: string; count: number }[]) {
		const maxCount = Math.max(...publishers.map(p => p.count), 1);
		const cloud = parent.createDiv({ cls: 'weread-stats-tag-cloud' });
		publishers.forEach(p => {
			const ratio = p.count / maxCount;
			const size = Math.round(11 + ratio * 10); // 11px ~ 21px
			const opacity = 0.5 + ratio * 0.5;
			const span = cloud.createSpan({ cls: 'weread-stats-cloud-tag', text: p.name });
			span.style.fontSize = `${size}px`;
			span.style.opacity = String(opacity);
			span.title = `${p.name}: ${p.count}本`;
		});
	}

	// ── Empty states ──────────────────────────────────────────────────
	private renderLoading() {
		this.statsEl.empty();
		const wrap = this.statsEl.createDiv({ cls: 'weread-stats-empty' });
		wrap.createDiv({ cls: 'weread-stats-spinner' });
		wrap.createDiv({ text: '正在加载数据…', cls: 'weread-stats-empty-text' });
	}

	private renderNoApiKey() {
		this.statsEl.empty();
		const wrap = this.statsEl.createDiv({ cls: 'weread-stats-empty' });
		setIcon(wrap.createDiv({ cls: 'weread-stats-empty-icon' }), 'key');
		wrap.createDiv({ text: '请先在设置中填写微信读书 API Key', cls: 'weread-stats-empty-text' });
		wrap.createDiv({ text: '设置 → 微信读书 → 阅读统计 → API Key', cls: 'weread-stats-empty-hint' });
	}

	private renderError() {
		this.statsEl.empty();
		const wrap = this.statsEl.createDiv({ cls: 'weread-stats-empty' });
		setIcon(wrap.createDiv({ cls: 'weread-stats-empty-icon' }), 'alert-circle');
		wrap.createDiv({ text: '数据加载失败，请检查 API Key 或网络', cls: 'weread-stats-empty-text' });
		const retryBtn = wrap.createEl('button', { text: '重试', cls: 'weread-stats-btn' });
		retryBtn.addEventListener('click', () => this.loadData());
	}
}
