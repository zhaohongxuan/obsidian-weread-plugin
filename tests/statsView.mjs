// Run: node --test tests/statsView.mjs
// Production Stats panel/CSS in Chrome, local fixtures only. Export is not invoked.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { build } from 'esbuild';

const chromeBin =
	process.env.CHROME_BIN || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
let available = true;
try {
	await access(chromeBin);
} catch {
	available = false;
}

const fixture = String.raw`
import { WereadReadingStatsPanel } from './src/components/wereadReadingStats';
import { settingsStore } from './src/settings';
const RealDate = Date;
const NOW = RealDate.parse('2026-11-06T04:00:00Z');
window.Date = class extends RealDate {
 constructor(...args) { if (args.length) super(...args); else super(NOW); }
 static now() { return NOW; }
};
const create = function(tag, options = {}) {
 if (typeof options === 'string') options = {cls: options};
 const node = document.createElement(tag);
 if (options.cls) node.className = options.cls;
 if (options.text !== undefined) node.textContent = options.text;
 for (const key of ['type', 'href', 'value']) if (options[key] !== undefined) node[key] = options[key];
 for (const [key, value] of Object.entries(options.attr || {})) node.setAttribute(key, value);
 this.append(node); return node;
};
HTMLElement.prototype.createEl = create;
HTMLElement.prototype.createDiv = function(options) { return create.call(this, 'div', options); };
HTMLElement.prototype.createSpan = function(options) { return create.call(this, 'span', options); };
HTMLElement.prototype.empty = function() { this.replaceChildren(); };
HTMLElement.prototype.addClass = function(...names) { this.classList.add(...names); };
HTMLElement.prototype.removeClass = function(...names) { this.classList.remove(...names); };
HTMLElement.prototype.setText = function(text) { this.textContent = text; };
Element.prototype.createSvg = function(tag, options = {}) {
 const node = document.createElementNS('http://www.w3.org/2000/svg', tag);
 for (const [key, value] of Object.entries(options.attr || {})) node.setAttribute(key, value);
 this.append(node); return node;
};
const assertions = [];
const check = (value, message) => { if (!value) throw new Error(message); assertions.push(message); };
const frame = () => new Promise(resolve => requestAnimationFrame(resolve));
const settle = async () => {
 for (let i = 0; i < 60; i++) {
  await frame();
  if (panel.data && !panel.loading && document.querySelector('.weread-stats-hero')) {
   await Promise.all([...document.images].map(image => image.decode().catch(() => {})));
   await frame(); return;
  }
 }
 throw new Error('Panel did not finish rendering fixture');
};
const svgData = (title, color) => 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="120" height="172"><rect width="120" height="172" rx="4" fill="' + color + '"/><path d="M12 0v172" stroke="#fff" opacity=".25"/><text x="65" y="69" text-anchor="middle" font-family="serif" font-size="16" fill="#fff">' + title + '</text><path d="M35 100h56M35 107h40" stroke="#fff" opacity=".55"/></svg>');
const titles = ['山间的阅读', '城市与记忆', '看见日常', '慢慢走', '一间自己的房间'];
const authors = ['林间', '周行', '陈默', '李晓', '弗吉尼亚·伍尔夫'];
const covers = ['#6f806c', '#8c7667', '#667e83', '#b29267', '#8c7d94'];
const ts = value => RealDate.parse(value) / 1000;
const readTimes = {[ts('2026-11-04T00:00:00+08:00')]: 960, [ts('2026-11-05T00:00:00+08:00')]: 1860, [ts('2026-11-06T00:00:00+08:00')]: 960};
const common = {
 totalReadTime: 3780, dayAverageReadTime: 1260, readDays: 3, compare: .12,
 readStat: [{stat: '读过', counts: '5本'}, {stat: '读完', counts: '2本'}, {stat: '笔记', counts: '18条'}],
 readLongest: titles.map((title, index) => ({book: {bookId: 'fixture-' + index, title, author: authors[index], cover: svgData(title, covers[index])}, readTime: [1260, 900, 720, 540, 360][index], tags: index === 0 ? ['文学', '读完'] : ['在读']})),
 preferCategory: [{categoryTitle: '文学', readingTime: 1800}, {categoryTitle: '历史', readingTime: 1080}, {categoryTitle: '生活', readingTime: 900}],
 preferCategoryWord: '在文字里，发现生活的层次',
 preferTime: [0, 0, 120, 360, 240, 0, 60, 0, 0, 120, 0, 60, 180, 720, 900, 540, 120, 0, 0, 0, 0, 0, 0, 0],
 preferTimeWord: '喜欢在夜晚安静阅读',
 preferAuthor: [{name: '林间', count: 3}, {name: '周行', count: 2}, {name: '陈默', count: 1}],
 preferPublisher: [{name: '理想国', count: 4}, {name: '新经典', count: 3}, {name: '上海译文', count: 2}, {name: '人民文学', count: 1}],
 registTime: ts('2024-01-01T00:00:00+08:00')
};
const calls = [];
const api = {async getReadingStats(mode, baseTime) {
 calls.push({mode, baseTime});
 let times = readTimes;
 if (mode === 'annually') times = {[ts('2026-09-01T00:00:00+08:00')]: 7200, [ts('2026-10-01T00:00:00+08:00')]: 10800, [ts('2026-11-01T00:00:00+08:00')]: 3780};
 if (mode === 'overall') times = {[ts('2024-01-01T00:00:00+08:00')]: 36000, [ts('2025-01-01T00:00:00+08:00')]: 72000, [ts('2026-01-01T00:00:00+08:00')]: 108000};
 return {...common, readTimes: times};
}};
settingsStore.value = {wereadApiKey: 'local-fixture-only', userVid: '', user: '山间读者', userSignature: '把日子读成一首诗', userAvatar: svgData('读', '#788875'), statsStartYear: 2024};
const main = document.createElement('main'); document.body.append(main);
let cacheAccesses = 0;
const noVaultAccess = () => { cacheAccesses++; throw new Error('Unexpected cache access in bar-chart fixture'); };
const app = {vault: {adapter: {exists: noVaultAccess, read: noVaultAccess, write: noVaultAccess}}, workspace: {}};
const panel = new WereadReadingStatsPanel(main, app, api, {});
// Avoid the separate multi-month daily-cache fanout in annual/overall heatmaps.
panel.chartView = {annually: 'bar', overall: 'bar'};
const click = async (selector, label) => {
 const button = [...document.querySelectorAll(selector)].find(node => label === undefined || node.textContent === label);
 check(button && !button.disabled, 'Control available: ' + (label || selector));
 button.click(); await settle();
};
const layout = mobile => {
 const trend = document.querySelector('.weread-stats-trend').getBoundingClientRect();
 const ranking = document.querySelector('.weread-stats-ranking').getBoundingClientRect();
 check(document.documentElement.scrollWidth <= innerWidth, 'No horizontal overflow at ' + innerWidth + 'px: ' + document.documentElement.scrollWidth);
 check(mobile ? ranking.top >= trend.bottom - 1 : ranking.left >= trend.right - 1 && Math.abs(ranking.top - trend.top) < 2, mobile ? 'Mobile stacks trend above ranking' : 'Desktop has trend/ranking columns');
 const bars = [...document.querySelectorAll('.weread-stats-trend .weread-stats-bar')];
 if (mobile && bars.length) {
  check(document.querySelector('.weread-stats-chart-detail').textContent.includes('11月4日') && document.querySelector('.weread-stats-chart-detail').textContent.includes('16分钟'), 'Resize preserves selected day and duration');
  const wrapper = document.querySelector('.weread-stats-trend .weread-stats-chart-wrapper').getBoundingClientRect();
  check(bars.every(bar => { const box = bar.getBoundingClientRect(); return box.left >= wrapper.left - 1 && box.right <= wrapper.right + 1; }), 'All daily bars fit the visible mobile chart');
  check(bars.at(-1).getAttribute('aria-label').includes('11月6日'), 'Latest November 6 bar stays visible');
 }
};
window.smoke = {
 assertions, calls, panel, settle, layout,
 async open() {
  await panel.onOpen(); await settle();
  check(calls.length === 1 && calls[0].mode === 'monthly', 'onOpen loads monthly fixture once');
  check(document.querySelector('.weread-stats-timepicker-label').textContent === '2026年11月', 'Period uses Asia/Shanghai fixture date');
  check(document.querySelectorAll('.weread-stats-book-row').length === 5, 'Ranking renders five books');
  check(document.querySelector('.weread-stats-export-btn')?.textContent.includes('导出图片'), 'Export rendered; export not invoked');
  check(document.querySelector('.weread-stats-overview .weread-stats-hero') && document.querySelector('.weread-stats-overview .weread-stats-kpi-grid'), 'Overview groups hero and KPIs');
  check(document.querySelector('.weread-stats-rhythm-grid'), 'Monthly renders daily rhythm');
  check(document.querySelectorAll('.weread-stats-trend .weread-stats-bar').length === 6, 'Current month shows elapsed six days only');
  check(getComputedStyle(document.querySelector('h1')).fontFamily.includes('Songti SC'), 'Heading inherits reference serif environment');
  const categories = [...document.querySelectorAll('.weread-stats-category-row')];
  check(categories.length === 3 && categories.every(row => row.textContent.includes('%') && row.textContent.includes('分钟')), 'Category rows expose duration and share');
  check(categories.find(row => row.textContent.includes('文学'))?.textContent.includes('30分钟'), 'Literature category shows its actual 30-minute fixture');
  layout(false); return assertions;
 },
 async controls() {
  const original = calls.length; await click('.weread-stats-timepicker-btn');
  check(calls.length === original + 1 && document.querySelector('.weread-stats-timepicker-label').textContent === '2026年10月', 'Previous loads previous month');
  check(document.querySelectorAll('.weread-stats-trend .weread-stats-bar').length === 31, 'Past month retains all 31 days');
  const next = document.querySelectorAll('.weread-stats-timepicker-btn')[1];
  check(!next.disabled, 'Next available from previous month'); next.click(); await settle();
  check(document.querySelector('.weread-stats-timepicker-label').textContent === '2026年11月' && document.querySelectorAll('.weread-stats-timepicker-btn')[1].disabled, 'Next returns to present and blocks future navigation');
  await click('.weread-stats-view-toggle-btn[title="日历"]');
  check(document.querySelector('.weread-calendar-cell[title="11月5日：31分钟"]'), 'Calendar shows fixture daily duration');
  layout(false); await click('.weread-stats-view-toggle-btn[title="柱状图"]');
  const detail = document.querySelector('.weread-stats-chart-detail');
  if (detail) {
   const bar = [...document.querySelectorAll('.weread-stats-trend .weread-stats-bar')].find(node => node.querySelector('title')?.textContent.includes('31分钟'));
   check(bar, 'Chart has 31-minute bar');
   bar.dispatchEvent(new MouseEvent('mouseenter', {bubbles: true})); bar.dispatchEvent(new MouseEvent('mouseover', {bubbles: true}));
   check(detail.textContent.includes('31分钟'), 'Hover updates chart detail');
   const focusBar = [...document.querySelectorAll('.weread-stats-trend .weread-stats-bar')].find(node => node.querySelector('title')?.textContent.includes('16分钟'));
   focusBar.focus(); focusBar.dispatchEvent(new FocusEvent('focus'));
   check(document.activeElement === focusBar && detail.textContent.includes('16分钟'), 'Keyboard focus updates chart detail');
   focusBar.dispatchEvent(new KeyboardEvent('keydown', {key: 'ArrowRight', bubbles: true}));
   check(document.activeElement === bar && detail.textContent.includes('31分钟'), 'ArrowRight selects the next bar');
   check(document.querySelectorAll('.weread-stats-trend .weread-stats-bar[tabindex="0"]').length === 1, 'Chart has one keyboard tab stop');
  }
  await click('.weread-stats-tab', '周');
  check(panel.currentMode === 'weekly' && document.querySelector('.weread-stats-rhythm-grid'), 'Weekly loads weekly rhythm');
  for (const [label, mode] of [['年','annually'], ['全部','overall']]) {
   const before = calls.length; await click('.weread-stats-tab', label);
   check(panel.currentMode === mode && calls.length === before + 1, mode + ' makes one fixture request');
   check(!document.querySelector('.weread-stats-rhythm-grid'), mode + ' omits misleading daily rhythm');
   check(document.querySelector('.weread-stats-trend') && document.querySelector('.weread-stats-ranking'), mode + ' retains trend/ranking');
   if (mode === 'overall') check(!document.querySelector('.weread-stats-timepicker'), 'Overall hides period navigation');
  }
  check(cacheAccesses === 0, 'Bar fixtures never access the daily disk cache');
  await click('.weread-stats-tab', '月');
  const selected = [...document.querySelectorAll('.weread-stats-trend .weread-stats-bar')].find(bar => bar.getAttribute('aria-label').includes('11月4日'));
  selected.focus(); selected.dispatchEvent(new FocusEvent('focus'));
  check(document.querySelector('.weread-stats-chart-detail').textContent.includes('16分钟'), 'Select 16-minute bar before resizing');
  return assertions;
 },
 async heatmap(mobile = false) {
   const daily = {};
   for (const date = new RealDate(2024, 0, 1); date <= new RealDate(NOW); date.setDate(date.getDate() + 1)) {
    daily[date.getFullYear() + '-' + date.getMonth() + '-' + date.getDate()] = date.getDay() < 5 ? (date.getDate() % 4 + 1) * 600 : 0;
   }
   panel.currentMode = 'overall'; panel.chartView.overall = 'heatmap';
   panel.data = {...common, readTimes, _allDailyReadTimes: daily, _statsStartYear: 2024};
   panel.render(); await settle();
   const labels = [...document.querySelectorAll('.weread-ghmap-monthlabel')].map(node => node.textContent).filter(Boolean);
   check(labels.length === 36 && labels.every((label, i) => label === String(i % 12 + 1)), 'Every year shows complete numeric month labels without clipped suffixes');
   check(document.querySelector('.weread-ghmap-col .weread-ghmap-cell:not(.is-empty)').getBoundingClientRect().width > 10, 'Heatmap cells remain comfortably sized');
   check(document.documentElement.scrollWidth <= innerWidth, 'Heatmap never overflows the page');
   const inner = document.querySelector('.weread-ghmap-inner').getBoundingClientRect(), wrap = document.querySelector('.weread-allheatmap-wrap').getBoundingClientRect();
   check(mobile ? inner.width > wrap.width : inner.right <= wrap.right + 1, mobile ? 'Narrow heatmap scrolls inside its own card' : 'Wide heatmap shows the complete year');
   check(cacheAccesses === 0, 'Cached heatmap fixtures do not fetch or rescan daily records');
   return assertions;
  },
  async close() { await panel.onClose(); check(!main.children.length, 'Close removes content'); return assertions; }
};
`;

