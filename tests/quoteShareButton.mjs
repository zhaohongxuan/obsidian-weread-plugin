import assert from 'node:assert/strict';
import test from 'node:test';
import { browserHarness, bundleFixture, chromeAvailable } from './helpers/detailBrowserHarness.mjs';

test(
	'shared button takes a fresh snapshot and ignores stale, inactive or empty controls',
	{ skip: !chromeAvailable },
	async (t) => {
		const browser = await browserHarness(t);
		const script = await bundleFixture(`
		import {createQuoteShareButton} from './src/components/quoteShareButton';
		HTMLElement.prototype.createEl=function(tag,options={}){const el=document.createElement(tag);el.className=options.cls||'';for(const [key,value]of Object.entries(options.attr||{}))el.setAttribute(key,value);this.append(el);return el;};
		const parent=document.createElement('div');document.body.append(parent);
		let content={text:'最初的句子',bookTitle:'合成图书'},active=true,bubbles=0;
		const shared=[];parent.onclick=()=>bubbles++;
		const button=createQuoteShareButton(parent,{getContent:()=>content,onShare:note=>shared.push(note),isActive:()=>active,cls:'surface-action'});
		content={text:'最新完整文字\\n第二段',bookTitle:'当前图书',author:'示例作者',chapterTitle:'第二章',cover:'https://fixture.invalid/cover'};
		button.click();content.text='打开之后变化的文字';
		active=false;button.click();active=true;
		content=undefined;button.click();content={text:'   ',bookTitle:'空白'};button.click();
		content={text:'下一条句子',bookTitle:'合成图书'};button.click();button.remove();button.click();
		window.shareButtonResult={shared,bubbles,classes:[...button.classList],label:button.getAttribute('aria-label'),title:button.title,svg:!!button.querySelector('svg')};
	`);
		await browser.evaluate(script);
		const result = await browser.evaluate('shareButtonResult');
		assert.equal(result.shared.length, 2);
		assert.equal(result.shared[0].text, '最新完整文字\n第二段');
		assert.equal(result.shared[0].bookTitle, '当前图书');
		assert.equal(result.shared[0].author, '示例作者');
		assert.equal(result.shared[0].chapterTitle, '第二章');
		assert.equal(result.shared[0].cover, 'https://fixture.invalid/cover');
		assert.equal(result.shared[1].text, '下一条句子');
		assert.equal(result.shared[1].createTime, undefined);
		assert.equal(result.shared[1].id, undefined);
		assert.equal(result.bubbles, 0);
		for (const value of ['clickable-icon', 'weread-share-button', 'surface-action'])
			assert(result.classes.includes(value));
		assert.equal(result.label, '分享卡片');
		assert.equal(result.title, '分享卡片');
		assert(result.svg);
	}
);
