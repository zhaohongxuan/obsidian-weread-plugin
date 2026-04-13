# Obsidian Weread Plugin

[![](https://github.com/zhaohongxuan/obsidian-weread-plugin/actions/workflows/CI.yml/badge.svg)](https://github.com/zhaohongxuan/obsidian-weread-plugin/actions/workflows/CI.yml)
[![Release Obsidian plugin](https://github.com/zhaohongxuan/obsidian-weread-plugin/actions/workflows/release.yml/badge.svg)](https://github.com/zhaohongxuan/obsidian-weread-plugin/actions/workflows/release.yml)
[![GitHub license](https://badgen.net/github/license/Naereen/Strapdown.js)](https://github.com/zhaohongxuan/obsidian-weread-plugin/blob/main/LICENSE)
[![Github all releases](https://img.shields.io/github/downloads/zhaohongxuan/obsidian-weread-plugin/total.svg)](https://GitHub.com/zhaohongxuan/obsidian-weread-plugin/releases/)
[![GitLab latest release](https://badgen.net/github/release/zhaohongxuan/obsidian-weread-plugin/)](https://github.com/zhaohongxuan/obsidian-weread-plugin/releases)



Obsidian微信读书插件是一个社区插件，用来同步微信读书中书籍`元信息`、`高亮标注`，`划线感想`、`书评`等，并将这些信息转换为markdown格式保存到Obsidian的文件夹中，初次使用，如果笔记数量较多，更新会比较慢，后面再去更新的时候只会更新`划线数量`或者`笔记数量`有变化的书籍，一般速度很快。

## 更新历史
https://github.com/zhaohongxuan/obsidian-weread-plugin/releases

## 功能
- 同步书籍元数据例如：书籍封面，作者、出版社、ISBN，出版时间等
- 同步微信读书的高亮划线
- 读书笔记分为`划线笔记`，`页面笔记`， `章节笔记`，`书籍书评`
- 支持微信扫码登录，理论上可以和浏览器一样保持长时间不掉线。
- 校验Cookie有效期自动刷新Cookie
- 自定义笔记生成模板 template
- 文件名支持多种格式设置
- 自定义FrontMatter，可在头部yaml文件中增加自己需要的字段，比如标签，阅读状态等
- 公众号划线和笔记归类同步
- 支持移动端同步，可以在手机和平板上使用本插件
- 支持Daily Notes,将当日读书笔记同步至Daily Notes中，已经在[0.4.0](https://github.com/zhaohongxuan/obsidian-weread-plugin/releases/tag/0.4.0)中支持
- 微信读书书架功能，展示本地同步的书籍汇总数据

<img width="1512" height="893" alt="image" src="https://github.com/user-attachments/assets/fe967324-789b-447a-95a2-3cd477720756" />


## 安装方法
插件市场直接搜索`weread`，找到`Weread Plugin`点击`install`安装，安装完成后点击`Enable`使插件启用，也可以直接在[release](https://github.com/zhaohongxuan/obsidian-weread-plugin/releases)页面手动下载。
## 设置
1. 打开Obsidian点击`设置`进入设置界面，找到`Obsidian Weread Plugin`进入到插件设置页面
2. 点击右侧`登录`按钮，在弹出的登录页面扫码登录，登录完成后，会显示个人昵称
3. 点击`注销`按钮即可注销登录，系统会自动清除Obsidian插件的Cookie信息
4. 设置笔记保存位置，笔记最小划线数量，笔记文件夹分类
<img width="2068" height="1554" alt="image" src="https://github.com/user-attachments/assets/dfcbdce1-b63d-4156-b18e-4aeef9e57c4f" />



## 使用

⚠️ 本插件是覆盖式更新，请不要在同步的文件里修改内容，写`永久笔记`（为什么写永久笔记参考[《卡片笔记写作法》](https://book.douban.com/subject/35503571/)）的时候可以使用[Block引用](https://help.obsidian.md/How+to/Link+to+blocks) 的方式，在外部引用进行批注。

<details>
	
<summary>基础使用</summary>

1. 点击左侧Ribbon上的微信读书按钮，或者command+P(windows ctrl+P)调出Command Pattle 输入Weread 找到`Sync Weread command`即可同步。
![sync|50](https://cdn.jsdelivr.net/gh/zhaohongxuan/picgo@master/20220522222015.png)
2. 默认模板效果(theme:minimal) ![](https://cdn.jsdelivr.net/gh/zhaohongxuan/picgo@master/20220522221449.png)
使用dataview+minimal cards的显示效果，[参考这里](https://github.com/zhaohongxuan/obsidian-weread-plugin/wiki/%E4%BD%BF%E7%94%A8Dataview%E8%BF%9B%E8%A1%8C%E4%B9%A6%E7%B1%8D%E7%AE%A1%E7%90%86)：
![](https://cdn.jsdelivr.net/gh/zhaohongxuan/picgo@master/20220529135016.png)
</details>

<details>
<summary>同步笔记到Daily Notes</summary>
	
1. 在设置中打开同步到Daily Notes的开关，然后分别设置Daily Notes的目录以及文件格式
2. 如果Daily Note是Periodic Notes管理的，可以改成Periodic Notes的格式，比如我使用的格式`YYYY/[W]ww/YYYY-MM-DD`，就会按照 年/周/日的维度在文件夹中寻找Daily Notes.
3. 设置在Daily Notes的特定的区间插入，可以修改默认值为你想要的markdown格式的内容，比如在`某两个标题`之间插入，注意📢，区间内的内容是会被覆盖的，不要在区间内修改文本。	
![](https://user-images.githubusercontent.com/8613196/179385400-d556527f-8d73-4ca7-b348-62810df96fe2.png)
</details>

## 已知问题
- 长期不使用本插件Cookie可能会失效，需要重新登录。
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
- [ ] 导出热门划线 https://github.com/zhaohongxuan/obsidian-weread-plugin/issues/42


## Weread API
[Weread API](./docs/weread-api.md)

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

## Supported By
<a href="https://jb.gg/OpenSourceSupport" target="_blank"><img src="https://resources.jetbrains.com/storage/products/company/brand/logos/jb_beam.png" height='128' style='border:0px;height:128px;' alt="JetBrains Logo (Main) logo."></a>
