import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { build } from 'esbuild';

export const chromeBin =
	process.env.CHROME_BIN || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
export const chromeAvailable = await access(chromeBin).then(
	() => true,
	() => false
);
const obsidian = `export class Component { constructor() { this.children = new Set(); } addChild(c) { this.children.add(c); return c; } removeChild(c) { this.children.delete(c); c.onunload?.(); return c; } } export class ItemView extends Component {} export class TFile { constructor(path) { this.path = path; this.extension = 'md'; } } export class WorkspaceLeaf {} export const Platform = {isDesktopApp:false}; export class Notice { constructor(text) { window.detailNotices.push(text); } } export function setIcon(element, name) { const svg = document.createElementNS('http://www.w3.org/2000/svg','svg'); svg.setAttribute('viewBox','0 0 24 24'); svg.setAttribute('fill','none'); svg.setAttribute('stroke','currentColor'); svg.setAttribute('stroke-width','1.7'); const p = document.createElementNS(svg.namespaceURI,'path'); p.setAttribute('d',name==='star'?'m12 3 2.8 5.7 6.3.9-4.5 4.4 1.1 6.2-5.7-3-5.7 3 1.1-6.2L3.2 9.6l6.3-.9Z':'M9 9h12v12H9z M5 15H3V3h12v2'); svg.append(p); element.append(svg); }`;
const settings = `let value = {favoritesViewMode:'cards',bookOpenMode:'web'}; const listeners = new Set(); export const settingsStore = {subscribe(fn) { listeners.add(fn); fn(value); return () => listeners.delete(fn); }, set(next) { value=next; for(const fn of listeners) fn(value); }, actions: {setFavoritesViewMode(mode) { value={...value,favoritesViewMode:mode}; for(const fn of listeners) fn(value); }}, listenerCount:()=>listeners.size };`;

export async function bundleFixture(fixture) {
	const output = await build({
		stdin: { contents: fixture, resolveDir: process.cwd(), loader: 'ts' },
		bundle: true,
		platform: 'browser',
		external: ['electron'],
		format: 'iife',
		write: false,
		plugins: [
			{
				name: 'detail-fixtures',
				setup(builder) {
					builder.onResolve({ filter: /^obsidian$/ }, () => ({
						path: 'obsidian',
						namespace: 'mock'
					}));
					builder.onResolve({ filter: /(?:^|\/)settings$/ }, () => ({
						path: 'settings',
						namespace: 'mock'
					}));
					builder.onLoad({ filter: /.*/, namespace: 'mock' }, ({ path: name }) => ({
						contents: name === 'obsidian' ? obsidian : settings
					}));
					builder.onLoad({ filter: /\.css$/ }, async ({ path: filename }) => ({
						contents: `const s=document.createElement('style');s.textContent=${JSON.stringify(await readFile(filename, 'utf8'))};document.head.append(s);`,
						loader: 'js'
					}));
				}
			}
		]
	});
	return output.outputFiles[0].text;
}

export async function browserHarness(t) {
	const directory = await mkdtemp(path.join(tmpdir(), 'book-detail-chrome-'));
	const chrome = spawn(
		chromeBin,
		[
			'--headless=new',
			'--disable-gpu',
			'--no-first-run',
			'--no-default-browser-check',
			'--disable-background-networking',
			'--remote-debugging-pipe',
			`--user-data-dir=${directory}`,
			'about:blank'
		],
		{ stdio: ['ignore', 'ignore', 'pipe', 'pipe', 'pipe'] }
	);
	let errors = '';
	chrome.stderr.on('data', (chunk) => (errors += chunk));
	const exited = new Promise((resolve) => chrome.once('exit', resolve));
	let id = 0,
		buffer = '';
	const pending = new Map();
	chrome.stdio[4].on('data', (chunk) => {
		buffer += chunk;
		for (;;) {
			const delimiter = buffer.indexOf('\0');
			if (delimiter < 0) break;
			const message = JSON.parse(buffer.slice(0, delimiter));
			buffer = buffer.slice(delimiter + 1);
			const request = pending.get(message.id);
			if (!request) continue;
			pending.delete(message.id);
			clearTimeout(request.timer);
			message.error
				? request.reject(new Error(JSON.stringify(message.error)))
				: request.resolve(message.result);
		}
	});
	t.after(async () => {
		chrome.kill('SIGTERM');
		let timer;
		await Promise.race([
			exited,
			new Promise((resolve) => {
				timer = setTimeout(resolve, 2000);
			})
		]);
		clearTimeout(timer);
		if (chrome.exitCode === null && chrome.signalCode === null) {
			chrome.kill('SIGKILL');
			await exited;
		}
		for (const request of pending.values()) {
			clearTimeout(request.timer);
			request.reject(new Error('Chrome closed'));
		}
		pending.clear();
		const resolved = path.resolve(directory);
		assert.equal(path.dirname(resolved), path.resolve(tmpdir()));
		assert(path.basename(resolved).startsWith('book-detail-chrome-'));
		await rm(resolved, { recursive: true, force: true, maxRetries: 5, retryDelay: 150 });
	});
	const cdp = (method, params = {}, sessionId) =>
		new Promise((resolve, reject) => {
			const requestId = ++id;
			const timer = setTimeout(() => {
				pending.delete(requestId);
				reject(new Error(`CDP timeout: ${method}\n${errors}`));
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
	const target = await cdp('Target.createTarget', { url: 'about:blank' });
	const { sessionId } = await cdp('Target.attachToTarget', {
		targetId: target.targetId,
		flatten: true
	});
	const send = (method, params) => cdp(method, params, sessionId);
	await send('Page.enable');
	await send('Runtime.enable');
	await send('Network.enable');
	await send('Network.setBlockedURLs', { urls: ['http://*', 'https://*'] });
	await send('Emulation.setTimezoneOverride', { timezoneId: 'Asia/Shanghai' });
	await send('Page.setDocumentContent', {
		frameId: (await send('Page.getFrameTree')).frameTree.frame.id,
		html: '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head><body></body></html>'
	});
	return {
		send,
		async evaluate(expression) {
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
		},
		async viewport(width, height = 1000) {
			await send('Emulation.setDeviceMetricsOverride', {
				width,
				height,
				deviceScaleFactor: 1,
				mobile: width < 500
			});
		},
		async screenshot(filename) {
			const result = await send('Page.captureScreenshot', {
				format: 'png',
				captureBeyondViewport: true
			});
			await writeFile(filename, Buffer.from(result.data, 'base64'));
		}
	};
}
