# Glass Canvas

一个为 VS Code 工作台添加自定义背景图的扩展，支持透明度、模糊、亮度、饱和度、填充方式和混合模式，并内置 Pixiv 找图面板。

[![VS Code](https://img.shields.io/badge/VS%20Code-%E2%89%A51.85-007ACC?logo=visualstudiocode)](https://code.visualstudio.com/)
[![Version](https://img.shields.io/badge/version-0.2.3-4c1)](CHANGELOG.md)
[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

> Copyright © 2026 [MrSpring521](https://github.com/MrSpring521). Released under the [MIT License](LICENSE).

## AI 生成免责声明

本项目的代码与文档主要由 OpenAI Codex 根据 MrSpring521 提出的需求生成，并在持续交互中完成修改与测试。人工智能生成的内容可能存在错误、安全隐患、兼容性问题或不适合特定使用场景的实现。

使用、修改或分发本项目之前，请自行审查代码并评估相关风险。使用者应自行负责遵守 VS Code、Pixiv 及所在地区适用的服务条款、版权规则和法律法规。OpenAI 不作为本项目的维护者，不代表 OpenAI 对本项目提供认可、保证或技术支持，也不对因使用本项目造成的任何损失承担责任。

该免责声明不改变本项目的 [MIT License](LICENSE)、MrSpring521 的项目版权声明，以及 Pixiv 作品作者对其图片享有的权利。

## 功能

- 为整个 VS Code 工作台或编辑器区域设置背景图。
- 支持本地图片、`file:` URI、HTTPS URL 和 base64 `data:image` URI。
- 支持透明度、模糊、亮度、饱和度和混合模式。
- 支持 `cover`、`contain`、原始尺寸和拉伸等填充方式。
- 在编辑器标题栏提供 Pixiv 找图入口。
- 支持 Pixiv Tag 搜索、最低分辨率筛选和结果翻页。
- 支持下载 Pixiv 原图或直接应用为背景。
- 使用 Pixiv 安全分级、作品限制标记和本地 Tag 规则进行工作环境过滤。
- 修改前自动创建带 SHA-256 校验的版本化备份。
- 提供移除背景、紧急恢复和 VS Code 更新后重新应用功能。

## 环境要求

- VS Code 1.85 或更高版本。
- 桌面版 VS Code；网页版不支持。
- 编译源码需要 Node.js 20 或兼容版本，以及 npm。
- 使用 Pixiv 找图功能需要能够访问 `www.pixiv.net` 和 `i.pximg.net`。

## 安装

### 从 VSIX 安装

下载或自行编译 `glass-canvas-0.2.3.vsix`，然后执行：

```bash
code --install-extension glass-canvas-0.2.3.vsix
```

也可以在 VS Code 中打开“扩展”视图，点击右上角 `…`，选择“从 VSIX 安装…”。

安装或升级后，执行一次 `Developer: Reload Window`。

### 从源码编译

克隆仓库：

```bash
git clone https://github.com/MrSpring521/glass-canvas-vscode.git
cd glass-canvas-vscode
```

安装开发依赖并运行检查：

```bash
npm install
npm test
npm run check
```

生成 VSIX：

```bash
npm run package
```

打包脚本会通过 `npx` 调用 `@vscode/vsce`，生成的 VSIX 位于项目根目录。

## 使用方法

### 快速设置本地背景

1. 按 `Ctrl/Cmd + Shift + P` 打开命令面板。
2. 运行 `Glass Canvas: 快速设置背景`。
3. 选择一张本地图片。
4. 输入背景可见度；建议从 `0.08`–`0.25` 开始。
5. 点击“立即重载”。

设置发生变化后，需要运行 `Glass Canvas: 应用 / 重新应用背景` 并重载窗口。

### 使用 Pixiv 找图

1. 打开任意文件，使编辑器标题栏可见。
2. 点击标题栏右上角的搜索图标；如果空间不足，该按钮可能位于 `…` 菜单中。
3. 输入一个 Tag，例如“风景”或“星空”。
4. 选择不限、1080p、1440p、4K 或 5K 最低分辨率。
5. 使用“上一页”和“下一页”浏览更多结果。
6. 点击缩略图可打开 Pixiv 原作品页。
7. 点击“下载”保存原图，或点击“设为背景”自动下载并应用。

Pixiv 搜索仅请求公开安全分级结果，不读取登录 Cookie。扩展还会在本地过滤受限作品，以及常见成人、裸露、性暗示、猎奇和血腥 Tag。启发式过滤可以降低风险，但不能保证绝对无遗漏。

每页最多加载 24 张缩略图，以控制 Webview 的内存占用。分辨率筛选同时接受横图与竖图，例如选择 1920 × 1080 时也会接受 1080 × 1920。

## 命令

| 命令 | 作用 |
| --- | --- |
| `Glass Canvas: 在 Pixiv 中找背景图` | 打开 Pixiv 搜索面板 |
| `Glass Canvas: 快速设置背景` | 选择本地图片、设置可见度并应用 |
| `Glass Canvas: 选择背景图` | 更新背景图片 |
| `Glass Canvas: 应用 / 重新应用背景` | 将当前配置写入工作台样式 |
| `Glass Canvas: 停用并移除背景` | 移除本扩展注入的样式块 |
| `Glass Canvas: 紧急恢复最近备份` | 用最近的校验通过备份恢复工作台 CSS |
| `Glass Canvas: 打开设置` | 打开扩展设置页 |
| `Glass Canvas: 打开备份目录` | 查看工作台样式备份 |

紧急移除背景快捷键：

- Linux / Windows：`Ctrl+Alt+Shift+F12`
- macOS：`Cmd+Alt+Shift+F12`

## 配置

在 VS Code 设置中搜索 `Glass Canvas`。

| 设置 | 默认值 | 说明 |
| --- | --- | --- |
| `glassCanvas.enabled` | `false` | 是否启用背景；建议通过扩展命令修改 |
| `glassCanvas.image` | 空 | 图片路径、file URI、HTTPS URL 或 data URI |
| `glassCanvas.opacity` | `0.16` | 背景可见度，范围为 `0`–`1` |
| `glassCanvas.scope` | `workbench` | `workbench` 或 `editor` |
| `glassCanvas.size` | `cover` | `cover`、`contain`、`auto` 或 `stretch` |
| `glassCanvas.position` | `center` | 背景对齐位置 |
| `glassCanvas.repeat` | `no-repeat` | 背景重复方式 |
| `glassCanvas.blur` | `0` | 模糊半径，范围为 `0`–`40` px |
| `glassCanvas.brightness` | `1` | 亮度倍数，范围为 `0`–`2` |
| `glassCanvas.saturation` | `1` | 饱和度倍数，范围为 `0`–`3` |
| `glassCanvas.blendMode` | `normal` | `normal`、`soft-light`、`overlay`、`screen` 或 `multiply` |
| `glassCanvas.pixivBlockedTags` | `[]` | 需要额外屏蔽的完整 Pixiv Tag，最多 100 个 |

支持 PNG、JPEG、GIF、WebP、BMP、AVIF 和 ICO。用于背景的单张图片上限为 10 MB；SVG 暂不支持。

## Linux 写入权限

VS Code 官方扩展 API 不提供全工作台背景接口，因此 Glass Canvas 需要修改 VS Code 安装目录中的：

```text
<VS Code appRoot>/out/vs/workbench/workbench.desktop.main.css
```

系统级安装通常不允许普通用户写入该文件。扩展不会自动执行 `sudo`。请根据错误消息中的准确路径，仅向当前用户授予目标 CSS 文件的写权限。例如 Ubuntu/Debian 官方包通常是：

```bash
sudo setfacl -m "u:$USER:rw" /usr/share/code/resources/app/out/vs/workbench/workbench.desktop.main.css
```

授权后重新运行 `Glass Canvas: 应用 / 重新应用背景`。

## 已知限制

- 修改 VS Code 安装文件属于非官方实现，VS Code 可能提示“安装似乎已损坏”。
- VS Code 更新会覆盖背景样式；扩展会在下次启动时提示重新应用。
- macOS 修改应用包可能影响代码签名。
- Web 版 VS Code 不支持；Remote SSH / WSL 场景中扩展运行在本地 UI 侧。
- Pixiv 使用的是其网页接口，不是稳定的扩展 API；站点调整后可能需要更新本扩展。
- Pixiv 图片版权归原作者所有，下载和使用时请遵守作品页标注的规则。

## 故障排查

### 应用时报 `EACCES` 或 `permission denied`

按照“Linux 写入权限”一节，仅向错误消息指出的工作台 CSS 文件授予当前用户写权限，然后重新应用。

### 背景已应用但看不见

1. 检查 `glassCanvas.enabled` 是否为 `true`。
2. 检查 `glassCanvas.opacity`；`0.01` 只有 1% 可见度，推荐先设为 `0.16`。
3. 运行 `Glass Canvas: 应用 / 重新应用背景`。
4. 执行 `Developer: Reload Window`。

### VS Code 更新后背景消失

运行 `Glass Canvas: 应用 / 重新应用背景`。如果扩展检测到旧版补丁，会提示升级或重新应用。

### 如何安全卸载

先运行 `Glass Canvas: 停用并移除背景`，确认重载后背景消失，再卸载扩展。VS Code 不会在扩展卸载时自动撤销安装文件补丁。

如果标记损坏或常规移除失败，可以运行 `Glass Canvas: 紧急恢复最近备份`。该命令会替换整份工作台 CSS，可能覆盖其他美化扩展后续的修改，因此只应作为兜底。

## 开发

主要目录：

```text
src/
├── core.js          # 设置规范化、CSS 生成与补丁处理
├── extension.js     # 扩展激活、命令、备份与工作台写入
├── pixiv.js         # Pixiv 请求、分辨率与安全过滤
└── pixivPanel.js    # Pixiv Webview UI、下载与自动应用

test/
├── core.test.js
├── extension.test.js
└── pixiv.test.js
```

常用命令：

```bash
npm test       # 运行单元与集成测试
npm run check  # 检查 JavaScript 语法
npm run package
```

在 VS Code 中打开项目后按 `F5`，可以启动扩展开发宿主。开发时建议优先运行自动化测试，避免意外修改日常使用的 VS Code 安装文件。

## 许可证

本项目使用 [MIT License](LICENSE)。

Glass Canvas 本身的版权归 MrSpring521 所有。Pixiv 搜索结果中的图片版权归各作品作者所有。
