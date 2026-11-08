// Run: node --test tests/bookshelfFilters.mjs
// Missing Chrome explicitly skips these tests; set CHROME_BIN to exercise the UI.
// Optional BOOKSHELF_FILTER_SCREENSHOTS=/tmp/bookshelf-ui writes 320/390/1100px PNGs.
// Production bookshelf panel/CSS in isolated Chrome; synthetic services, zero vault/API I/O.
import assert from 'node:assert/strict';
import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { build } from 'esbuild';
import { browserHarness, chromeAvailable } from './helpers/detailBrowserHarness.mjs';

const obsidian = String.raw`
export class Component { constructor(){this.children=new Set();this.disposers=[];} addChild(c){this.children.add(c);return c;} removeChild(c){this.children.delete(c);c.unload();} registerDomEvent(el,event,handler,options){el.addEventListener(event,handler,options);this.disposers.push(()=>el.removeEventListener(event,handler,options));} unload(){this.onunload?.();for(const dispose of this.disposers.splice(0))dispose();} }
export class ItemView extends Component {}
export class Modal { constructor(){this.contentEl=document.createElement('div');} open(){throw new Error('Unexpected modal');} }
export class Menu {}
export class Notice { constructor(text){window.notices.push(text);} }
export const Platform={isDesktopApp:true};
export function setIcon(el,name){el.replaceChildren();const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('viewBox','0 0 24 24');svg.setAttribute('data-icon',name);svg.setAttribute('aria-hidden','true');el.append(svg);}
export function setTooltip(el,text){el.setAttribute('aria-label',text);}
export function moment(value){const d=new Date(value);return {isValid:()=>Number.isFinite(d.valueOf()),unix:()=>d.valueOf()/1000,format:()=>String(d.getFullYear())};}
`;
const settings = String.raw`
const value={wereadApiKey:'synthetic-not-a-real-key',cookies:[],isCookieValid:false,bookshelfSourceMode:'bookshelf',bookshelfDefaultSyncStatusFilter:'all',bookshelfViewMode:'list',bookshelfSortMode:'title',bookshelfGroupByYear:false,bookshelfShowCoverTitle:true,saveArticleToggle:true,lastSyncTime:0,lastSyncBookCount:0};
const listeners=new Set();
export const settingsStore={subscribe(fn){listeners.add(fn);fn(value);return ()=>listeners.delete(fn);},listenerCount:()=>listeners.size,actions:{setBookshelfViewMode(mode){value.bookshelfViewMode=mode;}}};
`;
async function bundle() {
	const output = await build({
		stdin: { contents: fixture, resolveDir: process.cwd(), loader: 'ts' },
		bundle: true,
		platform: 'browser',
		format: 'iife',
		write: false,
		plugins: [
			{
				name: 'bookshelf-filter-fixture',
				setup(builder) {
					builder.onResolve({ filter: /^obsidian$/ }, () => ({
						path: 'obsidian',
						namespace: 'fixture'
					}));
					builder.onResolve({ filter: /(?:^|\/)settings$/ }, () => ({
						path: 'settings',
						namespace: 'fixture'
					}));
					builder.onResolve({ filter: /(?:^|\/)syncLogModal$/ }, () => ({
						path: 'syncLogModal',
						namespace: 'fixture'
					}));
					builder.onResolve({ filter: /(?:^|\/)parser\/parseResponse$/ }, () => ({
						path: 'parseResponse',
						namespace: 'fixture'
					}));
					builder.onLoad({ filter: /.*/, namespace: 'fixture' }, ({ path }) => ({
						contents:
							path === 'obsidian'
								? obsidian
								: path === 'settings'
									? settings
									: path === 'parseResponse'
										? 'export const getPcUrl=id=>"https://fixture.invalid/"+id; export const parseMetadata=entry=>entry.book;'
										: 'export class SyncLogModal { open(){window.historyOpened=(window.historyOpened||0)+1;} }',
						loader: 'js'
					}));
					builder.onLoad({ filter: /\.css$/ }, async ({ path }) => ({
						contents: `const style=document.createElement('style');style.textContent=${JSON.stringify(await readFile(path, 'utf8'))};document.head.append(style);`,
						loader: 'js'
					}));
				}
			}
		]
	});
	return output.outputFiles[0].text;
}

