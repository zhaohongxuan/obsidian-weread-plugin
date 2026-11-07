# Obsidian Weread Plugin

[![](https://github.com/zhaohongxuan/obsidian-weread-plugin/actions/workflows/CI.yml/badge.svg)](https://github.com/zhaohongxuan/obsidian-weread-plugin/actions/workflows/CI.yml)
[![Release Obsidian plugin](https://github.com/zhaohongxuan/obsidian-weread-plugin/actions/workflows/release.yml/badge.svg)](https://github.com/zhaohongxuan/obsidian-weread-plugin/actions/workflows/release.yml)
[![GitHub license](https://badgen.net/github/license/Naereen/Strapdown.js)](https://github.com/zhaohongxuan/obsidian-weread-plugin/blob/main/LICENSE)
[![Github all releases](https://img.shields.io/github/downloads/zhaohongxuan/obsidian-weread-plugin/total.svg)](https://GitHub.com/zhaohongxuan/obsidian-weread-plugin/releases/)
[![GitLab latest release](https://badgen.net/github/release/zhaohongxuan/obsidian-weread-plugin/)](https://github.com/zhaohongxuan/obsidian-weread-plugin/releases)

Obsidian 微信读书插件，同步微信读书的书籍元信息、高亮划线、笔记、书评、热门划线等，支持 API Key 和 Cookie 双认证模式，书架管理、书籍详情页和阅读统计。

## 3.0.0 更新亮点

打开微信读书后，顶部固定显示「今日 / 书架 / 回顾 / 统计」。点击 Tab 只切换下方内容，不创建新的 Obsidian 标签页；各面板首次点击才加载，切回来保留筛选、浏览和滚动状态。命令面板中的对应入口也会优先复用当前微信读书页面。

- **今日**：阅读时长、今天创建的划线与想法，以及按真实书架阅读时间倒序排列的最近三本书；「旧句重逢」从往日划线中随机选取，可换一句、换一本。
- **回顾**：按笔记创建日期浏览月历，查看「那年今日」，按划线／想法筛选；搜索会检索全部已缓存笔记的书名、作者与内容。卡片日期后提供原文跳转和复制正文图标，具备位置信息的划线可回到 App 原文。
- **书架模式**：文件夹和未归入文件夹的书在同一网格混排，共用标题／最近阅读排序；文件夹按其中书籍的最近阅读时间排序，成员书不在根目录重复展示。有声书和文章收藏入口不显示。笔记本模式展示有笔记的书和本地同步状态。
- **阅读统计**：周／月／年／累计时长、阅读节奏、交互图表、书籍排行和分类偏好；热力图独立宽屏展示，窄屏可在卡片内横向浏览。周／月的连续阅读天数、峰值日期和活跃天数依据每日时长计算。
- **共享缓存**：今日与回顾共用插件目录下的 JSON 笔记缓存，无需数据库。首次按书整理，之后默认每天校验一次，可在设置中改为每天两次；划线和想法数量未变化时复用详情。「刷新笔记」可立即校验。账号凭据变化时隔离缓存，网络失败会保留已取得内容并显示覆盖范围。
- **接口协议**：适配微信读书 Agent Skill 1.0.5，补齐笔记本与想法分页；接口要求升级时显示明确提示。

在「设置 → Weread → 书架设置 → 书架展示模式」选择书架模式或笔记本模式，默认使用书架模式，切换后页面自动更新。

回顾日历记录的是笔记创建历史，不能恢复未记录的完整阅读轨迹。页面统计仅包含已成功缓存的划线和个人想法，不包含书签或他人的公开书评。新增浏览功能不修改已同步 Markdown，也不改变原有同步模板和过滤规则。

### 界面预览

以下截图使用示例数据，展示当前版本的界面。

**今日：阅读概览、最近翻开的书与旧句重逢。**

![今日阅读概览与旧句重逢](./docs/screenshots/today.webp)

**回顾：按日历查看笔记，在往日划线和那年今日之间重逢。**

![回顾日历与历史笔记](./docs/screenshots/review.webp)

**阅读统计：阅读时长、节奏、书籍排行与分类偏好。**

![阅读统计与阅读节奏](./docs/screenshots/reading-stats.webp)

## 3.1.0 划线收藏

需要 Obsidian 1.1.9 或更新版本，并启用内置 Canvas。

顶部新增「收藏」Tab。今日、回顾、那年今日与旧句重逢中的个人划线，均可通过日期旁的星标收藏；想法和社区热门划线本期不开放收藏。

- **收藏列表与卡片**：默认卡片，可切换列表并记住选择；支持本地搜索、按收藏/划线时间排序及分批加载。
- **正文快照**：保存收藏时的正文、书名、作者、章节和来源。原划线变化、清笔记缓存或退出登录，不会清除收藏。
- **取消与撤销**：星标与收藏列表保持同步，取消后可限时撤销；原文跳转与复制正文继续可用。
- **原生 Canvas**：数据存于笔记库 `WereadData/favorites/favorites.canvas`。点击「在Canvas中打开」即可用 Obsidian 原生画布浏览和整理同一份收藏，不需要导出。已有位置、尺寸、颜色、连线和手动添加的内容会保留；编辑收藏正文或删除收藏卡片会同步到插件列表和星标。
- **图书封面**：Canvas 卡片顶部显示有界封面缩略图；打开已有收藏画布时自动补齐，不重排卡片或改变用户调整过的尺寸。封面使用原书 HTTP(S) 图片链接，正文和复制内容不混入图片标记。
- **旧数据迁移**：首次读取时自动将旧 JSON 收藏迁移到 Canvas，原 JSON 与旧备份保持不变；已有 Canvas 优先，不重复导入。
- **恢复保护**：写入完成后才确认收藏成功；保留上一有效版本备份。截断文件先保留原件再尝试恢复，未知新格式或可解析但结构/元数据有误的画布保持只读。

收藏归属当前笔记库的本地个人集合，切换登录仍保留，不修改已有书籍 Markdown，也不保存认证信息。多设备同时写入不保证自动合并；检测到外部修改时会重新加载并要求重试。手动备份笔记库时请包含 `WereadData/favorites` 目录。用户在画布中新建的自由卡片会保留，但不会自动当作带微信读书来源的划线收藏。

可通过命令「打开微信读书收藏」进入列表，或通过「打开微信读书收藏画布」进入原生 Canvas；在「设置 → Weread → 书架设置」调整收藏默认视图。实现与持久化方案见 [收藏设计说明](./docs/favorites-design.md)。

### 书籍详情

在当前页面内打开详情，通过面包屑返回原来的书架或回顾页面；个人划线可以直接加入收藏。

![书籍详情、面包屑导航与个人划线收藏](./docs/screenshots/book-detail.webp)

## 更新历史
https://github.com/zhaohongxuan/obsidian-weread-plugin/releases

## 功能
- 🔑 **API Key 登录**：扫码一键获取，稳定免维护
- 🔥 **热门划线同步**：同步社区热度最高的划线，标注共读人数
- 📖 **书籍详情页**：多 Tab 浏览划线、笔记、热门划线、书评，支持 deeplink 跳转微信读书
- 📊 **阅读统计**：周／月／年／累计概览、交互时长图、书籍排行和偏好分析；周／月每日记录可查看连续阅读天数、峰值日期和活跃天数。
- 📚 **微信读书书架**：搜索、筛选、排序，按年份分组，同步日志
- 📝 **笔记同步**：同步书籍元数据、高亮划线、划线想法、章节点评、书籍书评
- 📱 **公众号同步**：支持同步微信公众号文章的划线和笔记
- 📅 **Daily Notes**：将当日读书笔记插入 Daily Notes 指定位置
- 🎨 **主题系统**：4 个内置主题，支持自定义、导入导出、社区分享
- 📋 **自定义 FrontMatter**：可在头部 YAML 中增加标签、阅读状态等自定义字段
- 📁 **灵活文件组织**：支持按书名/分类创建子文件夹，多种文件名格式
- 🔄 **定时自动同步**：可配置间隔的自动同步

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

在书架页点击书籍封面或标题，会在**当前微信读书页面**内打开书籍详情；顶部保留统一导航，通过「书架 / 书名」面包屑返回，原有搜索、筛选、滚动和焦点保持不变。从今日、回顾或收藏进入时，也会返回对应的原页面。

1. **划线** Tab：按章节分组，以小圆点保留划线颜色，支持原文跳转、复制和星标收藏；收藏状态与今日、回顾、收藏页同步。
2. **笔记** Tab：个人想法和注解，按时间倒序，不混入长书评。
3. **热门划线** Tab：社区热度最高的划线（需 API Key），不作为个人划线收藏。
4. **书评** Tab：个人书评 + 社区精选书评。

封面、衬线书名、作者和简介使用与 3.0 一致的留白与主题配色；阅读进度、时长和条数以轻量信息行展示。可在页头打开微信读书或本地笔记。「刷新」只重新读取详情，「同步笔记」才同步该书的本地 Markdown。命令「打开当前书籍详情」也可从已同步书籍笔记进入。

本地历史划线仍可离线阅读和复制；若缺少原始划线 ID 或创建时间，会提示联网读取后再收藏，避免与今日/回顾生成重复来源。

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

模板编辑说明见[模板编辑器使用说明](./docs/template-editor-window.md)。

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
