# Obsidian Weread Plugin

[![](https://github.com/zhaohongxuan/obsidian-weread-plugin/actions/workflows/CI.yml/badge.svg)](https://github.com/zhaohongxuan/obsidian-weread-plugin/actions/workflows/CI.yml)
[![Release Obsidian plugin](https://github.com/zhaohongxuan/obsidian-weread-plugin/actions/workflows/release.yml/badge.svg)](https://github.com/zhaohongxuan/obsidian-weread-plugin/actions/workflows/release.yml)

Obsidian微信读书插件是一个社区插件，用来同步微信读书中所有的高亮文本/划线/以及个人感想，并将这些信息转换为笔记设置到Onbsidian的文件夹中。

## 功能
- 同步微信读书的划线以及个人感想到Obsidian，初次更新会比较慢，后面再去更新的时候只会更新`划线数量`或者`笔记数量`有变化的书籍，一般很快
- 自定义笔记生成模板 template （TBD）

## 安装方法
1. 进入[Release页面](https://github.com/zhaohongxuan/obsidian-weread-plugin/releases)下载`obsidian-weread-plugin.zip`插件包
   ![](https://cdn.jsdelivr.net/gh/zhaohongxuan/picgo@master/20220512084624.png)
2. 把zip包解压在自己`Obsidian Vault`的根目录 `.obsidian/plugins` 
3. 重启Obsidian，或者重新刷新community plugin![](https://cdn.jsdelivr.net/gh/zhaohongxuan/picgo@master/20220512084836.png)
## 使用方法

1. 先打开微信读书（也即r.qq.com），先不要登录，按 `CMD+Option+i`/`Ctrl+Shift+i` 启动网页控制台
2. 点击下图所示的网络（Network）栏目，按 `Ctrl+E`/`CMD+E` 启动网络监控
3. 在微信读书 r.qq.com 扫码登录，控制台获取到Cookie
   ![](https://cdn.jsdelivr.net/gh/zhaohongxuan/picgo@master/20220511235931.png)
4. 把Cookie内容粘贴到setting框
![](https://cdn.jsdelivr.net/gh/zhaohongxuan/picgo@master/20220511235704.png)
5. 点击左侧Ribbon上的微信读书按钮，或者command+P(windows ctrl+P)调出Command Pattle 输入Weread 找到`Sync Weread command`即可同步。

- Ribbon方式
![](https://cdn.jsdelivr.net/gh/zhaohongxuan/picgo@master/20220511235530.png)
- Command Pattle方式
   ![](https://cdn.jsdelivr.net/gh/zhaohongxuan/picgo@master/20220511235440.png)
4. 效果图 ![](https://cdn.jsdelivr.net/gh/zhaohongxuan/picgo@master/20220512090456.png)
## 已知问题

- 微信读书Cookie的有效期有点短，Cookie失效了之后需要重新登录 [r.qq.com](r.qq.com)获取Cookie，手机端获取Cookie不易，所以在Mobile端禁用了
  
## TODO
- [x] 解决Obsidian中CORS问题
- [x] 设置界面笔记保存路径
- [x] 优化文件同步逻辑，不需要每次都删除重建，可以根据Note的数量来判断
- [ ] 设置页面支持设置Template格式
- [ ] 弹出扫码框登录自动获取Cookie


## 感谢
- [wereader](https://github.com/arry-lee/wereader)
- [Kindle Plugin](https://github.com/hadynz/obsidian-kindle-plugin)
- [Obsidian Plugin Developer Docs](https://marcus.se.net/obsidian-plugin-docs/)
- [http proxy middleware](https://github.com/chimurai/http-proxy-middleware)
- [nunjucks](https://github.com/mozilla/nunjucks)
