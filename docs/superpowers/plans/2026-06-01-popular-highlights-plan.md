# 热门划线同步功能实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现热门划线同步功能，支持按章节并发查询、本地文件缓存（默认7天）、以及分离式模板展示

**Architecture:** 缓存层（popularHighlightsCache.ts）负责热门划线的读写，syncNotebooks.ts 集成缓存和并发查询逻辑，模板层支持合并/分离两种展示模式

**Tech Stack:** TypeScript, Obsidian API, Nunjucks templates

---

## 文件结构

```
src/
├── popularHighlightsCache.ts   # 新增：热门划线缓存管理类
├── models.ts                  # 修改：PopularHighlightCache 类型
├── settings.ts                # 修改：新增缓存 TTL 设置项
├── api-router.ts              # 修改：添加按章节查询方法
├── syncNotebooks.ts           # 修改：集成缓存和并发查询
├── renderer.ts                # 修改：扩展 RenderTemplate
├── settingTab.ts              # 修改：添加缓存 TTL 配置项
└── themes/
    └── separatedWithPopularTemplate.njk  # 新增：分离式含热门划线模板
```

---

## Task 1: 创建缓存管理类

**Files:**
- Create: `src/popularHighlightsCache.ts`
- Modify: `src/models.ts` (添加类型)

- [ ] **Step 1: 在 models.ts 中添加 PopularHighlightCache 类型**

在 `models.ts` 文件末尾添加：

```typescript
export type PopularHighlightCache = {
  bookId: string;
  cachedAt: number;
  ttl: number;
  items: PopularHighlight[];
  chapters: {
    bookId: string;
    chapterUid: number;
    chapterIdx: number;
    title: string;
  }[];
};
```

- [ ] **Step 2: 创建 popularHighlightsCache.ts**

