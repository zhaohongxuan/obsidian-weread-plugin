// Production routing/settings with synthetic hosts: no browser, Electron, auth or vault.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import test from 'node:test';
import { transformSync } from 'esbuild';
import * as stores from 'svelte/store';

const nodeRequire = createRequire(import.meta.url);
const bookId = 'book /中文?';
const bookmarkUrl = `weread://bestbookmark?bookId=${encodeURIComponent(bookId)}&chapterUid=12&rangeStart=34&rangeEnd=56`;
const readingUrl = `weread://reading?bId=${encodeURIComponent(bookId)}`;

function fixture(t, platform, preference = 'web', readingMode = 'WINDOW') {
  const Platform = { isMobile: false, isDesktopApp: true, ...platform };
  const windows = [], web = [], electron = [], notices = [], settings = [];
  const changes = [];
  const settingsStore = stores.writable({ bookOpenMode: preference, readingOpenMode: readingMode });
  settingsStore.actions = {
    setBookOpenMode(value) { changes.push(['book', value]); settingsStore.update(s => ({ ...s, bookOpenMode: value })); },
    setReadingOpenMode(value) { changes.push(['reading', value]); settingsStore.update(s => ({ ...s, readingOpenMode: value })); }
  };
  class DropdownCapture {
    options = {}; disabled = false;
    addOption(key, label) { this.options[key] = label; return this; }
    setValue(value) { this.value = value; return this; }
    setDisabled(value) { this.disabled = value; return this; }
    onChange(callback) { this.change = callback; return this; }
  }
  class Setting {
    constructor() { settings.push(this); }
    setName(value) { this.name = value; return this; }
    setDesc(value) { this.description = value; return this; }
    addDropdown(callback) { this.dropdown = new DropdownCapture(); callback(this.dropdown); return this; }
  }
  class Empty {}
  const obsidian = {
    Platform, Setting, Notice: class { constructor(message) { notices.push(message); } },
    App: Empty, PluginSettingTab: Empty, Modal: Empty, FuzzySuggestModal: Empty,
    ExtraButtonComponent: Empty, TextComponent: Empty, TFolder: Empty, TFile: Empty,
    setIcon() {}
  };
  const previousWindow = globalThis.window;
  globalThis.window = { open(url) { windows.push(url); } };
  t.after(() => { globalThis.window = previousWindow; });
  const cache = new Map();
  const explicitMocks = new Map([
    ['./components/wereadLoginModel', { default: Empty }],
    ['./components/wereadLogoutModel', { default: Empty }],
    ['./components/cookieCloudConfigModel', { default: Empty }],
    ['./components/themeManagerModal', { ThemeManagerModal: Empty }],
    ['./components/wereadReencounterBooksModal', { WereadReencounterBooksModal: Empty }],
    ['./api-router', { default: Empty }],
    ['./wereadPanel', { WereadPanel: Empty }],
    ['./wereadFavorites', { FavoritesUndoToast: Empty }],
    ['../bookDetailHelpers', {}],
    ['../journalHelpers', {}],
    ['../utils/localHighlightParser', {}],
    ['../utils/readingActionIcon', {}],
    ['../utils/noteTime', {}],
    ['./utils/bookIdUtils', {}],
    ['./utils/dateUtil', {}]
  ]);
  function load(filename) {
    filename = path.resolve(filename);
    if (cache.has(filename)) return cache.get(filename);
    const module = { exports: {} };
    const code = transformSync(readFileSync(filename, 'utf8'), { loader: 'ts', format: 'cjs', target: 'es2020' }).code;
    new Function('require', 'module', 'exports', code)(name => {
      if (name === 'obsidian') return obsidian;
      if (name === 'svelte/store') return stores;
      if (name === '../settings' || name === './settings') return { settingsStore };
      if (name === 'electron') { electron.push('require'); return { shell: { async openExternal(url) { electron.push(url); } } }; }
      if (name.endsWith('.css')) return {};
      if (explicitMocks.has(name)) return explicitMocks.get(name);
      if (name.startsWith('.')) return load(path.resolve(path.dirname(filename), name + '.ts'));
      if (['node-html-markdown', 'crypto-js'].includes(name)) return nodeRequire(name);
      throw new Error('Unexpected mobile fixture dependency: ' + name);
    }, module, module.exports);
    cache.set(filename, module.exports);
    return module.exports;
  }
  const routes = load('src/utils/openWereadUrl.ts');
  const plugin = { async openPreferredReadingView(...args) { web.push({ args, mode: stores.get(settingsStore).readingOpenMode }); } };
  const note = { bookId, text: 'Synthetic quotation', chapterTitle: 'Chapter', sourceUrl: bookmarkUrl };
  return { ...routes, load, plugin, note, Platform, windows, web, electron, notices, settings, settingsStore, changes };
}

