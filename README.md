# Obsidian Weread Plugin

Obsidian微信读书插件是一个社区插件，用来同步微信读书中所有的高亮文本/划线/以及个人感想，并将这些信息转换为笔记设置到Onbsidian的文件夹中。

## 功能
- 同步微信读书的划线以及个人感想到Obsidian
- 自定义笔记生成模板 template （TBD）
## 使用方法

1. 从r.qq.com扫码登录，控制台获取到Cookie
2. 把Cookie内容粘贴到setting框
   ![Cookie 设置](https://cdn.jsdelivr.net/gh/zhaohongxuan/picgo@master/20220510095654.png)
3. 点击左侧Ribbon上的微信读书按钮，或者command+P(windows ctrl+P)调出Command Pattle 输入Weread 找到`Sync Weread command`即可同步，默认会覆盖掉之前所有的笔记
   ![weread](https://cdn.jsdelivr.net/gh/zhaohongxuan/picgo@master/20220511160123.png)

## 已知问题

- 微信读书Cookie的有效期有点短，Cookie失效了之后需要重新登录 [r.qq.com](r.qq.com)获取Cookie
  
## TODO
- [x] 解决Obsidian中CORS问题
- [x] 设置界面笔记保存路径
- [ ] 设置页面支持设置Template格式
- [ ] 弹出扫码框登录自动获取Cookie
- [ ] 优化文件同步逻辑，不需要每次都删除重建，可以根据文件的


## 感谢
- [wereader](https://github.com/arry-lee/wereader)
- [Kindle Plugin](https://github.com/hadynz/obsidian-kindle-plugin)
- [Obsidian Plugin Developer Docs](https://marcus.se.net/obsidian-plugin-docs/)