import { ItemView, WorkspaceLeaf, setIcon, TFile } from 'obsidian';
import ApiManager from '../api';
import SyncReadingStats from '../syncReadingStats';
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

// preferTime 从 6 点开始排列
const HOUR_LABELS = ['6','7','8','9','10','11','12','13','14','15','16','17','18','19','20','21','22','23','0','1','2','3','4','5'];

const WEEK_LABELS = ['一', '二', '三', '四', '五', '六', '日'];

// ─── 时间偏移计算 ──────────────────────────────────────────────────────────────

/** 根据 mode 和 offset（0=当前，-1=上一期，...）计算 baseTime（Unix 秒） */
function calcBaseTime(mode: ReadingStatsMode, offset: number): number | undefined {
	if (mode === 'overall') return undefined;
	const now = new Date();
	if (mode === 'weekly') {
		// 本周一 0:00
		const day = now.getDay() === 0 ? 6 : now.getDay() - 1; // 0=Mon
		const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - day);
		monday.setDate(monday.getDate() + offset * 7);
		return Math.floor(monday.getTime() / 1000);
	}
	if (mode === 'monthly') {
		// 本月 1 日 0:00
		const d = new Date(now.getFullYear(), now.getMonth() + offset, 1);
		return Math.floor(d.getTime() / 1000);
	}
	if (mode === 'annually') {
		// 本年 1 月 1 日 0:00
		const d = new Date(now.getFullYear() + offset, 0, 1);
		return Math.floor(d.getTime() / 1000);
	}
	return undefined;
}

