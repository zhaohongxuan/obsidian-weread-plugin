import './wereadReadingStats.css';
import { getDailyReadingInsights, niceTickLabel } from '../statsInsights';
import { App, ItemView, Menu, Modal, Notice, WorkspaceLeaf, setIcon, TFile, Vault } from 'obsidian';
import ApiRouter from '../api-router';
import FileManager from '../fileManager';
import { settingsStore } from '../settings';
import { get } from 'svelte/store';
import type { ReadingStatsResponse, ReadingStatsMode } from '../models';
import { WereadPanel } from './wereadPanel';

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

/** 判断某个「月初时间戳」对应的月份是否已经完全过完（今天已进入下一月） */
function isMonthOver(monthStart: Date, now: Date): boolean {
	return new Date(monthStart.getFullYear(), monthStart.getMonth() + 1, 0, 23, 59, 59, 999) < now;
}

function periodLabel(mode: ReadingStatsMode, offset: number): string {
	if (mode === 'overall') return '全部';
	const now = new Date();
	if (mode === 'weekly') {
		const dow = now.getDay() === 0 ? 6 : now.getDay() - 1;
		const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - dow + offset * 7);
		const sunday = new Date(monday);
		sunday.setDate(sunday.getDate() + 6);
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

// ─── Daily stats disk cache ───────────────────────────────────────────────────

const CACHE_DIR = '.weread-cache';
const CACHE_FILE = `${CACHE_DIR}/daily-stats.json`;
const CACHE_VERSION = 2;

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
			const cache = JSON.parse(raw) as DailyStatsCache;
			if (cache.version !== CACHE_VERSION) migrateDailyCache(cache);
			return cache;
		}
	} catch (_) { /* ignore */ }
	return { version: CACHE_VERSION, data: {}, fetchedMonths: [] };
}

/**
 * v1 → v2 迁移：v1 会把「抓取时尚未结束的当月」也标记为已抓取，而当前月只能拿到
 * 截至当天的数据，跨月后该月不再被补抓，热力图于是留下固定缺口。
 * 这里按「该月数据是否覆盖到月末」找出不完整的月份，剔除其标记让它们重抓一次。
 */
function migrateDailyCache(cache: DailyStatsCache): void {
	const incomplete = new Set<string>();
	const monthsWithData = new Set<string>();
	const lastDay: Record<string, number> = {};
	for (const key of Object.keys(cache.data)) {
		const [y, m, d] = key.split('-').map(Number);
		const month = `${y}-${m}`;
		monthsWithData.add(month);
		lastDay[month] = Math.max(lastDay[month] ?? 0, d);
	}
	// 数据没有盖到月末（含抓取当天就断掉的月份）
	for (const [month, maxDay] of Object.entries(lastDay)) {
		const [y, m] = month.split('-').map(Number);
		if (maxDay < new Date(y, m + 1, 0).getDate()) incomplete.add(month);
	}
	// 有标记却一天数据都没有的月份（空响应被误标）
	for (const key of cache.fetchedMonths) {
		if (!monthsWithData.has(key)) incomplete.add(key);
	}
	cache.fetchedMonths = cache.fetchedMonths.filter(k => !incomplete.has(k));
	cache.version = CACHE_VERSION;
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
	private panel: WereadReadingStatsPanel | null = null;

	constructor(
		leaf: WorkspaceLeaf,
		private apiManager: ApiRouter,
		private fileManager: FileManager
	) {
		super(leaf);
	}

	getViewType(): string {
		return WEREAD_READING_STATS_VIEW_ID;
	}
	getDisplayText(): string {
		return '微信读书阅读统计';
	}
	getIcon(): string {
		return 'bar-chart-2';
	}
	onMoreOptionsMenu(menu: Menu): void {
		this.panel?.onMoreOptionsMenu(menu);
	}

	async onOpen(): Promise<void> {
		if (this.panel) return;
		const panel = new WereadReadingStatsPanel(
			this.contentEl,
			this.app,
			this.apiManager,
			this.fileManager
		);
		this.panel = panel;
		this.addChild(panel);
		await panel.onOpen();
	}

	async onClose(): Promise<void> {
		const panel = this.panel;
		this.panel = null;
		if (panel) this.removeChild(panel);
	}
}

