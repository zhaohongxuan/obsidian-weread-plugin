# 微信读书 Agent API 文档

通过统一网关调用微信读书接口，支持搜索、书架、笔记、书评、阅读统计等能力。

## 基础信息

| 项目 | 值 |
|------|-----|
| **接口地址** | `POST https://i.weread.qq.com/api/agent/gateway` |
| **鉴权方式** | `Authorization: Bearer <API_KEY>` |
| **Content-Type** | `application/json` |
| **接口选择** | 请求体中的 `api_name` 字段指定 |

### 请求模板

```bash
curl -X POST "https://i.weread.qq.com/api/agent/gateway" \
  -H "Authorization: Bearer wrk-xxxxxxxx" \
  -H "Content-Type: application/json" \
  -d '{"api_name": "/store/search", "keyword": "三体", "skill_version": "1.0.3"}'
```

### 通用规则

- 每次请求必须带 `skill_version`（当前为 `"1.0.3"`）
- 所有业务参数**平铺在 body 顶层**，不要嵌套在 `params`/`data` 等对象内
- 时间戳字段单位均为 Unix 秒，阅读时长字段单位均为秒
- `errcode` 非 0 时表示错误

---

## 接口列表

| 分类 | api_name | 说明 |
|------|----------|------|
| 搜索 | `/store/search` | 书城搜索（书籍、作者、有声书等） |
| 书架 | `/shelf/sync` | 获取完整书架（含有声书、书单） |
| 书籍 | `/book/info` | 书籍基本信息 |
| 书籍 | `/book/chapterinfo` | 章节目录 |
| 书籍 | `/book/getprogress` | 阅读进度 |
| 笔记 | `/user/notebooks` | 笔记本概览（所有有笔记的书） |
| 笔记 | `/book/bookmarklist` | 单本书划线内容列表 |
| 笔记 | `/review/list/mine` | 单本书个人想法与点评 |
| 笔记 | `/book/bestbookmarks` | 书籍热门划线 TOP20 |
| 笔记 | `/book/underlines` | 章节划线热度统计 |
| 笔记 | `/book/readreviews` | 划线下的公众想法/评论 |
| 笔记 | `/review/single` | 单条想法详情 |
| 书评 | `/review/list` | 书籍公开点评 |
| 统计 | `/readdata/detail` | 阅读统计（时长/天数/偏好分析） |
| 推荐 | `/book/recommend` | 个性化推荐 |
| 推荐 | `/book/similar` | 相似书推荐 |

---

## 搜索

### `/store/search` — 书城搜索

**请求参数**

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `keyword` | string | ✅ | 搜索关键词 |
| `scope` | int | — | 搜索类型，见下表，默认 10（电子书） |
| `count` | int | — | 每页数量 |
| `maxIdx` | int | — | 翻页偏移（上一页最后一条的 `searchIdx`） |

**scope 对应关系**

| scope | 说明 |
|-------|------|
| 0 | 全部（综合搜索） |
| 10 | 电子书 |
| 14 | 有声书/专辑 |
| 16 | 网文小说 |
| 6 | 作者 |
| 12 | 全文搜索 |
| 13 | 书单 |
| 2 | 公众号 |
| 4 | 文章 |

**响应示例**（搜索"三体"，scope 默认）

```json
{
  "sid": "5un7e9Aer2",
  "results": [
    {
      "title": "电子书",
      "scope": 17,
      "scopeCount": 26,
      "currentCount": 3,
      "type": 1,
      "books": [
        {
          "searchIdx": 1,
          "bookInfo": {
            "bookId": "695233",
            "title": "三体全集（全三册）",
            "author": "刘慈欣",
            "cover": "https://cdn.weread.qq.com/weread/cover/80/yuewen_695233/s_yuewen_6952331740758482.jpg",
            "payType": 4097,
            "type": 0,
            "soldout": 0,
            "newRating": 930,
            "newRatingCount": 293405,
            "newRatingDetail": { "title": "神作" }
          },
          "readingCount": 10775
        }
      ]
    },
    {
      "title": "有声书",
      "type": 41,
      "scope": 14,
      "scopeCount": 12,
      "currentCount": 1
    }
  ]
}
```