const hostCss = `
* { box-sizing: border-box; }
body { margin: 0; font-family: var(--font-interface); background: var(--background-primary); color: var(--text-normal);
 --font-interface: -apple-system, BlinkMacSystemFont, sans-serif;
 --font-text: 'Songti SC', 'Noto Serif CJK SC', 'Source Han Serif SC', Georgia, serif;
 --font-text-theme: var(--font-text); --font-heading: var(--font-text); --font-heading-theme: var(--font-text);
 --background-primary: #fbfaf7; --background-secondary: #f3f1ec; --background-modifier-border: #e2e0d9;
 --background-modifier-hover: #eeede7; --background-modifier-form-field: #fff;
 --text-normal: #292d29; --text-muted: #72756d; --text-faint: #96988e; --text-on-accent: #fff;
 --interactive-accent: #5f765c; --interactive-accent-hover: #52694f; --interactive-normal: #fff;
 --text-accent: #5f765c; --color-green: #668765; --color-red: #b76c61;
 --radius-s: 4px; --radius-m: 8px; --radius-l: 12px;
}
main { width: 100%; min-width: 0; }
button, input, select { font: inherit; color: inherit; }
/* Simulate the host theme's native pill defaults. */
button { appearance: none; border: 1px solid #d8d9d0; border-radius: 999px; background: var(--interactive-normal); padding: 8px 18px; min-height: 32px; box-shadow: 0 1px 2px #00000012; cursor: pointer; }
button:disabled { opacity: .45; cursor: default; }
button svg { width: 16px; height: 16px; }
body.theme-dark { --background-primary: #222620; --background-secondary: #2b3029; --background-modifier-border: #41483d; --background-modifier-hover: #363d32; --text-normal: #e7e8df; --text-muted: #a8af9f; --text-faint: #828b79; --interactive-normal: #30372c; --interactive-accent: #9bac88; --text-accent: #b5c4a4; }
`;

