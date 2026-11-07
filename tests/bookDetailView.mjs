// Run only: node --test tests/bookDetailView.mjs
// Set BOOK_DETAIL_SCREENSHOTS=0 to retain existing screenshots during behavior-only followups.
// Production in-page panel + real favorites persistence, rendered in Chrome; no server/API/vault.
import assert from 'node:assert/strict';
import test from 'node:test';
import { browserHarness, bundleFixture, chromeAvailable } from './helpers/detailBrowserHarness.mjs';

const fixture = String.raw`
import { WereadBookDetailPanel } from './src/components/wereadBookDetailPanel';
import { WereadFavoritesPanel } from './src/components/wereadFavorites';
import { WereadFavoritesService } from './src/favorites';
import { FAVORITES_PATH, parseFavorites } from './src/favoritesRepository';
import { settingsStore } from './src/settings';
import { TFile } from 'obsidian';
window.detailNotices = [];
const browserErrors=[];
window.addEventListener('error',event=>browserErrors.push(event.message));
window.addEventListener('unhandledrejection',event=>browserErrors.push(String(event.reason)));
const assertions = [];
const check = (value, message) => { if (!value) throw new Error(message); assertions.push(message); };
const gate = () => { let resolve; const promise = new Promise(done => resolve = done); return {promise, resolve}; };
const tick = () => new Promise(resolve => setTimeout(resolve,0));
const until = async (predicate, label) => { for(let n=0;n<100;n++) { if(predicate()) return; await tick(); } throw new Error('Fixture did not settle: '+label); };
const intervals = new Set();
const undoTimers=new Set(),nativeSetTimeout=window.setTimeout.bind(window),nativeClearTimeout=window.clearTimeout.bind(window);
window.setTimeout=(callback,delay,...args)=>{let id;id=nativeSetTimeout(()=>{undoTimers.delete(id);callback(...args);},delay);if(delay===5000)undoTimers.add(id);return id;};
window.clearTimeout=id=>{undoTimers.delete(id);nativeClearTimeout(id);};
const nativeSetInterval=window.setInterval.bind(window), nativeClearInterval=window.clearInterval.bind(window);
window.setInterval=(...args)=>{const id=nativeSetInterval(...args);intervals.add(id);return id;};
window.clearInterval=id=>{intervals.delete(id);nativeClearInterval(id);};
const create = function(tag, options={}) {
 if(typeof options==='string') options={cls:options};
 const node=document.createElement(tag);
 if(options.cls) node.className=options.cls;
 if(options.text!==undefined) node.textContent=options.text;
 for(const key of ['type','href','value']) if(options[key]!==undefined) node[key]=options[key];
 for(const [key,value] of Object.entries(options.attr||{})) {
  if(tag==='img'&&key==='src'&&String(value).startsWith('https://fixture.invalid/')) {
   node.src='data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="180" height="252"><rect width="180" height="252" fill="#76846c"/><rect x="12" y="12" width="156" height="228" fill="none" stroke="#d9dfc9"/><text x="90" y="90" text-anchor="middle" fill="#fff" font-family="serif" font-size="26">山间的阅读</text><path d="M30 170h120M30 178h86" stroke="#d9dfc9"/></svg>');node.loading='eager';
  } else node.setAttribute(key,value);
 }
 this.append(node);return node;
};
HTMLElement.prototype.createEl=create;
HTMLElement.prototype.createDiv=function(options){return create.call(this,'div',options);};
HTMLElement.prototype.createSpan=function(options){return create.call(this,'span',options);};
HTMLElement.prototype.empty=function(){this.replaceChildren();};
HTMLElement.prototype.addClass=function(...names){this.classList.add(...names);};
HTMLElement.prototype.removeClass=function(...names){this.classList.remove(...names);};
HTMLElement.prototype.toggleClass=function(name,enabled){this.classList.toggle(name,enabled);};
HTMLElement.prototype.setText=function(text){this.textContent=text;};
HTMLElement.prototype.setAttr=function(name,value){this.setAttribute(name,value);};
const style=document.createElement('style');style.textContent='*{box-sizing:border-box} body{margin:0;padding:24px;background:#f8f7f4;color:#292d29;font-family:-apple-system,BlinkMacSystemFont,sans-serif;--background-primary:#fff;--background-secondary:#f3f1ec;--background-modifier-border:#dddcd5;--text-normal:#292d29;--text-muted:#72756d;--text-faint:#8a8e83;--interactive-accent:#5f765c;--text-accent:#5f765c;--color-yellow:#c9a34a;--color-blue:#5b91c3;--color-green:#719768;--color-red:#c77c77;--color-purple:#a38aba;--interactive-normal:#fff;--background-modifier-hover:#e8eddf} main{max-width:1050px;margin:auto}button,input,select{font:inherit;padding:7px 11px;border:1px solid var(--background-modifier-border);background:var(--background-primary);border-radius:6px;color:inherit}button{cursor:pointer}button:disabled{opacity:.45}svg{width:18px;height:18px}body.theme-dark{background:#20231f;color:#e4e6dd;--background-primary:#282c26;--background-secondary:#222620;--background-modifier-border:#444b3f;--text-normal:#e4e6dd;--text-muted:#b1b8a9;--text-faint:#a0aa97;--interactive-accent:#a5bd8b;--text-accent:#a5bd8b;--interactive-normal:#282c26;--background-modifier-hover:#343d2e}@media(max-width:500px){body{padding:12px}}';document.head.append(style);
const clipboard=[];let clipboardFails=false;
Object.defineProperty(navigator,'clipboard',{configurable:true,value:{async writeText(text){if(clipboardFails)throw new Error('clipboard denied');clipboard.push(text);}}});
const TEXT='晨光穿过树叶，阅读让平凡的一天有了新的层次。 <img src=x onerror="window.injected=true"> & 原样保留';
const COVER='https://fixture.invalid/book-42.svg';
const CREATED=1793923200;
const chapters=[{chapterUid:2,chapterIdx:2,title:'第二章 · 向山而行'},{chapterUid:1,chapterIdx:1,title:'第一章 · 日常的光'}];
const highlight=(id,extra={})=>({bookmarkId:id,bookId:'42',type:1,colorStyle:5,markText:TEXT,chapterUid:1,range:'12-40',createTime:CREATED,...extra});
const data=(id='42')=>[
 {bookId:id,title:id==='42'?'山间的阅读':'后来的一本书 '+id,author:'林间',cover:COVER,intro:'把注意力还给日常，在书页与山水间，找回安静而坚定的自己。',newRating:870},
 {book:{progress:67,readingTime:7200}},
 {book:{bookId:id,title:'山间的阅读',author:'林间',cover:COVER},chapters,updated:[highlight('remote-2',{chapterUid:2,markText:'山与水之间，有一种安静。'}),highlight('remote-1'),highlight('invalid-time',{createTime:0,markText:'缺失创建时间的真实划线'}),highlight('invalid-id',{bookmarkId:'',markText:'缺失原始标识'}),highlight('deleted',{type:0,markText:'DELETED SENTINEL'})],removed:[]},
 {reviews:[{review:{type:1,reviewId:'note-1',content:'我的笔记：慢下来，看见被忽略的细节。',abstract:'读书的片刻',chapterUid:1,range:'12-40',createTime:CREATED}},{review:{type:4,reviewId:'review-1',title:'我的书评',content:'MY BOOK REVIEW SENTINEL',createTime:CREATED}}]},
 {items:[highlight('community',{markText:'COMMUNITY HIGHLIGHT SENTINEL',totalCount:123})],chapters},
 {reviews:[{review:{content:'COMMUNITY REVIEW SENTINEL',author:{name:'另一位读者'},createTime:CREATED}}]}
];
const methods=['getBook','getProgress','getNotebookHighlights','getNotebookReviews','getBestBookmarks','getPublicReviews'];
const router=(transform)=>Object.fromEntries(methods.map((name,index)=>[name,async id=>{const response=data(id)[index];return transform?transform(index,id,response):response;}]));
let activeFixture;
function persistence(initial=[]) {
 const files=new Map(initial);const faults={};const operations=[];
 const adapter={async exists(path){return files.has(path);},async mkdir(path){files.set(path,'<directory>');},async read(path){if(!files.has(path))throw new Error('missing');return files.get(path);},async write(path,raw){operations.push(path);if(faults.gate)await faults.gate.promise;if(faults.fail)throw new Error('FIXTURE DISK WRITE FAILED');files.set(path,raw);}};
 const plugin={app:{vault:{adapter,getAbstractFileByPath:path=>path==='fixture.md'?new TFile(path):null,async read(){return faults.markdown ?? '## 本地章节\n> 📌 [LOCAL QUOTE SENTINEL](<weread://bestbookmark?bookId=42&chapterUid=1&rangeStart=12&rangeEnd=40>)\n⏱ 2026-11-06 08:00:00';}},workspace:{getLeavesOfType:()=>[],requestSaveLayout(){},getLeaf(){throw new Error('Unexpected new workspace leaf');}}},async openPreferredReadingView(...args){plugin.opened.push(args);},opened:[],syncCalls:[],async syncBookById(id){plugin.syncCalls.push(id);if(faults.syncGate)await faults.syncGate.promise;if(faults.syncFail)throw new Error('SYNC SECRET SENTINEL');},async activateBookDetailView(){}};
 const service=new WereadFavoritesService(plugin);plugin.favoritesService=service;
 let subscriptions=0;const subscribe=service.subscribe.bind(service);service.subscribe=listener=>{subscriptions++;const off=subscribe(listener);let active=true;return ()=>{if(active){active=false;subscriptions--;off();}};};
 let writes=0;const setFavorite=service.setFavorite.bind(service);service.setFavorite=(...args)=>{writes++;return setFavorite(...args);};
 return {files,faults,operations,plugin,service,get subscriptions(){return subscriptions;},get writes(){return writes;}};
}
const host=()=>{const node=document.createElement('main');document.body.append(node);return node;};
let panel,peer,favorites,root,peerRoot,favoritesRoot,backCount=0;
const close=async()=>{for(const p of [panel,peer,favorites])if(p)await p.onClose();for(const el of [root,peerRoot,favoritesRoot])el?.remove();panel=peer=favorites=undefined;activeFixture?.service.dispose();};
const state={bookId:'42',bookTitle:'书架临时标题',bookCover:COVER,localFilePath:'',currentTab:'highlights'};
const mount=async(api=router(),initial=[],options={})=>{await close();activeFixture=persistence(initial);activeFixture.faults.markdown=options.markdown;root=host();panel=new WereadBookDetailPanel(root,api,activeFixture.plugin,{onBack:()=>{backCount++;void panel.onClose();},breadcrumbLabel:'书架'});await panel.onOpen();await panel.setState({...state,...options.state,secret:'MUST NOT PERSIST'});await activeFixture.service.load();await tick();return activeFixture;};
const star=(el=root)=>el.querySelector('[data-favorite-id="42:highlight:remote-1"]');
const quote=(el=root)=>el.querySelector('[data-bookmark-id="remote-1"] .weread-detail-quote');
const button=(label,el=root)=>[...el.querySelectorAll('button')].find(b=>b.textContent===label||b.getAttribute('aria-label')===label);
const click=(label,el=root)=>{const b=button(label,el);check(b&&!b.disabled,'Action available: '+label);b.click();};
const settled=async(f=activeFixture)=>{await until(()=>f.service.getSnapshot().pendingIds.length===0,'favorite write');await tick();};
const tab=name=>{const b=root.querySelector('[data-tab="'+name+'"]');b.click();check(b.getAttribute('aria-selected')==='true','Tab selected: '+name);};
window.smoke={assertions,
 async content(){
  const f=await mount();
  check(root.querySelector('h1.weread-detail-title').textContent==='山间的阅读','Remote hero metadata replaces shelf placeholder');
  check(root.querySelector('img').alt==='《山间的阅读》封面'&&root.querySelector('img').complete,'Synthetic hero cover renders accessibly');
  check(root.textContent.includes('林间')&&root.textContent.includes('把注意力还给日常'),'Author and introduction remain visible');
  check(root.querySelector('progress').value===67&&root.textContent.includes('2 小时'),'Real progress DTO yields progress and reading duration');
  check(JSON.stringify(Object.keys(panel.getState()).sort())===JSON.stringify(['bookCover','bookId','bookTitle','currentTab','localFilePath'].sort()),'Serialized detail state uses whitelist');
  check(root.querySelectorAll('[role="tab"]').length===4,'All four accessible content tabs exist');
  check([...root.querySelectorAll('.weread-detail-chapter-title')].map(n=>n.textContent).join('|')==='第一章 · 日常的光|第二章 · 向山而行','Highlights group in chapter order');
  check(quote().textContent===TEXT&&!quote().querySelector('img')&&!window.injected,'Highlight HTML is literal text without injected elements');
  const color=quote().closest('article').querySelector('[role="img"][aria-label="紫色划线"]');check(color&&color.getBoundingClientRect().width>0,'Personal source color remains visible with accessible name');
  const createdDate=new Date(CREATED*1000), createdClock=String(createdDate.getHours()).padStart(2,'0')+':'+String(createdDate.getMinutes()).padStart(2,'0');
  check(quote().closest('article').querySelector('.weread-detail-entry-meta').textContent.includes(createdClock),'Highlight metadata displays local creation hour and minute from API seconds');
  check(!root.textContent.includes('DELETED SENTINEL'),'Deleted type-zero highlight is excluded');
  check(star().getAttribute('aria-label')==='收藏'&&!star().disabled,'Authoritative personal highlight can be favorited');
  check([...root.querySelectorAll('.weread-detail-favorite')].filter(b=>b.disabled).length===2,'Missing original ID or timestamp cannot create favorites');
  click('复制正文',quote().closest('article'));await tick();check(clipboard.at(-1)===TEXT&&!clipboard.at(-1).includes('!['),'Copy preserves exact quote without Canvas cover markdown');
  clipboardFails=true;click('复制正文',quote().closest('article'));await tick();clipboardFails=false;check(window.detailNotices.at(-1)==='复制失败，请重试','Clipboard rejection reports failure');
  click('回到原文',quote().closest('article'));await tick();check(f.plugin.opened[0][1].bookId==='42'&&f.plugin.opened[0][1].rangeStart===12,'Source action uses actual bookmark location');
  tab('notes');check(root.textContent.includes('我的笔记：')&&!root.textContent.includes('MY BOOK REVIEW SENTINEL'),'Own notes retain type-one thoughts without book reviews');
  check(root.querySelector('.weread-detail-note .weread-detail-entry-meta').textContent.includes(createdClock),'Thought note metadata displays local creation hour and minute');
  check(!root.querySelector('.weread-detail-favorite'),'Own notes have no highlight favorite action');
  tab('popular');check(root.textContent.includes('COMMUNITY HIGHLIGHT SENTINEL')&&!root.querySelector('.weread-detail-favorite'),'Community highlights remain available without stars');
  tab('reviews');check(root.textContent.includes('MY BOOK REVIEW SENTINEL')&&root.textContent.includes('COMMUNITY REVIEW SENTINEL'),'Reviews preserve own and community reviews');
  check([...root.querySelectorAll('.weread-detail-review .weread-detail-muted')].every(el=>el.textContent.includes(createdClock)),'Own and community reviews display local creation hour and minute');
  click('复制正文',root.querySelector('.weread-detail-review'));await tick();check(clipboard.at(-1)==='MY BOOK REVIEW SENTINEL','Review copy preserves exact content after action grouping');
  check(!root.querySelector('.weread-detail-favorite'),'Reviews have no personal-highlight favorite action');
  tab('highlights');check(panel.getState().currentTab==='highlights','Tab changes persist in detail state');
 },
 async header(){
  const f=await mount(router(),[],{state:{localFilePath:'fixture.md'}});
  const counts=root.querySelector('.weread-detail-counts');
  check([...counts.children].map(el=>el.textContent).join('|')==='4 条划线|1 条笔记','Cover counts include personal highlights and thoughts, excluding deleted highlights and book reviews');
  check(counts.parentElement.classList.contains('weread-detail-cover-column')&&!root.querySelector('.weread-detail-info .weread-detail-counts'),'Counts belong exclusively to the cover column');
  const actions=[...root.querySelectorAll('.weread-detail-header-actions button')];
  check(actions.map(el=>el.textContent).join('|')==='去阅读|本地笔记|刷新|同步笔记','Header retains four concise visible text actions');
  check(actions.every(el=>el.querySelector('.weread-detail-action-icon[aria-hidden="true"] svg')&&el.lastElementChild.textContent===el.textContent),'Each header action has a decorative icon and an accessible visible text label');
  check(actions[0].querySelector('[data-weread-icon="book-arrow-up-right"]'),'Read action uses the chosen book and arrow icon');
  actions[0].focus();check(document.activeElement===actions[0],'Read text action remains keyboard focusable');
  click('去阅读');await tick();check(f.plugin.opened.length===1,'Renamed read action preserves the preferred reading route');
  root.querySelector('.weread-detail-cover').dispatchEvent(new Event('error'));
  check(!root.querySelector('.weread-detail-cover')&&root.querySelector('.weread-detail-jacket').textContent==='山间的阅读'&&counts.textContent==='4 条划线1 条笔记','Broken cover retains title fallback and loaded counts');
  await mount(router((i,id,response)=>i===0?{...response,cover:''}:i===2?{...response,book:{...response.book,cover:''}}:response),[],{state:{bookCover:''}});
  check(!root.querySelector('.weread-detail-cover')&&root.querySelector('.weread-detail-jacket').textContent==='山间的阅读','Missing cover renders a readable title fallback above counts');
  const loading=gate();await close();activeFixture=persistence();root=host();panel=new WereadBookDetailPanel(root,router((i,id,response)=>loading.promise.then(()=>response)),activeFixture.plugin);await panel.onOpen();const request=panel.setState(state);await tick();
  check(root.querySelector('.weread-detail-counts').textContent===''&&getComputedStyle(root.querySelector('.weread-detail-counts')).display==='none','Unknown loading counts stay hidden instead of inventing zero');
  check(button('正在刷新…').disabled&&button('正在刷新…').querySelector('svg'),'Pending refresh keeps its icon, text, and disabled state');loading.resolve();await request;
 },
 async stateValidation(){
  await mount();await panel.setState({...state,bookId:42});
  check(panel.getState().bookId==='42'&&root.querySelector('h1').textContent==='山间的阅读','Finite numeric workspace book ID normalizes to the canonical string');
  check(star()?.dataset.favoriteId==='42:highlight:remote-1'&&quote().textContent===TEXT,'Numeric restored book ID preserves the correct quote and real favorite source');
  await panel.setState({bookId:{value:'42'}});check(panel.getState().bookId===''&&!quote()&&!root.querySelector('.weread-detail-favorite')&&!root.textContent.includes('山间的阅读'),'Object book ID rejects without retaining old book content or source actions');
  await panel.setState({...state,bookId:42});await panel.setState({bookId:NaN});check(panel.getState().bookId===''&&!quote()&&!root.querySelector('.weread-detail-favorite'),'Nonfinite numeric book ID rejects without stale highlight actions');
 },
 async explicitSync(){
  const f=await mount();check(f.plugin.syncCalls.length===0,'Initial detail load never synchronizes native notes');
  const firstQuote=quote();click('刷新');await until(()=>quote()&&quote()!==firstQuote,'read-only refresh');check(f.plugin.syncCalls.length===0,'Refresh fetches detail without synchronizing native notes');
  const syncButton=button('同步笔记');check(syncButton&&!syncButton.disabled,'Explicit book sync is discoverable');
  f.faults.syncGate=gate();syncButton.click();syncButton.click();await tick();check(f.plugin.syncCalls.length===1&&f.plugin.syncCalls[0]==='42','Explicit sync uses captured book ID and rejects duplicate clicks');
  check(root.querySelector('.weread-detail-sync').disabled&&root.querySelector('.weread-detail-sync').textContent==='同步中…','Explicit sync disables its action while pending');
  await panel.setState({...state,bookId:'B'});const before=root.innerHTML,notices=window.detailNotices.length;
  f.faults.syncGate.resolve();f.faults.syncGate=undefined;await tick();await tick();
  check(panel.getState().bookId==='B'&&root.innerHTML===before&&window.detailNotices.length===notices,'Completing old book sync cannot refresh a different book or report stale success');
  check(f.plugin.syncCalls.join('|')==='42','Book navigation never triggers implicit native sync');
 },
 async sync(){
  const f=await mount();peerRoot=host();peerRoot.hidden=true;peer=new WereadBookDetailPanel(peerRoot,router(),f.plugin);await peer.onOpen();await peer.setState(state);
  favoritesRoot=host();favoritesRoot.hidden=true;favorites=new WereadFavoritesPanel(favoritesRoot,f.plugin,f.service);await favorites.onOpen();
  root.style.height='650px';root.style.overflowY='auto';root.scrollTop=180;check(root.scrollTop>0,'Reading pane is scrolled before favorite mutation');
  const originalQuote=quote(),originalScroll=root.scrollTop;f.faults.gate=gate();star().click();star().click();await tick();
  check(f.writes===1&&star().disabled&&star(peerRoot).disabled,'Pending save disables peers and rejects double click');
  check(star().getAttribute('aria-pressed')==='false'&&!favoritesRoot.querySelector('article'),'Pending write does not falsely acknowledge persisted favorite');
  f.faults.gate.resolve();f.faults.gate=undefined;await settled();
  const saved=f.service.getSnapshot().favorites[0];
  check(saved.id==='42:highlight:remote-1'&&saved.note.createTime===1793923200000,'Favorite uses journal-compatible real source ID and epoch milliseconds');
  check(saved.note.text===TEXT&&saved.note.cover===COVER&&saved.note.author==='林间','Frozen favorite retains exact body, cover and metadata');
  check(parseFavorites(f.files.get(FAVORITES_PATH)).records[0].note.text===TEXT,'Real Canvas serializer persists the exact quote');
  check(star().getAttribute('aria-pressed')==='true'&&star(peerRoot).getAttribute('aria-pressed')==='true'&&favoritesRoot.querySelector('article[data-favorite-id="42:highlight:remote-1"]'),'Persisted add synchronizes detail peer and production Favorites page');
  check(quote()===originalQuote&&root.scrollTop===originalScroll,'Favorite update preserves quote node and scroll');
  click('复制正文',favoritesRoot);await tick();check(clipboard.at(-1)===TEXT,'Favorites copy excludes generated cover metadata');
  const search=favoritesRoot.querySelector('input');search.value='fixture.invalid';search.dispatchEvent(new Event('input'));check(!favoritesRoot.querySelector('article'),'Favorites query does not index cover markdown');search.value='';search.dispatchEvent(new Event('input'));
  star().click();await settled();check(!f.service.isFavorite(saved.id)&&star(peerRoot).getAttribute('aria-pressed')==='false'&&!favoritesRoot.querySelector('article'),'Detail removal synchronizes both peer pages');
  click('撤销');await settled();check(f.service.getSnapshot().favorites[0].favoritedAt===saved.favoritedAt&&star(peerRoot).getAttribute('aria-pressed')==='true','Undo restores original favorite timestamp across pages');
  click('取消收藏',favoritesRoot);await settled();check(star().getAttribute('aria-pressed')==='false','Favorites removal synchronizes back to detail');
  f.faults.fail=true;star().click();await settled();check(!f.service.isFavorite(saved.id)&&star().getAttribute('aria-pressed')==='false'&&!star().disabled,'Failed disk write rolls back acknowledgement and enables retry');
  check(window.detailNotices.at(-1)==='收藏存储操作失败，请检查文件权限或可用空间后重试','Failed write surfaces actionable sanitized error');
  f.faults.fail=false;star().click();await settled();check(f.service.isFavorite(saved.id),'Retry after disk failure persists favorite');
  await panel.onClose();await peer.onClose();await favorites.onClose();check(f.subscriptions===0,'Closing all panels releases favorites subscriptions');
 },
 async fallback(){
  await mount(router((i,id,response)=>i===2?{...response,updated:[]}:response));await panel.setState({...state,bookId:'local-swap'});await panel.setState({...state,localFilePath:'fixture.md'});
  check(root.textContent.includes('LOCAL QUOTE SENTINEL'),'Empty remote highlights fall back to synced local Markdown');
  const localStar=root.querySelector('.weread-detail-favorite');check(localStar.disabled&&!localStar.dataset.favoriteId,'Synthetic local parser ID never becomes a favorite source');
  check(root.textContent.includes('联网读取原始划线后可收藏'),'Local-only quote explains how to enable favorites');
  const future=JSON.stringify({nodes:[{id:'future',type:'text',x:0,y:0,width:400,height:200,text:'<!-- weread-favorites:'+encodeURIComponent(JSON.stringify({schemaVersion:999,revision:0,tombstones:[]}))+' -->'}],edges:[]});
  const f=await mount(router(),[[FAVORITES_PATH,future]]);check(!f.service.getSnapshot().writable&&quote().textContent===TEXT&&star().disabled,'Unsupported future Canvas keeps detail readable with disabled star');
  check(f.files.get(FAVORITES_PATH)===future&&root.textContent.includes('只读'),'Read-only Canvas is preserved and explained');
 },
 async localPopularOffline(){
  const markdown='## 离线章节\n> 🔥 [First paragraph\n   Second paragraph](<weread://bestbookmark?bookId=42&chapterUid=11&rangeStart=10&rangeEnd=19>)\n📊 37人共读';
  for(const mode of ['undefined','rejected']) {
   await mount(router(()=>{if(mode==='rejected')throw new Error('OFFLINE API SECRET');return undefined;}),[],{state:{localFilePath:'fixture.md',currentTab:'popular'},markdown});
   const recovered=root.querySelector('.weread-detail-popular .weread-detail-quote');
   check(recovered?.textContent==='First paragraph\nSecond paragraph','Popular-only multiline Markdown recovers when all remote APIs are '+mode);
   check(/37\s*人划线/.test(recovered.closest('article').textContent),'Recovered popular highlight retains count 37 when all remote APIs are '+mode);
   check(root.textContent.includes('当前显示本地已同步划线')&&!root.textContent.includes('OFFLINE API SECRET'),'Popular-only local fallback keeps readable content and banner without a fatal error when APIs are '+mode);
   check(!root.querySelector('.weread-detail-favorite'),'Local community fallback never exposes personal favorite stars');
   tab('highlights');check(!root.querySelector('.weread-detail-highlight')&&!root.textContent.includes('First paragraph')&&root.textContent.includes('还没有划线'),'Popular-only Markdown does not invent a personal highlight');
  }
 },
 async remoteFallbackPriority(){
  const markdown='## 本地章节\n> 📌🔥 [LOCAL PRIORITY SENTINEL](<weread://bestbookmark?bookId=42&chapterUid=11&rangeStart=10&rangeEnd=19>)\n🔥 37人共读';
  await mount(router(),[],{state:{localFilePath:'fixture.md'},markdown});
  check(quote()?.textContent===TEXT&&star()?.dataset.favoriteId==='42:highlight:remote-1'&&!star().disabled,'Nonempty remote personal highlights retain original source identity over local Markdown');
  check(!root.textContent.includes('LOCAL PRIORITY SENTINEL')&&!root.textContent.includes('当前显示本地已同步划线'),'Remote personal response takes priority without a local fallback banner');
  tab('popular');check(root.querySelector('.weread-detail-popular .weread-detail-quote')?.textContent==='COMMUNITY HIGHLIGHT SENTINEL','Nonempty remote popular response takes priority over local Markdown');
  check(/123\s*人划线/.test(root.textContent)&&!root.textContent.includes('LOCAL PRIORITY SENTINEL')&&!root.textContent.includes('当前显示本地已同步划线'),'Remote popular count and remote-only status survive matching local alternatives');
 },
 async foreignFallback(){
  const markdown='## 其他书籍\n> 📌🔥 [FOREIGN BOOK SENTINEL](<weread://bestbookmark?bookId=other-book&chapterUid=11&rangeStart=10&rangeEnd=19>)\n🔥 37人共读';
  await mount(router(()=>{throw new Error('OFFLINE API SECRET');}),[],{state:{localFilePath:'fixture.md',currentTab:'popular'},markdown});
  check(!root.querySelector('article')&&!root.textContent.includes('FOREIGN BOOK SENTINEL'),'Offline fallback rejects Markdown belonging to a different book');
  check(root.textContent.includes('此项远程数据暂不可用')&&button('重试')&&!root.textContent.includes('OFFLINE API SECRET'),'No matching local fallback preserves friendly remote error and retry');
  tab('highlights');check(!root.querySelector('article')&&!root.textContent.includes('FOREIGN BOOK SENTINEL')&&button('重试'),'Foreign local personal highlights remain excluded after switching tabs');
 },
 async failures(){
  let failing=true;await mount(router((i,id,response)=>{if(failing&&i===2)throw new Error('API_SECRET_SENTINEL');return response;}));
  check(root.textContent.includes('山间的阅读')&&root.textContent.includes('重试'),'Partial API failure retains book metadata and retry action');
  check(root.querySelector('.weread-detail-counts').textContent==='1 条笔记','Failed highlights omit an unknown count while keeping the loaded note count');
  check(!root.textContent.includes('API_SECRET_SENTINEL'),'API exception details are not exposed');failing=false;click('重试');await until(()=>!!quote(),'retry data');check(quote().textContent===TEXT,'Retry recovers remote highlights');
  await mount(router(()=>{throw new Error('API_SECRET_SENTINEL');}));check(root.textContent.includes('书架临时标题')&&button('重试')&&!root.textContent.includes('API_SECRET_SENTINEL'),'All API failures retain shelf title and safe retry');
  await mount(router((i,id,response)=>i===2?{...response,updated:[]}:i===3||i===5?{reviews:[]}:i===4?{items:[],chapters:[]}:response));
  check(root.querySelector('.weread-detail-counts').textContent==='0 条划线0 条笔记'&&root.querySelector('.weread-detail-counts').getBoundingClientRect().height>0,'Loaded empty responses show visible zero counts beneath the cover');
  check(root.textContent.includes('还没有划线'),'Empty personal highlights have friendly copy');for(const name of ['notes','popular','reviews']){tab(name);check(root.querySelector('.weread-detail-empty')&&!root.querySelector('article'),'Empty '+name+' has friendly state');}
 },
 async races(){
  const slow=gate();await mount();const raceApi=router((i,id,response)=>id==='A'?slow.promise.then(()=>response):response);
  await close();activeFixture=persistence();root=host();panel=new WereadBookDetailPanel(root,raceApi,activeFixture.plugin);await panel.onOpen();
  const openingA=panel.setState({...state,bookId:'A'});await tick();await panel.setState({...state,bookId:'B'});slow.resolve();await openingA;
  check(root.querySelector('h1').textContent==='后来的一本书 B'&&!root.textContent.includes('后来的一本书 A'),'Out-of-order A response never appears beneath book B');
  const loading=gate();const f=await mount();await panel.onClose();root.remove();root=host();panel=new WereadBookDetailPanel(root,router((i,id,response)=>loading.promise.then(()=>response)),f.plugin);await panel.onOpen();const request=panel.setState(state);await tick();await panel.onClose();const html=root.innerHTML,notices=window.detailNotices.length;loading.resolve();await request;
  check(root.innerHTML===html&&window.detailNotices.length===notices&&f.subscriptions===0,'Closing during API load prevents late DOM, notices and subscriptions');
  const saving=await mount();saving.faults.gate=gate();star().click();await tick();await panel.onClose();const frozen=root.innerHTML,beforeNotices=window.detailNotices.length;saving.faults.gate.resolve();saving.faults.gate=undefined;await settled();check(root.innerHTML===frozen&&window.detailNotices.length===beforeNotices&&saving.subscriptions===0,'Closing during save permits persistence without late DOM or notices');
  await mount();const before=backCount;click('返回书架');check(backCount===before+1&&activeFixture.subscriptions===0,'Origin breadcrumb returns through callback and closes detail without a new leaf');
  await close();activeFixture=persistence();root=host();panel=new WereadBookDetailPanel(root,router(),activeFixture.plugin,{breadcrumbLabel:'收藏',onBack:()=>{backCount++;void panel.onClose();}});await panel.onOpen();await panel.setState(state);click('返回收藏');check(backCount===before+2,'Custom origin breadcrumb returns to Favorites');
  await close();check(intervals.size===0&&undoTimers.size===0&&settingsStore.listenerCount()===0,'Closed detail leaves no interval, Undo timer or settings subscriptions');
 },
 async preview(){await mount(router((i,id,response)=>i===2?{...response,updated:[highlight('remote-1',{colorStyle:3,markText:'晨光穿过树叶，阅读让平凡的一天有了新的层次。那些看似微小的片刻，恰恰是生活值得珍藏的部分。'}),highlight('remote-3',{colorStyle:1,range:'60-90',markText:'慢下来，才能看见身边被忽略的细节。书页里的世界如此辽阔，也让眼前的日常变得丰盈。'}),highlight('remote-2',{colorStyle:5,chapterUid:2,markText:'在山与水之间，找回内心的安静。脚步可以慢一些，方向要清楚。'})]}:response),[],{state:{localFilePath:'fixture.md'}});star().click();await settled();await Promise.all([...document.images].map(image=>image.decode().catch(()=>{})));},
 layout(){const page=root.getBoundingClientRect();check(document.documentElement.scrollWidth<=innerWidth,'Detail fits viewport '+innerWidth);check([...root.querySelectorAll('button')].filter(b=>b.offsetWidth).every(b=>{const r=b.getBoundingClientRect();return r.right<=innerWidth+1&&r.left>=-1;}),'Visible detail actions stay inside viewport '+innerWidth);check(quote()&&page.width>250,'Readable quote remains present at viewport '+innerWidth);
  const jacket=root.querySelector('.weread-detail-jacket').getBoundingClientRect(),counts=root.querySelector('.weread-detail-counts').getBoundingClientRect(),info=root.querySelector('.weread-detail-info').getBoundingClientRect(),stats=root.querySelector('.weread-detail-reading-stats').getBoundingClientRect();
  check(counts.top>=jacket.bottom&&counts.left>=jacket.left-1&&counts.right<=jacket.right+1&&counts.height>0,'Counts stay visibly below and within the cover column at viewport '+innerWidth);
  check(info.left>jacket.right&&stats.left>=info.left&&stats.right<=info.right+1,'Metadata and wrapping reading stats stay right of the cover at viewport '+innerWidth);
  check([...root.querySelectorAll('.weread-detail-counts > span')].every(el=>el.getBoundingClientRect().right<=counts.right+1),'Individual count labels remain legible inside the cover column at viewport '+innerWidth);
  if(innerWidth>=1000){const facts=root.querySelector('.weread-detail-facts').getBoundingClientRect(),progress=root.querySelector('.weread-detail-progress').getBoundingClientRect();check(Math.abs(facts.top-progress.top)<2,'Status, duration, and progress share one compact desktop row');}
 },
 async close(){await close();check(intervals.size===0&&undoTimers.size===0,'Final cleanup releases timers');check(browserErrors.length===0,'No uncaught browser errors or rejected UI promises: '+browserErrors.join('|'));}
};
`;

