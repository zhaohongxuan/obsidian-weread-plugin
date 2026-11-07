// Reader lifecycle only: production view with fake webview/timers; no Electron, network or vault.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { transformSync } from 'esbuild';

const READER_URL = 'https://weread.qq.com/web/reader/synthetic-book?k=synthetic-chapter-5';
const bookmark = (rangeStart, markText) => ({
  bookId: '42', chapterUid: 5, rangeStart, rangeEnd: rangeStart + 74, markText
});
const deferred = () => {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
};
const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };

function fixture(t) {
  const timers = new Map(), notices = [], requests = [], guestScripts = [];
  const guest = {};
  let nextTimer = 0;
  const previousWindow = globalThis.window;
  globalThis.window = {
    setTimeout(callback, delay) { const id = ++nextTimer; timers.set(id, { callback, delay }); return id; },
    clearTimeout(id) { timers.delete(id); }
  };

  class Webview {
    attributes = new Map();
    listeners = new Map();
    loadedUrl = '';
    setAttribute(key, value) { this.attributes.set(key, value); }
    getAttribute(key) { return this.attributes.get(key) ?? null; }
    getURL() { return this.loadedUrl; }
    addClass() {}
    addEventListener(name, callback) {
      if (!this.listeners.has(name)) this.listeners.set(name, []);
      this.listeners.get(name).push(callback);
    }
    removeEventListener(name, callback) {
      this.listeners.set(name, (this.listeners.get(name) || []).filter(fn => fn !== callback));
    }
    emit(name) { for (const callback of this.listeners.get(name) || []) callback(); }
    finish() { this.loadedUrl = this.getAttribute('src'); this.emit('did-finish-load'); }
    executeJavaScript(code) {
      guestScripts.push(code);
      if (code.startsWith('BOOKMARK:')) {
        const response = deferred();
        guest.__wereadBookmarkNavigationToken = 'active-script-' + requests.length;
        requests.push({ bookmark: JSON.parse(code.slice('BOOKMARK:'.length)).bookmark, response });
        return response.promise;
      }
      if (code.startsWith('window.')) new Function('window', code)(guest);
      return Promise.resolve({ mode: 'hook-installed' });
    }
  }
  const webview = new Webview();
  class ItemView {
    constructor(leaf) {
      this.leaf = leaf;
      this.app = { workspace: {} };
      this.contentEl = { doc: { createElement: () => webview }, appendChild() {}, addClass() {} };
    }
  }
  const obsidian = { ItemView, WorkspaceLeaf: class {}, Notice: class { constructor(message) { notices.push(message); } } };
  const cache = new Map();
  const load = filename => {
    if (cache.has(filename)) return cache.get(filename);
    const module = { exports: {} };
    cache.set(filename, module.exports);
    const code = transformSync(readFileSync(filename, 'utf8'), { loader: 'ts', format: 'cjs', target: 'es2020' }).code;
    new Function('require', 'module', 'exports', code)(name => {
      if (name === 'obsidian') return obsidian;
      if (name.endsWith('/webReaderBookmark')) return {
        buildBookmarkNavigationScript: (value, token) => 'BOOKMARK:' + JSON.stringify({ bookmark: value, token })
      };
      if (name.startsWith('.')) return load(path.resolve(path.dirname(filename), name + '.ts'));
      throw new Error('Unexpected reader dependency: ' + name);
    }, module, module.exports);
    cache.set(filename, module.exports);
    return module.exports;
  };
  const { WereadReadingView } = load(path.resolve('src/components/wereadReading.ts'));
  const view = new WereadReadingView({});
  t.after(async () => {
    try { await view.onClose(); }
    finally { globalThis.window = previousWindow; }
  });

  const runUntilRequests = async count => {
    await flush();
    for (let i = 0; i < 30 && requests.length < count; i++) {
      const timer = [...timers].sort((a, b) => a[1].delay - b[1].delay || a[0] - b[0])[0];
      if (!timer) break;
      timers.delete(timer[0]);
      timer[1].callback();
      await flush();
    }
    assert.equal(requests.length, count, 'Reader must execute the accepted bookmark without another load event');
  };
  const openAt = async first => {
    await view.onOpen();
    webview.finish(); // Shelf bootstrap.
    view.navigate(READER_URL, first);
    webview.finish(); // The chapter loads once; subsequent same-URL requests emit no load event.
    await runUntilRequests(1);
  };
  return { view, webview, timers, notices, requests, guestScripts, guest, runUntilRequests, openAt };
}

test('same loaded chapter schedules a second bookmark without another did-finish-load', async t => {
  const f = fixture(t), first = bookmark(100, 'First synthetic quote'), second = bookmark(1089, 'Second synthetic quote');
  await f.openAt(first);
  f.requests[0].response.resolve({ mode: 'canvas-page' });
  await flush();
  f.view.navigate(READER_URL, second);
  await f.runUntilRequests(2);
  assert.deepEqual(f.requests[1].bookmark, second, 'Same-chapter navigation carries the new note range and text');
  f.requests[1].response.resolve({ mode: 'canvas-scroll' });
  await flush();
  assert.equal(f.view.getState().bookmark, undefined);
  assert.deepEqual(f.notices, []);
});

test('stale async navigation cannot consume a newer bookmark or notify after replacement/close', async t => {
  const f = fixture(t), first = bookmark(100, 'Stale quote'), second = bookmark(1089, 'Current quote');
  await f.openAt(first);
  f.view.navigate(READER_URL, second);
  assert.equal(f.guest.__wereadBookmarkNavigationToken, null, 'Replacing a note cancels its previous guest page scan');
  f.requests[0].response.resolve({ mode: 'chapter-only' });
  await flush();
  assert.deepEqual(f.view.getState().bookmark, second, 'An old response cannot clear the new pending bookmark');
  assert.deepEqual(f.notices, [], 'An old fallback response cannot show a stale navigation notice');
  await f.runUntilRequests(2);
  assert.deepEqual(f.requests[1].bookmark, second);
  f.webview.emit('did-finish-load');
  await flush();
  assert(f.timers.size > 0, 'A later load event has queued another navigation attempt');
  assert.notEqual(f.guest.__wereadBookmarkNavigationToken, null, 'The current guest page scan is still active');
  await f.view.onClose();
  assert.equal(f.timers.size, 0, 'Close cancels queued bookmark navigation timers');
  assert.equal(f.guest.__wereadBookmarkNavigationToken, null, 'Close invalidates the active guest page scan');
  f.requests[1].response.resolve({ mode: 'chapter-only' });
  await flush();
  assert.deepEqual(f.notices, [], 'Closing suppresses late fallback notices from an in-flight guest script');
  assert.equal(f.requests.length, 2, 'Closing prevents the queued bookmark from executing');
});