```typescript
import { Notice } from 'obsidian';
import { settingsStore } from './settings';
import { get } from 'svelte/store';
import type { PopularHighlight, PopularHighlightCache } from './models';

export default class PopularHighlightsCacheManager {
  private cacheDir: string = '.weread-cache';

  /**
   * 获取缓存目录的完整路径
   */
  private getCachePath(bookId: string): string {
    return `${this.cacheDir}/popular-${bookId}.json`;
  }

  /**
   * 检查缓存是否过期
   */
  private isCacheExpired(cache: PopularHighlightCache): boolean {
    const settings = get(settingsStore);
    const ttlMs = (settings.popularHighlightsCacheTtl ?? 7) * 24 * 60 * 60 * 1000;
    return Date.now() > cache.cachedAt + ttlMs;
  }

  /**
   * 读取缓存
   */
  async get(bookId: string): Promise<PopularHighlightCache | null> {
    try {
      const cachePath = this.getCachePath(bookId);
      // 检查文件是否存在（通过异步读取）
      const exists = await this.fileExists(cachePath);
      if (!exists) return null;

      // 读取并解析 JSON
      const content = await this.readFile(cachePath);
      const cache: PopularHighlightCache = JSON.parse(content);

      // 检查缓存是否过期
      if (this.isCacheExpired(cache)) {
        console.log(`[weread plugin] 热门划线缓存已过期: ${bookId}`);
        return null;
      }

      console.log(`[weread plugin] 热门划线缓存命中: ${bookId}`);
      return cache;
    } catch (e) {
      console.error(`[weread plugin] 读取热门划线缓存失败: ${bookId}`, e);
      return null;
    }
  }

  /**
   * 写入缓存
   */
  async set(bookId: string, items: PopularHighlight[], chapters: PopularHighlightCache['chapters']): Promise<void> {
    try {
      const settings = get(settingsStore);
      const cache: PopularHighlightCache = {
        bookId,
        cachedAt: Date.now(),
        ttl: settings.popularHighlightsCacheTtl ?? 7,
        items,
        chapters
      };

      const cachePath = this.getCachePath(bookId);
      await this.ensureCacheDir();
      await this.writeFile(cachePath, JSON.stringify(cache, null, 2));
      console.log(`[weread plugin] 热门划线缓存已写入: ${bookId}`);
    } catch (e) {
      console.error(`[weread plugin] 写入热门划线缓存失败: ${bookId}`, e);
    }
  }

  /**
   * 清除单本书的缓存
   */
  async clear(bookId: string): Promise<void> {
    try {
      const cachePath = this.getCachePath(bookId);
      const exists = await this.fileExists(cachePath);
      if (exists) {
        await this.deleteFile(cachePath);
        console.log(`[weread plugin] 热门划线缓存已清除: ${bookId}`);
      }
    } catch (e) {
      console.error(`[weread plugin] 清除热门划线缓存失败: ${bookId}`, e);
    }
  }

  /**
   * 清除所有过期缓存
   */
  async clearExpired(): Promise<number> {
    try {
      const cacheDirPath = this.cacheDir;
      const exists = await this.fileExists(cacheDirPath);
      if (!exists) return 0;

      const files = await this.listFiles(cacheDirPath);
      let cleared = 0;

      for (const file of files) {
        if (!file.startsWith('popular-') || !file.endsWith('.json')) continue;

        try {
          const content = await this.readFile(`${cacheDirPath}/${file}`);
          const cache: PopularHighlightCache = JSON.parse(content);
          if (this.isCacheExpired(cache)) {
            await this.deleteFile(`${cacheDirPath}/${file}`);
            cleared++;
          }
        } catch (e) {
          // 忽略解析失败的文件
        }
      }

      if (cleared > 0) {
        console.log(`[weread plugin] 已清除 ${cleared} 个过期热门划线缓存`);
      }
      return cleared;
    } catch (e) {
      console.error('[weread plugin] 清除过期缓存失败', e);
      return 0;
    }
  }

  /**
   * 确保缓存目录存在
   */
  private async ensureCacheDir(): Promise<void> {
    try {
      const exists = await this.fileExists(this.cacheDir);
      if (!exists) {
        await this.createDir(this.cacheDir);
      }
    } catch (e) {
      // 目录已存在或其他错误，忽略
    }
  }

  // 抽象文件系统操作（由 Obsidian 实现）
  private async fileExists(path: string): Promise<boolean> {
    // @ts-ignore - Vault is available in Obsidian context
    return app.vault.getAbstractFileByPath(path) !== null;
  }

  private async readFile(path: string): Promise<string> {
    // @ts-ignore
    const file = app.vault.getAbstractFileByPath(path);
    if (!file) throw new Error('File not found');
    // @ts-ignore
    return await app.vault.read(file);
  }

  private async writeFile(path: string, content: string): Promise<void> {
    // @ts-ignore
    const file = app.vault.getAbstractFileByPath(path);
    if (file) {
      // @ts-ignore
      await app.vault.modify(file, content);
    } else {
      // @ts-ignore
      await app.vault.create(path, content);
    }
  }

  private async deleteFile(path: string): Promise<void> {
    // @ts-ignore
    const file = app.vault.getAbstractFileByPath(path);
    if (file) {
      // @ts-ignore
      await app.vault.delete(file);
    }
  }

  private async createDir(path: string): Promise<void> {
    // @ts-ignore
    await app.vault.createFolder(path);
  }

  private async listFiles(dirPath: string): Promise<string[]> {
    // @ts-ignore
    const folder = app.vault.getAbstractFileByPath(dirPath);
    if (!folder || folder.constructor.name !== 'TFolder') return [];
    // @ts-ignore
    return folder.children.filter(f => f.constructor.name === 'TFile').map(f => f.name);
  }
}
```

- [ ] **Step 3: 提交代码**

