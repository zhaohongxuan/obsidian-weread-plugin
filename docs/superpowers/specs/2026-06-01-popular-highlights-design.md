# 热门划线同步功能设计

**创建时间**: 2026-06-01
**状态**: 已确认

---

## 1. 概述

实现热门划线同步功能，支持按章节并发查询、本地文件缓存、以及分离式模板展示。

---

## 2. 功能需求

| 需求 | 说明 |
|------|------|
| 开关控制 | 根据 `syncPopularHighlightsToggle` 设置判断是否同步热门划线 |
| 缓存机制 | 本地文件缓存（`.weread-cache/`），默认有效期 7 天 |
| 并发查询 | 每批 5 个章节并发请求，失败重试 1 次 |
| 合并模式 | 热门划线合并入章节划线，按位置排序，重复时去重 |
| 分离模式 | 热门划线独立展示，不合并到用户划线中 |

---

## 3. 架构设计

### 3.1 组件结构

```
src/
├── popularHighlightsCache.ts   # 新增：热门划线缓存管理
├── api-router.ts               # 修改：添加热门划线按章节查询
└── syncNotebooks.ts            # 修改：集成缓存和并发查询

.weread-cache/                  # 新增：缓存目录
├── popular-{bookId}.json       # 单本书热门划线缓存
└── cache-manifest.json          # 缓存索引（可选）
```

### 3.2 缓存数据结构

**文件**: `src/popularHighlightsCache.ts`

```typescript
export interface PopularHighlightCache {
  bookId: string;
  cachedAt: number;      // 缓存时间戳（毫秒）
  ttl: number;           // 有效期（天）
  items: PopularHighlight[];
  chapters: {
    bookId: string;
    chapterUid: number;
    chapterIdx: number;
    title: string;
  }[];
}
```

**缓存文件格式**: `JSON`

```json
{
  "bookId": "123456",
  "cachedAt": 1717200000000,
  "ttl": 7,
  "items": [...],
  "chapters": [...]
}
```

---

## 4. 缓存策略

### 4.1 缓存读写流程

```
读取缓存:
1. 检查缓存文件是否存在 (.weread-cache/popular-{bookId}.json)
2. 检查缓存是否过期 (cachedAt + ttl*86400000 > now)
3. 未过期 → 返回缓存数据
4. 已过期或不存在 → 重新获取

写入缓存:
1. 热门划线数据获取成功后
2. 写入 .weread-cache/popular-{bookId}.json
3. 包含缓存时间戳和 TTL
```

### 4.2 缓存配置

在 `settings.ts` 中新增：

```typescript
popularHighlightsCacheTtl: number;  // 缓存有效期(天)，默认 7
```

---

## 5. 并发查询策略

### 5.1 查询流程

```
1. 获取书籍章节列表（来自 chapterResp）
2. 将章节按每批 5 个分组
3. 对每批章节并发调用 getBestBookmarks
4. 合并所有结果，按 chapterUid 分组
5. 写入缓存
```

### 5.2 重试机制

- 单章节请求失败时，重试 1 次
- 重试仍失败则跳过该章节（不影响其他章节）
- 使用 `Promise.allSettled` 避免单个失败影响整体

### 5.3 代码示例

```typescript
async fetchPopularHighlightsBatch(
  bookId: string,
  chapters: Chapter[],
  batchSize = 5
): Promise<Map<number, PopularHighlight[]>> {
  const results = new Map<number, PopularHighlight[]>();

  for (let i = 0; i < chapters.length; i += batchSize) {
    const batch = chapters.slice(i, i + batchSize);
    const promises = batch.map(async (chapter) => {
      const resp = await this.getBestBookmarks(bookId, chapter.chapterUid);
      return { chapterUid: chapter.chapterUid, items: resp?.items ?? [] };
    });

    const settled = await Promise.allSettled(promises);
    for (const result of settled) {
      if (result.status === 'fulfilled') {
        results.set(result.value.chapterUid, result.value.items);
      }
    }
  }

  return results;
}
```

---

## 6. 数据模型变更

### 6.1 models.ts 扩展

```typescript
// 新增类型
export type PopularHighlightCache = {
  bookId: string;
  cachedAt: number;
  ttl: number;
  items: PopularHighlight[];
  chapters: PopularChapterHighlight['chapterUid'][];
};

// 修改 Highlight 类型
export type Highlight = {
  // ... 现有字段
  isPopular?: boolean;        // 是否是热门划线（用户也有）
  popularCount?: number;      // 热门人数
  isUserHighlight?: boolean;  // 是否是用户自己的划线
};
```