async function browserBundle() {
	const output = await build({
		stdin: { contents: fixture, resolveDir: process.cwd(), loader: 'ts' },
		bundle: true,
		platform: 'browser',
		format: 'iife',
		write: false,
		plugins: [
			{
				name: 'stats-browser-fixtures',
				setup(builder) {
					builder.onResolve({ filter: /^obsidian$/ }, () => ({
						path: 'obsidian',
						namespace: 'mock'
					}));
					builder.onResolve({ filter: /(?:^|\/)settings$/ }, () => ({
						path: 'settings',
						namespace: 'mock'
					}));
					builder.onResolve({ filter: /^svelte\/store$/ }, () => ({
						path: 'svelte',
						namespace: 'mock'
					}));
					builder.onLoad({ filter: /.*/, namespace: 'mock' }, ({ path: name }) => ({
						contents:
							name === 'obsidian'
								? `
     export class Component { addChild(child) { return child; } removeChild(child) { child.onunload?.(); return child; } }
     export class ItemView extends Component {} export class Modal {} export class Notice { constructor(text) { console.info(text); } }
     export class TFile {} export class Vault {} export class App {} export class Menu {} export class WorkspaceLeaf {}
     export function setIcon(el, name) { const svg = document.createElementNS('http://www.w3.org/2000/svg','svg'); svg.setAttribute('viewBox','0 0 24 24'); svg.setAttribute('fill','none'); svg.setAttribute('stroke','currentColor'); svg.setAttribute('stroke-width','1.7'); svg.setAttribute('aria-hidden','true'); const p = document.createElementNS(svg.namespaceURI,'path'); const paths = {'chevron-left':'m15 18-6-6 6-6','chevron-right':'m9 18 6-6-6-6','image-down':'M13 3H3v18h18V11M17 3v10m-4-4 4 4 4-4M3 16l5-5 8 10','bar-chart-2':'M5 20V10m7 10V4m7 16v-7','calendar-days':'M3 5h18v16H3zM3 10h18M7 3v4m10-4v4','clock':'M12 7v5l3 2M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0'}; p.setAttribute('d', paths[name] || 'M4 5h16v14H4zM8 9h8m-8 4h6'); svg.append(p); el.append(svg); }
    `
								: name === 'settings'
									? 'export const settingsStore = {value: {}, actions: {setUserSignature() {}}};'
									: 'export const get = store => store.value;'
					}));
					builder.onLoad({ filter: /\.css$/ }, async ({ path: filename }) => ({
						contents:
							'const style = document.createElement("style"); style.textContent = ' +
							JSON.stringify(await readFile(filename, 'utf8')) +
							'; document.head.append(style);',
						loader: 'js'
					}));
				}
			}
		]
	});
	return output.outputFiles[0].text;
}

