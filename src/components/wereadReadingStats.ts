import { ItemView, WorkspaceLeaf, setIcon } from 'obsidian';
import ApiManager from '../api';
import SyncReadingStats from '../syncReadingStats';
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

// ─── View ─────────────────────────────────────────────────────────────────────

export class WereadReadingStatsView extends ItemView {
	private apiManager: ApiManager;
	private syncReadingStats: SyncReadingStats;
	private currentMode: ReadingStatsMode = 'monthly';
	private data: ReadingStatsResponse | null = null;
	private loading = false;
	private contentEl2: HTMLElement; // renamed to avoid shadow

	constructor(leaf: WorkspaceLeaf, apiManager: ApiManager, syncReadingStats: SyncReadingStats) {
		super(leaf);
		this.apiManager = apiManager;
		this.syncReadingStats = syncReadingStats;
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

		const now = new Date();
		let baseTime: number | undefined;
		if (this.currentMode === 'annually') {
			baseTime = Math.floor(new Date(now.getFullYear(), 0, 1).getTime() / 1000);
		}

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

		// 同步统计文档按钮
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

	// ── Tab bar ───────────────────────────────────────────────────────
	private renderTabBar(el: HTMLElement) {
		const tabs: { mode: ReadingStatsMode; label: string }[] = [
			{ mode: 'weekly', label: '本周' },
			{ mode: 'monthly', label: '本月' },
			{ mode: 'annually', label: '本年' },
			{ mode: 'overall', label: '全部' },
		];

		const bar = el.createDiv({ cls: 'weread-stats-tabbar' });
		for (const tab of tabs) {
			const btn = bar.createEl('button', {
				text: tab.label,
				cls: 'weread-stats-tab' + (this.currentMode === tab.mode ? ' is-active' : '')
			});
			btn.addEventListener('click', () => {
				if (this.currentMode === tab.mode) return;
				this.currentMode = tab.mode;
				this.data = null;
				this.render();
				this.loadData();
			});
		}
	}

	// ── KPI Cards ─────────────────────────────────────────────────────
	private renderKPICards(el: HTMLElement, data: ReadingStatsResponse) {
		const grid = el.createDiv({ cls: 'weread-stats-kpi-grid' });

		// 总阅读时长
		this.makeKPICard(grid, '阅读时长', fmtDuration(data.totalReadTime), 'clock');

		// 阅读天数
		this.makeKPICard(grid, '阅读天数', `${data.readDays} 天`, 'calendar');

		// 日均时长
		this.makeKPICard(grid, '日均时长', fmtDuration(data.dayAverageReadTime), 'trending-up',
			data.compare !== undefined ? fmtCompare(data.compare) : null);

		// 从 readStat 里找读过本数和笔记数
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
			weekly: '每日阅读时长（本周）',
			monthly: '每日阅读时长（本月）',
			annually: '每月阅读时长（本年）',
			overall: '每年阅读时长（历史）'
		};
		section.createEl('h3', { text: modeLabel[this.currentMode], cls: 'weread-stats-section-title' });

		const entries = Object.entries(data.readTimes)
			.sort(([a], [b]) => Number(a) - Number(b));

		const values = entries.map(([, v]) => v as number);
		const labels = entries.map(([ts]) => {
			const d = new Date(Number(ts) * 1000);
			if (this.currentMode === 'overall') return `${d.getFullYear()}`;
			if (this.currentMode === 'annually') return `${d.getMonth() + 1}月`;
			return `${d.getDate()}`;
		});

		this.renderBarChart(section, values, labels);
	}

	// ── Bar Chart (SVG-based) ─────────────────────────────────────────
	private renderBarChart(parent: HTMLElement, values: number[], labels: string[]) {
		const maxVal = Math.max(...values, 1);
		const barW = 28;
		const gap = 6;
		const chartH = 120;
		const labelH = 20;
		const totalW = (barW + gap) * values.length;

		const wrapper = parent.createDiv({ cls: 'weread-stats-chart-wrapper' });
		const svg = wrapper.createSvg('svg', {
			attr: {
				viewBox: `0 0 ${totalW} ${chartH + labelH}`,
				width: '100%',
				height: chartH + labelH,
				class: 'weread-stats-bar-chart'
			}
		});

		values.forEach((v, i) => {
			const barH = Math.max((v / maxVal) * chartH, v > 0 ? 4 : 0);
			const x = i * (barW + gap);
			const y = chartH - barH;

			// bar
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

			// tooltip on hover via title
			rect.createSvg('title').textContent = `${labels[i]}: ${fmtDuration(v)}`;

			// label
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
			const pct = (item.readTime / maxTime) * 100;

			const row = list.createDiv({ cls: 'weread-stats-book-row' });

			// rank
			row.createDiv({ cls: 'weread-stats-book-rank', text: String(i + 1) });

			// cover
			if (cover) {
				const img = row.createEl('img', { cls: 'weread-stats-book-cover' });
				img.src = cover;
				img.alt = title;
			} else {
				const placeholder = row.createDiv({ cls: 'weread-stats-book-cover weread-stats-book-cover-placeholder' });
				setIcon(placeholder, 'book');
			}

			// info
			const info = row.createDiv({ cls: 'weread-stats-book-info' });
			info.createDiv({ cls: 'weread-stats-book-title', text: title });
			if (author) info.createDiv({ cls: 'weread-stats-book-author', text: author });

			// tags
			if (item.tags?.length) {
				const tagRow = info.createDiv({ cls: 'weread-stats-book-tags' });
				item.tags.forEach(tag => tagRow.createSpan({ cls: 'weread-stats-tag', text: tag }));
			}

			// progress bar + duration
			const right = row.createDiv({ cls: 'weread-stats-book-right' });
			right.createDiv({ cls: 'weread-stats-book-duration', text: fmtDuration(item.readTime) });
			const barTrack = right.createDiv({ cls: 'weread-stats-mini-bar-track' });
			const barFill = barTrack.createDiv({ cls: 'weread-stats-mini-bar-fill' });
			barFill.style.width = `${pct}%`;
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

		// 分类偏好
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

		// 作者偏好
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

		// 阅读时段
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

	// ── Yearly Overview (overall only) ────────────────────────────────
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