---

## 书架

### `/shelf/sync` — 完整书架

**请求参数**：无（用户身份通过 API Key 自动注入）

**书架数量计算**：`books.length + albums.length + (mp 非空 ? 1 : 0)`

**响应示例**

```json
{
  "books": [
    {
      "bookId": "CB_7YV4cp4egBPA6wW6x6F0K3Kf",
      "title": "Harry Potter and the Sorcerer's Stone",
      "author": "J.K. Rowling",
      "cover": "https://res.weread.qq.com/...",
      "updateTime": 1749304698,
      "readUpdateTime": 1758035679,
      "finishReading": 0,
      "secret": 1,
      "isTop": false
    }
  ],
  "albums": [
    {
      "albumInfo": {
        "albumId": "3110080161",
        "name": "置身事内：中国政府与经济发展",
        "authorName": "王大民",
        "cover": "https://wehear-1258476243.file.myqcloud.com/...",
        "trackCount": 30,
        "finish": 1,
        "finishStatus": "已完结",
        "payType": 1,
        "updateTime": 1706068808
      },
      "albumInfoExtra": {
        "albumId": "3110080161",
        "secret": 1,
        "lecturePaid": 0,
        "lectureReadUpdateTime": 1745223973,
        "isTop": false
      }
    }
  ],
  "mp": {
    "show": 1,
    "book": {
      "bookId": "mpbook",
      "title": "文章收藏",
      "cover": "https://...",
      "readUpdateTime": 1751125626
    }
  },
  "archive": [
    {
      "name": "哈利波特",
      "bookIds": ["CB_7Q14cb4eg...", "CB_7t24ci4eg..."],
      "albumIds": []
    }
  ]
}
```

---

## 书籍信息

### `/book/info` — 书籍基本信息

**请求参数**

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `bookId` | string | ✅ | 书籍 ID |

**响应示例**

```json
{
  "bookId": "695233",
  "title": "三体全集（全三册）",
  "author": "刘慈欣",
  "cover": "https://cdn.weread.qq.com/weread/cover/80/yuewen_695233/t6_yuewen_6952331740758482.jpg",
  "intro": "【荣获世界科幻大奖"雨果奖"...】",
  "category": "精品小说-科幻小说",
  "publisher": "重庆出版社",
  "publishTime": "2022-04-01 00:00:00",
  "isbn": "",
  "newRating": 930,
  "newRatingCount": 293405,
  "newRatingDetail": {
    "good": 274343,
    "fair": 15852,
    "poor": 3210,
    "recent": 598,
    "deepV": 5071,
    "title": "神作"
  }
}
```

---

### `/book/chapterinfo` — 章节目录

**请求参数**

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `bookId` | string | ✅ | 书籍 ID |

**响应示例**（截取前 3 章）

```json
{
  "bookId": "695233",
  "synckey": 1687693885,
  "chapterUpdateTime": 1759043478,
  "chapters": [
    {
      "chapterUid": 90,
      "chapterIdx": 5,
      "title": "三体1",
      "level": 1,
      "wordCount": 1,
      "price": 0,
      "paid": 0,
      "isMPChapter": 0,
      "updateTime": 1740758664
    },
    {
      "chapterUid": 94,
      "chapterIdx": 9,
      "title": "1 科学边界",
      "level": 2,
      "wordCount": 7959,
      "price": 0,
      "paid": 0,
      "isMPChapter": 0,
      "updateTime": 1740758664
    },
    {
      "chapterUid": 110,
      "chapterIdx": 25,
      "title": "17 三体问题",
      "level": 2,
      "wordCount": 9109,
      "price": -1,
      "paid": 0,
      "isMPChapter": 0,
      "updateTime": 1740758664
    }
  ]
}
```

