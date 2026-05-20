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

// ─── View ─────────────────────────────────────────────────────────────────────

export class WereadReadingStatsView extends ItemView {
	private apiManager: ApiManager;
	private syncReadingStats: SyncReadingStats;
	private fileManager: FileManager;
	private currentMode: ReadingStatsMode = 'monthly';
	private currentOffset = 0;
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

	async onClose() { this.containerEl.empty(); }

	private async loadData() {
		const settings = get(settingsStore);
		if (!settings.wereadApiKey) { this.renderNoApiKey(); return; }
		this.loading = true;
		this.renderLoading();
		const baseTime = calcBaseTime(this.currentMode, this.currentOffset);
		const data = await this.apiManager.getReadingStats(this.currentMode, baseTime);
		this.loading = false;
		if (!data) { this.renderError(); return; }
		this.data = data;
		this.render();
	}

	private render() {
		const el = this.contentEl2;
		el.empty();
		if (!get(settingsStore).wereadApiKey) { this.renderNoApiKey(); return; }
		if (this.loading) { this.renderLoading(); return; }
		if (!this.data) return;

		this.renderHeader(el);
		this.renderTabBar(el);
		this.renderKPICards(el, this.data);
		this.renderTimeSeries(el, this.data);
		this.renderTopBooks(el, this.data);
		this.renderPreferences(el, this.data);
		if (this.currentMode === 'overall') {
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
		const exportBtn = actions.createEl('button', { cls: 'weread-stats-btn', attr: { 'aria-label': '导出 Markdown' } });
		setIcon(exportBtn, 'file-text');
		exportBtn.createSpan({ text: '导出 Markdown' });
		exportBtn.addEventListener('click', () => this.syncReadingStats.sync());

		const refreshBtn = actions.createEl('button', { cls: 'weread-stats-btn weread-stats-btn-icon', attr: { 'aria-label': '刷新数据' } });
		setIcon(refreshBtn, 'refresh-ccw');
		refreshBtn.addEventListener('click', () => { this.data = null; this.loadData(); });
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

	// ── KPI Cards ─────────────────────────────────────────────────────
	private renderKPICards(el: HTMLElement, data: ReadingStatsResponse) {
		const grid = el.createDiv({ cls: 'weread-stats-kpi-grid' });
		this.makeKPICard(grid, '阅读时长', fmtDuration(data.totalReadTime), 'clock');
		this.makeKPICard(grid, '阅读天数', `${data.readDays} 天`, 'calendar');
		this.makeKPICard(grid, '日均时长', fmtDuration(data.dayAverageReadTime), 'trending-up',
			data.compare !== undefined ? fmtCompare(data.compare) : null);

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

	// ── Time Series ───────────────────────────────────────────────────
	private renderTimeSeries(el: HTMLElement, data: ReadingStatsResponse) {
		if (!data.readTimes || Object.keys(data.readTimes).length === 0) return;

		const section = el.createDiv({ cls: 'weread-stats-section' });
		const modeLabel: Record<ReadingStatsMode, string> = {
			weekly: '每日阅读时长', monthly: '每日阅读时长',
			annually: '每月阅读时长', overall: '每年阅读时长'
		};
		section.createEl('h3', { text: modeLabel[this.currentMode], cls: 'weread-stats-section-title' });

		let values: number[];
		let labels: string[];

		if (this.currentMode === 'weekly') {
			const baseTime = calcBaseTime('weekly', this.currentOffset);
			const built = buildWeekValues(data.readTimes, baseTime);
			values = built.values;
			labels = built.labels;
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

		this.renderBarChart(section, values, labels);
	}

	// ── Bar Chart (SVG) with Y-axis scale ────────────────────────────
	private renderBarChart(parent: HTMLElement, values: number[], labels: string[]) {
		const rawMax = Math.max(...values, 1);
		const maxVal = niceMax(rawMax);
		const gap = 4;
		const chartH = 140;
		const labelH = 22;
		const scaleW = 52; // left gutter

		const wrapper = parent.createDiv({ cls: 'weread-stats-chart-wrapper' });

		const n = values.length;
		const barAreaW = 600;
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

		// Y-axis: 0, 50%, 100% with nice labels
		const tickFractions = [0, 0.5, 1];
		for (const frac of tickFractions) {
			const tickVal = maxVal * frac;
			const yPos = chartH - frac * chartH;
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
			const y = chartH - barH;

			const rect = svg.createSvg('rect', {
				attr: { x: String(x), y: String(y), width: String(barW), height: String(barH), rx: '4', class: 'weread-stats-bar' + (v === rawMax && v > 0 ? ' is-max' : '') }
			});
			rect.createSvg('title').textContent = `${labels[i]}: ${fmtDuration(v)}`;

			const text = svg.createSvg('text', {
				attr: { x: String(x + barW / 2), y: String(chartH + labelH - 2), 'text-anchor': 'middle', class: 'weread-stats-bar-label' }
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

		// ── 阅读时段（柱状图，加时段标签）
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

		// ── 分类偏好（饼图）
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

		// ── 偏好作者
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

		// ── 出版方标签云
		if (hasPublisher) {
			const pubCard = prefGrid.createDiv({ cls: 'weread-stats-pref-card weread-stats-pref-card-wide' });
			const pubHeader = pubCard.createDiv({ cls: 'weread-stats-pref-card-header' });
			setIcon(pubHeader.createSpan(), 'building-2');
			pubHeader.createSpan({ text: '偏好出版方' });
			this.renderTagCloud(pubCard, data.preferPublisher!.slice(0, 20));
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

	/** 简单 SVG 饼图 + 图例 */
	private renderPieChart(parent: HTMLElement, items: { label: string; value: number }[]) {
		const total = items.reduce((s, it) => s + it.value, 0);
		if (total === 0) return;

		const size = 120;
		const cx = size / 2, cy = size / 2, r = size / 2 - 4;
		// accent palette: rotate hue from accent color
		const COLORS = ['#7c6af7','#a78bfa','#6366f1','#818cf8','#c4b5fd','#4f46e5','#ddd6fe','#3730a3'];

		const pieWrap = parent.createDiv({ cls: 'weread-stats-pie-wrap' });

		const svg = pieWrap.createSvg('svg', {
			attr: { width: String(size), height: String(size), viewBox: `0 0 ${size} ${size}`, class: 'weread-stats-pie-svg' }
		});

		let angle = -Math.PI / 2; // start top
		items.forEach((item, idx) => {
			const sweep = (item.value / total) * 2 * Math.PI;
			const x1 = cx + r * Math.cos(angle);
			const y1 = cy + r * Math.sin(angle);
			const x2 = cx + r * Math.cos(angle + sweep);
			const y2 = cy + r * Math.sin(angle + sweep);
			const large = sweep > Math.PI ? 1 : 0;

			const path = svg.createSvg('path', {
				attr: {
					d: `M ${cx} ${cy} L ${x1} ${y1} A ${r} ${r} 0 ${large} 1 ${x2} ${y2} Z`,
					class: 'weread-stats-pie-slice'
				}
			});
			(path as SVGElement).setAttribute('style', `fill: ${COLORS[idx % COLORS.length]}`);
			path.createSvg('title').textContent = `${item.label}: ${fmtDuration(item.value)}`;
			angle += sweep;
		});

		// Legend
		const legend = pieWrap.createDiv({ cls: 'weread-stats-pie-legend' });
		items.forEach((item, idx) => {
			const row = legend.createDiv({ cls: 'weread-stats-pie-legend-row' });
			const dot = row.createDiv({ cls: 'weread-stats-pie-legend-dot' });
			dot.style.background = COLORS[idx % COLORS.length];
			const pct = Math.round((item.value / total) * 100);
			row.createSpan({ cls: 'weread-stats-pie-legend-label', text: `${item.label} ${pct}%` });
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

	// ── Yearly Overview ────────────────────────────────────────────────
	private renderYearlyOverview(el: HTMLElement, data: ReadingStatsResponse) {
		if (!data.readTimes || Object.keys(data.readTimes).length === 0) return;

		const section = el.createDiv({ cls: 'weread-stats-section' });
		section.createEl('h3', { text: '注册信息', cls: 'weread-stats-section-title' });
		const infoGrid = section.createDiv({ cls: 'weread-stats-info-grid' });

		const addInfo = (label: string, value: string) => {
			const item = infoGrid.createDiv({ cls: 'weread-stats-info-item' });
			item.createDiv({ cls: 'weread-stats-info-label', text: label });
			item.createDiv({ cls: 'weread-stats-info-value', text: value });
		};

		if (data.registTime) addInfo('注册时间', fmtTs(data.registTime));
		if (data.readRate !== undefined) addInfo('文字阅读占比', `${data.readRate}%`);
		if (data.wrReadTime) addInfo('文字阅读', fmtDuration(data.wrReadTime));
		if (data.wrListenTime) addInfo('听书时长', fmtDuration(data.wrListenTime));
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