```bash
git add src/models.ts src/popularHighlightsCache.ts
git commit -m "feat: 添加热门划线缓存管理类

- 新增 PopularHighlightsCacheManager 类
- 支持缓存读写、过期检查、批量清理
- 缓存存储在 .weread-cache/ 目录

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 2: 添加缓存 TTL 设置项

**Files:**
- Modify: `src/settings.ts:109-165` (DEFAULT_SETTINGS), `src/settings.ts:742-747` (actions)

- [ ] **Step 1: 在 DEFAULT_SETTINGS 中添加 popularHighlightsCacheTtl**

在 `settings.ts` 的 `DEFAULT_SETTINGS` 对象中，找到 `syncPopularHighlightsToggle: false,` 这一行，在其后添加：

```typescript
popularHighlightsCacheTtl: 7,
```

完整添加位置（约在第 139 行）：
```typescript
saveReadingInfoToggle: true,
syncPopularHighlightsToggle: false,
popularHighlightsCacheTtl: 7,
readingOpenMode: 'TAB',
```

- [ ] **Step 2: 添加 setPopularHighlightsCacheTtl action**

在 `settings.ts` 中找到 `setStatsStartYear` 的定义（约在第 742 行），在其后添加：

```typescript
const setPopularHighlightsCacheTtl = (value: number) => {
  store.update((state) => {
    state.popularHighlightsCacheTtl = Math.max(1, value);
    return state;
  });
};
```

- [ ] **Step 3: 在 actions 对象中注册新方法**

找到 `return { ... }` 中的 `actions` 对象（约在第 756 行），添加：

```typescript
setPopularHighlightsCacheTtl,
```

位置示例：
```typescript
setStatsStartYear,
setReadingStatsLocation,
setUserSignature,
setPopularHighlightsCacheTtl,  // 新增
```

- [ ] **Step 4: 提交代码**

```bash
git add src/settings.ts
git commit -m "feat: 添加热门划线缓存 TTL 设置项

- 新增 popularHighlightsCacheTtl 配置项（默认7天）
- 新增 setPopularHighlightsCacheTtl action

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 3: 添加按章节查询热门划线方法

**Files:**
- Modify: `src/api-router.ts:134-143` (添加重载方法)
- Modify: `src/api-v2.ts:88-102` (实现按章节查询)

- [ ] **Step 1: 在 api-v2.ts 中检查 getBestBookmarks 是否支持 chapterUid 参数**

查看 `src/api-v2.ts` 第 88-102 行的 `getBestBookmarks` 方法：

```typescript
async getBestBookmarks(bookId: string, chapterUid = 0) {
  return this.callAgent<{
    synckey: number;
    totalCount: number;
    items: {
      bookId: string;
      bookmarkId: string;
      chapterUid: number;
      range: string;
      markText: string;
      totalCount: number;
    }[];
    chapters: { bookId: string; chapterUid: number; chapterIdx: number; title: string }[];
  }>('/book/bestbookmarks', { bookId, chapterUid });
}
```

该方法已支持 `chapterUid` 参数，参数名为 0 表示获取全量。

- [ ] **Step 2: 在 api-router.ts 中添加并发批量获取方法**

在 `src/api-router.ts` 的 `ApiRouter` 类中，找到 `getBestBookmarks` 方法（约在第 134 行），在其后添加新方法：

```typescript
/**
 * 批量获取热门划线（按章节）
 * @param bookId 书籍 ID
 * @param chapterUids 章节 UID 数组
 * @param batchSize 每批数量，默认 5
 */
async getBestBookmarksBatch(
  bookId: string,
  chapterUids: number[],
  batchSize = 5
): Promise<Map<number, { bookmarkId: string; range: string; markText: string; totalCount: number }[]>> {
  const results = new Map<number, { bookmarkId: string; range: string; markText: string; totalCount: number }[]>();

  for (let i = 0; i < chapterUids.length; i += batchSize) {
    const batch = chapterUids.slice(i, i + batchSize);
    const promises = batch.map(async (chapterUid) => {
      const resp = await this.getBestBookmarks(bookId, chapterUid);
      return { chapterUid, items: resp?.items ?? [] };
    });

    const settled = await Promise.allSettled(promises);
    for (const result of settled) {
      if (result.status === 'fulfilled') {
        results.set(result.value.chapterUid, result.value.items);
      } else {
        console.warn(`[weread plugin] 获取章节热门划线失败: chapterUid=${result.reason}`);
      }
    }
  }

  return results;
}
```