> `price: 0` 为免费章节，`price: -1` 为付费章节（需购买书籍）。`level` 为目录层级，1=一级标题，2=二级，3=三级。

---

### `/book/getprogress` — 阅读进度

**请求参数**

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `bookId` | string | ✅ | 书籍 ID |

**响应示例**

```json
{
  "bookId": "695233",
  "book": {
    "chapterUid": 114,
    "chapterOffset": 848,
    "chapterIdx": 27,
    "progress": 15,
    "updateTime": 1712799586,
    "readingTime": 28223,
    "recordReadingTime": 0,
    "isStartReading": 1
  },
  "timestamp": 1779233957
}
```

> `progress` 为 0-100 整数，表示百分比（`15` = 15%）。`readingTime` 单位秒。`finishTime` 仅在 `progress=100` 时出现。

---

## 笔记与划线

### `/user/notebooks` — 笔记本概览

获取所有有笔记的书，支持分页。

**请求参数**

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `count` | int | — | 每页数量，默认 20 |
| `lastSort` | int | — | 翻页游标（上一页最后一条的 `sort` 值） |

> **翻页**：`hasMore=1` 时，取本页最后一条的 `sort` 作为下次请求的 `lastSort`。

**响应示例**（2 条）

```json
{
  "synckey": 1779233400,
  "totalBookCount": 553,
  "totalNoteCount": 17177,
  "hasMore": 1,
  "books": [
    {
      "bookId": "3300189789",
      "book": {
        "bookId": "3300189789",
        "title": "金钱的艺术",
        "author": "[美]摩根·豪泽尔",
        "cover": "https://cdn.weread.qq.com/..."
      },
      "reviewCount": 2,
      "noteCount": 42,
      "bookmarkCount": 1,
      "readingProgress": 24,
      "markedStatus": 2,
      "sort": 1779067614
    },
    {
      "bookId": "33638775",
      "book": {
        "bookId": "33638775",
        "title": "苏东坡新传",
        "author": "李一冰",
        "cover": "https://cdn.weread.qq.com/..."
      },
      "reviewCount": 0,
      "noteCount": 10,
      "bookmarkCount": 0,
      "readingProgress": 3,
      "markedStatus": 2,
      "sort": 1778550758
    }
  ]
}
```

> **笔记总数** = `reviewCount + noteCount + bookmarkCount`。`noteCount` 是划线数，`reviewCount` 是想法/点评数，`bookmarkCount` 是书签数。

---

### `/book/bookmarklist` — 单本书划线列表

**请求参数**

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `bookId` | string | ✅ | 书籍 ID |

**响应示例**（2 条划线）

```json
{
  "synckey": 1740760267,
  "updated": [
    {
      "bookId": "695233",
      "bookmarkId": "695233_19_3760-3894",
      "chapterUid": 108,
      "markText": "地球生命真的是宇宙中偶然里的偶然，宇宙是个空荡荡的大宫殿，人类是这宫殿中唯一的一只小蚂蚁。",
      "range": "3450-3584",
      "createTime": 1711949794,
      "type": 1,
      "colorStyle": 0
    },
    {
      "bookId": "695233",
      "bookmarkId": "695233_12_2420-2507",
      "chapterUid": 101,
      "markText": "大树被拖走了，地面上的石块和树桩划开了树皮，使它巨大的身躯皮开肉绽。",
      "range": "2216-2303",
      "createTime": 1711589330,
      "type": 1,
      "colorStyle": 1
    }
  ],
  "removed": [],
  "chapters": [
    { "chapterUid": 108, "chapterIdx": 23, "title": "15 红岸之四" },
    { "chapterUid": 101, "chapterIdx": 16, "title": "8 寂静的春天" }
  ],
  "book": {
    "bookId": "695233",
    "title": "三体全集（全三册）",
    "author": "刘慈欣"
  }
}
```

> `range` 格式为 `"起始-结束"`，可用于构造深度链接。`type=1` 为划线，书签已自动过滤。

---