/** 当前期 label，如"2026年5月"、"2026年第20周"、"2026年" */
function periodLabel(mode: ReadingStatsMode, offset: number): string {
	if (mode === 'overall') return '全部';
	const now = new Date();
	if (mode === 'weekly') {
		const day = now.getDay() === 0 ? 6 : now.getDay() - 1;
		const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - day + offset * 7);
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

// ─── View ─────────────────────────────────────────────────────────────────────

export class WereadReadingStatsView extends ItemView {
	private apiManager: ApiManager;
	private syncReadingStats: SyncReadingStats;
	private fileManager: FileManager;
	private currentMode: ReadingStatsMode = 'monthly';
	private currentOffset = 0; // 0=当前，-1=上一期，...
	private data: ReadingStatsResponse | null = null;
	private loading = false;
	private contentEl2: HTMLElement;

	constructor(leaf: WorkspaceLeaf, apiManager: ApiManager, syncReadingStats: SyncReadingStats, fileManager: FileManager) {
		super(leaf);
		this.apiManager = apiManager;
		this.syncReadingStats = syncReadingStats;
		this.fileManager = fileManager;
	}

	getViewType(): string { return WEREAD_READING_STATS_VIEW_ID; }
	getDisplayText(): string { return '阅读统计'; }
	getIcon(): string { return 'bar-chart-2'; }

	async onOpen() {
		const { containerEl } = this;
		containerEl.empty();
		containerEl.addClass('weread-stats-view');
		this.contentEl2 = containerEl.createDiv({ cls: 'weread-stats-container' });
		this.render();
		this.loadData();
	}

	async onClose() {
		this.containerEl.empty();
	}

	private async loadData() {
		const settings = get(settingsStore);
		if (!settings.wereadApiKey) {
			this.renderNoApiKey();
			return;
		}
		this.loading = true;
		this.renderLoading();

		const baseTime = calcBaseTime(this.currentMode, this.currentOffset);
		const data = await this.apiManager.getReadingStats(this.currentMode, baseTime);
		this.loading = false;
		if (!data) {
			this.renderError();
			return;
		}
		this.data = data;
		this.render();
	}

	private render() {
		const el = this.contentEl2;
		el.empty();

		if (!get(settingsStore).wereadApiKey) {
			this.renderNoApiKey();
			return;
		}
		if (this.loading) {
			this.renderLoading();
			return;
		}
		if (!this.data) return;

		this.renderHeader(el);
		this.renderTabBar(el);
		this.renderKPICards(el, this.data);
		this.renderTimeSeries(el, this.data);
		this.renderTopBooks(el, this.data);
		this.renderPreferences(el, this.data);
		if (this.currentMode === 'overall' || this.currentMode === 'annually') {
			this.renderYearlyOverview(el, this.data);
		}
	}

	// ── Header ────────────────────────────────────────────────────────
	private renderHeader(el: HTMLElement) {
		const header = el.createDiv({ cls: 'weread-stats-header' });
		const titleRow = header.createDiv({ cls: 'weread-stats-title-row' });
		const icon = titleRow.createSpan({ cls: 'weread-stats-header-icon' });
		setIcon(icon, 'bar-chart-2');
		titleRow.createEl('h2', { text: '阅读统计', cls: 'weread-stats-title' });

		const actions = header.createDiv({ cls: 'weread-stats-header-actions' });

		// 导出 Markdown 按钮
		const exportBtn = actions.createEl('button', {
			cls: 'weread-stats-btn',
			attr: { 'aria-label': '导出 Markdown' }
		});
		setIcon(exportBtn, 'file-text');
		exportBtn.createSpan({ text: '导出 Markdown' });
		exportBtn.addEventListener('click', () => {
			this.syncReadingStats.sync();
		});

		// 刷新按钮
		const refreshBtn = actions.createEl('button', {
			cls: 'weread-stats-btn weread-stats-btn-icon',
			attr: { 'aria-label': '刷新数据' }
		});
		setIcon(refreshBtn, 'refresh-ccw');
		refreshBtn.addEventListener('click', () => {
			this.data = null;
			this.loadData();
		});
	}

	// ── Tab bar + 时间导航 ────────────────────────────────────────────
	private renderTabBar(el: HTMLElement) {
		const tabs: { mode: ReadingStatsMode; label: string }[] = [
			{ mode: 'weekly', label: '本周' },
			{ mode: 'monthly', label: '本月' },
			{ mode: 'annually', label: '本年' },
			{ mode: 'overall', label: '全部' },
		];

		const nav = el.createDiv({ cls: 'weread-stats-nav' });

		// Tab 胶囊
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

		// 时间导航（overall 不需要）
		if (this.currentMode !== 'overall') {
			const timePicker = nav.createDiv({ cls: 'weread-stats-timepicker' });

			const prevBtn = timePicker.createEl('button', { cls: 'weread-stats-timepicker-btn' });
			setIcon(prevBtn, 'chevron-left');
			prevBtn.addEventListener('click', () => {
				this.currentOffset--;
				this.data = null;
				this.render();
				this.loadData();
			});

			timePicker.createSpan({
				cls: 'weread-stats-timepicker-label',
				text: periodLabel(this.currentMode, this.currentOffset)
			});

			const nextBtn = timePicker.createEl('button', {
				cls: 'weread-stats-timepicker-btn' + (this.currentOffset >= 0 ? ' is-disabled' : '')
			});
			setIcon(nextBtn, 'chevron-right');
			if (this.currentOffset >= 0) {
				nextBtn.setAttribute('disabled', 'true');
			}
			nextBtn.addEventListener('click', () => {
				if (this.currentOffset >= 0) return;
				this.currentOffset++;
				this.data = null;
				this.render();
				this.loadData();
			});
		}
	}

	// ── KPI Cards ─────────────────────────────────────────────────────
	private renderKPICards(el: HTMLElement, data: ReadingStatsResponse) {
		const grid = el.createDiv({ cls: 'weread-stats-kpi-grid' });

		this.makeKPICard(grid, '阅读时长', fmtDuration(data.totalReadTime), 'clock');
		this.makeKPICard(grid, '阅读天数', `${data.readDays} 天`, 'calendar');
		this.makeKPICard(grid, '日均时长', fmtDuration(data.dayAverageReadTime), 'trending-up',
			data.compare !== undefined ? fmtCompare(data.compare) : null);

		const readStat = data.readStat ?? [];
		const readCount = readStat.find(s => s.stat === '读过')?.counts ?? '—';
		const finishCount = readStat.find(s => s.stat === '读完')?.counts ?? '—';
		const noteCount = readStat.find(s => s.stat === '笔记')?.counts ?? '—';

		this.makeKPICard(grid, '读过', readCount, 'book-open');
		this.makeKPICard(grid, '读完', finishCount, 'check-circle');
		this.makeKPICard(grid, '笔记', noteCount, 'pencil');
	}

	private makeKPICard(
		parent: HTMLElement,
		label: string,
		value: string,
		iconName: string,
		compare?: { text: string; up: boolean } | null
	) {
		const card = parent.createDiv({ cls: 'weread-stats-kpi-card' });
		const iconEl = card.createDiv({ cls: 'weread-stats-kpi-icon' });
		setIcon(iconEl, iconName);
		const body = card.createDiv({ cls: 'weread-stats-kpi-body' });
		body.createDiv({ cls: 'weread-stats-kpi-value', text: value });
		const labelRow = body.createDiv({ cls: 'weread-stats-kpi-label-row' });
		labelRow.createSpan({ text: label, cls: 'weread-stats-kpi-label' });
		if (compare) {
			labelRow.createSpan({
				cls: 'weread-stats-compare-badge ' + (compare.up ? 'is-up' : 'is-down'),
				text: (compare.up ? '↑' : '↓') + compare.text
			});
		}
	}

	// ── Time Series Chart ─────────────────────────────────────────────
	private renderTimeSeries(el: HTMLElement, data: ReadingStatsResponse) {
		if (!data.readTimes || Object.keys(data.readTimes).length === 0) return;

		const section = el.createDiv({ cls: 'weread-stats-section' });

		const modeLabel: Record<ReadingStatsMode, string> = {
			weekly: '每日阅读时长',
			monthly: '每日阅读时长',
			annually: '每月阅读时长',
			overall: '每年阅读时长'
		};
		section.createEl('h3', { text: modeLabel[this.currentMode], cls: 'weread-stats-section-title' });

		const entries = Object.entries(data.readTimes)
			.sort(([a], [b]) => Number(a) - Number(b));

		const values = entries.map(([, v]) => v as number);
		const labels = entries.map(([ts]) => {
			const d = new Date(Number(ts) * 1000);
			if (this.currentMode === 'overall') return `${d.getFullYear()}`;
			if (this.currentMode === 'annually') return `${d.getMonth() + 1}月`;
			if (this.currentMode === 'weekly') {
				// getDay(): 0=Sun,1=Mon,...,6=Sat → WEEK_LABELS index: 0=Mon,...,6=Sun
				const dow = d.getDay();
				const idx = dow === 0 ? 6 : dow - 1;
				return WEEK_LABELS[idx];
			}
			return `${d.getDate()}`;
		});

		this.renderBarChart(section, values, labels);
	}

	// ── Bar Chart (SVG-based, with Y scale) ──────────────────────────
	private renderBarChart(parent: HTMLElement, values: number[], labels: string[]) {
		const maxVal = Math.max(...values, 1);
		const gap = 4;
		const chartH = 140;
		const labelH = 22;
		const scaleW = 48; // left gutter for Y-axis labels

		const wrapper = parent.createDiv({ cls: 'weread-stats-chart-wrapper' });

		// compute nice scale ticks
		const tickMax = maxVal; // seconds
		const ticks = [0, 0.5, 1].map(f => Math.round(tickMax * f)); // 0, mid, max

		// SVG fills full width; bars share space equally
		const n = values.length;
		// We use a fixed viewBox wide enough; bars spaced evenly
		const barAreaW = 600; // logical width for bars
		const barW = Math.max(8, Math.floor(barAreaW / n) - gap);
		const totalViewW = scaleW + barAreaW;

		const svg = wrapper.createSvg('svg', {
			attr: {
				viewBox: `0 0 ${totalViewW} ${chartH + labelH}`,
				width: '100%',
				height: chartH + labelH,
				class: 'weread-stats-bar-chart',
				preserveAspectRatio: 'xMidYMid meet'
			}
		});

		// Y-axis guide lines + labels
		for (let ti = 0; ti < ticks.length; ti++) {
			const tickVal = ticks[ti];
			const yPos = chartH - (tickVal / maxVal) * chartH;

			// dashed line across bar area
			svg.createSvg('line', {
				attr: {
					x1: String(scaleW), y1: String(yPos),
					x2: String(totalViewW), y2: String(yPos),
					class: 'weread-stats-scale-line'
				}
			});

			// label on left
			const lbl = svg.createSvg('text', {
				attr: {
					x: String(scaleW - 4),
					y: String(yPos + 4),
					'text-anchor': 'end',
					class: 'weread-stats-scale-label'
				}
			});
			lbl.textContent = ti === 0 ? '0' : fmtDuration(tickVal);
		}

		// Bars + labels
		values.forEach((v, i) => {
			const barH = Math.max((v / maxVal) * chartH, v > 0 ? 4 : 0);
			const slotW = barAreaW / n;
			const x = scaleW + i * slotW + (slotW - barW) / 2;
			const y = chartH - barH;

			const rect = svg.createSvg('rect', {
				attr: {
					x: String(x),
					y: String(y),
					width: String(barW),
					height: String(barH),
					rx: '4',
					class: 'weread-stats-bar' + (v === maxVal ? ' is-max' : '')
				}
			});
			rect.createSvg('title').textContent = `${labels[i]}: ${fmtDuration(v)}`;

			const text = svg.createSvg('text', {
				attr: {
					x: String(x + barW / 2),
					y: String(chartH + labelH - 2),
					'text-anchor': 'middle',
					class: 'weread-stats-bar-label'
				}
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
				img.src = cover;
				img.alt = title;
			} else {
				const placeholder = row.createDiv({ cls: 'weread-stats-book-cover weread-stats-book-cover-placeholder' });
				setIcon(placeholder, 'book');
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
			const barFill = barTrack.createDiv({ cls: 'weread-stats-mini-bar-fill' });
			barFill.style.width = `${pct}%`;

			// 点击跳转到本地笔记
			if (bookId) {
				row.addClass('weread-stats-book-row-clickable');
				row.addEventListener('click', async () => {
					const bookIdMap = await this.fileManager.getNotebookFilesByBookId();
					const annotationFile = bookIdMap.get(bookId);
					if (annotationFile?.file instanceof TFile) {
						const leaf = this.app.workspace.getLeaf(false);
						await leaf.openFile(annotationFile.file);
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
		if (!hasCat && !hasAuthor && !hasTime) return;

		const section = el.createDiv({ cls: 'weread-stats-section' });
		section.createEl('h3', { text: '偏好分析', cls: 'weread-stats-section-title' });

		const prefGrid = section.createDiv({ cls: 'weread-stats-pref-grid' });

		if (hasCat) {
			const cats = data.preferCategory.filter(c => c.readingTime > 0);
			const maxCatTime = Math.max(...cats.map(c => c.readingTime), 1);

			const catCard = prefGrid.createDiv({ cls: 'weread-stats-pref-card' });
			const catHeader = catCard.createDiv({ cls: 'weread-stats-pref-card-header' });
			setIcon(catHeader.createSpan(), 'tag');
			catHeader.createSpan({ text: '分类偏好' });
			if (data.preferCategoryWord) {
				catCard.createDiv({ cls: 'weread-stats-pref-subtitle', text: data.preferCategoryWord });
			}

			cats.slice(0, 6).forEach(cat => {
				const pct = (cat.readingTime / maxCatTime) * 100;
				const row = catCard.createDiv({ cls: 'weread-stats-pref-row' });
				row.createSpan({ cls: 'weread-stats-pref-name', text: cat.categoryTitle });
				const barTrack = row.createDiv({ cls: 'weread-stats-pref-bar-track' });
				barTrack.createDiv({ cls: 'weread-stats-pref-bar-fill' }).style.width = `${pct}%`;
				row.createSpan({ cls: 'weread-stats-pref-meta', text: fmtDuration(cat.readingTime) });
			});
		}

		if (hasAuthor) {
			const authorCard = prefGrid.createDiv({ cls: 'weread-stats-pref-card' });
			const authorHeader = authorCard.createDiv({ cls: 'weread-stats-pref-card-header' });
			setIcon(authorHeader.createSpan(), 'user');
			authorHeader.createSpan({ text: '偏好作者' });

			data.preferAuthor!.slice(0, 6).forEach(a => {
				const row = authorCard.createDiv({ cls: 'weread-stats-pref-row' });
				row.createSpan({ cls: 'weread-stats-pref-name', text: a.name });
				row.createSpan({ cls: 'weread-stats-pref-meta', text: `${a.count}本 · ${a.readTime}` });
			});
		}

		if (hasTime) {
			const timeCard = prefGrid.createDiv({ cls: 'weread-stats-pref-card weread-stats-pref-card-wide' });
			const timeHeader = timeCard.createDiv({ cls: 'weread-stats-pref-card-header' });
			setIcon(timeHeader.createSpan(), 'clock');
			timeHeader.createSpan({ text: '阅读时段分布' });
			if (data.preferTimeWord) {
				timeCard.createDiv({ cls: 'weread-stats-pref-subtitle', text: data.preferTimeWord });
			}

			const maxTimeVal = Math.max(...data.preferTime!, 1);
			const hourChart = timeCard.createDiv({ cls: 'weread-stats-hour-chart' });
			data.preferTime!.forEach((v, i) => {
				const col = hourChart.createDiv({ cls: 'weread-stats-hour-col' });
				const barH = Math.max((v / maxTimeVal) * 48, v > 0 ? 3 : 0);
				const bar = col.createDiv({ cls: 'weread-stats-hour-bar' });
				bar.style.height = `${barH}px`;
				bar.title = `${HOUR_LABELS[i]}时: ${fmtDuration(v)}`;
				if (i % 3 === 0) {
					col.createDiv({ cls: 'weread-stats-hour-label', text: HOUR_LABELS[i] });
				} else {
					col.createDiv({ cls: 'weread-stats-hour-label' });
				}
			});
		}
	}

	// ── Yearly Overview ────────────────────────────────────────────────
	private renderYearlyOverview(el: HTMLElement, data: ReadingStatsResponse) {
		if (!data.readTimes || Object.keys(data.readTimes).length === 0) return;
		if (this.currentMode !== 'overall') return;

		const section = el.createDiv({ cls: 'weread-stats-section' });
		section.createEl('h3', { text: '注册信息', cls: 'weread-stats-section-title' });

		const infoGrid = section.createDiv({ cls: 'weread-stats-info-grid' });
		if (data.registTime) {
			const item = infoGrid.createDiv({ cls: 'weread-stats-info-item' });
			item.createDiv({ cls: 'weread-stats-info-label', text: '注册时间' });
			item.createDiv({ cls: 'weread-stats-info-value', text: fmtTs(data.registTime) });
		}
		if (data.readRate !== undefined) {
			const item = infoGrid.createDiv({ cls: 'weread-stats-info-item' });
			item.createDiv({ cls: 'weread-stats-info-label', text: '文字阅读占比' });
			item.createDiv({ cls: 'weread-stats-info-value', text: `${data.readRate}%` });
		}
		if (data.wrReadTime) {
			const item = infoGrid.createDiv({ cls: 'weread-stats-info-item' });
			item.createDiv({ cls: 'weread-stats-info-label', text: '文字阅读' });
			item.createDiv({ cls: 'weread-stats-info-value', text: fmtDuration(data.wrReadTime) });
		}
		if (data.wrListenTime) {
			const item = infoGrid.createDiv({ cls: 'weread-stats-info-item' });
			item.createDiv({ cls: 'weread-stats-info-label', text: '听书时长' });
			item.createDiv({ cls: 'weread-stats-info-value', text: fmtDuration(data.wrListenTime) });
		}
	}

	// ── Empty states ──────────────────────────────────────────────────
	private renderLoading() {
		this.contentEl2.empty();
		const wrap = this.contentEl2.createDiv({ cls: 'weread-stats-empty' });
		wrap.createDiv({ cls: 'weread-stats-spinner' });
		wrap.createDiv({ text: '正在加载数据…', cls: 'weread-stats-empty-text' });
	}

	private renderNoApiKey() {
		this.contentEl2.empty();
		const wrap = this.contentEl2.createDiv({ cls: 'weread-stats-empty' });
		setIcon(wrap.createDiv({ cls: 'weread-stats-empty-icon' }), 'key');
		wrap.createDiv({ text: '请先在设置中填写微信读书 API Key', cls: 'weread-stats-empty-text' });
		wrap.createDiv({ text: '设置 → 微信读书 → 阅读统计 → API Key', cls: 'weread-stats-empty-hint' });
	}

	private renderError() {
		this.contentEl2.empty();
		const wrap = this.contentEl2.createDiv({ cls: 'weread-stats-empty' });
		setIcon(wrap.createDiv({ cls: 'weread-stats-empty-icon' }), 'alert-circle');
		wrap.createDiv({ text: '数据加载失败，请检查 API Key 或网络', cls: 'weread-stats-empty-text' });
		const retryBtn = wrap.createEl('button', { text: '重试', cls: 'weread-stats-btn' });
		retryBtn.addEventListener('click', () => this.loadData());
	}
}
