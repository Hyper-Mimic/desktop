This document is the authoritative source for HyperMimic's changelogs. Everything else gets generated from this list by `node scripts/generate-changelogs.mjs`.

Prefix notes with "Windows:", "macOS:", or "Linux:" as needed. Do not use **formatting** or [links](https://hypermimic.netlify.app/).
# 1.0.6 (2026-08-29)

- 修复已知bug
- 优化变量管理器插件的加载速度
- 

# 1.0.5 (2026-08-29)

- 修复许多已知bug
- 从ScratchAddons引入插件“调试器”（加入新标签页“计时器”）、“FPS计数器”（替代原来的“显示FPS”插件）、“重新为自制积木上色”、“自定义编辑器主题”，并做出适当调整
- 移除插件“拖动调整工具箱分类”，新增插件“作品分析器”、“从现有积木构建”代替原来固定处于页面上的功能，插件“自定义积木形状”支持预览，插件“查找积木”支持改变宽度，初次进入编辑器会启用HyperMimic默认插件设置而不是TurboWarp默认插件（允许在插件设置页面底部恢复默认），等
- 添加新的吉祥物（初始角色）“球猫”（Ball Cat）
- 移除自制积木创建页面右下角的三个缩放按钮，只使用Ctrl加鼠标滚轮的方式进行缩放

# 1.0.1 (2026-08-20)

- 修复一些已知bug
- 从AstraEditor引入插件“调试器（含新标签页）”、“显示FPS”、“拖动调整工具箱分类”、“书签”、“背景”、“待办”，并做出适当调整
- 调整工作区右键菜单样式（后续会允许自定义样式）

# 1.0.0 (2026-08-17)

 - 初始版本
 - 新增：HyperMimic 橙色主题
 - 新增：造型编辑器内的圆角矩形绘制工具
 - 新增：功能众多的作品分析器（菜单栏>文件>查看作品分析）
 - 允许在自制积木的创建界面放大、缩小视图，就像在工作区一样
 - 允许从已有的自制积木构建新的自制积木