### `/review/list/mine` — 个人想法与点评

**请求参数**

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `bookid` | string | ✅ | 书籍 ID（注意是小写 `bookid`） |
| `synckey` | int | — | 翻页游标，默认 0 |
| `count` | int | — | 每页数量，默认 20 |

**响应示例**

```json
{
  "synckey": 1740761771,
  "totalCount": 1,
  "hasMore": 0,
  "reviews": [
    {
      "reviewId": "15707910_7r61CO8jM",
      "review": {
        "reviewId": "15707910_7r61CO8jM",
        "bookId": "695233",
        "content": "三维空间里人有着巨大的局限性",
        "abstract": ""射手"假说：有一名神枪手，在一个靶子上每隔十厘米打一个洞...",
        "range": "1277-1599",
        "type": 1,
        "chapterUid": 96,
        "chapterName": "3 射手和农场主",
        "chapterIdx": 11,
        "createTime": 1623806624,
        "star": 0,
        "author": {
          "userVid": 15707910,
          "name": "赵小轩",
          "avatar": "https://res.weread.qq.com/..."
        }
      }
    }
  ]
}
```

> `type=1` 为划线想法，`type=4` 为章节点评，`type=6` 为整本书评。`abstract` 是对应的划线原文。

---

### `/book/bestbookmarks` — 热门划线 TOP20

**请求参数**

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `bookId` | string | ✅ | 书籍 ID |
| `chapterUid` | int | — | 章节 UID，0=全书，默认 0 |
| `synckey` | int | — | 增量同步 key，默认 0 |

> 服务端固定返回前 20 条，不支持分页。

**响应示例**（2 条）

```json
{
  "synckey": 1779233154,
  "totalCount": 973,
  "items": [
    {
      "bookId": "695233",
      "bookmarkId": "695233_145_15118-15195",
      "chapterUid": 145,
      "range": "15118-15195",
      "markText": "太阳快落下去了，你们的孩子居然不害怕？ "当然不害怕，她知道明天太阳还会升起来的。"",
      "totalCount": 58136,
      "userVid": 29121947
    },
    {
      "bookId": "695233",
      "bookmarkId": "695233_100_4603-4634",
      "chapterUid": 100,
      "range": "4603-4634",
      "markText": "在中国，任何超脱飞扬的思想都会砰然坠地的，现实的引力太沉重了。",
      "totalCount": 56955,
      "userVid": 276736035
    }
  ],
  "chapters": [
    { "bookId": "695233", "chapterUid": 94, "chapterIdx": 9, "title": "1 科学边界" }
  ]
}
```

> `totalCount` 为该段划线的人数。

---

### `/book/underlines` — 章节划线热度统计

**请求参数**

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `bookId` | string | ✅ | 书籍 ID |
| `chapterUid` | int | ✅ | 章节 UID |
| `synckey` | int | — | 增量同步 key，默认 0 |

> 只返回热度统计（人数/得分），**不含划线原文**。适合展示"X 人划线"标签。

**响应示例**

```json
{
  "synckey": 1779233188,
  "bookId": "695233",
  "chapterUid": 94,
  "underlines": [
    { "range": "389-528", "count": 30600, "score": 877.63, "type": 2 },
    { "range": "608-657", "count": 8058,  "score": 195.74, "type": 2 },
    { "range": "695-706", "count": 0,     "score": 22.75,  "type": 0 }
  ]
}
```

---

### `/book/readreviews` — 划线下的公众想法

**请求参数**

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `bookId` | string | ✅ | 书籍 ID |
| `chapterUid` | int | ✅ | 章节 UID |
| `reviews` | array | ✅ | 要查询的划线范围数组 |
| `reviews[].range` | string | ✅ | 划线位置范围（来自 `/book/bestbookmarks`） |
| `reviews[].count` | int | — | 每个 range 返回数量，上限 20 |
| `reviews[].maxIdx` | int | — | 翻页偏移，默认 0 |
| `reviews[].synckey` | int | — | 翻页游标，默认 0 |

