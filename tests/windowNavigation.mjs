// Separate-window reader lifecycle; all Electron sessions, windows and timers are synthetic.
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { transformSync } from 'esbuild';

const URL = 'https://weread.qq.com/web/reader/synthetic-chapter-5';
const BOOKMARK = { bookId: '42', chapterUid: 5, rangeStart: 1089, rangeEnd: 1163, markText: 'Synthetic full quote for chapter five' };
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const flush = async () => { for (let n = 0; n < 10; n++) await Promise.resolve(); };

function fixture(t) {
  const windows = [], timers = new Map(), notices = [], requests = [], hooks = [], cookieCalls = [];
  let timerId = 0;
  const previousWindow = globalThis.window;
  globalThis.window = {
    setTimeout(callback) { const id = ++timerId; timers.set(id, callback); return id; },
    clearTimeout(id) { timers.delete(id); }
  };
  class BrowserWindow extends EventEmitter {
    destroyed = false;
    guest = {};
    loadedUrl = '';
    constructor(options) {
      super(); this.options = options; windows.push(this);
      this.webContents = new EventEmitter();
      Object.assign(this.webContents, {
        isDestroyed: () => this.destroyed,
        getURL: () => this.loadedUrl,
        session: { cookies: {
          set: async cookie => { cookieCalls.push(cookie); },
          flush: async () => { cookieCalls.push('flush'); }
        } },
        executeJavaScript: code => {
          assert(!this.destroyed, 'Never execute guest code after window destruction');
          if (code.startsWith('BOOKMARK:')) {
            const response = deferred(); this.guest.__wereadBookmarkNavigationToken = 'active';
            requests.push({ bookmark: JSON.parse(code.slice(9)), response });
            return response.promise;
          }
          if (code.startsWith('window.')) new Function('window', code)(this.guest);
          else hooks.push({ code, url: this.loadedUrl });
          return Promise.resolve();
        }
      });
    }
    isDestroyed() { return this.destroyed; }
    setTitle() {}
    show() {}
    async loadURL(url) {
      this.loadedUrl = url;
      this.webContents.emit('dom-ready');
      this.webContents.emit('did-finish-load');
    }
    close() { this.emit('close'); this.destroyed = true; this.emit('closed'); }
  }
  const settingsStore = { value: { cookies: [{ name: 'synthetic', value: 'fixture-only' }] } };
  const obsidian = { Plugin: class {}, Notice: class { constructor(message) { notices.push(message); } } };
  const bookmarkModule = {
    buildBookmarkNavigationScript: value => 'BOOKMARK:' + JSON.stringify(value),
    getReaderUrlForBookmark: () => URL
  };
  const load = (filename, mocks) => {
    const module = { exports: {} };
    const code = transformSync(readFileSync(filename, 'utf8'), { loader: 'ts', format: 'cjs', target: 'es2020' }).code;
    new Function('require', 'module', 'exports', code)(name => {
      if (name in mocks) return mocks[name];
      if (filename.endsWith('main.ts') && (name.startsWith('./src/') || name.endsWith('.css'))) return {};
      throw new Error('Unexpected window dependency: ' + name);
    }, module, module.exports);
    return module.exports;
  };
  const common = { obsidian, 'svelte/store': { get: store => store.value } };
  const canvas = load(path.resolve('src/utils/webReaderCanvas.ts'), {});
  const Window = load(path.resolve('src/components/wereadBrowserWindow.ts'), {
    ...common, '../settings': { settingsStore }, '../utils/webReaderBookmark': bookmarkModule,
    '../utils/webReaderCanvas': canvas,
    electron: { remote: { BrowserWindow, getCurrentWindow: () => ({ syntheticParent: true }) } }
  }).default;
  const Plugin = load(path.resolve('main.ts'), {
    ...common, './src/settings': { settingsStore }, './src/utils/webReaderBookmark': bookmarkModule,
    './src/components/wereadBrowserWindow': Window,
    './src/components/wereadReading': { WEREAD_BROWSER_VIEW_ID: 'weread-reading-view' }
  }).default;
  const plugin = new Plugin();
  const leafStates = [];
  plugin.app = { workspace: {
    getLeavesOfType: () => [],
    getLeaf: () => ({ setViewState: async state => { leafStates.push(state); } }),
    revealLeaf() {}
  } };
  t.after(() => {
    for (const window of windows) if (!window.destroyed) window.close();
    globalThis.window = previousWindow;
  });
  const runTimers = async () => {
    await flush();
    for (let n = 0; timers.size && n < 20; n++) {
      const [id, callback] = timers.entries().next().value;
      timers.delete(id); callback(); await flush();
    }
  };
  return { Window, plugin, windows, timers, notices, requests, hooks, cookieCalls, leafStates, runTimers };
}

test('WINDOW entry preserves the bookmark and installs new-document hooks before navigating its exact quote', async t => {
  const f = fixture(t);
  await f.plugin.activateReadingView('WINDOW', URL, BOOKMARK);
  assert.equal(f.windows.length, 1);
  const window = f.windows[0];
  assert.equal(window.loadedUrl, URL);
  assert.equal(window.options.webPreferences.partition, 'persist:weread-plugin-browser');
  assert.equal(f.cookieCalls.at(-1), 'flush', 'Cookie session setup remains complete before loading');
  assert(f.hooks.some(hook => hook.url === URL && hook.code.includes('__wereadBookmarkCanvasHookInstalled')), 'Fresh document receives the shared Canvas paint hook');
  await f.runTimers();
  assert.equal(f.requests.length, 1);
  assert.deepEqual(f.requests[0].bookmark, BOOKMARK, 'Window receives the full chapter, range, and quote from plugin navigation');
  f.requests[0].response.resolve({ mode: 'canvas-page' }); await flush();
  assert.deepEqual(f.notices, [], 'Successful Canvas-page navigation has no inaccurate fallback notice');
  await f.plugin.activateReadingView('TAB', URL, BOOKMARK);
  assert.equal(f.windows.length, 1, 'TAB mode creates no separate window');
  assert.deepEqual(f.leafStates[0].state.bookmark, BOOKMARK);
});

test('closing a reader window cancels guest scans and queued attempts and suppresses late navigation results', async t => {
  const f = fixture(t), windowReader = new f.Window();
  await windowReader.open(URL, BOOKMARK);
  await f.runTimers();
  assert.equal(f.requests.length, 1);
  const window = f.windows[0];
  window.webContents.emit('did-finish-load'); await flush();
  assert(f.timers.size > 0, 'A load event has queued another attempt');
  assert.equal(window.guest.__wereadBookmarkNavigationToken, 'active');
  window.close();
  assert.equal(f.timers.size, 0, 'Closing clears queued bookmark attempts');
  assert.equal(window.guest.__wereadBookmarkNavigationToken, null, 'Closing cancels the running guest scan before destruction');
  f.requests[0].response.resolve({ mode: 'chapter-only' }); await flush();
  assert.deepEqual(f.notices, [], 'A destroyed reader never emits a late fallback notice');
  window.webContents.emit('dom-ready'); window.webContents.emit('did-finish-load');
  await f.runTimers();
  assert.equal(f.requests.length, 1, 'Late document events cannot execute another bookmark after close');
});