const mobilePlatforms = [
  ['iOS phone', { isMobile: true, isDesktopApp: false, isIosApp: true, isTablet: false }],
  ['iPadOS tablet', { isMobile: true, isDesktopApp: false, isIosApp: true, isTablet: true }],
  ['Android', { isMobile: true, isDesktopApp: false, isAndroidApp: true }]
];
for (const [label, platform] of mobilePlatforms) {
  for (const preference of ['web', 'app']) for (const mode of ['TAB', 'WINDOW']) {
    test(`${label}: saved ${preference}/${mode} always opens exact App locations`, async t => {
      const f = fixture(t, platform, preference, mode);
      await f.openJournalNoteOriginal(f.plugin, f.note);
      await f.openWereadHighlightLocation(f.plugin, bookId, 12, '34-56');
      const invalidSources = [undefined, 'malformed', 'https://weread.qq.com/web/reader/example',
        bookmarkUrl.replace(encodeURIComponent(bookId), 'spoofed'),
        bookmarkUrl + '&bookId=spoofed', bookmarkUrl.replace('rangeStart=34', 'rangeStart=NaN'),
        bookmarkUrl.replace('rangeEnd=56', 'rangeEnd=1')];
      for (const sourceUrl of invalidSources) await f.openJournalNoteOriginal(f.plugin, { ...f.note, sourceUrl });
      assert.deepEqual(f.windows, [bookmarkUrl, bookmarkUrl, ...invalidSources.map(() => readingUrl)]);
      assert.deepEqual(f.web, []);
      assert.deepEqual(f.electron, []);
      assert.deepEqual(stores.get(f.settingsStore), { bookOpenMode: preference, readingOpenMode: mode });
    });
  }
}

for (const preference of ['web', 'app']) for (const mode of ['TAB', 'WINDOW']) {
  test(`desktop retains ${preference}/${mode} routing`, async t => {
    const f = fixture(t, {}, preference, mode);
    await f.openJournalNoteOriginal(f.plugin, f.note);
    await f.openJournalNoteOriginal(f.plugin, { ...f.note, sourceUrl: undefined });
    if (preference === 'app') {
      assert.deepEqual(f.electron, ['require', bookmarkUrl, 'require', readingUrl]);
      assert.deepEqual(f.web, []);
    } else {
      const { getPcUrl } = f.load('src/parser/parseResponse.ts');
      assert.deepEqual(f.web, [
        { args: [undefined, { bookId, chapterUid: 12, rangeStart: 34, rangeEnd: 56, chapterTitle: 'Chapter', markText: f.note.text }], mode },
        { args: [getPcUrl(bookId)], mode }
      ]);
      assert.deepEqual(f.electron, []);
    }
    assert.deepEqual(f.windows, []);
  });
}

test('each click reads the latest preference and mobile still overrides it', async t => {
  const f = fixture(t, {});
  await f.openJournalNoteOriginal(f.plugin, f.note);
  f.settingsStore.actions.setBookOpenMode('app');
  await f.openJournalNoteOriginal(f.plugin, f.note);
  f.settingsStore.actions.setBookOpenMode('web');
  await f.openWereadHighlightLocation(f.plugin, bookId, 12, '34-56');
  f.Platform.isMobile = true;
  f.Platform.isDesktopApp = false;
  await f.openJournalNoteOriginal(f.plugin, f.note);
  assert.equal(f.web.length, 2);
  assert.deepEqual(f.electron, ['require', bookmarkUrl]);
  assert.deepEqual(f.windows, [bookmarkUrl]);
});

for (const mobile of [true, false]) {
  test(`settings ${mobile ? 'mobile' : 'desktop'} values, descriptions and initialization preserve store`, t => {
    const f = fixture(t, { isMobile: mobile, isDesktopApp: !mobile });
    const { WereadSettingsTab } = f.load('src/settingTab.ts');
    const tab = Object.create(WereadSettingsTab.prototype);
    tab.containerEl = {};
    const before = structuredClone(stores.get(f.settingsStore));
    tab.bookOpenModeSetting();
    tab.readingOpenModeSetting();
    const [book, reading] = f.settings;
    assert.match(book.description, /桌面.*网页版.*App.*iOS\/iPadOS\/Android.*固定.*App.*deeplink/);
    assert.match(reading.description, /仅桌面网页版.*移动端固定.*App/);
    assert.equal(book.dropdown.value, mobile ? 'app' : 'web');
    assert.equal(reading.dropdown.value, 'WINDOW');
    assert.equal(book.dropdown.disabled, mobile);
    assert.equal(reading.dropdown.disabled, mobile);
    assert.deepEqual(stores.get(f.settingsStore), before);
    assert.deepEqual(f.changes, []);
    if (!mobile) {
      book.dropdown.change('app'); reading.dropdown.change('TAB');
      assert.deepEqual(stores.get(f.settingsStore), { bookOpenMode: 'app', readingOpenMode: 'TAB' });
      assert.deepEqual(f.changes, [['book', 'app'], ['reading', 'TAB']]);
    }
  });
  test(`detail openBook ${mobile ? 'mobile forces App' : 'desktop follows fresh preference'}`, async t => {
    const f = fixture(t, { isMobile: mobile, isDesktopApp: !mobile });
    const { WereadBookDetailPanel } = f.load('src/components/wereadBookDetailPanel.ts');
    const panel = Object.create(WereadBookDetailPanel.prototype);
    Object.assign(panel, { bookId, generation: 1, active: true, plugin: f.plugin });
    await panel.openBook();
    f.settingsStore.actions.setBookOpenMode('app');
    await panel.openBook();
    assert.deepEqual(f.windows, mobile ? [readingUrl, readingUrl] : [readingUrl]);
    assert.equal(f.web.length, mobile ? 0 : 1);
    assert.deepEqual(f.electron, []);
  });
}
