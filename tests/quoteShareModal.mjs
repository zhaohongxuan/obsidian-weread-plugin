import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import test from 'node:test';
import { browserHarness, chromeAvailable } from './helpers/detailBrowserHarness.mjs';
import { bundleQuoteShareFixture } from './helpers/quoteShareFixture.mjs';
export { bundleQuoteShareFixture } from './helpers/quoteShareFixture.mjs';

test('production share modal previews and exports PNGs while preserving defaults and lifecycle', {skip:!chromeAvailable}, async t=>{
 const browser=await browserHarness(t);await browser.viewport(1180);await browser.evaluate(await bundleQuoteShareFixture());await browser.evaluate('shareFixtureReady');
 const previews=await browser.evaluate('shareSmoke.basics()');
 for(const preview of previews){assert.equal(preview.width,1080);assert(preview.height>=1440);assert.equal(preview.mime,'image/png');assert(preview.size>1000);assert.deepEqual(preview.pixel,[163,46,114,255]);}
 await browser.evaluate('shareSmoke.exports()');
 const nativeTarget=await browser.evaluate('shareSmoke.nativeTarget()');
 await browser.send('Input.dispatchMouseEvent',{type:'mousePressed',...nativeTarget,button:'left',clickCount:1});
 await browser.send('Input.dispatchMouseEvent',{type:'mouseReleased',...nativeTarget,button:'left',clickCount:1});
 assert.equal(await browser.evaluate('shareFixture.shares.length'),2);
 assert.equal(await browser.evaluate('shareFixture.shares.at(-1).active'),true,'native share uses the original trusted click user activation');
 for(const width of [390,768]){await browser.viewport(width,1000);await browser.evaluate('shareSmoke.geometry()');}
 await browser.evaluate('shareSmoke.closePending()');
 await browser.viewport(1180);await browser.evaluate('shareSmoke.capture()');
 const directory='cr_result/share-card-prototype';await mkdir(directory,{recursive:true});
 await writeFile(directory+'/production-modal-card.png',Buffer.from(await browser.evaluate('shareSmoke.png()')));
 await browser.screenshot(directory+'/production-modal.png');
 t.diagnostic((await browser.evaluate('shareFixture.assertions'))+' production modal assertions passed');
 await browser.evaluate('shareSmoke.closePending()');
});
