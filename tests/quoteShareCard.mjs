import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { browserHarness, bundleFixture, chromeAvailable } from './helpers/detailBrowserHarness.mjs';

const compiled = await build({
	entryPoints: ['src/quoteShareCard.ts'],
	bundle: true,
	platform: 'node',
	format: 'esm',
	write: false
});
const api = await import(
	`data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString('base64')}`
);

test('share template catalog imports without DOM and resolves untrusted settings to paper', () => {
	assert.equal(api.DEFAULT_QUOTE_SHARE_TEMPLATE, 'paper');
	assert.deepEqual(
		api.QUOTE_SHARE_TEMPLATES.map((value) => value.id),
		['paper', 'cover', 'night']
	);
	for (const value of [undefined, null, '', 'constructor', {}, 1])
		assert.equal(api.resolveQuoteShareTemplate(value), 'paper');
	for (const value of ['paper', 'cover', 'night'])
		assert.equal(api.resolveQuoteShareTemplate(value), value);
});

test(
	'production Canvas keeps complete Unicode text, source, username and contained cover for all styles',
	{ skip: !chromeAvailable },
	async (t) => {
		const browser = await browserHarness(t);
		const fixture = await bundleFixture(`
		import { renderQuoteShareCard } from './src/quoteShareCard';
		window.renderShareCard = renderQuoteShareCard;
	`);
		await browser.evaluate(fixture);
		const result = await browser.evaluate(String.raw`(() => {
		const note = { id:'synthetic', bookId:'sample', kind:'highlight', bookTitle:'合成图书', author:'示例作者', chapterTitle:'测试章节', createTime:1700000000000, text:'先看一棵树。\n\nFamily 👨‍👩‍👧‍👦 and café — a remarkablylongwordthatmustwrapwithoutlosingcharacters。继续认真生活。' };
		const cover = document.createElement('canvas'); cover.width=400; cover.height=100;
		cover.getContext('2d').fillStyle='#ff00ff'; cover.getContext('2d').fillRect(0,0,400,100);
		const originalText=CanvasRenderingContext2D.prototype.fillText;
		const originalImage=CanvasRenderingContext2D.prototype.drawImage;
		let calls=[],images=[];
		CanvasRenderingContext2D.prototype.fillText=function(value,x,y){const metrics=this.measureText(value);calls.push({value,x,y,font:this.font,width:metrics.width,left:x-metrics.actualBoundingBoxLeft,right:x+metrics.actualBoundingBoxRight,top:y-metrics.actualBoundingBoxAscent,bottom:y+metrics.actualBoundingBoxDescent});return originalText.apply(this,arguments)};
		CanvasRenderingContext2D.prototype.drawImage=function(){images.push(Array.from(arguments).slice(1));return originalImage.apply(this,arguments)};
		const snapshots=[];
		for(const template of ['paper','cover','night']) {
			calls=[];images=[];
			const canvas=window.renderShareCard(note,{template,username:'测试读者 🪴',cover});
			const body=calls.filter(call=>call.font.startsWith(template==='cover'?'48px':'56px'));
			const draw=images[0];
			const pixel=canvas.getContext('2d').getImageData(Math.floor(draw[0]+draw[2]/2),Math.floor(draw[1]+draw[3]/2),1,1).data;
			snapshots.push({template,width:canvas.width,height:canvas.height,body,images,calls,pixel:Array.from(pixel),png:canvas.toDataURL().slice(0,30)});
		}
		calls=[];images=[];
		const longText=('长句保留全部文本，不使用省略号。👩🏽‍💻 Latin words stay readable.\n').repeat(18);
		const longCanvas=window.renderShareCard({...note,text:longText},{username:'长句测试'});
		const longCalls=calls.filter(call=>call.font.startsWith('56px'));
		const fallback=calls.some(call=>call.value==='书');
		const minimal={text:'不需要标识的完整分享内容。👨‍👩‍👧‍👦\nCommunity thought and review.',bookTitle:'只有书名的来源'};
		const minimalSnapshots=[];
		for(const template of ['paper','cover','night']) {
			for(const createTime of [undefined,NaN,Infinity,-1,0,1e20]) {
				calls=[];const canvas=window.renderShareCard({...minimal,...(createTime===undefined?{}:{createTime})},{template,username:'社区读者'});
				minimalSnapshots.push({template,calls,height:canvas.height,png:canvas.toDataURL().slice(0,30)});
			}
		}
		let oversized='';try{window.renderShareCard({...note,text:'不应静默裁切'.repeat(20000)})}catch(e){oversized=e.message}
		return {snapshots,minimal,minimalSnapshots,expected:note.text,longText,longHeight:longCanvas.height,longCalls,fallback,oversized};
	})()`);
		for (const snapshot of result.snapshots) {
			assert.equal(snapshot.width, 1080);
			assert(snapshot.height >= 1440 && snapshot.height <= 12000);
			assert.equal(
				snapshot.body.map((call) => call.value).join(''),
				result.expected.replaceAll('\n', '')
			);
			assert(snapshot.body.some((call) => call.value.includes('👨‍👩‍👧‍👦')));
			assert(
				snapshot.body.some((call) => call.value === ''),
				'explicit empty paragraph remains'
			);
			for (const value of [
				'《合成图书》',
				'示例作者',
				'测试章节',
				'2023.11.15',
				'测试读者 🪴'
			])
				assert(
					snapshot.calls.some((call) => call.value === value),
					value
				);
			const heading = snapshot.calls.find((call) => call.value === '分享此刻');
			const brand = snapshot.calls.find((call) => call.value === 'OBSIDIAN WEREAD');
			assert(heading && brand, snapshot.template + ' has generic heading and exact brand');
			assert.equal(snapshot.calls.filter((call) => call.value === '分享此刻').length, 1);
			assert.equal(snapshot.calls.filter((call) => call.value === 'OBSIDIAN WEREAD').length, 1);
			assert(!snapshot.calls.some((call) => /旧句重逢|READ & REMEMBER|READING NOTES/.test(call.value)));
			assert(heading.y < 110 && brand.y <= 110, 'branding stays in upper header');
			assert(heading.x < 200 && brand.x > 395, 'branding occupies upper left and right');
			assert(heading.right + 30 < brand.left, 'header text has a clear horizontal gap');
			assert(Math.abs(brand.x + brand.width - 982) < 0.01, 'brand aligns to the 982px right edge');
			assert(brand.left >= 395 && brand.right <= 984, 'actual brand glyphs stay in right header');
			assert(brand.top >= 0 && brand.bottom < 174, 'actual brand glyphs stay inside header height');
			assert(snapshot.png.startsWith('data:image/png;base64,'));
			assert.deepEqual(snapshot.pixel, [255, 0, 255, 255]);
			assert.equal(snapshot.images.length, 1);
			const [x, y, width, height] = snapshot.images[0];
			assert.equal(width / height, 4, 'cover aspect ratio preserved');
			assert(
				x > 750 &&
					y > snapshot.height / 2 &&
					x + width <= 1080 &&
					y + height < snapshot.height
			);
			assert(
				snapshot.body.every((call) => call.y + 106 < y),
				'body clears source/cover footer'
			);
		}
		for (const snapshot of result.minimalSnapshots) {
			const body = snapshot.calls.filter((call) => call.font.startsWith(snapshot.template === 'cover' ? '48px' : '56px'));
			assert.equal(body.map((call) => call.value).join(''), result.minimal.text.replaceAll('\n', ''));
			assert(snapshot.calls.some((call) => call.value === '《只有书名的来源》'));
			assert(snapshot.calls.some((call) => call.value === '社区读者'));
			assert(!snapshot.calls.some((call) => /^\d{4}\.\d{2}\.\d{2}$/.test(call.value)), 'absent/invalid date omitted');
			assert(!snapshot.calls.some((call) => /Invalid Date|undefined|NaN/.test(call.value)));
			assert(snapshot.png.startsWith('data:image/png;base64,'));
		}
		assert(result.longHeight > 1440 && result.longHeight <= 12000);
		assert.equal(
			result.longCalls.map((call) => call.value).join(''),
			result.longText.replaceAll('\n', '')
		);
		assert(result.fallback, 'missing cover gets typographic placeholder');
		assert.match(result.oversized, /过长.*安全尺寸/);
	}
);