const fixture = String.raw`
import './style.css';
import { WereadBookshelfPanel } from './src/components/wereadBookshelf';
import { settingsStore } from './src/settings';
window.notices=[];
const errors=[];
window.addEventListener('error',e=>errors.push(e.message));
window.addEventListener('unhandledrejection',e=>errors.push(String(e.reason)));
const assertions=[];
const check=(condition,label)=>{if(!condition)throw new Error(label);assertions.push(label);};
const same=(actual,expected,label)=>check(JSON.stringify([...actual].sort())===JSON.stringify([...expected].sort()),label+'; got '+JSON.stringify(actual));
const tick=()=>new Promise(resolve=>setTimeout(resolve,0));
const create=function(tag,options={}){if(typeof options==='string')options={cls:options};const node=document.createElement(tag);if(options.cls)node.className=options.cls;if(options.text!==undefined)node.textContent=options.text;for(const key of ['type','value','href'])if(options[key]!==undefined)node[key]=options[key];for(const [key,value]of Object.entries(options.attr||{}))node.setAttribute(key,value);this.append(node);return node;};
HTMLElement.prototype.createEl=create;
HTMLElement.prototype.createDiv=function(options){return create.call(this,'div',options);};
HTMLElement.prototype.createSpan=function(options){return create.call(this,'span',options);};
HTMLElement.prototype.empty=function(){this.replaceChildren();};
HTMLElement.prototype.addClass=function(...names){this.classList.add(...names);};
HTMLElement.prototype.removeClass=function(...names){this.classList.remove(...names);};
HTMLElement.prototype.toggleClass=function(name,enabled){this.classList.toggle(name,enabled);};
HTMLElement.prototype.setText=function(text){this.textContent=text;};
HTMLElement.prototype.setAttr=function(name,value){this.setAttribute(name,value);};
const style=document.createElement('style');style.textContent='*{box-sizing:border-box}body{margin:0;background:#fafaf8;color:#292d29;font-family:-apple-system,BlinkMacSystemFont,sans-serif;--background-primary:#fff;--background-secondary:#f3f1ec;--background-modifier-border:#dddcd5;--text-normal:#292d29;--text-muted:#72756d;--text-faint:#8a8e83;--interactive-accent:#5f765c;--text-accent:#5f765c;--interactive-normal:#fff;--background-modifier-hover:#e8eddf}main{width:100%;height:100vh}button,input,select{font:inherit;padding:7px 11px;border:1px solid var(--background-modifier-border);background:var(--background-primary);border-radius:6px;color:inherit}button{cursor:pointer}svg{width:18px;height:18px}';document.head.append(style);
const book=(bookId,title,category,extra={})=>({bookId,title,category,author:'合成作者 '+bookId,remoteExists:true,hasLocalFile:false,isLocalOnly:false,isArticle:false,noteCount:0,reviewCount:0,countsKnown:true,finished:false,progress:{state:'loaded',readingProgress:35},lastReadDate:'2026-10-01',...extra});
const books=[
 book('novel-read','小说在读','小说',{hasLocalFile:true,noteCount:2,reviewCount:1}),
 book('novel-done','小说读完','小说',{finished:true,progress:{state:'loaded',readingProgress:100}}),
 book('history-read','历史在读','历史'),
 book('philosophy-done','哲学读完','哲学宗教',{hasLocalFile:true,finished:true,noteCount:3,progress:{state:'loaded',readingProgress:100}}),
 book('unknown','分类缺失',undefined,{lastReadDate:undefined,progress:{state:'idle'}}),
 book('local','离线历史','历史',{remoteExists:false,hasLocalFile:true,isLocalOnly:true,localFile:{file:{path:'synthetic/local.md'}},noteCount:4}),
 book('article','文章样本','历史',{isArticle:true})
];
const collection={books,folders:[{id:'folder-one',name:'周末阅读',bookIds:['novel-read','novel-done','history-read','novel-read']},{id:'folder-two',name:'思考书单',bookIds:['novel-read','philosophy-done','unknown']}],albums:[],hasArticleCollection:false,remoteEntryCount:6};
let panel,root,detail,selection,syncCalls=[],resolveSync,loadCalls=0;
const unexpected=()=>{throw new Error('Unexpected native/upstream I/O');};
const plugin={app:{vault:{getFiles:unexpected,adapter:{read:unexpected,write:unexpected}},workspace:{getLeaf:unexpected}},startSync(force,signal){syncCalls.push({force,signal});return new Promise(resolve=>resolveSync=resolve);},syncBookById:unexpected,deleteLocalBookByPath:unexpected,openWereadSettingsTab:unexpected,openPreferredReadingView:unexpected};
const service={async getCollection(){loadCalls++;return collection;},getLocalCollection:unexpected,clearProgressCache(){},getProgress(id){return books.find(book=>book.bookId===id)?.progress||{state:'idle'};},async loadProgressForBooks(){}};
const mount=async()=>{if(panel){await panel.onClose();panel.unload();}root?.remove();detail?.remove();root=document.body.createEl('main');panel=new WereadBookshelfPanel(root,plugin,service,undefined,async value=>{selection=value;root.hidden=true;detail=document.body.createEl('section',{text:'合成详情'});detail.createEl('button',{text:'返回书架'}).onclick=()=>{detail.remove();root.hidden=false;};});await panel.onOpen();await tick();};
const search=()=>root.querySelector('.weread-bookshelf-search');
const actions=()=>[...root.querySelectorAll('.weread-bookshelf-toolbar-actions button')];
const syncAction=()=>actions()[0];
const labels={genre:'筛选书籍分类',kind:'筛选书籍类型',sync:'筛选同步状态',reading:'筛选阅读状态'};
const control=key=>root.querySelector('select[aria-label="'+labels[key]+'"]');
const select=(key,value)=>{const node=control(key);check(node&&[...node.options].some(option=>option.value===value),'Native select option available: '+key+' / '+value);node.value=value;node.dispatchEvent(new Event('change',{bubbles:true}));check(node.value===value&&!node.multiple&&node.selectedOptions.length===1,'Native dropdown stays single-select: '+key+' / '+value);};
const cards=()=>[...root.querySelectorAll('.weread-bookshelf-grid .weread-bookshelf-card')];
const cardId=node=>books.find(book=>book.title===node.querySelector('.weread-bookshelf-card-title')?.textContent)?.bookId;
const folderNames=()=>[...root.querySelectorAll('.weread-bookshelf-folder-title')].map(node=>node.textContent);
const expectBooks=(expected,label)=>{const ids=cards().map(cardId);check(ids.every(Boolean)&&new Set(ids).size===ids.length,'Rendered book IDs are known and unique: '+label);same(ids,expected,label);};
const expectCount=count=>check([...root.querySelectorAll('.weread-bookshelf-summary [aria-label]')].some(node=>node.getAttribute('aria-label').includes('筛选匹配 '+count+' 本')),'Original summary reports filtered book count '+count);
const emptyText=()=>root.querySelector('.weread-bookshelf-empty').textContent;
const setSearch=value=>{search().value=value;search().dispatchEvent(new Event('input',{bubbles:true}));};
const openFolder=name=>{const button=[...root.querySelectorAll('.weread-bookshelf-folder-card')].find(node=>node.querySelector('.weread-bookshelf-folder-title').textContent===name);check(button,'Folder available: '+name);button.click();};
const backFromFolder=()=>{const button=root.querySelector('.weread-bookshelf-folder-navigation button');check(button,'Folder back is available');button.click();};
window.bookshelfSmoke={assertions,errors,mount,
 header(){
  check(root.querySelector('.weread-bookshelf-toolbar')&&search().type==='search','Original toolbar and accessible search are retained');
  check(actions().length===2,'Original toolbar retains exactly sync and sync-history icon actions');
  same(actions().map(button=>button.querySelector('svg')?.getAttribute('data-icon')),['refresh-ccw','history'],'Sync and history retain their original icon affordances');
  check(actions().every(button=>button.textContent===''),'Sync and history retain icon-button presentation');
  check(syncAction().getAttribute('aria-label')?.includes('同步'),'Sync icon has an accessible action name');
  check(root.querySelectorAll('.weread-bookshelf-toolbar select').length===4,'One category dropdown is added alongside the original three');
  same([...control('genre').options].map(option=>option.textContent),['全部分类','小说','历史','哲学宗教','暂未获取分类'],'Category dropdown uses official primary categories and an honest unknown label');
  for(const key of Object.keys(labels))check(control(key)&&!control(key).multiple&&control(key).value==='all','Named native dropdown starts with ALL: '+key);
  check(root.querySelector('.weread-bookshelf-summary-card'),'Original summary-card layout is retained');
  check(syncCalls.length===0,'Opening the panel never synchronizes notes implicitly');
  actions()[1].click();check(window.historyOpened===1,'Retained history icon opens the mocked sync-history modal');
 },
 startSync(){syncAction().click();check(syncCalls.length===1&&!syncCalls[0].force,'Sync icon starts normal synchronization');check(syncAction().querySelector('[data-icon="square"]')&&syncAction().getAttribute('aria-label')?.includes('取消'),'Pending sync exposes its original cancellation icon and accessible name');},
 cancelSync(){syncAction().click();check(syncCalls[0].signal.cancelled,'Cancellation reaches the original sync signal');check(syncCalls.length===1,'Cancel never starts another sync');},
 async finishSync(){resolveSync(0);await tick();check(syncAction().querySelector('[data-icon="refresh-ccw"]')&&!syncAction().disabled,'Cancelled sync restores its original icon action');},
 forceSync(){check(syncAction().getAttribute('aria-label')?.includes('强制'),'Alt exposes the original force-sync accessible name');syncAction().click();check(syncCalls.length===2&&syncCalls[1].force===true,'Alt-key force reaches the original sync API');},
 async finishForce(){resolveSync(0);await tick();check(syncAction().querySelector('[data-icon="refresh-ccw"]')&&loadCalls===1,'Zero-change sync completion preserves the shelf without native file work');},
 layout(width){
  root.scrollTop=0;
  const toggle=root.querySelector('.weread-bookshelf-filter-toggle');
  const narrow=getComputedStyle(toggle).display!=='none';
  const dropdowns=root.querySelector('.weread-bookshelf-filter-dropdowns');
  if(narrow&&!dropdowns.classList.contains('is-open'))toggle.click();
  check(document.documentElement.scrollWidth<=width+1&&document.body.scrollWidth<=width+1,'Page has no horizontal overflow at '+width);
  check(root.scrollWidth<=root.clientWidth+1,'Production pane has no horizontal overflow at '+width);
  for(const node of [search(),...actions(),...Object.keys(labels).map(control)]){node.scrollIntoView({block:'nearest',inline:'nearest'});const rect=node.getBoundingClientRect();const css=getComputedStyle(node);check(rect.width>0&&rect.height>=24&&rect.left>=-1&&rect.right<=width+1,'Original control is visible and contained at '+width+': '+(node.getAttribute('aria-label')||node.tagName));check(parseFloat(css.fontSize)>=12,'Original control stays readable at '+width);}
  check(!control('genre').multiple&&control('genre').getAttribute('aria-label')===labels.genre,'Category dropdown preserves native keyboard and accessible semantics at '+width);
 },
 resetScroll(){root.scrollTop=0;root.scrollLeft=0;},
 prepareKeyboard(){select('genre','all');control('genre').focus();check(document.activeElement===control('genre'),'Native category select accepts keyboard focus');},
 verifyTab(){check(document.activeElement instanceof HTMLSelectElement&&document.activeElement!==control('genre'),'Tab advances to another original native dropdown');},
 async close(){await panel.onClose();panel.unload();check(settingsStore.listenerCount()===0&&root.children.length===0,'Closing production panel unsubscribes and clears its DOM');},
 async filters(){
  same(folderNames(),['周末阅读','思考书单'],'Unfiltered shelf preserves original folder tiles');
  select('genre','category:小说');expectBooks(['novel-read','novel-done'],'Category reveals matching folder members directly');expectCount(2);
  check(folderNames().length===0,'Selected category avoids folder indirection');
  select('reading','finished');expectBooks(['novel-done'],'Category and reading intersect');expectCount(1);
  select('sync','synced');expectBooks([],'Category, reading and sync combine with AND');expectCount(0);
  check(emptyText().includes('没有找到匹配'),'Empty intersection explains no matches');
  select('reading','all');expectBooks(['novel-read'],'Reading ALL preserves category and sync');expectCount(1);
  select('genre','all');same(folderNames(),['周末阅读','思考书单'],'Category ALL restores original folder behavior while sync filter remains');check(control('sync').value==='synced','Clearing category preserves selected sync state');expectCount(2);
  select('sync','localOnly');expectBooks(['local'],'Original local-only status exposes loose local notes');
  select('genre','category:小说');expectBooks([],'Category and local-only can intersect to zero');
  select('genre','category:历史');expectBooks(['local'],'Changing category replaces its single selection');
  select('sync','all');expectBooks(['history-read','local','article'],'Sync ALL restores every matching history book');expectCount(3);
  select('kind','book');expectBooks(['history-read','local'],'Original book-type select intersects category');expectCount(2);
  select('kind','article');expectBooks(['article'],'Original article select replaces book selection');expectCount(1);
  select('kind','all');expectBooks(['history-read','local','article'],'Type ALL clears only its own dropdown');
  select('genre','category:哲学宗教');expectBooks(['philosophy-done'],'Canonical primary philosophy category is selectable');
  select('genre','unknown');expectBooks(['unknown'],'Unknown-category folder member remains directly accessible');expectCount(1);
  for(const [category,expected]of [['category:小说',['novel-read','novel-done']],['category:历史',['history-read','local','article']],['category:哲学宗教',['philosophy-done']],['unknown',['unknown']]]){select('genre',category);expectBooks(expected,'Repeated category filtering retains full collection: '+category);}
  select('genre','all');same(folderNames(),['周末阅读','思考书单'],'Returning to ALL restores original folder navigation');
  select('reading','finished');same(folderNames(),['周末阅读','思考书单'],'Standalone reading status preserves original folder presentation');expectCount(2);
  select('reading','all');select('kind','book');same(folderNames(),['周末阅读','思考书单'],'Standalone type select preserves original folder presentation');expectBooks(['local'],'Type filtering retains local loose book');
  select('kind','all');check(loadCalls===1,'Dropdowns retain full loaded data without remote reloads');check(syncCalls.length===0,'Filtering never implicitly synchronizes notes');
 },
 async folders(){
  setSearch('周末阅读');same(folderNames(),['周末阅读'],'Original search preserves folder-name matching');
  openFolder('周末阅读');expectBooks(['novel-read','novel-done','history-read'],'Folder-name search exposes all unique members inside');
  backFromFolder();setSearch('合成作者 history-read');same(folderNames(),['周末阅读'],'Metadata search preserves matching containing folder');
  openFolder('周末阅读');expectBooks(['history-read'],'Metadata search narrows members inside the folder');
  backFromFolder();setSearch('');select('genre','category:小说');
  const card=cards().find(node=>cardId(node)==='novel-read');const originalRoot=root,originalCard=card,originalFilter=control('genre');const beforeLoads=loadCalls;
  root.style.height='220px';root.scrollTop=80;const beforeScroll=root.scrollTop;check(beforeScroll>0,'Shelf is scrolled before opening detail');
  card.click();check(selection?.bookId==='novel-read'&&root.hidden,'Production card opens retained detail callback synchronously');
  detail.querySelector('button').click();
  check(!root.hidden&&root===originalRoot&&root.contains(originalCard),'Synchronous back retains existing bookshelf DOM');
  check(control('genre')===originalFilter&&originalFilter.value==='category:小说','Back retains exact native category select and value');
  expectBooks(['novel-read','novel-done'],'Back retains category-filtered results');
  check(root.scrollTop===beforeScroll&&loadCalls===beforeLoads,'Back preserves nonzero scroll without reloading');
  select('genre','all');openFolder('思考书单');expectBooks(['novel-read','philosophy-done','unknown'],'Original folder retains overlapping member and unknown category');
  backFromFolder();same(folderNames(),['周末阅读','思考书单'],'Folder back restores original tiles');
 }
};
`;