- [ ] **Step 3: 提交代码**

```bash
git add src/api-router.ts src/api-v2.ts
git commit -m "feat: 添加按章节批量查询热门划线方法

- ApiRouter 新增 getBestBookmarksBatch 方法
- 支持按批次并发查询，每批 5 个章节

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 4: 创建分离式含热门划线模板

**Files:**
- Create: `src/themes/separatedWithPopularTemplate.njk`

- [ ] **Step 1: 创建模板文件**

```njk
---
isbn: {{ metaData.isbn }}
lastReadDate: {{ metaData.lastReadDate }}
---
# {{ metaData.title }}
> 作者：{{ metaData.author }}
> {% if metaData.intro %}{{ metaData.intro | truncate(100) }}{% endif %}

{% set hasUserHighlights = false %}
{% for chapter in chapterHighlights %}
  {% if chapter.highlights and chapter.highlights.length > 0 %}
    {% set hasUserHighlights = true %}
    {% break %}
  {% endif %}
{% endfor %}

# 我的划线
{% if hasUserHighlights %}
{% for chapter in chapterHighlights %}
{% if chapter.highlights and chapter.highlights.length > 0 %}
## {{ chapter.chapterTitle }}
{% for highlight in chapter.highlights %}
{% set rangeParts = highlight.range | split("-") %}
{% set deeplink = "weread://bestbookmark?bookId=" + metaData.bookId + "&chapterUid=" + highlight.chapterUid + "&rangeStart=" + rangeParts[0] + "&rangeEnd=" + rangeParts[1] %}
> 📌 [{{ highlight.markText | trim }}](<{{ deeplink }}>) ^{{ highlight.bookmarkId }}
{% if highlight.isPopular %}
> 🔥 {{ highlight.popularCount }} 人共读
{% endif %}
{% endfor %}
{% endif %}
{% endfor %}
{% else %}
> 暂无划线
{% endif %}

{% set hasPopularHighlights = false %}
{% if popularHighlights and popularHighlights.length > 0 %}
{% for chapter in popularHighlights %}
  {% if chapter.highlights and chapter.highlights.length > 0 %}
    {% set hasPopularHighlights = true %}
    {% break %}
  {% endif %}
{% endfor %}
{% endif %}

# 热门划线
{% if hasPopularHighlights %}
{% for chapter in popularHighlights %}
{% if chapter.highlights and chapter.highlights.length > 0 %}
## {{ chapter.chapterTitle }}
{% for highlight in chapter.highlights %}
{% set rangeParts = highlight.range | split("-") %}
{% set deeplink = "weread://bestbookmark?bookId=" + metaData.bookId + "&chapterUid=" + highlight.chapterUid + "&rangeStart=" + rangeParts[0] + "&rangeEnd=" + rangeParts[1] %}
> 🔥 [{{ highlight.markText | trim }}](<{{ deeplink }}>) ^{{ highlight.bookmarkId }}
{% if highlight.totalCount %}
> 📊 {{ highlight.totalCount }} 人共读
{% endif %}
{% endfor %}
{% endif %}
{% endfor %}
{% else %}
> 暂无热门划线
{% endif %}

# 我的笔记
{% set hasNotes = false %}
{% for chapter in chapterHighlights %}
  {% if chapter.highlights %}
    {% for highlight in chapter.highlights %}
      {% if highlight.reviewContent %}
        {% set hasNotes = true %}
        {% break %}
      {% endif %}
    {% endfor %}
  {% endif %}
  {% if hasNotes %}{% break %}{% endif %}
{% endfor %}