test(
	'Canvas soft wraps keep punctuation attached without overflowing',
	{ skip: !chromeAvailable },
	async (t) => {
		const browser = await browserHarness(t);
		await browser.evaluate(
			await bundleFixture(
				`import { renderQuoteShareCard } from './src/quoteShareCard'; window.renderShareCard=renderQuoteShareCard;`
			)
		);
		const snapshots = await browser.evaluate(String.raw`(() => {
		const result=[]; const original=CanvasRenderingContext2D.prototype.fillText;let calls=[];
		CanvasRenderingContext2D.prototype.fillText=function(value,x,y){if(this.font.startsWith('56px')||this.font.startsWith('48px'))calls.push({value,width:this.measureText(value).width,x});return original.apply(this,arguments)};
		for(const template of ['paper','cover','night']) {
			const probe=document.createElement('canvas').getContext('2d');probe.font=(template==='cover'?48:56)+'px "Songti SC", "STSong", "Noto Serif CJK SC", serif';
			const width=1080-(template==='cover'?395:template==='night'?178:98)-98;
			const count=Math.floor(width/probe.measureText('汉').width);
			for(const quote of ['在平凡的生活里，仍然记得看见光。','汉'.repeat(count)+'。下一句。','汉'.repeat(count-1)+'「继续看见光」。','汉'.repeat(count-1)+'《书名》，继续。','English words remain together. '+ '汉'.repeat(count)+'，👨‍👩‍👧‍👦 café。']) {
				calls=[];window.renderShareCard({id:'synthetic',bookId:'sample',kind:'highlight',bookTitle:'合成',author:'作者',createTime:0,text:quote},{template});result.push({template,quote,width,lines:calls});
			}
		}return result;
	})()`);
		for (const snapshot of snapshots) {
			assert.equal(snapshot.lines.map((line) => line.value).join(''), snapshot.quote);
			for (const [index, line] of snapshot.lines.entries()) {
				assert(line.width <= snapshot.width + 0.01, JSON.stringify(snapshot));
				if (index)
					assert(
						!/^[，。！？、；：）》」』】〉,.!?;:]/.test(line.value),
						JSON.stringify(snapshot)
					);
				if (index < snapshot.lines.length - 1)
					assert(!/[（《「『【〈]$/.test(line.value), JSON.stringify(snapshot));
			}
		}
	}
);
