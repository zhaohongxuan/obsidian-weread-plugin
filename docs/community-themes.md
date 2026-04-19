# 社区主题指南

分享你的自定义主题，让其他微信读书插件用户也能使用！

## 主题包格式

社区主题是一个 JSON 文件，结构如下：

```json
{
  "manifest": {
    "id": "community-my-awesome-theme",
    "name": "我的主题名称",
    "description": "主题简短描述",
    "author": "作者名称",
    "version": "1.0.0"
  },
  "theme": {
    "template": "---...",
    "trimBlocks": false
  }
}
```

### 字段说明

| 字段 | 必填 | 说明 |
|------|------|------|
| `manifest.id` | 是 | 唯一标识符，建议以 `community-` 开头 |
| `manifest.name` | 是 | 显示名称 |
| `manifest.description` | 否 | 主题描述 |
| `manifest.author` | 否 | 作者名称或 GitHub 用户名 |
| `manifest.version` | 否 | 版本号 |
| `theme.template` | 是 | Nunjucks 模板字符串 |
| `theme.trimBlocks` | 否 | 是否去除区块空白（默认 false） |

## 分享主题

### 方式一：贡献内置主题

如果你希望将自己的主题贡献为插件内置主题：

1. Fork [weread-community-themes](https://github.com/zhaohongxuan/weread-community-themes) 仓库
2. 将 NJK 模板文件添加到 `themes/` 目录
3. 更新 `themes/index.json` 添加主题清单
4. 提交 Pull Request

### 方式二：分享为社区主题

如果你不想通过 PR，也可以分享 JSON 文件：

1. 在插件中导出主题（点击「导出」按钮）
2. 通过任何方式分享 JSON 文件（GitHub Gist、网盘等）
3. 其他用户可以通过「从 URL 导入」或「选择文件」导入你的主题

## 安装社区主题

1. 下载主题 JSON 文件或获取其 URL
2. 打开插件设置 → 主题管理
3. 点击「从 URL 导入」或「选择文件」
4. 选择或粘贴 JSON 文件

## 主题要求

- `manifest.id` 必须唯一，建议以 `community-` 开头
- 模板必须是有效的 Nunjucks 语法
- 请提供清晰的描述，让用户知道主题的功能
- 导入本地测试后再分享

## 模板变量

设计主题时，可使用以下变量：

```typescript
{
  metaData: {
    bookId: string,           // 书籍 ID
    title: string,            // 书名
    author: string,           // 作者
    cover: string,           // 封面 URL
    url: string,             // 微信读书书籍 URL
    pcUrl: string,           // PC 端 URL
    bookType: number,        // 书籍类型
    publishTime: string,     // 出版时间
    noteCount: number,       // 笔记数量
    reviewCount: number,     // 想法数量
    isbn: string,            // ISBN
    category: string,        // 分类
    publisher: string,       // 出版社
    intro: string,            // 简介
    lastReadDate: string,    // 最近阅读日期
    totalWords: number,      // 总字数
    rating: string,          // 评分
    readInfo: {
      readingTime: number,      // 阅读时长（分钟）
      totalReadDay: number,     // 总阅读天数
      continueReadDays: number, // 连续阅读天数
      readingBookCount: number, // 在读书籍数
      finishedDate: number,     // 完成日期
      readingProgress: number,  // 阅读进度
      markedStatus: number,     // 标记状态
      finishedBookCount: number,// 已读完书籍数
      finishedBookIndex: number // 完成书籍索引
    }
  },
  chapterHighlights: [{
    chapterUid: number,      // 章节 UID
    chapterIdx: number,     // 章节索引
    chapterTitle: string,   // 章节标题
    level: number,          // 层级
    isMPChapter: number,   // 是否公众号章节
    highlights: [{
      bookmarkId: string,      // 划线 ID
      created: number,          // 创建时间戳
      createTime: string,      // 创建时间字符串
      chapterUid: number,      // 所属章节 UID
      chapterIdx: number,      // 所属章节索引
      chapterTitle: string,    // 所属章节标题
      markText: string,        // 划线内容
      style: number,           // 样式
      colorStyle: number,     // 颜色样式
      range: string,           // 范围
      reviewContent: string   // 想法/笔记内容
    }]
  }],
  bookReview: {
    chapterReviews: [{
      chapterUid: number,
      chapterTitle: string,
      reviews: [{
        reviewId: string,
        abstract: string,
        content: string,
        mdContent: string,
        createTime: string
      }],
      chapterReview: string
    }],
    bookReviews: [{
      reviewId: string,
      created: number,
      createTime: string,
      content: string,
      mdContent: string,
      type: number
    }]
  }
}
```

### 可用的 Nunjucks 过滤器

- `trim` - 去除首尾空白
- `striptags` - 去除 HTML 标签
- `safe` - 标记为安全 HTML（跳过转义）

### 模板示例结构

```njk
---
isbn: {{metaData.isbn}}
lastReadDate: {{metaData.lastReadDate}}
---
《{{metaData.title}}》
{{metaData.author}}
{{metaData.noteCount}}个笔记

{% for chapter in chapterHighlights %}
## {{chapter.chapterTitle}}
{% for highlight in chapter.highlights %}
> {{ highlight.markText | trim }} ^{{highlight.bookmarkId}}
{% endfor %}
{% endfor %}
```

## 内置主题文件

内置主题位于 `src/themes/*.njk`：

| 主题 | 文件 | 说明 |
|------|------|------|
| 合并式模板 | `notebookTemplate.njk` | 划线和想法 inline 展示，适合快速回顾 |
| 分离式模板 | `separatedTemplate.njk` | 先展示纯划线，笔记统一在底部，适合整理归纳 |
| 微信官方笔记主题 | `wereadOfficialTemplate.njk` | 详细的元数据信息，适合生成书籍笔记 |