let bundled;
async function setup(t, width = 1100) {
	const browser = await browserHarness(t);
	await browser.viewport(width);
	bundled ??= bundle();
	await browser.evaluate(await bundled);
	await browser.evaluate('bookshelfSmoke.mount()');
	return browser;
}

async function finish(t, browser) {
	const result = await browser.evaluate(
		'({errors:bookshelfSmoke.errors,assertions:bookshelfSmoke.assertions})'
	);
	assert.deepEqual(result.errors, [], 'No browser errors or unhandled rejections');
	t.diagnostic(`${result.assertions.length} rendered production-panel assertions`);
}

async function key(browser, key, code, windowsVirtualKeyCode) {
	await browser.send('Input.dispatchKeyEvent', {
		type: 'keyDown',
		key,
		code,
		windowsVirtualKeyCode
	});
	await browser.send('Input.dispatchKeyEvent', {
		type: 'keyUp',
		key,
		code,
		windowsVirtualKeyCode
	});
}

test(
	'production bookshelf retains sync/history icons and category select with cancellation and Alt force',
	{ skip: !chromeAvailable, timeout: 30000 },
	async (t) => {
		const browser = await setup(t);
		await browser.evaluate(
			'bookshelfSmoke.header();bookshelfSmoke.startSync();bookshelfSmoke.cancelSync();bookshelfSmoke.finishSync()'
		);
		await browser.send('Input.dispatchKeyEvent', {
			type: 'keyDown',
			key: 'Alt',
			code: 'AltLeft',
			windowsVirtualKeyCode: 18,
			modifiers: 1
		});
		await browser.evaluate('bookshelfSmoke.forceSync()');
		await browser.send('Input.dispatchKeyEvent', {
			type: 'keyUp',
			key: 'Alt',
			code: 'AltLeft',
			windowsVirtualKeyCode: 18,
			modifiers: 0
		});
		await browser.evaluate('bookshelfSmoke.finishForce()');
		await browser.evaluate('bookshelfSmoke.close()');
		await finish(t, browser);
	}
);

