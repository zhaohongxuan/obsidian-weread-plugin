// Production bookmark script in real Chrome; synthetic reader only, no network or vault.
// Run: node --test tests/webReaderBookmark.mjs
import assert from 'node:assert/strict';
import test from 'node:test';
import { browserHarness, bundleFixture, chromeAvailable } from './helpers/detailBrowserHarness.mjs';

const fixture = String.raw`
import { buildBookmarkNavigationScript } from './src/utils/webReaderBookmark';
import { BOOKMARK_CANVAS_HOOK_SCRIPT } from './src/utils/webReaderCanvas';
window.installBookmarkCanvasCapture = () => (0, eval)(BOOKMARK_CANVAS_HOOK_SCRIPT);
const quote = 'A distant highlighted passage belongs to the book, not the notes sidebar.';
window.prepareBookmarkReader = ({ noteButton = false, find = true, nativeJump, readerText = false, repeatedPrefix = false, hiddenPreRender = false } = {}) => {
  document.body.innerHTML = '';
  document.head.querySelectorAll('style').forEach(node => node.remove());
  const style = document.createElement('style');
  style.textContent = 'body{margin:0} .readerChapterContent{width:600px} canvas{display:block} .wr_reader_note_panel{position:fixed;right:0;top:0;width:300px;background:white}';
  document.head.append(style);
  const main = document.createElement('main');
  main.className = 'readerChapterContent';
  main.innerHTML = '<h1>Chapter opening</h1><p>The reader is still at the chapter top.</p>';
  const canvas = document.createElement('canvas');
  canvas.width = 600;
  canvas.height = 3000;
  canvas.getContext('2d').fillText(quote, 20, 2400);
  main.append(canvas);
  const bookQuote = document.createElement('p');
  bookQuote.className = 'renderTargetContent';
  bookQuote.textContent = quote;
  if (readerText || nativeJump) main.append(bookQuote);
  if (hiddenPreRender) {
    const preRender = document.createElement('div');
    preRender.className = 'preRenderContainer';
    preRender.style.cssText = 'position:absolute;left:-10000px;top:0';
    preRender.innerHTML = '<div class="preRenderContent"></div>';
    preRender.firstElementChild.textContent = quote;
    main.append(preRender);
  }
  document.body.append(main);
  const sidebar = document.createElement('aside');
  sidebar.className = 'wr_reader_note_panel';
  const wrapper = document.createElement('div');
  wrapper.className = 'wr_reader_note_panel_item_cell_wrapper';
  const text = document.createElement('span');
  text.className = 'wr_reader_note_panel_item_cell_content_text';
  text.textContent = quote;
  const content = document.createElement('div');
  content.className = 'wr_reader_note_panel_item_cell_content';
  content.append(text);
  wrapper.append(content);
  sidebar.append(wrapper);
  if (hiddenPreRender) text.textContent = 'An unrelated note in the sidebar';
  window.wrongNoteClicks = 0;
  if (repeatedPrefix) {
    const wrong = wrapper.cloneNode(true);
    wrong.querySelector('.wr_reader_note_panel_item_cell_content_text').textContent = quote.slice(0, 20) + ' ... an entirely different passage.';
    wrong.addEventListener('click', () => { window.wrongNoteClicks++; });
    sidebar.prepend(wrong);
  }
  document.body.append(sidebar);
  window.noteWrapperClicks = 0;
  wrapper.addEventListener('click', () => {
    window.noteWrapperClicks++;
    if (nativeJump === 'scroll') bookQuote.scrollIntoView({block: 'center'});
    if (nativeJump === 'page') {
      canvas.style.display = 'none';
      main.querySelector('h1').textContent = 'Later page of the same chapter';
      main.querySelector('p').textContent = 'The chapter opening has been replaced.';
      main.classList.add('isHorizontalReader');
    }
  });
  if (noteButton) {
    const button = document.createElement('button');
    button.className = 'readerControls_item wr_note';
    button.textContent = 'Notes';
    document.body.append(button);
  }
  window.getSelection().removeAllRanges();
  window.scrollTo(0, 0);
  // Isolate the note-click path when requested. The find regression uses Chrome's native find.
  window.find = find ? window.nativeBookmarkFind : undefined;
  window.bookmarkScript = buildBookmarkNavigationScript({
    bookId: 'synthetic-book', chapterUid: 7, rangeStart: 2400, rangeEnd: 2470, markText: quote
  });
  return { quote, scrollY: window.scrollY, quoteY: canvas.getBoundingClientRect().top + 2400, viewportHeight: window.innerHeight };
};
window.nativeBookmarkFind = window.find.bind(window);
window.bookmarkReaderState = () => {
  const selection = window.getSelection();
  const selectedElement = selection.anchorNode?.nodeType === Node.ELEMENT_NODE
    ? selection.anchorNode : selection.anchorNode?.parentElement;
  const bookQuote = document.querySelector('.renderTargetContent');
  const rect = bookQuote?.getBoundingClientRect();
  return {
    bookQuoteVisible: !!rect && rect.top >= 0 && rect.bottom <= window.innerHeight,
    wrongNoteClicks: window.wrongNoteClicks,
    selectionInPreRender: !!selectedElement?.closest('.preRenderContainer'),
    scrollY: window.scrollY,
    selectedText: selection.toString(),
    selectionInSidebar: !!selectedElement?.closest('.wr_reader_note_panel'),
    selectionInReader: !!selectedElement?.closest('.readerChapterContent'),
    noteWrapperClicks: window.noteWrapperClicks
  };
};
`;