**请求示例**

```json
{
  "api_name": "/book/readreviews",
  "bookId": "695233",
  "chapterUid": 94,
  "reviews": [{"range": "389-528", "count": 2}],
  "skill_version": "1.0.3"
}
```

**响应示例**

```json
{
  "bookId": "695233",
  "chapterUid": 94,
  "reviews": [
    {
      "range": "389-528",
      "totalCount": 2660,
      "hasMore": 1,
      "maxIdx": 2,
      "synckey": 1779233188,
      "bookMarkCount": 30600,
      "pageReviews": [
        {
          "reviewId": "378001216_86Qiq9XLA",
          "likesCount": 193,
          "review": {
            "userVid": 378001216,
            "content": "在中国的体制下，警察和武警配合是常态...",
            "abstract": "1科学边界汪淼觉得，来找他的这四个人是一个奇怪的组合...",
            "range": "389-528",
            "chapterName": "1 科学边界",
            "createTime": 1770821022,
            "author": {
              "userVid": 378001216,
              "name": "长风不息⛵",
              "avatar": "https://res.weread.qq.com/..."
            }
          }
        }
      ]
    }
  ]
}
```

---

### `/review/single` — 单条想法详情

**请求参数**

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `reviewId` | string | ✅ | 想法 ID |
| `commentsCount` | int | — | 拉取评论数量，默认 10 |
| `commentsDirection` | int | — | 评论排序，0=倒序，1=正序 |
| `likesCount` | int | — | 拉取点赞数量，默认 10 |
| `synckey` | int | — | 增量同步 key，默认 0 |

---

## 书评

### `/review/list` — 书籍公开点评

**请求参数**

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `bookId` | string | ✅ | 书籍 ID |
| `reviewListType` | int | — | 0=全部，1=推荐，2=差评，3=最新，4=一般，默认 0 |
| `count` | int | — | 每页数量，默认 20 |
| `maxIdx` | int | — | 翻页偏移 |
| `synckey` | int | — | 翻页游标 |

**响应示例**（1 条推荐点评，已缩略）

```json
{
  "synckey": 1779233986,
  "reviewsCnt": 104402,
  "recentTotalCnt": 598,
  "reviewsHasMore": 1,
  "reviewsHas5Star": 1,
  "deepVUniqueCount": 5071,
  "friendCommentCount": 6,
  "friendUniqueCount": 6,
  "reviews": [
    {
      "idx": 1,
      "review": {
        "reviewId": "68566999_7ZHAfkTxE",
        "likesCount": 3259,
        "commentsCount": 988,
        "review": {
          "star": 100,
          "content": "我非常喜欢《三体》和刘慈欣；但书中对女性角色的塑造，一言难尽...",
          "createTime": 1745674848,
          "isFinish": 0,
          "chapterName": "",
          "author": {
            "userVid": 68566999,
            "name": "（Eason)逐月",
            "avatar": "https://thirdwx.qlogo.cn/..."
          }
        }
      }
    }
  ]
}
```

> `star` 评分：100=⭐⭐⭐⭐⭐，80=⭐⭐⭐⭐，60=⭐⭐⭐，40=⭐⭐，20=⭐。翻页用上一页最后一条的 `idx` 作为下次 `maxIdx`。

---

## 阅读统计

### `/readdata/detail` — 阅读统计详情

**请求参数**

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `mode` | string | — | `weekly`=本周，`monthly`=本月（默认），`annually`=本年，`overall`=全部历史 |
| `baseTime` | int | — | 基准时间戳，服务端归一化到周期起点；传历史时间戳可查历史周期 |

**响应示例**（本月，已精简）