test(
	'production bookshelf category dropdown intersects original filters and retains unique folder members',
	{ skip: !chromeAvailable, timeout: 30000 },
	async (t) => {
		const browser = await setup(t);
		await browser.evaluate('bookshelfSmoke.filters()');
		await browser.evaluate('bookshelfSmoke.close()');
		await finish(t, browser);
	}
);

test(
	'production bookshelf preserves folder and metadata search plus synchronous detail back selection',
	{ skip: !chromeAvailable, timeout: 30000 },
	async (t) => {
		const browser = await setup(t);
		await browser.evaluate('bookshelfSmoke.folders()');
		await browser.evaluate('bookshelfSmoke.close()');
		await finish(t, browser);
	}
);

test(
	'production bookshelf four dropdowns fit 320/390/1100 and preserve native keyboard focus',
	{ skip: !chromeAvailable, timeout: 30000 },
	async (t) => {
		const browser = await setup(t);
		for (const width of [320, 390, 1100]) {
			await browser.viewport(width);
			await browser.evaluate(
				'new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))'
			);
			await browser.evaluate('bookshelfSmoke.layout(' + width + ')');
			if (process.env.BOOKSHELF_FILTER_SCREENSHOTS) {
				const directory = path.resolve(process.env.BOOKSHELF_FILTER_SCREENSHOTS);
				await mkdir(directory, { recursive: true });
				await browser.evaluate('bookshelfSmoke.resetScroll()');
				const filename = path.join(directory, `bookshelf-${width}.png`);
				await browser.screenshot(filename);
				t.diagnostic(`Screenshot: ${filename}`);
			}
		}
		await browser.evaluate('bookshelfSmoke.prepareKeyboard()');
		await key(browser, 'Tab', 'Tab', 9);
		await browser.evaluate('bookshelfSmoke.verifyTab()');
		await browser.evaluate('bookshelfSmoke.close()');
		await finish(t, browser);
	}
);