async function reader(t, options) {
	const browser = await browserHarness(t);
	await browser.viewport(1100, 800);
	await browser.evaluate(await bundleFixture(fixture));
	const initial = await browser.evaluate(`prepareBookmarkReader(${JSON.stringify(options)})`);
	assert.equal(initial.scrollY, 0);
	assert(
		initial.quoteY > initial.viewportHeight,
		'The canvas highlight starts below the viewport'
	);
	return { browser, initial };
}

test(
	'a no-op notes wrapper click cannot report an exact highlight jump while the book stays at chapter top',
	{ skip: !chromeAvailable },
	async (t) => {
		const { browser, initial } = await reader(t, { noteButton: true, find: false });
		const result = await browser.evaluate('eval(bookmarkScript)');
		const state = await browser.evaluate('bookmarkReaderState()');
		t.diagnostic(JSON.stringify({ result, state }));
		assert.equal(state.noteWrapperClicks, 1, 'The actual matching notes wrapper was clicked');
		assert.equal(
			state.scrollY,
			initial.scrollY,
			'The no-op click leaves the book at chapter top'
		);
		assert.equal(state.selectionInReader, false, 'No book passage was selected');
		assert.equal(
			result.mode,
			'chapter-only',
			'Sidebar text alone must not report a successful highlight jump'
		);
	}
);

test(
	'native window.find selecting a quote inside the sidebar cannot report a book highlight jump',
	{ skip: !chromeAvailable },
	async (t) => {
		const { browser, initial } = await reader(t, { noteButton: false, find: true });
		const result = await browser.evaluate('eval(bookmarkScript)');
		const state = await browser.evaluate('bookmarkReaderState()');
		t.diagnostic(JSON.stringify({ result, state }));
		// Chrome may clear a rejected sidebar selection; if retained, it must be the real quote.
		if (state.selectedText) {
			assert.equal(state.selectedText, initial.quote.slice(0, 32));
			assert.equal(state.selectionInSidebar, true);
		}
		assert.equal(
			state.scrollY,
			initial.scrollY,
			'Finding sidebar text leaves the book at chapter top'
		);
		assert.equal(state.selectionInReader, false, 'The selected quote is not book content');
		assert.equal(
			result.mode,
			'chapter-only',
			'A sidebar-only native find must not report a successful highlight jump'
		);
	}
);

for (const nativeJump of ['scroll', 'page']) {
	test(
		`a native notes click that reveals the book quote by ${nativeJump} reports successful navigation`,
		{ skip: !chromeAvailable },
		async (t) => {
			const { browser } = await reader(t, { noteButton: true, find: false, nativeJump });
			const result = await browser.evaluate('eval(bookmarkScript)');
			const state = await browser.evaluate('bookmarkReaderState()');
			t.diagnostic(JSON.stringify({ result, state }));
			assert.equal(
				state.bookQuoteVisible,
				true,
				'The actual book quote must enter the viewport'
			);
			if (nativeJump === 'scroll')
				assert(state.scrollY > 0, 'Vertical reader scrolls to the quote');
			else
				assert.equal(
					state.scrollY,
					0,
					'Horizontal page change can reveal a quote without window scrolling'
				);
			assert.notEqual(result.mode, 'chapter-only', 'A real book jump must remain supported');
		}
	);
}

test(
	'native window.find selecting the actual reader passage reports successful navigation',
	{ skip: !chromeAvailable },
	async (t) => {
		const { browser, initial } = await reader(t, { readerText: true });
		const result = await browser.evaluate('eval(bookmarkScript)');
		const state = await browser.evaluate('bookmarkReaderState()');
		t.diagnostic(JSON.stringify({ result, state }));
		assert.equal(state.selectedText, initial.quote.slice(0, 32));
		assert.equal(state.selectionInReader, true);
		assert.equal(state.selectionInSidebar, false);
		assert.equal(state.bookQuoteVisible, true, 'Native find exposes actual book text');
		assert.equal(result.mode, 'find');
	}
);

