# Obsidian Weread Plugin

[![](https://github.com/zhaohongxuan/obsidian-weread-plugin/actions/workflows/CI.yml/badge.svg)](https://github.com/zhaohongxuan/obsidian-weread-plugin/actions/workflows/CI.yml)
[![Release Obsidian plugin](https://github.com/zhaohongxuan/obsidian-weread-plugin/actions/workflows/release.yml/badge.svg)](https://github.com/zhaohongxuan/obsidian-weread-plugin/actions/workflows/release.yml)
[![GitHub license](https://badgen.net/github/license/Naereen/Strapdown.js)](https://github.com/zhaohongxuan/obsidian-weread-plugin/blob/main/LICENSE)
[![Github all releases](https://img.shields.io/github/downloads/zhaohongxuan/obsidian-weread-plugin/total.svg)](https://GitHub.com/zhaohongxuan/obsidian-weread-plugin/releases/)
[![GitLab latest release](https://badgen.net/github/release/zhaohongxuan/obsidian-weread-plugin/)](https://github.com/zhaohongxuan/obsidian-weread-plugin/releases)

Obsidian 微信读书插件，同步微信读书的书籍元信息、高亮划线、笔记、书评、热门划线等，支持 API Key 和 Cookie 双认证模式，书架管理、书籍详情页和阅读统计。

<img width="1672" height="941" alt="image" src="https://github.com/user-attachments/assets/41340794-9d48-44f2-9512-e1e7ae0672ff" />

## V2 更新亮点 🔥

**2.0** 是一次重大架构升级，以 **API Key** 为核心，引入微信读书 Agent API。

| 特性 | 说明 |
|------|------|
| 🔑 **API Key 扫码获取** | 设置页一键扫码获取 Key，自动校验有效性，无需反复登录 |
| 🔀 **双模式路由** | API Key 优先走 V2 Agent API，失败自动回退 Cookie，平滑切换 |
| 🔥 **热门划线同步** | 每本书 TOP 20 社区热门划线，按章节融合用户划线，标注共读人数 |
| 📖 **书籍详情页** | 新标签页打开，划线 / 笔记 / 热门划线 / 书评四个 Tab，支持 App deeplink |
| 🎨 **主题系统** | 4 个内置主题，支持自定义、导入导出、实时预览的模板编辑器 |
| 📊 **阅读统计** | 年度/月度/每周阅读时长、偏好分析、热力图 |

详细使用说明见 [V2 使用指南 ⧉](./docs/weread-v2-guide.md)。

## 更新历史
https://github.com/zhaohongxuan/obsidian-weread-plugin/releases

## 功能
- 🔑 **API Key 登录**：扫码一键获取，稳定免维护
- 🔥 **热门划线同步**：同步社区热度最高的划线，标注共读人数
- 📖 **书籍详情页**：多 Tab 浏览划线、笔记、热门划线、书评，支持 deeplink 跳转微信读书
- 📊 **阅读统计**：年度/月度阅读时长、偏好分析、热力图
- 📚 **微信读书书架**：搜索、筛选、排序，按年份分组，同步日志
- 📝 **笔记同步**：同步书籍元数据、高亮划线、划线想法、章节点评、书籍书评
- 📱 **公众号同步**：支持同步微信公众号文章的划线和笔记
- 📅 **Daily Notes**：将当日读书笔记插入 Daily Notes 指定位置
- 🎨 **主题系统**：4 个内置主题，支持自定义、导入导出、社区分享
- 📋 **自定义 FrontMatter**：可在头部 YAML 中增加标签、阅读状态等自定义字段
- 📁 **灵活文件组织**：支持按书名/分类创建子文件夹，多种文件名格式
- 🔄 **定时自动同步**：可配置间隔的自动同步

<img width="1548" height="930" alt="image" src="https://github.com/user-attachments/assets/c9252fa6-6ac8-40ab-94db-f72138b63ad5" />

## 安装方法
插件市场直接搜索`weread`，找到`Weread Plugin`点击`install`安装，安装完成后点击`Enable`使插件启用，也可以直接在[release](https://github.com/zhaohongxuan/obsidian-weread-plugin/releases)页面手动下载。

## 快速开始

### API Key

1. 打开设置页，在「API Key」区域点击 **「扫码获取」**
2. 已登录用户自动获取 Key；未登录弹出二维码，微信扫码登录后自动获取
3. 获取成功后输入框旁显示 ✓ 绿色图标即完成配置
4. 点击 Ribbon 按钮或命令面板 `Sync Weread` 开始同步

> 💡 **移动端**：访问 <https://weread.qq.com/api/skills/apikeyGet> 复制 Key，粘贴到设置页。详见 [V2 使用指南](./docs/weread-v2-guide.md)。

## 设置参考
<img width="2068" height="1554" alt="image" src="https://github.com/user-attachments/assets/dfcbdce1-b63d-4156-b18e-4aeef9e57c4f" />



## 使用

⚠️ 本插件是覆盖式更新，请不要在同步的文件里修改内容。写「永久笔记」（为什么写永久笔记参考[《卡片笔记写作法》](https://book.douban.com/subject/35503571/)）时，可使用[Block 引用](https://help.obsidian.md/How+to/Link+to+blocks)在外部分别批注。

<details>
<summary>📖 书籍详情页</summary>

在书架页点击书籍封面或标题，即可在新标签页打开**书籍详情视图**：

1. **划线** Tab：按章节分组，颜色边线区分，支持 deeplink 跳转和复制
2. **笔记** Tab：个人想法和注解，按时间倒序
3. **热门划线** Tab：社区热度最高的划线（需 API Key）
4. **书评** Tab：个人书评 + 社区精选书评

Header 区域展示封面、阅读进度、时长、分类、出版社等元数据。右下角悬浮按钮可快速跳转本地笔记。

</details>

<details>
<summary>📝 基础同步</summary>

1. 点击左侧 Ribbon 上的微信读书按钮，或 `Cmd+P`（Windows `Ctrl+P`）打开命令面板，输入 `Weread` 找到 `Sync Weread` 即可同步。
![sync|50](https://cdn.jsdelivr.net/gh/zhaohongxuan/picgo@master/20220522222015.png)
2. 默认模板效果(theme:minimal) ![](https://cdn.jsdelivr.net/gh/zhaohongxuan/picgo@master/20220522221449.png)
使用dataview+minimal cards的显示效果，[参考这里](https://github.com/zhaohongxuan/obsidian-weread-plugin/wiki/%E4%BD%BF%E7%94%A8Dataview%E8%BF%9B%E8%A1%8C%E4%B9%A6%E7%B1%8D%E7%AE%A1%E7%90%86)：
![](https://cdn.jsdelivr.net/gh/zhaohongxuan/picgo@master/20220529135016.png)
</details>

<details>
<summary>📅 同步笔记到 Daily Notes</summary>
	
1. 在设置中打开同步到Daily Notes的开关，然后分别设置Daily Notes的目录以及文件格式
2. 如果Daily Note是Periodic Notes管理的，可以改成Periodic Notes的格式，比如我使用的格式`YYYY/[W]ww/YYYY-MM-DD`，就会按照 年/周/日的维度在文件夹中寻找Daily Notes.
3. 设置在Daily Notes的特定的区间插入，可以修改默认值为你想要的markdown格式的内容，比如在`某两个标题`之间插入，注意📢，区间内的内容是会被覆盖的，不要在区间内修改文本。	
![](https://user-images.githubusercontent.com/8613196/179385400-d556527f-8d73-4ca7-b348-62810df96fe2.png)
</details>

<details>
<summary>🔥 热门划线同步</summary>

1. 确保已配置 **API Key**
2. 在设置中开启「同步热门划线」开关
3. 合并式模板中热门划线与用户划线融合，标注 📌🔥 和共读人数
4. 分离式模板中热门划线独立展示，按章节分组

支持本地缓存（默认 7 天有效期），可配置 TTL。

</details>

## 主题管理

插件内置 **4 个主题模板**，支持导入导出和自定义主题。

### 内置主题

| 主题 | 说明 |
|------|------|
| 合并式模板 | 划线和想法 inline 展示，支持热门划线标记，适合快速回顾 |
| 分离式模板 | 先展示纯划线，笔记统一在底部，适合整理归纳 |
| 微信官方笔记主题 | 详细的元数据信息，适合生成书籍笔记 |
| 分离式（含热门划线） | 我的划线、热门划线、笔记三个独立区块 🔥 |

### 主题类型

| 类型 | 说明 |
|------|------|
| 内置 | 插件自带，不可删除，不可编辑 |
| 自定义 | 用户创建，可编辑、复制、导出 |
| 旧模板 | 从旧版本迁移的模板，不可编辑，只能复制后自定义 |

### 使用主题

1. 在插件设置中打开**主题管理**
2. 选择想要使用的主题，点击「使用此主题」
3. 当前使用中的主题会显示「✓ 使用中」标签

### 创建自定义主题

1. 选择任意内置主题，点击「复制并自定义」
2. 系统会创建该主题的副本并自动设为使用中
3. 点击「编辑」修改模板内容或设置项

### 导入导出

- **导出**：点击主题的「导出」按钮，下载 JSON 文件
- **导入**：支持从本地文件或 URL 导入主题

详细指南请查看[主题贡献指南](./docs/community-themes.md)。

## 已知问题
- 使用 Cookie 登录时，长期不使用可能导致 Cookie 失效，建议优先使用 API Key。
- 偶尔可能会有网络连接问题，重新点击同步即可，已同步的笔记不会再次更新。

## TODO
- [x] 解决Obsidian中CORS问题
- [x] 设置界面笔记保存路径
- [x] 优化文件同步逻辑，不需要每次都删除重建，可以根据Note的数量来判断
- [x] 被动刷新Cookie延长有效期
- [x] 多处登录导致Cookie失效Fix
- [x] 弹出扫码框登录自动获取Cookie
- [x] 书名重复导致同步失败
- [x] 设置页面支持设置Template格式
- [x] 文件名模板
- [x] 移动端适配
- [x] 阅读状态元数据，比如阅读中，阅读完成等等，以及阅读时间的分布等
- [x] 按照章节Index进行排序
- [x] 保留多个章节层级
- [x] 同步微信公众号文章
- [x] 模板预览功能
- [x] 设置页面，目录选择优化 https://github.com/zhaohongxuan/obsidian-weread-plugin/issues/39
- [x] 导出热门划线 https://github.com/zhaohongxuan/obsidian-weread-plugin/issues/42
- [x] API Key 扫码获取与双模式路由
- [x] 书籍详情页（划线/笔记/热门划线/书评四个 Tab）
- [x] 主题系统（4 个内置主题 + 自定义导入导出）
- [x] 阅读统计（年度/月度/每周 + 热力图）


## 文档

- [V2 使用指南](./docs/weread-v2-guide.md) — V2 功能介绍与使用说明
- [微信读书 Agent API](./docs/weread-agent-api.md) — V2 Agent API 接口文档
- [微信读书 API (V1)](./docs/weread-api.md) — V1 Cookie API 参考
- [模板编辑器](./docs/template-editor-window.md) — 模板编辑器使用说明

## 赞赏

<img src=https://github.com/zhaohongxuan/obsidian-weread-plugin/assets/8613196/661a1d1b-6f45-493b-adb5-6f53fbf2d499 width=30% />

## 免责声明
本程序没有爬取任何书籍内容，只提供登录用户的图书以及笔记信息，没有侵犯书籍作者版权和微信读书官方利益。
## 感谢
- [wereader](https://github.com/arry-lee/wereader)
- [Kindle Plugin](https://github.com/hadynz/obsidian-kindle-plugin)
- [Hypothesis Plugin](https://github.com/weichenw/obsidian-hypothesis-plugin)
- [Obsidian Plugin Developer Docs](https://marcus.se.net/obsidian-plugin-docs/)
- [http proxy middleware](https://github.com/chimurai/http-proxy-middleware)
- [nunjucks](https://github.com/mozilla/nunjucks)

## Star History

[![Star History](https://api.star-history.com/svg?repos=zhaohongxuan/obsidian-weread-plugin&type=Timeline)](https://star-history.com/#zhaohongxuan/obsidian-weread-plugin&type=Timeline)