function cdpClient(chrome) {
	let id = 0,
		buffer = '';
	const pending = new Map();
	chrome.stdio[4].on('data', (chunk) => {
		buffer += chunk.toString();
		for (;;) {
			const delimiter = buffer.indexOf('\0');
			if (delimiter < 0) break;
			const message = JSON.parse(buffer.slice(0, delimiter));
			buffer = buffer.slice(delimiter + 1);
			const request = pending.get(message.id);
			if (!request) continue;
			pending.delete(message.id);
			clearTimeout(request.timer);
			if (message.error) request.reject(new Error(JSON.stringify(message.error)));
			else request.resolve(message.result);
		}
	});
	chrome.once('exit', () => {
		for (const request of pending.values()) {
			clearTimeout(request.timer);
			request.reject(new Error('Chrome exited'));
		}
		pending.clear();
	});
	return (method, params = {}, sessionId) =>
		new Promise((resolve, reject) => {
			const requestId = ++id;
			const timer = setTimeout(() => {
				pending.delete(requestId);
				reject(new Error('CDP timeout: ' + method));
			}, 15000);
			pending.set(requestId, { resolve, reject, timer });
			chrome.stdio[3].write(
				JSON.stringify({
					id: requestId,
					method,
					params,
					...(sessionId ? { sessionId } : {})
				}) + '\0'
			);
		});
}