test(
	'notes with the same first twenty characters must not navigate to a different passage',
	{ skip: !chromeAvailable },
	async (t) => {
		const { browser } = await reader(t, {
			noteButton: true,
			find: false,
			repeatedPrefix: true,
			nativeJump: 'scroll'
		});
		const result = await browser.evaluate('eval(bookmarkScript)');
		const state = await browser.evaluate('bookmarkReaderState()');
		t.diagnostic(JSON.stringify({ result, state }));
		assert.equal(
			state.bookQuoteVisible,
			true,
			'The requested complete quote must enter the book viewport'
		);
		assert.equal(
			state.wrongNoteClicks,
			0,
			'A matching prefix alone must not activate the wrong note'
		);
		assert.notEqual(result.mode, 'chapter-only');
	}
);

test(
	'native find of offscreen pre-render text must not count as a visible book passage',
	{ skip: !chromeAvailable },
	async (t) => {
		const { browser } = await reader(t, { hiddenPreRender: true });
		const result = await browser.evaluate('eval(bookmarkScript)');
		const state = await browser.evaluate('bookmarkReaderState()');
		t.diagnostic(JSON.stringify({ result, state }));
		assert.equal(
			state.bookQuoteVisible,
			false,
			'The rendered reader page has no visible target quote'
		);
		assert.equal(
			result.mode,
			'chapter-only',
			'Pre-render content is not a successful book highlight jump'
		);
	}
);

const paintSetup = String.raw`
  document.querySelector('.wr_reader_note_panel').remove();
  installBookmarkCanvasCapture();
  const canvas = document.querySelector('canvas');
  const ctx = canvas.getContext('2d');
  window.find = undefined;
  window.pageClicks = 0;
`;

test(
	'production canvas capture locates transformed painted text beyond the viewport without using bookmark offsets as indexes',
	{ skip: !chromeAvailable },
	async (t) => {
		const { browser, initial } = await reader(t, { find: false });
		await browser.evaluate(`(() => { ${paintSetup}
    canvas.width = 1200; canvas.height = 6000;
    canvas.style.width = '600px'; canvas.style.height = '3000px';
    ctx.scale(2, 2); ctx.font = '18px sans-serif';
    ctx.fillText(${JSON.stringify(initial.quote)}, 20, 2400);
  })()`);
		const result = await browser.evaluate('eval(bookmarkScript)');
		const actual = await browser.evaluate(`(() => {
    const canvas = document.querySelector('canvas');
    const rect = canvas.getBoundingClientRect();
    return {scrollY, paintedQuoteY: rect.top + 2400};
  })()`);
		t.diagnostic(JSON.stringify({ result, actual }));
		assert.equal(result.mode, 'canvas-scroll');
		assert(actual.scrollY > 0);
		assert(
			actual.paintedQuoteY >= 0 && actual.paintedQuoteY < 800,
			'The transformed painted quote enters the real viewport'
		);
	}
);

for (const repaint of [true, false]) {
	test(
		`canvas pagination ${repaint ? 'finds a newly painted quote' : 'stops after a no-op page button'}`,
		{ skip: !chromeAvailable },
		async (t) => {
			const { browser, initial } = await reader(t, { find: false });
			await browser.evaluate(`(() => { ${paintSetup}
      canvas.width = 600; canvas.height = 400;
      ctx.font = '18px sans-serif'; ctx.fillText('Unrelated opening page', 20, 100);
      const next = document.createElement('button'); next.className = 'renderTarget_pager_button_right';
      next.textContent = 'Next page'; document.querySelector('main').append(next);
      next.addEventListener('click', () => {
        window.pageClicks++;
        if (${repaint}) {
          ctx.clearRect(0, 0, canvas.width, canvas.height);
          ctx.fillText(${JSON.stringify(initial.quote)}, 20, 100);
        }
      });
    })()`);
			const result = await browser.evaluate('eval(bookmarkScript)');
			const actual = await browser.evaluate(
				`({pageClicks, scrollY, ink: document.querySelector('canvas').getContext('2d').getImageData(20, 80, 500, 30).data.some(value => value > 0)})`
			);
			t.diagnostic(JSON.stringify({ result, actual }));
			assert.equal(actual.pageClicks, 1, 'The pager is never blindly clicked eighty times');
			assert.equal(actual.scrollY, 0);
			assert.equal(actual.ink, true, 'The page has actual painted text');
			assert.equal(result.mode, repaint ? 'canvas-page' : 'chapter-only');
		}
	);
}