{% if hasNotes %}
{% for chapter in chapterHighlights %}
{% if chapter.highlights %}
{% for highlight in chapter.highlights %}
{% if highlight.reviewContent %}
## {{ chapter.chapterTitle }} 的想法
{{ highlight.reviewContent }}
> 📌 {{ highlight.markText | trim }}

{% endif %}
{% endfor %}
{% endif %}
{% endfor %}
{% else %}
> 暂无笔记
{% endif %}

{% if bookReview.bookReviews and bookReview.bookReviews.length > 0 %}
# 书评
{% for bookReview in bookReview.bookReviews %}
## 书评 {{ loop.index }}
{{ bookReview.createTime }}
{{ bookReview.mdContent }}
^{{ bookReview.reviewId }}
{% endfor %}
{% endif %}
```

- [ ] **Step 2: 在 settings.ts 中注册新模板为内置主题**

在 `settings.ts` 中找到 `BUILT_IN_THEMES` 数组（约在第 20-51 行），在 `builtin_official` 后添加：

```typescript
{
  id: 'builtin_separated_with_popular',
  name: '分离式（含热门划线）',
  description: '我的划线、热门划线、笔记分开展示，适合分析学习',
  template: separatedWithPopularTemplate,
  trimBlocks: true,
  isBuiltIn: true,
  isReadOnly: true,
  source: 'builtin'
},
```

然后在文件顶部添加 import：

```typescript
import separatedWithPopularTemplate from './themes/separatedWithPopularTemplate.njk';
```

- [ ] **Step 3: 提交代码**

```bash
git add src/themes/separatedWithPopularTemplate.njk src/settings.ts
git commit -m "feat: 新增分离式（含热门划线）模板

- 模板结构：我的划线 → 热门划线 → 我的笔记 → 书评
- 热门划线标记 🔥 和共读人数
- 注册为内置主题 builtin_separated_with_popular

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 5: 扩展 RenderTemplate 和 Notebook 类型

**Files:**
- Modify: `src/models.ts` (Notebook, RenderTemplate)

- [ ] **Step 1: 修改 Notebook 类型**

找到 `models.ts` 中的 `Notebook` 类型定义（约在第 339 行），修改为：

```typescript
export type Notebook = {
  metaData: Metadata;
  chapterHighlights: ChapterHighlightReview[];
  bookReview: BookReview;
  popularHighlights?: PopularChapterHighlight[];  // 用于分离模式
};
```

注意：当前 `Notebook` 已包含 `popularHighlights`，不需要修改。

- [ ] **Step 2: 修改 ChapterHighlightReview 类型，添加 popularHighlights**

找到 `ChapterHighlightReview` 类型定义（约在第 437 行），修改为：

```typescript
export type ChapterHighlightReview = {
  chapterUid?: number;
  chapterIdx?: number;
  chapterTitle: string;
  level: number;
  isMPChapter: number;
  highlights?: Highlight[];
  chapterReviews?: Review[];
  popularHighlights?: PopularHighlight[];  // 新增：该章节的热门划线（用于分离模式）
};
```

- [ ] **Step 3: 修改 Highlight 类型，添加 isUserHighlight**

找到 `Highlight` 类型定义（约在第 389 行），添加字段：

```typescript
export type Highlight = {
  bookmarkId: string;
  created: number;
  createTime: string;
  chapterUid: number;
  chapterIdx: number;
  chapterTitle: string;
  markText: string;
  style: number;
  colorStyle: number;
  reviewContent?: string;
  range: string;
  refMpReviewId?: string;
  isPopular?: boolean;
  popularCount?: number;
  isUserHighlight?: boolean;  // 新增：标记是否为用户自己的划线
};
```

- [ ] **Step 4: 修改 RenderTemplate 类型**

找到 `RenderTemplate` 类型定义（约在第 449 行），修改为：

