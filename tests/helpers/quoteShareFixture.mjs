import { readFile } from 'node:fs/promises';
import { build } from 'esbuild';

const obsidian = `
export class App {}
export class Notice { constructor(text) { window.shareFixture.notices.push(text); } }
export const requestUrl = options => window.shareFixture.request(options);
export class Modal {
 constructor(app) { this.app=app; this.modalEl=document.createElement('div');this.modalEl.className='modal';this.contentEl=this.modalEl.createDiv({cls:'modal-content'}); }
 open() { document.body.append(this.modalEl);this.onOpen(); }
 close() { this.onClose();this.modalEl.remove(); }
}`;
const settings = `
let value={user:'示例读者',quoteShareTemplate:'paper',quoteShareUsername:'',journalIncludeArticles:false};
const listeners=new Set();
function update(key,next) { value={...value,[key]:next};window.shareFixture.saves.push({key,value:next});for(const fn of listeners)fn(value); }
export const settingsStore={subscribe(fn){listeners.add(fn);fn(value);return()=>listeners.delete(fn)},
 actions:{setQuoteShareTemplate(value){update('quoteShareTemplate',value)},setQuoteShareUsername(value){update('quoteShareUsername',value.trim())}}};
window.shareSettings={current:()=>value,set(next){value={...value,...next};for(const fn of listeners)fn(value)}};
`;

// Exported so another browser engine can replay the same production modal fixture.
export async function bundleQuoteShareFixture() {
 const result=await build({stdin:{contents:fixture,resolveDir:process.cwd(),loader:'ts'},bundle:true,platform:'browser',format:'iife',write:false,
 plugins:[{name:'quote-share-fixtures',setup(builder){
  builder.onResolve({filter:/^obsidian$/},()=>({path:'obsidian',namespace:'share-mock'}));
  builder.onResolve({filter:/(?:^|\/)settings$/},()=>({path:'settings',namespace:'share-mock'}));
  builder.onLoad({filter:/.*/,namespace:'share-mock'},({path})=>({contents:path==='obsidian'?obsidian:settings}));
  builder.onLoad({filter:/\.css$/},async({path})=>({contents:'const style=document.createElement("style");style.textContent='+JSON.stringify(await readFile(path,'utf8'))+';document.head.append(style);',loader:'js'}));
 }}]});return result.outputFiles[0].text;
}

