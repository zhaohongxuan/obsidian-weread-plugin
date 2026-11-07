// Run: node --test tests/reencounterBooksModal.mjs
// Runs production picker in Chrome with synthetic cache/settings and no network.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { build } from 'esbuild';
import { browserHarness, chromeAvailable } from './helpers/detailBrowserHarness.mjs';

const fixture = String.raw`
import { WereadReencounterBooksModal } from './src/components/wereadReencounterBooksModal';
import { settingsStore } from './src/settings';
const create = function(tag, options = {}) {
 const node = document.createElement(tag);
 if(options.cls) node.className = options.cls;
 if(options.text !== undefined) node.textContent = options.text;
 if(options.type) node.type = options.type;
 for(const [key,value] of Object.entries(options.attr || {})) node.setAttribute(key,value);
 this.append(node); return node;
};
HTMLElement.prototype.createEl = create;
HTMLElement.prototype.createDiv = function(opts) { return create.call(this,'div',opts); };
HTMLElement.prototype.createSpan = function(opts) { return create.call(this,'span',opts); };
HTMLElement.prototype.empty = function() { this.replaceChildren(); };
HTMLElement.prototype.addClass = function(...names) { this.classList.add(...names); };
HTMLElement.prototype.setText = function(text) { this.textContent = text; };
const check = (value, message) => { if(!value) throw new Error(message); checks.push(message); };
const checks = [];
const tick = () => new Promise(resolve => setTimeout(resolve,0));
const gate = () => { let resolve, reject; const promise = new Promise((yes,no)=>{resolve=yes;reject=no;}); return {promise,resolve,reject}; };
const note = (bookId, bookTitle, author, kind='highlight') => ({bookId, bookTitle, author, kind});
const notes = [note('a','山间的阅读','林间'),note('a','山间的阅读','林间'),note('b','城市与记忆','周行'),note('thought-only','ONLY THOUGHT','作者','thought'), ...Array.from({length:563},(_,i)=>note('book-'+i,'书名 '+i,'作者 '+i))];
let state = {notes,totalBooks:565,scannedBooks:565,failedBooks:0,updatedAt:1,syncing:false,error:'',hasCache:true};
const listeners = new Set();
const loads = [];
let pending;
const service = {
 getSnapshot:()=>state,
 subscribe(fn) { listeners.add(fn); fn(state); return ()=>listeners.delete(fn); },
 load(force) { loads.push(force); return pending ? pending.promise : Promise.resolve(state); },
 publish(patch) { state = {...state,...patch}; for(const fn of listeners) fn(state); }
};
const plugin = {app:{},getJournalService:()=>service};
let savedCallback;
const mount = () => { const modal = new WereadReencounterBooksModal(plugin, ids=>savedCallback=ids); modal.open(); return modal; };
const button = (modal,text)=>[...modal.contentEl.querySelectorAll('button')].find(el=>el.textContent===text);
const checkbox = (modal,id)=>[...modal.contentEl.querySelectorAll('input[type=checkbox]')].find(el=>el.dataset.bookId===id);
const search = (modal,value)=>{ const input=modal.contentEl.querySelector('input[type=search]'); input.focus(); input.value=value; input.dispatchEvent(new Event('input')); return input; };
const visible = modal => [...modal.contentEl.querySelectorAll('label')].filter(row=>!row.hidden);
window.runPickerChecks = async () => {
 settingsStore.set({journalExcludedBookIds:['missing']});
 let modal = mount(); await tick();
 check(loads.length===1 && loads[0]===false,'opens with one non-forced singleton cache load');
 check(listeners.size===1,'subscribes to cache');
 check(modal.contentEl.querySelectorAll('label').length===566,'565 unique personal-highlight books plus missing selection');
 check(!checkbox(modal,'thought-only'),'thought-only books are not offered');
 check(checkbox(modal,'missing').checked,'missing saved ID visible and checked');
 check(modal.contentEl.textContent.includes('书籍 ID：missing'),'missing selected ID has removable fallback label');
 checkbox(modal,'a').click();
 const input = search(modal,'周行');
 check(visible(modal).length===2 && !checkbox(modal,'b').closest('label').hidden,'author search includes matching book plus missing selection');
 checkbox(modal,'b').click();
 search(modal,'山间');
 check(checkbox(modal,'a').checked && checkbox(modal,'b').checked,'draft selection survives search');
 check(settingsStore.writes.length===0,'checkbox changes remain draft');
 search(modal,'');
 const sameRow=checkbox(modal,'a'); sameRow.focus();
 const list = modal.contentEl.querySelector('.weread-reencounter-books-list');
 list.scrollTop=100;
 service.publish({notes:[...notes,note('new','New cache book','New author')]});
 check(checkbox(modal,'a')===sameRow && document.activeElement===sameRow,'cache updates retain checkbox DOM and focus');
 check(list.scrollTop===100,'cache updates retain scroll');
 search(modal,'new cache');
 check(document.activeElement===input && visible(modal).length===2,'cache loads preserve search and filter new books');
 service.publish({notes:[],hasCache:false});
 check(checkbox(modal,'a').checked && checkbox(modal,'b').checked && checkbox(modal,'missing').checked && visible(modal).length===3,'cache clear or account change retains draft IDs as removable fallbacks');
 service.publish({notes,hasCache:true});
 search(modal,'山间');
 check(checkbox(modal,'a').checked && checkbox(modal,'a').closest('label').textContent.includes('山间的阅读'),'rehydration restores metadata without dropping selection');
 button(modal,'取消').click();
 check(listeners.size===0 && settingsStore.writes.length===0,'Cancel releases subscription without persisting draft');
 modal=mount(); await tick();
 check(!checkbox(modal,'a').checked && checkbox(modal,'missing').checked,'reopen uses saved selection, discarding cancelled draft');
 search(modal,'No match');
 checkbox(modal,'missing').click();
 check(visible(modal).length===0 && modal.contentEl.textContent.includes('没有匹配的书籍'),'missing selections removable during search');
 search(modal,'城市'); checkbox(modal,'b').click();
 button(modal,'保存').click();
 check(JSON.stringify(settingsStore.writes.at(-1))==='["b"]' && JSON.stringify(savedCallback)==='["b"]','Save persists only draft selection and updates setting count callback');
 check(listeners.size===0,'Save releases subscription');
 modal=mount(); await tick(); button(modal,'清空选择').click(); button(modal,'保存').click();
 check(settingsStore.writes.at(-1).length===0,'clear selection saves empty list');
 pending=gate(); service.publish({notes:[],hasCache:false,syncing:true,scannedBooks:0});
 settingsStore.set({journalExcludedBookIds:['orphan']});
 modal=mount();
 check(modal.contentEl.textContent.includes('正在整理') && checkbox(modal,'orphan').checked,'loading empty cache preserves selected IDs');
 const stale=[...listeners][0];
 modal.close(); stale({...state,notes}); pending.resolve({...state,notes}); await tick();
 check(modal.contentEl.childElementCount===0 && listeners.size===0,'late publication and load completion do not render after close');
 pending=gate(); modal=mount(); modal.close(); modal.open();
 const currentContent=modal.contentEl.querySelector('h2');
 pending.resolve(state); await tick();
 check(modal.contentEl.querySelector('h2')===currentContent && listeners.size===1,'reopen ignores prior generation completion');
 modal.close(); pending=undefined;
 service.publish({notes:[],syncing:false,error:'',hasCache:true}); settingsStore.set({journalExcludedBookIds:[]});
 modal=mount(); await tick();
 check(modal.contentEl.textContent.includes('暂无个人划线书籍'),'empty cache explains absence of selectable books');
 modal.close();
 pending=gate(); modal=mount(); pending.reject(new Error('synthetic failure')); await tick();
 check(modal.contentEl.textContent.includes('读取缓存失败'),'cache load failures have visible retry guidance');
 modal.close();
 return checks;
};
`;