```typescript
export type RenderTemplate = {
  metaData: Metadata;
  chapterHighlights: ChapterHighlightReview[];
  bookReview: BookReview;
  popularHighlights?: PopularChapterHighlight[];  // 用于分离模式
  // userHighlights 和 popularHighlights 是相同的 chapterHighlights + popularHighlights
  // 模板通过判断 isUserHighlight 来区分
};
```

- [ ] **Step 5: 提交代码**

```bash
git add src/models.ts
git commit -m "feat: 扩展模型类型以支持热门划线分离展示

- ChapterHighlightReview 添加 popularHighlights 字段
- Highlight 添加 isUserHighlight 字段
- RenderTemplate 添加 popularHighlights 字段

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 6: 集成缓存和并发查询到 syncNotebooks.ts

**Files:**
- Modify: `src/syncNotebooks.ts:174-270` (convertToNotebook)

- [ ] **Step 1: 添加缓存管理器实例**

在 `SyncNotebooks` 类顶部添加：

```typescript
import PopularHighlightsCacheManager from './popularHighlightsCache';

export default class SyncNotebooks {
  private fileManager: FileManager;
  private apiManager: ApiRouter;
  private cacheManager: PopularHighlightsCacheManager;

  constructor(fileManager: FileManager, apiManager: ApiRouter) {
    this.fileManager = fileManager;
    this.apiManager = apiManager;
    this.cacheManager = new PopularHighlightsCacheManager();
  }
```

- [ ] **Step 2: 添加获取热门划线的方法**

在 `SyncNotebooks` 类中添加新方法（放在 `convertToNotebook` 方法之前）：

```typescript
/**
 * 获取热门划线（支持缓存）
 */
private async getPopularHighlights(
  bookId: string,
  chapters: { chapterUid: number; chapterIdx: number; title: string }[]
): Promise<PopularChapterHighlight[]> {
  // 1. 尝试从缓存获取
  const cached = await this.cacheManager.get(bookId);
  if (cached) {
    return this.groupPopularByChapter(cached.items, cached.chapters);
  }

  // 2. 缓存未命中，并发获取热门划线
  const chapterUids = chapters.map((c) => c.chapterUid);
  const popularByChapter = await this.apiManager.getBestBookmarksBatch(bookId, chapterUids, 5);

  // 3. 转换为数组格式
  const items: { bookmarkId: string; chapterUid: number; chapterTitle: string; range: string; markText: string; totalCount: number }[] = [];
  const chapterMap = new Map(chapters.map((c) => [c.chapterUid, c]));
  
  for (const [chapterUid, highlights] of popularByChapter) {
    const chapterInfo = chapterMap.get(chapterUid);
    for (const h of highlights) {
      items.push({
        bookmarkId: h.bookmarkId,
        chapterUid,
        chapterTitle: chapterInfo?.title ?? '',
        range: h.range,
        markText: h.markText,
        totalCount: h.totalCount
      });
    }
  }

  // 4. 写入缓存
  await this.cacheManager.set(bookId, items, chapters);

  // 5. 按章节分组返回
  return this.groupPopularByChapter(items, chapters);
}

/**
 * 按章节分组热门划线
 */
private groupPopularByChapter(
  items: { chapterUid: number; chapterTitle: string; range: string; markText: string; totalCount: number; bookmarkId: string }[],
  chapters: { chapterUid: number; chapterIdx: number; title: string }[]
): PopularChapterHighlight[] {
  const chapterMap = new Map(chapters.map((c) => [c.chapterUid, c]));
  const grouped = new Map<number, { chapterUid: number; chapterIdx: number; chapterTitle: string; highlights: PopularHighlight[] }>();

  for (const item of items) {
    if (!grouped.has(item.chapterUid)) {
      const chapterInfo = chapterMap.get(item.chapterUid);
      grouped.set(item.chapterUid, {
        chapterUid: item.chapterUid,
        chapterIdx: chapterInfo?.chapterIdx ?? 0,
        chapterTitle: chapterInfo?.title ?? item.chapterTitle,
        highlights: []
      });
    }
    grouped.get(item.chapterUid).highlights.push({
      bookmarkId: item.bookmarkId,
      chapterUid: item.chapterUid,
      chapterTitle: item.chapterTitle,
      range: item.range,
      markText: item.markText,
      totalCount: item.totalCount
    });
  }

  return Array.from(grouped.values());
}
```

- [ ] **Step 3: 修改 convertToNotebook 方法**

找到 `convertToNotebook` 方法中处理热门划线的部分（约在第 210-264 行），替换为：

```typescript
const bookReview = parseChapterReviews(reviewResp);

let popularHighlights: PopularChapterHighlight[] = [];

if (get(settingsStore).syncPopularHighlightsToggle) {
  // 获取章节信息用于缓存
  const chaptersInfo = chapters.map((c) => ({
    chapterUid: c.chapterUid ?? 0,
    chapterIdx: c.chapterIdx ?? 0,
    title: c.title
  }));

  // 获取热门划线（缓存优先）
  popularHighlights = await this.getPopularHighlights(metaData.bookId, chaptersInfo);

  // 获取当前激活主题
  const activeTheme = get(settingsStore).themes?.find(
    (t) => t.id === get(settingsStore).activeThemeId
  );

  // 判断是否为分离式主题（包含 popular 的分离主题）
  const isSeparatedWithPopularTheme = activeTheme?.id === 'builtin_separated_with_popular';

  if (isSeparatedWithPopularTheme) {
    // 分离模式：热门划线单独处理，不合并到 chapterHighlights
    // 标记用户划线中的热门（用于展示区分）
    for (const chapter of chapterHighlightReview) {
      if (chapter.highlights) {
        for (const h of chapter.highlights) {
          // 查找对应的热门划线
          const popularChapter = popularHighlights.find((p) => p.chapterUid === chapter.chapterUid);
          if (popularChapter) {
            const match = popularChapter.highlights.find((p) => p.range === h.range);
            if (match) {
              h.isPopular = true;
              h.popularCount = match.totalCount;
            }
          }
        }
      }
    }
  } else {
    // 合并模式：热门划线合并到章节划线中
    const popularByChapter = new Map<number, typeof popularHighlights[0]['highlights'][0][]>();
    for (const chapter of popularHighlights) {
      popularByChapter.set(chapter.chapterUid, chapter.highlights);
    }

    for (const chapter of chapterHighlightReview) {
      const chapterPopular = popularByChapter.get(chapter.chapterUid ?? 0) ?? [];
      if (chapterPopular.length === 0) continue;

      const existingHighlights = chapter.highlights ?? [];
      const userRangeSet = new Set(existingHighlights.map((h) => h.range));

      // 已有划线与热门重叠：标记为热门并加人数
      for (const h of existingHighlights) {
        const match = chapterPopular.find((p) => p.range === h.range);
        if (match) {
          h.isPopular = true;
          h.popularCount = match.totalCount;
        }
      }

      // 热门划线中用户未标注的：追加为新 Highlight
      for (const p of chapterPopular) {
        if (!userRangeSet.has(p.range)) {
          existingHighlights.push({
            bookmarkId: p.bookmarkId,
            created: 0,
            createTime: '',
            chapterUid: chapter.chapterUid ?? 0,
            chapterIdx: chapter.chapterIdx ?? 0,
            chapterTitle: chapter.chapterTitle,
            markText: p.markText,
            style: 0,
            colorStyle: 0,
            range: p.range,
            isPopular: true,
            popularCount: p.totalCount,
            isUserHighlight: false
          });
        }
      }

      // 标记所有用户划线
      for (const h of existingHighlights) {
        if (!h.isUserHighlight) {
          h.isUserHighlight = true;
        }
      }

      // 按 range 起始位置重新排序
      chapter.highlights = existingHighlights.sort((a, b) => {
        return (parseInt(a.range.split('-')[0]) || 0) - (parseInt(b.range.split('-')[0]) || 0);
      });
    }
  }
}

return {
  metaData: metaData,
  chapterHighlights: chapterHighlightReview,
  bookReview: bookReview,
  popularHighlights: popularHighlights
};
```

- [ ] **Step 4: 提交代码**

```bash
git add src/syncNotebooks.ts
git commit -m "feat: 集成缓存和并发查询到热门划线同步

- 添加 PopularHighlightsCacheManager 实例
- 新增 getPopularHighlights 方法（支持缓存）
- 新增 groupPopularByChapter 方法
- convertToNotebook 支持分离/合并两种模式

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 7: 更新设置页面

**Files:**
- Modify: `src/settingTab.ts` (添加缓存 TTL 配置项)

- [ ] **Step 1: 找到热门划线设置项的位置**

读取 `src/settingTab.ts`，找到 `syncPopularHighlightsToggle` 相关的设置项。

- [ ] **Step 2: 在热门划线开关后添加缓存 TTL 配置**

找到设置项的 container 或 section，在 `new Toggle(...)` 后添加：

```typescript
// 缓存 TTL 设置
const cacheTtlContainer = container.createDiv('setting-item');
cacheTtlContainer.createEl('text', { text: '热门划线缓存有效期（天）', cls: 'setting-item-name' });
const cacheTtlInput = cacheTtlContainer.createEl('input', {
  cls: 'setting-input',
  attr: { type: 'number', min: '1', max: '365' }
});
cacheTtlInput.value = String(get(settingsStore).popularHighlightsCacheTtl ?? 7);
cacheTtlInput.onChange = (value: string) => {
  const num = parseInt(value) || 7;
  settingsStore.actions.setPopularHighlightsCacheTtl(num);
};
```

注意：具体实现需根据 settingTab.ts 的现有结构调整。

- [ ] **Step 3: 提交代码**

```bash
git add src/settingTab.ts
git commit -m "feat: 添加热门划线缓存 TTL 配置项

- 在设置页面热门划线开关后添加缓存有效期配置
- 支持 1-365 天范围

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 8: 验证和测试

- [ ] **Step 1: 运行构建检查**

```bash
npm run build
```

确保没有 TypeScript 编译错误。

- [ ] **Step 2: 运行 lint 检查**

```bash
npm run lint
```

确保没有 lint 错误。

- [ ] **Step 3: 手动测试场景**

1. 启用热门划线同步开关
2. 选择"分离式（含热门划线）"模板
3. 同步一本书
4. 检查生成的笔记：
   - 我的划线部分显示用户的划线
   - 热门划线部分显示热门划线（带 🔥 标记）
   - 两者按章节分组正确

5. 切换到"合并式"模板
6. 再次同步同一本书
7. 检查：
   - 用户划线和热门划线合并展示
   - 热门划线标记 🔥 和人数

8. 检查缓存文件：
   - 确认 `.weread-cache/popular-{bookId}.json` 存在

- [ ] **Step 4: 提交测试代码变更**

```bash
git add -A
git commit -m "test: 热门划线同步功能测试

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## 依赖关系

```
Task 1 (缓存类) → Task 2 (设置项) → Task 3 (API) → Task 4 (模板) → Task 5 (模型) → Task 6 (集成) → Task 7 (UI) → Task 8 (测试)
```

---

## 总结

| Task | 描述 | 变更类型 |
|------|------|----------|
| 1 | 缓存管理类 | 新增 |
| 2 | 缓存 TTL 设置项 | 修改 |
| 3 | 按章节批量查询 API | 修改 |
| 4 | 分离式模板 | 新增 |
| 5 | 模型类型扩展 | 修改 |
| 6 | 集成缓存和并发查询 | 修改 |
| 7 | 设置页面 | 修改 |
| 8 | 验证测试 | - |