export class WereadReadingStatsPanel extends WereadPanel {
	private apiManager: ApiRouter;
	private fileManager: FileManager;
	private currentMode: ReadingStatsMode = 'monthly';
	private currentOffset = 0;
	private data: ReadingStatsResponse | null = null;
	private loading = false;
	private closed = false;
	private loadGeneration = 0;
	private chartResizeObserver: ResizeObserver | null = null;
	private statsEl: HTMLElement;
	// chart view preference per mode
	private chartView: Partial<Record<ReadingStatsMode, ChartView>> = {};
	// in-memory image cache: url -> base64 data url
	private imgCache: Map<string, string> = new Map();

	constructor(contentEl: HTMLElement, app: App, apiManager: ApiRouter, fileManager: FileManager) {
		super(contentEl, app);
		this.apiManager = apiManager;
		this.fileManager = fileManager;
	}

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
		this.closed = false;
		this.contentEl.empty();
		this.contentEl.addClass('weread-stats-view');
		this.statsEl = this.contentEl.createDiv({ cls: 'weread-stats-container' });
		this.render();
		this.loadData();
	}

	async onClose() {
		if (this.closed) return;
		this.closed = true;
		this.loadGeneration++;
		this.disconnectChartResize();
		this.contentEl.empty();
	}


	private async loadData() {
		if (this.closed) return;
		const generation = ++this.loadGeneration;
		const settings = get(settingsStore);
		if (!settings.wereadApiKey) { this.renderNoApiKey(); return; }
		this.loading = true;
		this.renderLoading();
		const mode = this.currentMode;
		const baseTime = calcBaseTime(mode, this.currentOffset);
		try {
			if (settings.userVid) {
				const userInfo = await this.apiManager.getUserInfo(settings.userVid);
				if (this.closed || generation !== this.loadGeneration) return;
				const parts = [(userInfo as any)?.signature, (userInfo as any)?.vDesc].filter(Boolean);
				const sig = parts.join(' ｜ ');
				if (sig) settingsStore.actions.setUserSignature(sig);
			}
			const data = await this.apiManager.getReadingStats(mode, baseTime);
			if (this.closed || generation !== this.loadGeneration) return;
			this.loading = false;
			if (!data) { this.renderError(); return; }
			this.data = data;
			this.render();
		} catch (error) {
			if (this.closed || generation !== this.loadGeneration) return;
			this.loading = false;
			console.error('[weread] Failed to load reading stats', error);
			this.renderError();
		}
	}

	private isCurrentData(data: ReadingStatsResponse, generation: number): boolean {
		return !this.closed && generation === this.loadGeneration && this.data === data;
	}

	private disconnectChartResize() {
		this.chartResizeObserver?.disconnect();
		this.chartResizeObserver = null;
	}

	private render() {
		if (this.closed) return;
		this.disconnectChartResize();
		const el = this.statsEl;
		el.empty();
		if (!get(settingsStore).wereadApiKey) { this.renderNoApiKey(); return; }
		if (this.loading) { this.renderLoading(); return; }
		if (!this.data) return;

		this.renderHeader(el);
		this.renderTabBar(el);
		const overview = el.createDiv({ cls: 'weread-stats-overview' });
		this.renderReadingTimeHero(overview, this.data);
		this.renderKPICards(overview, this.data);
		this.renderRhythm(el, this.data);
		const content = el.createDiv({ cls: 'weread-stats-content-grid' });
		this.renderTimeSeries(content, this.data);
		this.renderTopBooks(content, this.data);
		this.renderPreferences(el, this.data);
	}

	// ── Header ────────────────────────────────────────────────────────
	private renderHeader(el: HTMLElement) {
		const header = el.createDiv({ cls: 'weread-stats-header' });
		header.createDiv({ cls: 'weread-stats-eyebrow', text: '阅读手记 · 统计' });
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
				attr: { title: '导出为图片', 'aria-label': '导出阅读统计图片' }
			});
			setIcon(exportBtn, 'image-down');
			exportBtn.createSpan({ text: '导出图片' });
			exportBtn.addEventListener('click', () => this.exportAsImage(exportBtn));
		}
	}

	private async exportAsImage(_btn: HTMLElement) {
		if (this.closed) return;
		const generation = this.loadGeneration;
		const isCurrent = () => !this.closed && generation === this.loadGeneration;
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
				if (isCurrent()) img.src = this.imgCache.get(src)!;
			} catch { /* keep original */ }
		}));
		if (!isCurrent()) { loadingModal.close(); return; }

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
			if (isCurrent()) new ExportPreviewModal(this.app, dataUrl, this.exportFilename(), this.app.vault).open();
		} catch (e) {
			loadingModal.close();
			if (!isCurrent()) return;
			console.error('导出图片失败', e);
			new Notice('❌ 导出图片失败：' + e.message);
		} finally {
			if (!this.closed) {
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
				cls: 'weread-stats-tab' + (this.currentMode === tab.mode ? ' is-active' : ''),
				attr: { 'aria-label': `${tab.label}阅读统计`, 'aria-pressed': String(this.currentMode === tab.mode) }
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
			prevBtn.setAttribute('aria-label', '上一时段');
			prevBtn.addEventListener('click', () => { this.currentOffset--; this.data = null; this.render(); this.loadData(); });
			timePicker.createSpan({ cls: 'weread-stats-timepicker-label', text: periodLabel(this.currentMode, this.currentOffset) });
			const nextBtn = timePicker.createEl('button', { cls: 'weread-stats-timepicker-btn' + (this.currentOffset >= 0 ? ' is-disabled' : '') });
			setIcon(nextBtn, 'chevron-right');
			nextBtn.setAttribute('aria-label', '下一时段');
			if (this.currentOffset >= 0) nextBtn.setAttribute('disabled', 'true');
			nextBtn.addEventListener('click', () => { if (this.currentOffset >= 0) return; this.currentOffset++; this.data = null; this.render(); this.loadData(); });
		}
	}

	// ── Hero 阅读时长 ──────────────────────────────────────────────────
	private renderReadingTimeHero(el: HTMLElement, data: ReadingStatsResponse) {
		const hero = el.createDiv({ cls: 'weread-stats-hero' });
		hero.createSpan({ cls: 'weread-stats-hero-label', text: '阅读时长' });

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
		const avgReadTime = this.currentMode !== 'overall' && Number.isFinite(data.dayAverageReadTime)
			? data.dayAverageReadTime
			: (data.readDays > 0 ? Math.round(data.totalReadTime / data.readDays) : 0);
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

	private renderRhythm(el: HTMLElement, data: ReadingStatsResponse) {
		if (this.currentMode !== 'weekly' && this.currentMode !== 'monthly') return;
		const insights = getDailyReadingInsights(data.readTimes, this.currentMode,
			calcBaseTime(this.currentMode, this.currentOffset)!);
		const section = el.createDiv({ cls: 'weread-stats-section weread-stats-rhythm' });
		section.createEl('h3', { cls: 'weread-stats-section-title', text: '阅读节奏' });
		if (!insights.hasData) {
			section.createDiv({ cls: 'weread-stats-empty-text', text: '这个时段暂无每日阅读记录' });
			return;
		}
		const grid = section.createDiv({ cls: 'weread-stats-rhythm-grid' });
		const metric = (label: string, value: string, caption: string) => {
			const item = grid.createDiv({ cls: 'weread-stats-rhythm-item' });
			item.createSpan({ text: label });
			item.createEl('strong', { text: value });
			item.createEl('small', { text: caption });
		};
		metric('最长连续阅读', `${insights.longestStreak} 天`, '所选时段内，连续有阅读时长的天数');
		const peak = insights.peakDay;
		metric('阅读最多的一天', peak ? `${peak.date.getMonth() + 1}月${peak.date.getDate()}日` : '—',
			peak ? fmtDuration(peak.seconds) : '暂无阅读时长');
		metric('有阅读记录的天数', `${insights.activeDays} / ${insights.elapsedDays} 天`, this.currentOffset === 0 ? '按每日记录统计，截至今天' : '按每日记录统计，覆盖完整时段');
	}

	// ── Time Series ───────────────────────────────────────────────────
	private renderTimeSeries(el: HTMLElement, data: ReadingStatsResponse) {
		if (!data.readTimes || Object.keys(data.readTimes).length === 0) return;

		const section = el.createDiv({ cls: 'weread-stats-section weread-stats-trend' });

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
					attr: { title: viewTitles[v], 'aria-label': viewTitles[v], 'aria-pressed': String(currentView === v) }
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
			if (this.currentMode === 'weekly' || this.currentMode === 'monthly') {
				const insights = getDailyReadingInsights(data.readTimes, this.currentMode,
					calcBaseTime(this.currentMode, this.currentOffset)!);
				values = insights.days.map(day => day.seconds);
				labels = insights.days.map(day => `${day.date.getMonth() + 1}月${day.date.getDate()}日`);
			} else {
				const entries = Object.entries(data.readTimes)
					.filter(([ts, value]) => Number.isFinite(Number(ts)) && Number.isFinite(new Date(Number(ts) * 1000).getTime()) && Number.isFinite(value) && value >= 0)
					.sort(([a], [b]) => Number(a) - Number(b));
				values = entries.map(([, value]) => value);
				labels = entries.map(([ts]) => {
					const date = new Date(Number(ts) * 1000);
					return this.currentMode === 'overall' ? `${date.getFullYear()}年` : `${date.getMonth() + 1}月`;
				});
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

		// Reuse validated, summed daily buckets so calendar and rhythm agree.
		const dayMap: Record<number, number> = {};
		const insights = getDailyReadingInsights(readTimes, 'monthly', baseTime!);
		for (const day of insights.days) dayMap[day.date.getDate()] = day.seconds;
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
		const generation = this.loadGeneration;
		if (!this.isCurrentData(data, generation)) return;
		const baseTime = calcBaseTime('annually', this.currentOffset);
		const refDate = baseTime ? new Date(baseTime * 1000) : new Date();
		const year = refDate.getFullYear();
		const today = new Date();

		const cache = await loadDailyCache(this.app.vault);
		if (!this.isCurrentData(data, generation)) return;
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
			if (!this.isCurrentData(data, generation)) return;
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
				// 已过完的月份才算抓全：当前月只能拿到「截至今天」的数据，
				// 此时打标记会让该月跨月后永不补全
				if (isMonthOver(d, today) && !cache.fetchedMonths.includes(monthKey)) {
					cache.fetchedMonths.push(monthKey);
				}
				dirty = true;
			}
			if (i + BATCH < toFetch.length) {
				await new Promise(r => setTimeout(r, 200));
			}
		}

		if (dirty) await saveDailyCache(this.app.vault, cache);
		if (!this.isCurrentData(data, generation)) return;

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
		const generation = this.loadGeneration;
		if (!this.isCurrentData(data, generation)) return;
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
		if (!this.isCurrentData(data, generation)) return;
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
			if (!this.isCurrentData(data, generation)) return;
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
				// 同 loadAnnualDailyData：未过完的当月不打标记，避免跨月后无法补全
				if (isMonthOver(d, today) && !cache.fetchedMonths.includes(monthKey)) {
					cache.fetchedMonths.push(monthKey);
				}
				dirty = true;
			}
			if (i + BATCH < toFetch.length) {
				await new Promise(r => setTimeout(r, 200));
				if (!this.isCurrentData(data, generation)) return;
			}
		}

		if (dirty) await saveDailyCache(this.app.vault, cache);
		if (!this.isCurrentData(data, generation)) return;

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
			monthRow.createDiv({ cls: 'weread-ghmap-monthlabel', text: mo ? String(Number(mo[0]) + 1) : '' });
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
		const initialWidth = Math.max(wrapper.clientWidth || 600, 240);
		const barAreaW = initialWidth - scaleW;
		const barW = Math.min(28, Math.max(2, Math.floor(barAreaW / Math.max(n, 1)) - gap));
		const totalViewW = initialWidth;
		const totalViewH = topPad + chartH + labelH;

		const svg = wrapper.createSvg('svg', {
			attr: {
				viewBox: `0 0 ${totalViewW} ${totalViewH}`,
				width: '100%',
				height: totalViewH,
				class: 'weread-stats-bar-chart',
				preserveAspectRatio: 'xMidYMid meet',
				role: 'group',
				'aria-label': '阅读时长图表，使用左右方向键选择时段'
			}
		});
		const detail = parent.createDiv({ cls: 'weread-stats-chart-detail' });
		detail.setAttribute('aria-live', 'polite');
		const bars: SVGElement[] = [];
		const barLabels: SVGElement[] = [];
		const gridLines: SVGElement[] = [];
		const selectBar = (index: number) => {
			detail.setText(`${labels[index]} · ${fmtDuration(values[index])}`);
			bars.forEach((bar, i) => {
				bar.classList.toggle('is-selected', i === index);
				bar.setAttribute('tabindex', i === index ? '0' : '-1');
				bar.setAttribute('aria-pressed', String(i === index));
			});
		};

		// Y-axis: 0, 50%, 100% — offset down by topPad
		const tickFractions = [0, 0.5, 1];
		for (const frac of tickFractions) {
			const tickVal = maxVal * frac;
			const yPos = topPad + chartH - frac * chartH;
			gridLines.push(svg.createSvg('line', {
				attr: { x1: String(scaleW), y1: String(yPos), x2: String(totalViewW), y2: String(yPos), class: 'weread-stats-scale-line' }
			}));
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
			const y = topPad + chartH - Math.max(barH, 3);

			const rect = svg.createSvg('rect', {
				attr: { x: String(x), y: String(y), width: String(barW), height: String(Math.max(barH, 3)), rx: '4', role: 'button', tabindex: '-1', 'aria-label': `${labels[i]}：${fmtDuration(v)}`, class: 'weread-stats-bar' + (v === 0 ? ' is-empty' : '') + (v === rawMax && v > 0 ? ' is-max' : '') }
			});
			rect.createSvg('title').textContent = `${labels[i]}: ${fmtDuration(v)}`;
			bars.push(rect);
			for (const event of ['mouseenter', 'pointerdown', 'focus', 'click']) {
				rect.addEventListener(event, () => selectBar(i));
			}
			rect.addEventListener('keydown', event => {
				const key = (event as KeyboardEvent).key;
				let next = i;
				if (key === 'ArrowRight') next = Math.min(n - 1, i + 1);
				else if (key === 'ArrowLeft') next = Math.max(0, i - 1);
				else if (key === 'Home') next = 0;
				else if (key === 'End') next = n - 1;
				else if (key !== 'Enter' && key !== ' ') return;
				event.preventDefault();
				selectBar(next);
				bars[next].focus();
			});

			const text = svg.createSvg('text', {
				attr: { x: String(x + barW / 2), y: String(topPad + chartH + labelH - 2), 'text-anchor': 'middle', class: 'weread-stats-bar-label' }
			});
			barLabels.push(text);
		});
		if (n > 0) selectBar(Math.max(0, values.indexOf(Math.max(...values))));
		let lastWidth = 0;
		const resizeChart = () => {
			if (this.closed) return;
			const width = Math.max(wrapper.clientWidth || 600, 240);
			if (width === lastWidth) return;
			lastWidth = width;
			const area = width - scaleW;
			const slot = area / Math.max(n, 1);
			const resizedBarWidth = Math.min(28, Math.max(2, slot - gap));
			const labelCapacity = Math.max(2, Math.floor(area / 50));
			const labelStep = Math.max(1, Math.ceil(n / labelCapacity));
			svg.setAttribute('viewBox', `0 0 ${width} ${totalViewH}`);
			gridLines.forEach(line => line.setAttribute('x2', String(width)));
			bars.forEach((bar, index) => {
				const center = scaleW + (index + 0.5) * slot;
				bar.setAttribute('x', String(center - resizedBarWidth / 2));
				bar.setAttribute('width', String(resizedBarWidth));
				const label = barLabels[index];
				label.setAttribute('x', String(center));
				const isLast = index === n - 1;
				label.setAttribute('text-anchor', isLast ? 'end' : 'middle');
				const showRegular = index % labelStep === 0 &&
					(!isLast && (n - 1 - index) * slot >= 50);
				label.textContent = isLast || showRegular ? labels[index] : '';
			});
		};
		resizeChart();
		if (typeof ResizeObserver !== 'undefined') {
			this.disconnectChartResize();
			this.chartResizeObserver = new ResizeObserver(resizeChart);
			this.chartResizeObserver.observe(wrapper);
		}
	}

	// ── Top Books ─────────────────────────────────────────────────────
	private renderTopBooks(el: HTMLElement, data: ReadingStatsResponse) {
		if (!data.readLongest?.length) return;

		const section = el.createDiv({ cls: 'weread-stats-section weread-stats-ranking' });
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
				row.setAttribute('role', 'button');
				row.setAttribute('tabindex', '0');
				row.setAttribute('aria-label', `打开《${title}》的本地笔记`);
				const openLocalBook = async () => {
					const map = await this.fileManager.getNotebookFilesByBookId();
					const f = map.get(bookId);
					if (f?.file instanceof TFile) {
						await this.app.workspace.getLeaf(false).openFile(f.file);
					}
				};
				row.addEventListener('click', openLocalBook);
				row.addEventListener('keydown', event => {
					if (event.key === 'Enter' || event.key === ' ') {
						event.preventDefault();
						void openLocalBook();
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

		// 分类在左，出版方与作者在右侧纵向排列。
		if (hasCat) {
			const cats = data.preferCategory.filter(c => c.readingTime > 0);
			const catCard = prefGrid.createDiv({ cls: 'weread-stats-pref-card' });
			const catHeader = catCard.createDiv({ cls: 'weread-stats-pref-card-header' });
			setIcon(catHeader.createSpan(), 'tag');
			catHeader.createSpan({ text: '分类偏好' });
			if (data.preferCategoryWord) {
				catCard.createDiv({ cls: 'weread-stats-pref-subtitle', text: data.preferCategoryWord });
			}
			this.renderCategoryBars(catCard, cats.map(c => ({ label: c.categoryTitle, value: c.readingTime })));
		}
		const secondary = hasPublisher || hasAuthor
			? prefGrid.createDiv({ cls: 'weread-stats-pref-secondary' })
			: prefGrid;
		if (!hasCat && (hasPublisher || hasAuthor)) secondary.style.gridColumn = '1 / -1';
		if (hasPublisher) {
			const pubCard = secondary.createDiv({ cls: 'weread-stats-pref-card' });
			const pubHeader = pubCard.createDiv({ cls: 'weread-stats-pref-card-header' });
			setIcon(pubHeader.createSpan(), 'building-2');
			pubHeader.createSpan({ text: '偏好出版方' });
			this.renderTagCloud(pubCard, data.preferPublisher!.slice(0, 20));
		}

		// ── 偏好作者（进度条）
		if (hasAuthor) {
			const authorCard = secondary.createDiv({ cls: 'weread-stats-pref-card' });
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

	/** Category shares use all positive category time, including the grouped remainder. */
	private renderCategoryBars(parent: HTMLElement, items: { label: string; value: number }[]) {
		const sorted = items.filter(item => Number.isFinite(item.value) && item.value > 0)
			.sort((a, b) => b.value - a.value);
		const total = sorted.reduce((sum, item) => sum + item.value, 0);
		if (!total || !Number.isFinite(total)) return;
		const displayed = sorted.slice(0, 6);
		if (sorted.length > 6) {
			displayed.push({ label: '其他', value: sorted.slice(6).reduce((sum, item) => sum + item.value, 0) });
		}
		const list = parent.createDiv({ cls: 'weread-stats-category-list' });
		for (const item of displayed) {
			const percent = item.value / total * 100;
			const row = list.createDiv({ cls: 'weread-stats-category-row' });
			row.createSpan({ cls: 'weread-stats-category-label', text: item.label });
			row.createEl('small', {
				cls: 'weread-stats-category-meta',
				text: `${fmtDuration(item.value)} · ${percent.toFixed(1)}%`
			});
			const track = row.createDiv({ cls: 'weread-stats-category-track' });
			track.createDiv({ cls: 'weread-stats-category-fill' }).style.width = `${percent}%`;
		}
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
		this.disconnectChartResize();
		this.statsEl.empty();
		const wrap = this.statsEl.createDiv({ cls: 'weread-stats-empty' });
		wrap.createDiv({ cls: 'weread-stats-spinner' });
		wrap.createDiv({ text: '正在加载数据…', cls: 'weread-stats-empty-text' });
	}

	private renderNoApiKey() {
		this.disconnectChartResize();
		this.statsEl.empty();
		const wrap = this.statsEl.createDiv({ cls: 'weread-stats-empty' });
		setIcon(wrap.createDiv({ cls: 'weread-stats-empty-icon' }), 'key');
		wrap.createDiv({ text: '请先在设置中填写微信读书 API Key', cls: 'weread-stats-empty-text' });
		wrap.createDiv({ text: '设置 → 微信读书 → 阅读统计 → API Key', cls: 'weread-stats-empty-hint' });
	}

	private renderError() {
		this.disconnectChartResize();
		this.statsEl.empty();
		const wrap = this.statsEl.createDiv({ cls: 'weread-stats-empty' });
		setIcon(wrap.createDiv({ cls: 'weread-stats-empty-icon' }), 'alert-circle');
		wrap.createDiv({ text: '数据加载失败，请检查 API Key 或网络', cls: 'weread-stats-empty-text' });
		const retryBtn = wrap.createEl('button', { text: '重试', cls: 'weread-stats-btn' });
		retryBtn.addEventListener('click', () => this.loadData());
	}
}