const obsidian = `export class Modal { constructor(app) { this.app=app; this.contentEl=document.createElement('div'); } open() { document.body.append(this.contentEl); this.onOpen(); } close() { this.onClose(); this.contentEl.remove(); } }`;
const settings = `let value={journalExcludedBookIds:[]}; export function normalizeJournalExcludedBookIds(value) { return Array.isArray(value)?[...new Set(value.filter(id=>typeof id==='string'||typeof id==='number'&&Number.isFinite(id)).map(id=>String(id).trim()).filter(Boolean))]:[]; } export const settingsStore={writes:[],set(next){value=next;},subscribe(fn){fn(value);return ()=>{};},actions:{setJournalExcludedBookIds(ids){value={...value,journalExcludedBookIds:[...ids]};settingsStore.writes.push([...ids]);}}};`;

test(
	'picker searches 565 books and preserves draft/cache/lifecycle behavior',
	{ skip: !chromeAvailable },
	async (t) => {
		const output = await build({
			stdin: { contents: fixture, resolveDir: process.cwd(), loader: 'ts' },
			bundle: true,
			platform: 'browser',
			format: 'iife',
			write: false,
			plugins: [
				{
					name: 'picker-fixtures',
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
							contents: `const style=document.createElement('style');style.textContent=${JSON.stringify(await readFile(filename, 'utf8'))};document.head.append(style);`,
							loader: 'js'
						}));
					}
				}
			]
		});
		const browser = await browserHarness(t);
		await browser.evaluate(output.outputFiles[0].text);
		const checks = await browser.evaluate('runPickerChecks()');
		assert(checks.length >= 20);
	}
);