```json
{
  "baseTime": 1777564800,
  "totalReadTime": 35683,
  "readDays": 19,
  "dayAverageReadTime": 1784,
  "compare": 0.247,
  "readStat": [
    { "stat": "读过", "counts": "9本" },
    { "stat": "读完", "counts": "1本" },
    { "stat": "阅读", "counts": "19天" },
    { "stat": "笔记", "counts": "119条" }
  ],
  "readLongest": [
    {
      "book": { "bookId": "26278269", "title": "苏轼传", "author": "王水照 崔铭" },
      "readTime": 17756,
      "tags": ["单日阅读最久"]
    },
    {
      "book": { "bookId": "3300189789", "title": "金钱的艺术", "author": "[美]摩根·豪泽尔" },
      "readTime": 8547,
      "tags": ["笔记最多"]
    }
  ],
  "preferCategory": [
    { "categoryTitle": "人物传记", "readingCount": 3, "readingTime": 22183 },
    { "categoryTitle": "经济理财", "readingCount": 3, "readingTime": 11127 }
  ],
  "preferCategoryWord": "偏好阅读人物传记",
  "readTimes": {
    "1777564800": 229,
    "1777651200": 2388,
    "1777737600": 4502
  }
}
```

> `totalReadTime`、`readTime`、`readingTime` 等所有时长字段单位均为**秒**。`compare` 为与上期日均时长的对比比例，`0.247` 表示增长约 24.7%。`readTimes` key 为每天的起始时间戳，value 为当天阅读秒数。

**查询历史数据示例**

```json
// 查询 2025 年全年
{"api_name": "/readdata/detail", "mode": "annually", "baseTime": 1735689600, "skill_version": "1.0.3"}

// 查询 2024 年 3 月
{"api_name": "/readdata/detail", "mode": "monthly", "baseTime": 1709222400, "skill_version": "1.0.3"}

// 查询全部历史
{"api_name": "/readdata/detail", "mode": "overall", "skill_version": "1.0.3"}
```

---

## 发现推荐

### `/book/recommend` — 个性化推荐

**请求参数**

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `count` | int | — | 每页数量，默认 12 |
| `maxIdx` | int | — | 翻页偏移（上一页最后一条的 `searchIdx`） |

**响应示例**（3 条）

```json
{
  "books": [
    {
      "bookId": "3300164559",
      "title": "奇特的一生（精装典藏2025版）",
      "author": "[俄]格拉宁",
      "cover": "https://cdn.weread.qq.com/...",
      "intro": "本书描述了一个真正和时间成为朋友的人...",
      "category": "个人成长-人生哲学",
      "price": 56.0,
      "payType": 1048577,
      "type": 0
    },
    {
      "bookId": "3300027206",
      "title": "5%的改变",
      "author": "李松蔚",
      "cover": "https://cdn.weread.qq.com/...",
      "category": "心理-积极心理学",
      "price": 49.8,
      "payType": 1048577,
      "type": 0
    }
  ]
}
```

---

### `/book/similar` — 相似书推荐

**请求参数**

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `bookId` | string | ✅ | 基准书籍 ID |
| `count` | int | — | 每页数量，默认 12 |
| `maxIdx` | int | — | 翻页偏移 |
| `sessionId` | string | — | 翻页会话 ID（首次不传，后续传回包中的值） |

---

## 深度链接（URL Scheme）

在 App 内跳转对应位置：

| 场景 | URL 格式 |
|------|---------|
| 打开书籍（上次进度） | `weread://reading?bId={bookId}` |
| 跳转到指定章节 | `weread://reading?bId={bookId}&chapterUid={chapterUid}` |
| 跳转到划线位置 | `weread://bestbookmark?bookId={bookId}&chapterUid={chapterUid}&rangeStart={start}&rangeEnd={end}` |

> `rangeStart`/`rangeEnd` 从 `range` 字段（如 `"389-528"`）解析得到。

**示例**

```
weread://reading?bId=695233
weread://reading?bId=695233&chapterUid=94
weread://bestbookmark?bookId=695233&chapterUid=94&rangeStart=389&rangeEnd=528
```

---

## 错误码

| errcode | 说明 |
|---------|------|
| 0 | 成功 |
| -2003 | 参数格式错误 |
| -2012 | 登录超时，需重新鉴权 |