const fixture=String.raw`
import { WereadQuoteShareModal } from './src/components/wereadQuoteShare';
window.shareFixtureReady=(async()=>{
const check=(value,message)=>{if(!value)throw new Error(message);window.shareFixture.assertions++};
const wait=async predicate=>{for(let i=0;i<300;i++){if(predicate())return;await new Promise(resolve=>setTimeout(resolve,10))}throw new Error('Timed out waiting for production modal')};
function createEl(tag,options={}){const el=document.createElement(tag);if(options.cls)el.className=options.cls;if(options.text)el.textContent=options.text;if(options.type)el.type=options.type;for(const [key,value]of Object.entries(options.attr||{}))el.setAttribute(key,value);this.append(el);return el}
HTMLElement.prototype.createEl=createEl;HTMLElement.prototype.createDiv=function(options){return this.createEl('div',options)};HTMLElement.prototype.createSpan=function(options){return this.createEl('span',options)};
HTMLElement.prototype.addClass=function(...names){this.classList.add(...names)};HTMLElement.prototype.empty=function(){this.replaceChildren()};HTMLElement.prototype.setText=function(value){this.textContent=value};
const style=document.createElement('style');style.textContent='*{box-sizing:border-box}body{margin:0;padding:12px;background:#e8e6df;color:#292b26;font:14px -apple-system,BlinkMacSystemFont,"PingFang SC",sans-serif;--background-primary:#fffdf8;--background-secondary:#efede7;--background-modifier-border:#d6d3c8;--interactive-accent:#63825d;--text-muted:#73766e;--text-faint:#85867c}.modal{margin:0 auto;padding:24px;background:var(--background-primary);border-radius:12px;overflow:auto;max-width:100%}.modal-content{min-width:0}button,input{font:inherit}button{padding:8px;border:1px solid #d6d3c8;border-radius:6px;background:#fffdf8}input{padding:8px;border:1px solid #d6d3c8;border-radius:5px}';document.head.append(style);
const originalURL=URL.createObjectURL.bind(URL),revokeURL=URL.revokeObjectURL.bind(URL);
const originalText=CanvasRenderingContext2D.prototype.fillText,originalDraw=CanvasRenderingContext2D.prototype.drawImage;
const originalToBlob=HTMLCanvasElement.prototype.toBlob;
const state=window.shareFixture={assertions:0,saves:[],notices:[],requests:[],writes:[],resolutions:[],downloads:[],created:[],revoked:[],texts:[],textCalls:[],draws:[],shares:[],canShare:false,coverMode:'ok',blobGate:undefined};
URL.createObjectURL=blob=>{const url=originalURL(blob);state.created.push(url);return url};URL.revokeObjectURL=url=>{state.revoked.push(url);revokeURL(url)};
CanvasRenderingContext2D.prototype.fillText=function(text){state.texts.push(text);state.textCalls.push({text,font:this.font});return originalText.apply(this,arguments)};
CanvasRenderingContext2D.prototype.drawImage=function(image,x,y,w,h){state.draws.push({x,y,w,h});return originalDraw.apply(this,arguments)};
HTMLCanvasElement.prototype.toBlob=function(callback,...args){if(state.blobGate){const gate=state.blobGate;state.blobGate=undefined;originalToBlob.call(this,blob=>{gate.release=()=>callback(blob)},...args)}else originalToBlob.call(this,callback,...args)};
HTMLAnchorElement.prototype.click=function(){if(this.download)state.downloads.push({name:this.download,url:this.href});else throw new Error('Unexpected navigation')};
Object.defineProperty(navigator,'canShare',{configurable:true,value:()=>state.canShare});
Object.defineProperty(navigator,'share',{configurable:true,value:async data=>{state.shares.push({file:data.files[0],title:data.title,active:navigator.userActivation?.isActive});if(state.cancelShare)throw new DOMException('Cancelled','AbortError')}});
const cover=document.createElement('canvas');cover.width=180;cover.height=260;const ctx=cover.getContext('2d');ctx.fillStyle='#a32e72';ctx.fillRect(0,0,180,260);ctx.fillStyle='#fff';ctx.font='22px serif';ctx.fillText('真实书封',10,70);
const coverBytes=await fetch(cover.toDataURL()).then(response=>response.arrayBuffer());
state.request=async options=>{state.requests.push(options);if(state.coverMode==='pending')await new Promise(resolve=>state.releaseCover=resolve);if(state.coverMode==='fail')throw new Error('Synthetic offline');return{status:200,headers:{'content-type':'image/png'},arrayBuffer:coverBytes}};
const note={id:'synthetic:bookmark',bookId:'synthetic',kind:'highlight',text:'把日子过成一首慢慢读的诗。\n\n在平凡的生活里，仍然记得看见光。',bookTitle:'阅读与生活',author:'示例作者',chapterTitle:'第三章 日常的微光',createTime:1700000000000,cover:'https://synthetic.invalid/cover.png'};
const app={fileManager:{async getAvailablePathForAttachment(name){state.resolutions.push(name);return 'attachments/'+name}},vault:{getAbstractFileByPath(path){return state.occupied?.(path)?{path}:undefined},async createBinary(path,bytes){state.writes.push({path,bytes:Array.from(new Uint8Array(bytes)),length:bytes.byteLength})}}};
let modal;
const root=()=>modal.contentEl,button=text=>[...root().querySelectorAll('button')].find(el=>el.textContent===text),image=()=>root().querySelector('.weread-quote-share-preview img');
async function ready(previous){await wait(()=>image()&&image().src!==previous&&root().querySelector('.weread-quote-share-status').textContent.includes('PNG'));await image().decode();return image()}
async function open(options={},base=note){if(modal)modal.close();state.texts=[];state.draws=[];modal=new WereadQuoteShareModal(app,{...base,...options});modal.open();await ready();return modal}
async function template(id){const previous=image().src;root().querySelector('[data-template='+id+']').click();await ready(previous)}
async function username(value){const previous=image().src;const input=root().querySelector('input');input.value=value;input.dispatchEvent(new Event('input'));input.dispatchEvent(new Event('change'));await ready(previous)}
window.shareSmoke={
 async basics(){await open();check(root().querySelector('h2').textContent==='分享卡片','generic modal heading');check(modal.note.id===note.id&&modal.note.bookId===note.bookId&&modal.note.kind===note.kind,'full journal snapshot retains runtime fields');check(state.texts.includes('示例读者'),'canonical WeRead username rendered');check(root().querySelector('[data-template=paper]').getAttribute('aria-pressed')==='true','paper is default');check(state.requests.length===1&&state.requests[0].url===note.cover,'cover fetched through native requestUrl');check(state.draws.length===1,'real cover rendered');check(button('系统分享').hidden,'unsupported native share hidden');
 const snapshots=[];for(const id of ['paper','cover','night']){if(id!=='paper')await template(id);const img=image();const blob=await fetch(img.src).then(r=>r.blob());const bitmap=await createImageBitmap(blob);const pixels=document.createElement('canvas');pixels.width=bitmap.width;pixels.height=bitmap.height;pixels.getContext('2d').drawImage(bitmap,0,0);const d=state.draws.at(-2)||state.draws[0];const pixel=Array.from(pixels.getContext('2d').getImageData(Math.floor(d.x+d.w/2),Math.floor(d.y+d.h/2),1,1).data);snapshots.push({id,width:img.naturalWidth,height:img.naturalHeight,mime:blob.type,size:blob.size,pixel});check(img.alt.includes({paper:'纸间',cover:'书封',night:'夜读'}[id]),'preview label matches template');check(state.saves.length===0,'preview selection does not persist global default')}
 button('设为默认模板').click();check(state.saves.length===1&&state.saves[0].key==='quoteShareTemplate'&&window.shareSettings.current().quoteShareTemplate==='night','only explicit default action persists selected template');
 await username('  分享笔名  ');check(state.texts.includes('分享笔名'),'edited nickname renders');check(window.shareSettings.current().quoteShareUsername==='分享笔名'&&window.shareSettings.current().user==='示例读者','nickname override saves without changing canonical username');
 await username('');check(state.texts.at(-1)==='示例读者'||state.texts.slice(-20).includes('示例读者'),'clearing override renders canonical username');check(window.shareSettings.current().quoteShareUsername==='','cleared override persists');
 window.shareSettings.set({quoteShareUsername:'已存署名'});await open();check(state.texts.includes('已存署名'),'saved override used on next open');window.shareSettings.set({quoteShareUsername:'',quoteShareTemplate:'paper'});await open();
 return snapshots},
 async exports(){button('保存图片').click();check(state.downloads.length===1&&state.downloads[0].url.startsWith('data:image/png;base64,')&&state.downloads[0].name.startsWith('分享此刻-阅读与生活-')&&state.downloads[0].name.endsWith('-paper.png'),'local download contains prepared PNG and current template filename');
 let collisions=0;state.occupied=()=>++collisions===1;button('保存到笔记库').click();await wait(()=>state.writes.length===1);check(state.resolutions.length===2&&state.writes[0].path.startsWith('attachments/')&&state.writes[0].path.endsWith('-1.png'),'vault export resolves attachment path and skips occupied file');check(state.writes[0].bytes.slice(0,8).join(',')==='137,80,78,71,13,10,26,10','vault export is real PNG');
 state.occupied=undefined;const manager=app.fileManager;delete app.fileManager;button('保存到笔记库').click();await wait(()=>state.writes.length===2);check(!state.writes[1].path.includes('/'),'older Obsidian saves to vault root');app.fileManager=manager;
 state.canShare=true;await template('cover');check(!button('系统分享').hidden,'native share shown when file sharing supported');const notices=state.notices.length;state.cancelShare=true;button('系统分享').click();await wait(()=>state.shares.length===1);await new Promise(resolve=>setTimeout(resolve,0));const file=state.shares[0].file;check(file instanceof File&&file.type==='image/png'&&file.size>1000&&file.name.startsWith('分享此刻-阅读与生活-')&&file.name.endsWith('-cover.png'),'native share receives prepared PNG File');check(state.notices.length===notices,'user cancellation does not show error');state.cancelShare=false;
 state.coverMode='fail';await open();check(root().querySelector('.weread-quote-share-status').textContent.includes('文字书封')&&state.draws.length===0,'failed native cover request falls back to text cover');state.coverMode='ok';return state.assertions},
 async minimal(){
  const content={text:'来自社区的完整想法。👩🏽‍💻\n书评同样可以分享。',bookTitle:'社区书评',context:{source:'community'}};
  const requests=state.requests.length;await open({},content);
  check(root().querySelector('h2').textContent==='分享卡片','minimal content uses generic modal title');
  check(!('id' in modal.note)&&!('bookId' in modal.note)&&!('kind' in modal.note)&&!('createTime' in modal.note)&&!('author' in modal.note),'minimal snapshot fabricates no identifiers, author or date');
  check(modal.note.context===content.context,'runtime extras survive spread snapshot');
  check(state.requests.length===requests,'minimal share does not fetch a fabricated cover');
  const snapshots=[];
  for(const id of ['paper','cover','night']) {
   state.texts=[];state.textCalls=[];await template(id);
   const values=state.texts;
   check(values.includes('分享此刻')&&values.includes('OBSIDIAN WEREAD'),'each modal template renders requested branding');
   check(!values.some(value=>/旧句重逢|READ & REMEMBER/.test(value)),'old branding absent from minimal share');
   check(values.includes('《社区书评》')&&values.includes('示例读者'),'minimal share preserves source and username');
   check(!values.some(value=>/^\d{4}\.\d{2}\.\d{2}$/.test(value)),'minimal share omits unknown date');
   const before=state.downloads.length;button('保存图片').click();const download=state.downloads.at(-1);
   check(state.downloads.length===before+1&&download.name.startsWith('分享此刻-社区书评-')&&download.name.endsWith('-'+id+'.png')&&download.url.startsWith('data:image/png;base64,'),'minimal share exports prepared PNG with generic filename');
   snapshots.push({id,texts:[...values],body:state.textCalls.filter(call=>call.font.startsWith(id==='cover'?'48px':'56px')).map(call=>call.text).join(''),filename:download.name});
  }
  return {content:content.text,snapshots};
 },
 async closePending(){const writes=state.writes.length;modal.close();state.coverMode='pending';modal=new WereadQuoteShareModal(app,note);modal.open();const detached=root();await wait(()=>state.releaseCover);modal.close();state.releaseCover();await new Promise(resolve=>setTimeout(resolve,60));check(!detached.querySelector('img')&&state.writes.length===writes,'close during cover request prevents late preview and vault writes');state.coverMode='ok';
 state.blobGate={};const gate=state.blobGate;modal=new WereadQuoteShareModal(app,note);modal.open();await wait(()=>gate.release);const content=root();modal.close();gate.release();await new Promise(resolve=>setTimeout(resolve,30));check(!content.querySelector('img')&&state.writes.length===writes,'close during PNG encoding discards later result');check(state.created.every(url=>state.revoked.includes(url)),'cover and preview object URLs revoked on replacement and close');return state.assertions},
 async geometry(){await open();await template('paper');const shell=modal.modalEl.getBoundingClientRect();check(document.documentElement.scrollWidth<=innerWidth,'modal does not overflow viewport');check(root().scrollWidth<=root().clientWidth,'modal content has no horizontal overflow');check(image().getBoundingClientRect().width>100,'production PNG preview remains visible');return{shellWidth:shell.width,viewport:innerWidth,assertions:state.assertions}},
 async capture(){window.shareSettings.set({quoteShareUsername:'',quoteShareTemplate:'paper'});await open();return image().src},
 nativeTarget(){const rect=button('系统分享').getBoundingClientRect();return{x:rect.x+rect.width/2,y:rect.y+rect.height/2}},
 png:async()=>Array.from(new Uint8Array(await fetch(image().src).then(r=>r.arrayBuffer())))
};
})();
`;