test(
	'production Stats panel layout and controls in Chrome with local fixtures',
	{ skip: !available, timeout: 60000 },
	async (t) => {
		const bundle = await browserBundle();
		const directory = await mkdtemp(path.join(tmpdir(), 'stats-view-chrome-'));
		const chrome = spawn(
			chromeBin,
			[
				'--headless=new',
				'--disable-gpu',
				'--no-first-run',
				'--no-default-browser-check',
				'--disable-background-networking',
				'--remote-debugging-pipe',
				'--user-data-dir=' + directory,
				'about:blank'
			],
			{ stdio: ['ignore', 'ignore', 'pipe', 'pipe', 'pipe'] }
		);
		let chromeErrors = '';
		chrome.stderr.on('data', (chunk) => {
			chromeErrors += chunk.toString();
		});
		const exited = new Promise((resolve) => chrome.once('exit', resolve));
		t.after(async () => {
			chrome.kill('SIGTERM');
			await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 2000))]);
			if (chrome.exitCode === null && chrome.signalCode === null) {
				chrome.kill('SIGKILL');
				await exited;
			}
			const resolved = path.resolve(directory);
			assert.equal(path.dirname(resolved), path.resolve(tmpdir()));
			assert(path.basename(resolved).startsWith('stats-view-chrome-'));
			// Chromium helpers may finish profile writes just after the browser exits.
			await rm(resolved, { recursive: true, force: true, maxRetries: 5, retryDelay: 150 });
		});
		const cdp = cdpClient(chrome);
		let sessionId;
		try {
			const target = await cdp('Target.createTarget', { url: 'about:blank' });
			({ sessionId } = await cdp('Target.attachToTarget', {
				targetId: target.targetId,
				flatten: true
			}));
		} catch (error) {
			throw new Error(error.message + '\n' + chromeErrors);
		}
		const send = (method, params) => cdp(method, params, sessionId);
		await send('Page.enable');
		await send('Runtime.enable');
		await send('Network.enable');
		await send('Network.setBlockedURLs', { urls: ['http://*', 'https://*'] });
		await send('Emulation.setTimezoneOverride', { timezoneId: 'Asia/Shanghai' });
		const resize = (width, height, mobile) =>
			send('Emulation.setDeviceMetricsOverride', {
				width,
				height,
				deviceScaleFactor: 1,
				mobile
			});
		await resize(1100, 1000, false);
		await send('Page.setDocumentContent', {
			frameId: (await send('Page.getFrameTree')).frameTree.frame.id,
			html: '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head><body class="theme-light"></body></html>'
		});
		const evaluate = async (expression) => {
			const result = await send('Runtime.evaluate', {
				expression,
				awaitPromise: true,
				returnByValue: true
			});
			if (result.exceptionDetails)
				throw new Error(
					result.exceptionDetails.exception?.description || result.exceptionDetails.text
				);
			return result.result.value;
		};
		const appendCss = (css) =>
			evaluate(
				'(() => { const style = document.createElement("style"); style.textContent = ' +
					JSON.stringify(css) +
					'; document.head.append(style); })()'
			);
		await appendCss(hostCss);
		await evaluate(bundle);
		// Main imports legacy style.css after the Stats module; verify that cascade too.
		await appendCss(await readFile('style.css', 'utf8'));
		await evaluate('smoke.open()');
		const screenshot = async (filename) => {
			await evaluate('smoke.settle()');
			const shot = await send('Page.captureScreenshot', {
				format: 'png',
				captureBeyondViewport: true
			});
			await writeFile(filename, Buffer.from(shot.data, 'base64'));
		};
		await screenshot('/tmp/obsidian-weread-stats-redesign.png');
		await evaluate('smoke.controls()');
		await evaluate('document.querySelector("main").style.width = "500px"');
		await evaluate('smoke.settle().then(() => smoke.layout(true))');
		await evaluate('document.querySelector("main").style.width = ""');
		await resize(390, 844, true);
		await evaluate('smoke.settle().then(() => smoke.layout(true))');
		await screenshot('/tmp/obsidian-weread-stats-redesign-mobile.png');
		await resize(1100, 1000, false);
		await evaluate('document.body.className = "theme-dark"');
		await evaluate('smoke.settle().then(() => smoke.layout(false))');
		await screenshot('/tmp/obsidian-weread-stats-redesign-dark.png');
		await evaluate('document.body.className = "theme-light"');
		await evaluate('smoke.heatmap()');
		await screenshot('/tmp/obsidian-weread-heatmap.png');
		await resize(390, 844, true);
		await evaluate('smoke.heatmap(true)');
		await screenshot('/tmp/obsidian-weread-heatmap-mobile.png');
		const assertions = await evaluate('smoke.close()');
		assert(assertions.length >= 30);
		t.diagnostic(
			assertions.length +
				' browser assertions passed; desktop, mobile and dark screenshots saved in /tmp. Export button checked; image export not invoked.'
		);
	}
);