test(
	'a newer bookmark invocation cancels an older pending note navigation',
	{ skip: !chromeAvailable },
	async (t) => {
		const { browser } = await reader(t, { find: false });
		const results = await browser.evaluate(`(async () => {
    const first = eval(bookmarkScript);
    const second = eval(bookmarkScript);
    return Promise.all([first, second]);
  })()`);
		assert.equal(results[0].mode, 'cancelled');
		assert.equal(results[1].mode, 'chapter-only');
	}
);

for (const targetPage of [0, 2]) {
	test(
		`late canvas capture primes and restores the initial page before finding target page ${targetPage}`,
		{ skip: !chromeAvailable },
		async (t) => {
			const { browser, initial } = await reader(t, { find: false });
			const initialState = await browser.evaluate(`(() => {
      document.querySelector('.wr_reader_note_panel').remove();
      const canvas = document.querySelector('canvas'), ctx = canvas.getContext('2d');
      canvas.width = 600; canvas.height = 400;
      window.currentPage = 0; window.pageTurns = [];
      const quote = ${JSON.stringify(initial.quote)};
      const previous = document.createElement('button'); previous.className = 'renderTarget_pager_button'; previous.textContent = 'Previous page';
      const next = document.createElement('button'); next.className = 'renderTarget_pager_button renderTarget_pager_button_right'; next.textContent = 'Next page';
      document.querySelector('main').append(previous, next);
      const paint = () => {
        ctx.clearRect(0, 0, canvas.width, canvas.height); ctx.font = '18px sans-serif';
        ctx.fillText(window.currentPage === ${targetPage} ? quote : 'Other book page ' + window.currentPage, 20, 100);
        previous.disabled = window.currentPage === 0; next.disabled = window.currentPage === 2;
      };
      previous.addEventListener('click', () => { window.currentPage--; window.pageTurns.push(window.currentPage); paint(); });
      next.addEventListener('click', () => { window.currentPage++; window.pageTurns.push(window.currentPage); paint(); });
      paint();
      installBookmarkCanvasCapture();
      return {captured: window.__wereadBookmarkCanvasState.canvases.size};
    })()`);
			assert.equal(
				initialState.captured,
				0,
				'The hook was installed after the initial real paint'
			);
			const result = await browser.evaluate('eval(bookmarkScript)');
			const actual = await browser.evaluate('({currentPage, pageTurns, scrollY})');
			t.diagnostic(JSON.stringify({ result, actual }));
			assert.equal(actual.currentPage, targetPage);
			assert.deepEqual(
				actual.pageTurns.slice(0, 2),
				[1, 0],
				'Priming restores the original page before searching'
			);
			assert.equal(result.mode, targetPage ? 'canvas-page' : 'canvas-scroll');
			assert.equal(actual.scrollY, 0);
		}
	);
}

test(
	'late canvas capture requests a resize repaint before using any page controls',
	{ skip: !chromeAvailable },
	async (t) => {
		const { browser, initial } = await reader(t, { find: false });
		await browser.evaluate(`(() => {
    document.querySelector('.wr_reader_note_panel').remove();
    const canvas = document.querySelector('canvas'), ctx = canvas.getContext('2d');
    canvas.width = 600; canvas.height = 400;
    const paint = () => {ctx.clearRect(0,0,600,400);ctx.fillText(${JSON.stringify(initial.quote)},20,100);};
    paint(); installBookmarkCanvasCapture();
    window.resizePaints = 0;
    window.addEventListener('resize', () => {window.resizePaints++; paint();});
  })()`);
		const result = await browser.evaluate('eval(bookmarkScript)');
		const actual = await browser.evaluate('({resizePaints, scrollY})');
		t.diagnostic(JSON.stringify({ result, actual }));
		assert.equal(result.mode, 'canvas-scroll');
		assert.equal(actual.resizePaints, 1);
		assert.equal(actual.scrollY, 0);
	}
);

test(
	'a hidden populated notes panel is opened before native note navigation',
	{ skip: !chromeAvailable },
	async (t) => {
		const { browser } = await reader(t, { noteButton: true, find: false, nativeJump: 'page' });
		await browser.evaluate(`(() => {
    const panel = document.querySelector('.wr_reader_note_panel'); panel.style.display = 'none';
    window.noteButtonClicks = 0;
    document.querySelector('.readerControls_item.wr_note').addEventListener('click', () => {window.noteButtonClicks++; panel.style.display = 'block';});
  })()`);
		const result = await browser.evaluate('eval(bookmarkScript)');
		const actual = await browser.evaluate('({noteButtonClicks, ...bookmarkReaderState()})');
		assert.equal(
			actual.noteButtonClicks,
			1,
			'Hidden note DOM must not prevent opening the panel'
		);
		assert.equal(actual.bookQuoteVisible, true);
		assert.equal(result.mode, 'note-panel');
	}
);
