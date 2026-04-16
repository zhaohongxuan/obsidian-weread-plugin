# Community Themes

Share your custom themes with other WeRead plugin users!

## Built-in Themes

All built-in themes are located in `src/themes/*.njk`:

| Theme | File | Description |
|-------|------|-------------|
| 合并式模板 | `notebookTemplate.njk` | 划线和想法 inline 展示，适合快速回顾 |
| 分离式模板 | `separatedTemplate.njk` | 先展示纯划线，笔记统一在底部，适合整理归纳 |
| 微信官方笔记主题 | `wereadOfficialTemplate.njk` | 详细的元数据信息，适合生成书籍笔记 |

## Theme Package Format

A community theme is a JSON file with the following structure:

```json
{
  "manifest": {
    "id": "community-my-awesome-theme",
    "name": "My Awesome Theme",
    "description": "A brief description of your theme",
    "author": "your-github-username",
    "version": "1.0.0"
  },
  "theme": {
    "template": "---...",
    "trimBlocks": false
  }
}
```

### Manifest Fields

| Field | Required | Description |
|-------|----------|-------------|
| `manifest.id` | Yes | Unique identifier, must be prefixed with `community-` |
| `manifest.name` | Yes | Display name shown in the theme selector |
| `manifest.description` | No | Brief description of the theme |
| `manifest.author` | No | Your name or GitHub username |
| `manifest.version` | No | Version string for update tracking |
| `theme.template` | Yes | The Nunjucks template string |
| `theme.trimBlocks` | No | Whether to trim block whitespace (default: false) |

## Submitting a Theme

### Option 1: Contribute to Built-in Themes (NJK files)

If you want to contribute a theme that should be included as a built-in theme:

1. Fork the [weread-community-themes](https://github.com/zhaohongxuan/weread-community-themes) repository
2. Add your NJK template file to the `themes/` folder
3. Update `themes/index.json` with your theme's manifest
4. Submit a Pull Request

### Option 2: Share as Community Theme (JSON)

If you want to share your theme without a PR:

1. Export your theme from the plugin (导出主题 button)
2. Share the JSON file however you prefer (GitHub Gist, Drive, etc.)
3. Others can import your theme by downloading and using "从 URL 导入" or "选择文件"

## Installing Community Themes

1. Download the theme JSON file or get its URL
2. Open WeRead plugin settings → 主题管理
3. Click "从 URL 导入" or "选择文件"
4. Select or paste the downloaded JSON file

## Theme Requirements

- `manifest.id` must be unique and prefixed with `community-`
- Template must be valid Nunjucks syntax
- Include a clear description so users know what the theme does
- Test your theme by importing it locally before submitting

## Template Variables

When designing a theme, the following variables are available:

```typescript
{
  metaData: {
    bookId: string,
    title: string,
    author: string,
    cover: string,
    url: string,
    pcUrl: string,
    bookType: number,
    publishTime: string,
    noteCount: number,
    reviewCount: number,
    isbn: string,
    category: string,
    publisher: string,
    intro: string,
    lastReadDate: string,
    totalWords: number,
    rating: string,
    readInfo: {
      readingTime: number,
      totalReadDay: number,
      continueReadDays: number,
      readingBookCount: number,
      finishedDate: number,
      readingProgress: number,
      markedStatus: number,
      finishedBookCount: number,
      finishedBookIndex: number
    }
  },
  chapterHighlights: [{
    chapterUid: number,
    chapterIdx: number,
    chapterTitle: string,
    level: number,
    isMPChapter: number,
    highlights: [{
      bookmarkId: string,
      created: number,
      createTime: string,
      chapterUid: number,
      chapterIdx: number,
      chapterTitle: string,
      markText: string,
      style: number,
      colorStyle: number,
      range: string,
      reviewContent: string
    }]
  }],
  bookReview: {
    chapterReviews: [],
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

### Available Nunjucks Filters

- `trim` - Remove leading/trailing whitespace
- `striptags` - Remove HTML tags
- `safe` - Mark as safe HTML (skip escaping)

### Example Template Structure

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
