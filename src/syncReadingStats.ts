import { Notice, Vault } from 'obsidian';
import ApiRouter from './api-router';
import { settingsStore } from './settings';
import { get } from 'svelte/store';
import type { ReadingStatsResponse } from './models';

// ─── 格式化工具 ───────────────────────────────────────────────────────────────

function fmtDuration(seconds: number): string {
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

function fmtCompare(compare?: number): string {
	if (compare === undefined || compare === null) return '';
	const pct = Math.round(compare * 100);
	return pct >= 0 ? `↑${pct}%` : `↓${Math.abs(pct)}%`;
}

// 24 小时分布，preferTime 从 6 点开始排列
const HOUR_LABELS = ['6时','7时','8时','9时','10时','11时','12时','13时','14时','15时','16时','17时','18时','19时','20时','21时','22时','23时','0时','1时','2时','3时','4时','5时'];

function renderBarChart(values: number[], labels: string[], maxWidth = 20): string {
	const maxVal = Math.max(...values, 1);
	return values.map((v, i) => {
		const barLen = Math.round((v / maxVal) * maxWidth);
		const bar = '█'.repeat(barLen) + '░'.repeat(maxWidth - barLen);
		const label = labels[i].padEnd(4, ' ');
		return `${label} ${bar} ${fmtDuration(v)}`;
	}).join('\n');
}

// ─── Markdown 生成 ────────────────────────────────────────────────────────────

function buildMarkdown(
	overall: ReadingStatsResponse,
	annual: ReadingStatsResponse,
	monthly: ReadingStatsResponse,
	year: number,
	month: number
): string {
	const now = new Date();
	const lines: string[] = [];

	// Frontmatter
	lines.push('---');
	lines.push(`title: 微信读书 · 阅读统计`);
	lines.push(`updated: ${now.toISOString().slice(0, 10)}`);
	lines.push(`tags:`);
	lines.push(`  - 阅读统计`);
	lines.push(`  - 微信读书`);
	lines.push('---');
	lines.push('');

	// 标题
	lines.push('# 📚 微信读书 · 阅读数据分析');
	lines.push('');
	lines.push(`> 最后更新：${now.toLocaleString('zh-CN', { hour12: false })}`);
	lines.push('');

	// ── 一、总览 ──────────────────────────────────────────────────────
	lines.push('## 📊 一、历年总览');
	lines.push('');

	const totalH = fmtDuration(overall.totalReadTime);
	const totalDays = overall.readDays;

	lines.push(`| 指标 | 数值 |`);
	lines.push(`|------|------|`);
	lines.push(`| 注册时间 | ${overall.registTime ? fmtTs(overall.registTime) : '—'} |`);
	lines.push(`| 累计阅读时长 | ${totalH} |`);
	lines.push(`| 累计阅读天数 | ${totalDays} 天 |`);

	// 阅读统计摘要（读过、读完、笔记数等）
	if (overall.readStat?.length) {
		for (const s of overall.readStat) {
			lines.push(`| ${s.stat} | ${s.counts} |`);
		}
	}
	lines.push('');

	// 历年阅读时长分布（readTimes 是 overall 时按年分桶）
	if (overall.readTimes && Object.keys(overall.readTimes).length > 0) {
		lines.push('### 历年阅读时长');
		lines.push('');
		lines.push('| 年份 | 阅读时长 |');
		lines.push('|------|---------|');
		const sorted = Object.entries(overall.readTimes).sort(([a], [b]) => Number(a) - Number(b));
		for (const [ts, secs] of sorted) {
			const yr = new Date(Number(ts) * 1000).getFullYear();
			lines.push(`| ${yr} | ${fmtDuration(secs as number)} |`);
		}
		lines.push('');
	}

	// ── 二、今年数据 ──────────────────────────────────────────────────
	lines.push(`## 📅 二、${year} 年阅读概况`);
	lines.push('');
	lines.push(`| 指标 | 数值 |`);
	lines.push(`|------|------|`);
	lines.push(`| 总阅读时长 | ${fmtDuration(annual.totalReadTime)} |`);
	lines.push(`| 阅读天数 | ${annual.readDays} 天 |`);
	lines.push(`| 日均时长 | ${fmtDuration(annual.dayAverageReadTime)} |`);
	if (annual.readStat?.length) {
		for (const s of annual.readStat) {
			lines.push(`| ${s.stat} | ${s.counts} |`);
		}
	}
	lines.push('');

	// 今年逐月分布
	if (annual.readTimes && Object.keys(annual.readTimes).length > 0) {
		lines.push(`### ${year} 年逐月阅读时长`);
		lines.push('');
		const monthEntries = Object.entries(annual.readTimes)
			.sort(([a], [b]) => Number(a) - Number(b));
		const monthVals = monthEntries.map(([, v]) => v as number);
		const monthLabels = monthEntries.map(([ts]) => {
			const d = new Date(Number(ts) * 1000);
			return `${d.getMonth() + 1}月`;
		});
		lines.push('```');
		lines.push(renderBarChart(monthVals, monthLabels, 24));
		lines.push('```');
		lines.push('');
	}

	// 今年读得最多的书
	if (annual.readLongest?.length) {
		lines.push(`### ${year} 年阅读时长 TOP${annual.readLongest.length}`);
		lines.push('');
		lines.push('| # | 书名 | 作者 | 阅读时长 | 标签 |');
		lines.push('|---|------|------|---------|------|');
		annual.readLongest.forEach((item, i) => {
			const title = item.book?.title ?? item.albumInfo?.name ?? '—';
			const author = item.book?.author ?? item.albumInfo?.authorName ?? '—';
			const tags = item.tags?.join('、') ?? '';
			lines.push(`| ${i + 1} | ${title} | ${author} | ${fmtDuration(item.readTime)} | ${tags} |`);
		});
		lines.push('');
	}

	// 今年偏好分类
	if (annual.preferCategory?.length) {
		lines.push(`### ${year} 年偏好分类`);
		lines.push('');
		lines.push('| 分类 | 阅读本数 | 阅读时长 |');
		lines.push('|------|---------|---------|');
		for (const cat of annual.preferCategory) {
			if (cat.readingTime > 0) {
				lines.push(`| ${cat.categoryTitle} | ${cat.readingCount} 本 | ${fmtDuration(cat.readingTime)} |`);
			}
		}
		lines.push('');
	}

	// 今年偏好作者
	if (annual.preferAuthor?.length) {
		lines.push(`### ${year} 年偏好作者`);
		lines.push('');
		lines.push('| 作者 | 阅读本数 | 阅读时长 |');
		lines.push('|------|---------|---------|');
		for (const a of annual.preferAuthor) {
			lines.push(`| ${a.name} | ${a.count} 本 | ${a.readTime} |`);
		}
		lines.push('');
	}

	// ── 三、本月数据 ──────────────────────────────────────────────────
	lines.push(`## 🗓️ 三、${year} 年 ${month} 月阅读概况`);
	lines.push('');
	lines.push(`| 指标 | 数值 |`);
	lines.push(`|------|------|`);
	lines.push(`| 本月阅读时长 | ${fmtDuration(monthly.totalReadTime)} |`);
	lines.push(`| 阅读天数 | ${monthly.readDays} 天 |`);
	lines.push(`| 日均时长 | ${fmtDuration(monthly.dayAverageReadTime)} |`);
	if (monthly.compare !== undefined) {
		const cmp = fmtCompare(monthly.compare);
		if (cmp) lines.push(`| 与上月日均对比 | ${cmp} |`);
	}
	if (monthly.readStat?.length) {
		for (const s of monthly.readStat) {
			lines.push(`| ${s.stat} | ${s.counts} |`);
		}
	}
	lines.push('');

	// 本月每日分布
	if (monthly.readTimes && Object.keys(monthly.readTimes).length > 0) {
		lines.push(`### ${month} 月每日阅读时长`);
		lines.push('');
		const dayEntries = Object.entries(monthly.readTimes)
			.sort(([a], [b]) => Number(a) - Number(b));
		const dayVals = dayEntries.map(([, v]) => v as number);
		const dayLabels = dayEntries.map(([ts]) => {
			const d = new Date(Number(ts) * 1000);
			return `${d.getDate()}日`;
		});
		lines.push('```');
		lines.push(renderBarChart(dayVals, dayLabels, 20));
		lines.push('```');
		lines.push('');
	}

	// 本月读得最多的书
	if (monthly.readLongest?.length) {
		lines.push(`### ${month} 月阅读时长 TOP${monthly.readLongest.length}`);
		lines.push('');
		lines.push('| # | 书名 | 作者 | 阅读时长 | 标签 |');
		lines.push('|---|------|------|---------|------|');
		monthly.readLongest.forEach((item, i) => {
			const title = item.book?.title ?? item.albumInfo?.name ?? '—';
			const author = item.book?.author ?? item.albumInfo?.authorName ?? '—';
			const tags = item.tags?.join('、') ?? '';
			lines.push(`| ${i + 1} | ${title} | ${author} | ${fmtDuration(item.readTime)} | ${tags} |`);
		});
		lines.push('');
	}

	// 本月偏好分类
	if (monthly.preferCategory?.length) {
		lines.push(`### ${month} 月偏好分类`);
		lines.push('');
		lines.push('| 分类 | 阅读本数 | 阅读时长 |');
		lines.push('|------|---------|---------|');
		for (const cat of monthly.preferCategory) {
			if (cat.readingTime > 0) {
				lines.push(`| ${cat.categoryTitle} | ${cat.readingCount} 本 | ${fmtDuration(cat.readingTime)} |`);
			}
		}
		lines.push('');
	}

	// ── 四、阅读偏好分析 ─────────────────────────────────────────────
	lines.push('## 🎯 四、阅读偏好分析（年度）');
	lines.push('');

	if (annual.preferCategoryWord) {
		lines.push(`> ${annual.preferCategoryWord}`);
		lines.push('');
	}

	// 阅读时段分布
	if (annual.preferTime?.length === 24) {
		lines.push('### 阅读时段分布');
		lines.push('');
		if (annual.preferTimeWord) {
			lines.push(`> ${annual.preferTimeWord}`);
			lines.push('');
		}
		lines.push('```');
		lines.push(renderBarChart(annual.preferTime, HOUR_LABELS, 20));
		lines.push('```');
		lines.push('');
	}

	// 文字/听书占比
	if (annual.readRate !== undefined && annual.wrReadTime && annual.wrListenTime) {
		lines.push('### 阅读方式');
		lines.push('');
		lines.push('| 方式 | 时长 | 占比 |');
		lines.push('|------|------|------|');
		lines.push(`| 文字阅读 | ${fmtDuration(annual.wrReadTime)} | ${annual.readRate}% |`);
		lines.push(`| 听书 | ${fmtDuration(annual.wrListenTime)} | ${100 - annual.readRate}% |`);
		lines.push('');
	}

	return lines.join('\n');
}

// ─── 主入口 ───────────────────────────────────────────────────────────────────

export default class SyncReadingStats {
	constructor(
		private vault: Vault,
		private apiManager: ApiRouter
	) {}

	async sync(): Promise<void> {
		const settings = get(settingsStore);
		if (!settings.wereadApiKey) {
			new Notice('请先在设置中填写微信读书 API Key（wrk-xxx）', 5000);
			return;
		}

		const notice = new Notice('正在获取阅读统计数据…', 0);

		try {
			const now = new Date();
			const year = now.getFullYear();
			const month = now.getMonth() + 1;

			// 年初时间戳（用于查询本年）
			const yearStart = Math.floor(new Date(year, 0, 1).getTime() / 1000);

			notice.setMessage('获取历史总计…');
			const overall = await this.apiManager.getReadingStats('overall');
			if (!overall) {
				notice.hide();
				new Notice('获取阅读统计失败，请检查 API Key 是否正确', 5000);
				return;
			}

			notice.setMessage(`获取 ${year} 年数据…`);
			const annual = await this.apiManager.getReadingStats('annually', yearStart);
			if (!annual) {
				notice.hide();
				new Notice('获取年度统计失败', 5000);
				return;
			}

			notice.setMessage(`获取 ${year} 年 ${month} 月数据…`);
			const monthly = await this.apiManager.getReadingStats('monthly');
			if (!monthly) {
				notice.hide();
				new Notice('获取月度统计失败', 5000);
				return;
			}

			notice.setMessage('生成统计文档…');
			const content = buildMarkdown(overall, annual, monthly, year, month);
			await this.saveFile(content, settings.readingStatsLocation);
			notice.hide();
			new Notice('✅ 阅读统计已同步', 4000);
		} catch (e) {
			notice.hide();
			new Notice('阅读统计同步失败，请查看控制台', 5000);
			console.error('[weread plugin] 阅读统计同步失败', e);
		}
	}

	private async saveFile(content: string, folder: string): Promise<void> {
		// 确保目录存在
		const safeFolder = folder.endsWith('/') ? folder.slice(0, -1) : folder;
		const dir = safeFolder === '' ? '' : safeFolder;
		if (dir) {
			const exists = await this.vault.adapter.exists(dir);
			if (!exists) {
				await this.vault.createFolder(dir);
			}
		}

		const filePath = dir ? `${dir}/微信读书阅读统计.md` : '微信读书阅读统计.md';
		const exists = await this.vault.adapter.exists(filePath);
		if (exists) {
			const file = this.vault.getAbstractFileByPath(filePath);
			if (file) {
				await this.vault.modify(file as any, content);
				return;
			}
		}
		await this.vault.create(filePath, content);
	}
}
