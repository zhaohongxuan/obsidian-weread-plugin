# Obsidian Weread Plugin

[![](https://github.com/zhaohongxuan/obsidian-weread-plugin/actions/workflows/CI.yml/badge.svg)](https://github.com/zhaohongxuan/obsidian-weread-plugin/actions/workflows/CI.yml)
[![Release Obsidian plugin](https://github.com/zhaohongxuan/obsidian-weread-plugin/actions/workflows/release.yml/badge.svg)](https://github.com/zhaohongxuan/obsidian-weread-plugin/actions/workflows/release.yml)

Obsidian微信读书插件是一个社区插件，用来同步微信读书中所有的高亮文本/划线/以及个人感想，并将这些信息转换为笔记设置到Onbsidian的文件夹中，初次使用，如果笔记数量较多，更新会比较慢，后面再去更新的时候只会更新`划线数量`或者`笔记数量`有变化的书籍，一般速度很快

## 功能
- 同步微信读书的高亮划线
- 读书笔记分为`划线笔记`，`章节笔记`，`书籍书评`，目前`划线笔记`已实现，`章节笔记`，`书籍书评`正在开发中。
- 支持微信扫码登录，理论上可以和浏览器一样保持长时间不掉线。
- 校验Cookie有效期自动刷新Cookie
- 自定义笔记生成模板 template

## 安装方法
📢 由于本插件还未在插件市场上架，所以目前可以通过github下载release包安装。
1. 进入[Release页面](https://github.com/zhaohongxuan/obsidian-weread-plugin/releases)下载`obsidian-weread-plugin.zip`插件包
2. 打开设置，点击community plugins,点击这个文件夹图标打开plugins目录，把刚才的zip包解压缩到这里，然后刷新启用本插件![](https://cdn.jsdelivr.net/gh/zhaohongxuan/picgo@master/20220518124443.png)
## 设置
1. 打开Obsidian点击`设置`进入设置界面，找到`Obsidian Weread Plugin`进入到插件设置页面
2. 点击右侧`登录`按钮，在弹出的登录页面扫码登录![](https://cdn.jsdelivr.net/gh/zhaohongxuan/picgo@master/20220517112720.png)
   登录完成后，会显示个人昵称：![](https://cdn.jsdelivr.net/gh/zhaohongxuan/picgo@master/20220517110048.png)
3. 注销登录可以清楚Obsidian插件的Cookie信息，注销方法，和网页版微信读书一样，右上角点击头像，点击退出登录


## 使用
⚠️ 本插件是覆盖式更新，请不要在同步的文件里修改内容，写`永久笔记`（为什么写永久笔记参考[《卡片笔记写作法》](https://book.douban.com/subject/35503571/)）的时候可以使用[Block引用](https://help.obsidian.md/How+to/Link+to+blocks) 的方式，在外部引用进行批注。


1. 点击左侧Ribbon上的微信读书按钮，或者command+P(windows ctrl+P)调出Command Pattle 输入Weread 找到`Sync Weread command`即可同步。
![同步](https://cdn.jsdelivr.net/gh/zhaohongxuan/picgo@master/20220518124603.png)
2. 默认模板效果：![](https://cdn.jsdelivr.net/gh/zhaohongxuan/picgo@master/20220518190147.png)

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
- [ ] 书名重复导致同步失败
- [x] 设置页面支持设置Template格式
- [ ] 按照是否读完分类

## Weread API
[Weread API](./docs/weread-api.md)

## 免责声明
本程序没有爬取任何书籍内容，只提供登录用户的图书以及笔记信息，没有侵犯书籍作者版权和微信读书官方利益。
## 感谢
- [wereader](https://github.com/arry-lee/wereader)
- [Kindle Plugin](https://github.com/hadynz/obsidian-kindle-plugin)
- [Hypothesis Plugin](https://github.com/weichenw/obsidian-hypothesis-plugin)
- [Obsidian Plugin Developer Docs](https://marcus.se.net/obsidian-plugin-docs/)
- [http proxy middleware](https://github.com/chimurai/http-proxy-middleware)
- [nunjucks](https://github.com/mozilla/nunjucks)