test(
	'production book detail panel: content, real Canvas favorites, lifecycle and responsive Chrome UI',
	{ skip: !chromeAvailable, timeout: 60000 },
	async (t) => {
		const browser = await browserHarness(t);
		const screenshot = async (filename) => {
			if (process.env.BOOK_DETAIL_SCREENSHOTS !== '0') await browser.screenshot(filename);
		};
		await browser.viewport(1180);
		await browser.evaluate(await bundleFixture(fixture));
		for (const scenario of [
			'content',
			'header',
			'stateValidation',
			'explicitSync',
			'sync',
			'fallback',
			'localPopularOffline',
			'remoteFallbackPriority',
			'foreignFallback',
			'failures',
			'races'
		]) {
			await browser.evaluate(`smoke.${scenario}()`);
			t.diagnostic(`Passed detail scenario: ${scenario}`);
		}
		await browser.evaluate('smoke.preview()');
		const accessibility = await browser.send('Accessibility.getFullAXTree');
		for (const label of ['去阅读', '本地笔记', '刷新', '同步笔记']) {
			assert(
				accessibility.nodes.some(
					(node) => !node.ignored && node.role?.value === 'button' && node.name?.value === label
				),
				`Chrome exposes the header button with its visible accessible name: ${label}`
			);
		}
		await browser.evaluate('smoke.layout()');
		await screenshot('/tmp/obsidian-weread-book-detail.png');
		await browser.viewport(375, 844);
		await browser.evaluate('smoke.layout()');
		await screenshot('/tmp/obsidian-weread-book-detail-mobile.png');
		for (const width of [320, 600]) {
			await browser.viewport(width, 844);
			await browser.evaluate('smoke.layout()');
		}
		await browser.viewport(1180);
		await browser.evaluate('document.body.classList.add("theme-dark"); smoke.layout()');
		await screenshot('/tmp/obsidian-weread-book-detail-dark.png');
		await browser.evaluate('smoke.close()');
		const count = await browser.evaluate('smoke.assertions.length');
		assert(count >= 65, `Expected meaningful browser coverage, received ${count}`);
		t.diagnostic(
			`${count} browser assertions passed; screenshots: /tmp/obsidian-weread-book-detail.png, /tmp/obsidian-weread-book-detail-mobile.png, /tmp/obsidian-weread-book-detail-dark.png`
		);
	}
);
