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
			assert.equal(
				snapshot.calls.filter((call) => call.value === 'OBSIDIAN WEREAD').length,
				1
			);
			assert(
				!snapshot.calls.some((call) =>
					/旧句重逢|READ & REMEMBER|READING NOTES/.test(call.value)
				)
			);
			assert(heading.y < 110 && brand.y <= 110, 'branding stays in upper header');
			assert(heading.x < 200 && brand.x > 395, 'branding occupies upper left and right');
			assert(heading.right + 30 < brand.left, 'header text has a clear horizontal gap');
			assert(
				Math.abs(brand.x + brand.width - 982) < 0.01,
				'brand aligns to the 982px right edge'
			);
			assert(
				brand.left >= 395 && brand.right <= 984,
				'actual brand glyphs stay in right header'
			);
			assert(
				brand.top >= 0 && brand.bottom < 174,
				'actual brand glyphs stay inside header height'
			);
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
			const body = snapshot.calls.filter((call) =>
				call.font.startsWith(snapshot.template === 'cover' ? '48px' : '56px')
			);
			assert.equal(
				body.map((call) => call.value).join(''),
				result.minimal.text.replaceAll('\n', '')
			);
			assert(snapshot.calls.some((call) => call.value === '《只有书名的来源》'));
			assert(snapshot.calls.some((call) => call.value === '社区读者'));
			assert(
				!snapshot.calls.some((call) => /^\d{4}\.\d{2}\.\d{2}$/.test(call.value)),
				'absent/invalid date omitted'
			);
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

test(
	'source hierarchy measures complete rows and clears cover/footer across metadata shapes',
	{ skip: !chromeAvailable },
	async (t) => {
		const browser = await browserHarness(t);
		await browser.evaluate(
			await bundleFixture(
				`import { renderQuoteShareCard } from './src/quoteShareCard'; window.renderShareCard=renderQuoteShareCard;`
			)
		);
		const snapshots = await browser.evaluate(String.raw`(() => {
  const original = CanvasRenderingContext2D.prototype.fillText;
  const stroke = CanvasRenderingContext2D.prototype.moveTo;
  let calls=[], rules=[];
  CanvasRenderingContext2D.prototype.fillText=function(value,x,y){const m=this.measureText(value); calls.push({value,x,y,font:this.font,color:this.fillStyle,left:x-m.actualBoundingBoxLeft,right:x+m.actualBoundingBoxRight,top:y-m.actualBoundingBoxAscent,bottom:y+m.actualBoundingBoxDescent});return original.apply(this,arguments)};
  CanvasRenderingContext2D.prototype.moveTo=function(x,y){rules.push({x,y});return stroke.apply(this,arguments)};
  const cases=[
   {bookTitle:'创造行为：存在即答案',author:'[美]里克·鲁宾',chapterTitle:'我们对自己说的话',createTime:new Date('2026-11-11T12:00:00+08:00').getTime()},
   {bookTitle:'关于日常生活、创造与时间的漫长讨论：在世界的角落寻找答案'.repeat(3),author:'[美]合成作者甲、[英]合成作者乙、合成作者丙与研究小组'.repeat(3),chapterTitle:'第一部分「我们对自己说的话」：如何认真地观察生活，并保持好奇心。'.repeat(4),createTime:1794369600000},
   {bookTitle:'仅有书名'},
   {bookTitle:'缺少作者',chapterTitle:'仍然保留完整章节'},
   {bookTitle:'缺少章节',author:'合成作者',createTime:1794369600000}
  ];
  const result=[];
  for(const template of ['paper','cover','night']) for(const note of cases){
   calls=[];rules=[];const canvas=window.renderShareCard({...note,text:'这是一段合成的短句。'},{template,username:'合成读者'});
   const x=template==='cover'?395:template==='night'?178:98;
   const title=calls.filter(c=>c.x===x&&c.font.startsWith('34px'));
   const start=title[0].y;
   const footer=rules.findLast(r=>r.x===x).y;
   const source=calls.filter(c=>c.x===x&&c.y>=start&&c.y<footer);
   result.push({template,note,title,source,footer,height:canvas.height,username:calls.find(c=>c.value==='合成读者')});
  }return result;
 })()`);
		for (const s of snapshots) {
			const rows = (size) => s.source.filter((c) => c.font.startsWith(size + 'px'));
			assert.equal(
				rows(34)
					.map((c) => c.value)
					.join(''),
				'《' + s.note.bookTitle + '》'
			);
			assert.equal(
				rows(23)
					.map((c) => c.value)
					.join(''),
				s.note.author || ''
			);
			assert.equal(
				rows(21)
					.map((c) => c.value)
					.join(''),
				s.note.chapterTitle || ''
			);
			assert.equal(rows(20).length, s.note.createTime ? 1 : 0);
			if (s.note.createTime) assert.match(rows(20)[0].value, /^2026\.11\.11$/);
			for (let i = 0; i < s.source.length; i++) {
				const row = s.source[i];
				assert(row.right < 780 && row.left >= row.x - 3, 'source clears cover column');
				assert(row.bottom < s.footer - 40, 'actual source glyphs clear footer');
				assert(!row.value.includes('…'), 'metadata never gets an ellipsis');
				if (i) assert(row.top > s.source[i - 1].bottom + 5, 'visible row separation');
			}
			assert(
				s.username.top > s.footer + 20 && s.username.bottom < s.height,
				'username clears footer and card bottom'
			);
			const title = rows(34),
				author = rows(23),
				chapter = rows(21),
				date = rows(20);
			for (const field of [title, author, chapter])
				for (let i = 1; i < field.length; i++)
					assert.equal(
						field[i].y - field[i - 1].y,
						field === title ? 48 : field === author ? 34 : 32,
						'consistent measured row advances'
					);
			if (author.length) assert.equal(author[0].y - title.at(-1).y, 58);
			if (chapter.length)
				assert.equal(
					chapter[0].y - (author.at(-1) || title.at(-1)).y,
					author.length ? 52 : 66,
					'missing author adds no orphan spacing'
				);
			if (date.length)
				assert.equal(s.footer - date[0].y, 74, 'date anchors near cover bottom');
			assert(
				title[0].color !== (author[0] || chapter[0] || title[0]).color ||
					(!author.length && !chapter.length),
				'title has darker ink than secondary metadata'
			);
		}
	}
);
