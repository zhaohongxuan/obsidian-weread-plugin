# 原生窗口模板编辑器

## 概述

新的模板编辑器使用 Electron 的 `BrowserWindow` 创建了一个真正的原生窗口，提供类似 macOS 原生应用的体验。

## 功能特性

### 三栏布局

1. **左侧：模板说明文档** (300px，可调整 250-500px)
   - 显示完整的 Nunjucks 模板语法说明
   - 包含可用变量、过滤器和示例代码
   - 支持拖动调整宽度

2. **中间：模板编辑器** (自适应宽度)
   - 语法高亮的代码编辑器
   - 支持 Nunjucks 模板语法
   - 实时语法验证

3. **右侧：实时预览** (自适应宽度)
   - 300ms 防抖的实时渲染
   - 使用示例数据预览效果
   - 错误提示显示

### 窗口功能

- **原生窗口体验**：使用 Electron BrowserWindow，提供完整的原生窗口功能
- **可拖动标题栏**：通过标题栏拖动整个窗口
- **最小尺寸**：1200×600px (初始尺寸：1600×900px)
- **响应式布局**：自动适应窗口大小
- **深色主题**：专为深色模式优化的 UI

## 技术实现

### 组件结构

```
templateEditorWindow.ts
├── Constructor
│   ├── 创建 BrowserWindow
│   ├── 设置窗口参数
│   └── 初始化 Renderer
├── loadContent()
│   └── 加载 HTML 内容
├── generateHTML()
│   ├── 生成完整的 HTML/CSS/JS
│   ├── 嵌入模板说明文档
│   └── 设置事件监听器
├── open()
│   ├── 设置 IPC 通信
│   ├── update-preview: 更新预览
│   ├── save-template: 保存模板
│   └── close-window: 关闭窗口
└── buildSampleNotebook()
    └── 生成示例数据
```

### IPC 通信

**渲染进程 → 主进程**
- `update-preview`: 发送模板字符串以更新预览
- `save-template`: 保存模板
- `close-window`: 关闭窗口

**主进程 → 渲染进程**
- `preview-updated`: 返回渲染结果或错误信息

### 样式设计

- **字体**：SF Mono, Monaco, Cascadia Code (代码编辑器)
- **配色**：基于 VS Code 深色主题
- **布局**：Flexbox 响应式布局
- **交互**：平滑过渡动画和悬停效果

## 使用方式

### 在设置页面

```typescript
// settingTab.ts
private template(): void {
    const descFragment = document.createRange()
        .createContextualFragment(templateInstructions);

    new Setting(this.containerEl)
        .setName('笔记模板')
        .setDesc(descFragment)
        .addButton((button) => {
            return button
                .setButtonText('编辑模板')
                .setCta()
                .onClick(() => {
                    const editorWindow = new TemplateEditorWindow(
                        get(settingsStore).template,
                        (newTemplate: string) => {
                            settingsStore.actions.setTemplate(newTemplate);
                        }
                    );
                    editorWindow.open();
                });
        });
}
```

### 编程调用

```typescript
import { TemplateEditorWindow } from './components/templateEditorWindow';

// 创建编辑器窗口
const editor = new TemplateEditorWindow(
    currentTemplate,          // 当前模板字符串
    (newTemplate: string) => { // 保存回调
        // 处理保存的模板
        console.log('新模板:', newTemplate);
    }
);

// 打开窗口
editor.open();
```

## 与之前实现的对比

| 特性 | 之前 (Modal) | 现在 (BrowserWindow) |
|------|-------------|---------------------|
| 窗口类型 | Obsidian Modal | Electron 原生窗口 |
| 布局 | 两栏（编辑器+预览） | 三栏（说明+编辑器+预览） |
| 大小调整 | 8方向拖拽调整 | 原生窗口缩放 |
| 窗口拖动 | 自定义拖拽实现 | 原生标题栏拖拽 |
| 最大化 | 自定义按钮 | 原生最大化按钮 |
| 最小尺寸 | 600×400px | 1200×600px |
| 初始尺寸 | 95vw×90vh | 1600×900px |
| 说明文档 | 在设置页面 | 集成在窗口左侧 |
| 主题适配 | CSS 变量 | 独立样式 |

## 优势

1. **真正的原生体验**：使用系统原生窗口，符合用户习惯
2. **三栏布局**：说明、编辑、预览一目了然
3. **更大的工作空间**：1600×900px 的初始尺寸
4. **原生窗口管理**：支持系统级的窗口操作（最小化、最大化、关闭）
5. **可调整的说明面板**：根据需要调整说明文档的宽度
6. **专业的编辑体验**：类似 IDE 的界面设计

## 注意事项

1. **仅支持桌面端**：BrowserWindow 仅在 Electron 环境中可用
2. **内存管理**：确保窗口关闭时清理 IPC 监听器
3. **调试**：可以使用 Electron DevTools 调试窗口内容
4. **性能**：使用 300ms 防抖优化实时预览性能

## 未来改进

- [ ] 添加快捷键支持 (Cmd+S 保存等)
- [ ] 支持多标签页编辑多个模板
- [ ] 添加模板历史记录
- [ ] 支持模板导入导出
- [ ] 添加语法高亮和自动补全
- [ ] 支持实时预览滚动同步

---

**最后更新**: 2025-11-22