### 6.2 settings.ts 扩展

```typescript
// 新增设置项
popularHighlightsCacheTtl: number;  // 默认 7 天

// 操作方法
setPopularHighlightsCacheTtl(value: number)
```

---

## 7. 模板设计

### 7.1 合并模式（已有逻辑增强）

**文件**: `themes/notebookTemplate.njk`

- 热门划线标记 `🔥` 和人数
- 用户划线且是热门时同时展示标记

```njk
{% for highlight in chapter.highlights %}
> 📌 {% if highlight.isPopular %}🔥 {{ highlight.popularCount }} {% endif %}
   [{{ highlight.markText | trim }}]
   {{ highlight.createTime }}
{% endfor %}
```

### 7.2 分离模式（新增）

**文件**: `themes/separatedWithPopularTemplate.njk`

结构：
```
# 我的划线
## 章节1
  - 我的划线

# 热门划线
## 章节1
  - 热门划线1 (🔥 999)
  - 热门划线2

# 我的笔记
  ...
```

**模板变量**：
```typescript
type RenderTemplate = {
  // ... 现有字段
  userHighlights: ChapterHighlightReview[];      // 仅用户划线
  popularHighlights: PopularChapterHighlight[];  // 热门划线
};
```

---

## 8. 同步流程变更

### 8.1 convertToNotebook 流程

```typescript
private async convertToNotebook(metaData: Metadata): Promise<Notebook> {
  // ... 现有逻辑（获取书籍信息、进度、划线、笔记）

  // 新增：热门划线处理
  if (get(settingsStore).syncPopularHighlightsToggle) {
    const popularHighlights = await this.getPopularHighlights(metaData.bookId);
    // 分离模式：设置 userHighlights 和 popularHighlights
    // 合并模式：标记用户划线中的热门，并追加新的热门划线
  }

  return {
    metaData,
    chapterHighlights,
    bookReview,
    popularHighlights,  // 用于分离模式
    userHighlights      // 仅分离模式使用
  };
}
```

### 8.2 getPopularHighlights 逻辑

```typescript
private async getPopularHighlights(bookId: string): Promise<PopularChapterHighlight[]> {
  // 1. 检查缓存
  const cache = await this.cacheManager.get(bookId);
  if (cache && !this.isCacheExpired(cache)) {
    return this.groupByChapter(cache.items, cache.chapters);
  }

  // 2. 获取章节信息
  const chapters = await this.getChaptersInfo(bookId);

  // 3. 并发获取热门划线
  const popularByChapter = await this.fetchPopularHighlightsBatch(bookId, chapters);

  // 4. 写入缓存
  await this.cacheManager.set(bookId, popularByChapter, chapters);

  // 5. 返回按章节分组的结果
  return this.groupByChapter(popularByChapter, chapters);
}
```

---

## 9. 文件变更清单

| 文件 | 变更类型 | 说明 |
|------|----------|------|
| `src/popularHighlightsCache.ts` | 新增 | 缓存管理类 |
| `src/models.ts` | 修改 | 新增类型定义 |
| `src/settings.ts` | 修改 | 新增缓存 TTL 设置项 |
| `src/api-router.ts` | 修改 | 添加按章节查询方法 |
| `src/syncNotebooks.ts` | 修改 | 集成缓存和并发查询 |
| `src/renderer.ts` | 修改 | 扩展 RenderTemplate |
| `src/themes/separatedWithPopularTemplate.njk` | 新增 | 分离式含热门划线模板 |
| `src/settingTab.ts` | 修改 | 添加缓存 TTL 配置项 |
| `src/main.ts` | 修改 | 注册缓存目录清理命令（可选） |

---

## 10. 风险与限制

| 风险 | 缓解措施 |
|------|----------|
| 热门划线 API 限流 | 并发控制（每批5个）+ 缓存复用 |
| 缓存文件过多 | 单书一个文件，定期清理过期缓存 |
| 用户禁用热门划线后缓存仍存在 | 保留缓存，下次启用时直接使用 |
| 缓存数据与实际不符 | 缓存过期后自动刷新 |

---

## 11. 配置项

| 配置项 | 类型 | 默认值 | 说明 |
|--------|------|--------|------|
| `syncPopularHighlightsToggle` | boolean | false | 是否同步热门划线 |
| `popularHighlightsCacheTtl` | number | 7 | 缓存有效期（天） |