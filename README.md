# Glass Canvas — VS Code 自定义背景

**Copyright © 2026 MrSpring521. Released under the MIT License.**

给 VS Code 工作台添加一层可调透明度的背景图。支持本地图片、HTTPS 图片、Pixiv 找图、透明度、模糊、亮度、饱和度、填充方式和混合模式。

## 安装与使用

1. 安装项目根目录中的 `glass-canvas-0.2.3.vsix`。
2. 打开命令面板（`Ctrl/Cmd + Shift + P`）。
3. 运行 **Glass Canvas: 快速设置背景**。
4. 选择图片并输入可见度；推荐从 `0.08` 到 `0.25` 开始。
5. 选择“立即重载”。

也可以在设置中搜索 `Glass Canvas`，精细调整后运行 **Glass Canvas: 应用 / 重新应用背景**。

命令行安装：

```bash
code --install-extension glass-canvas-0.2.3.vsix
```

## Pixiv 找图

打开任意编辑器后，点击编辑器标题栏右上角的搜索图标，即可打开 **Pixiv 找图**：

- 输入一个 Tag，例如“风景”或“星空”。
- 选择不限、1080p、1440p、4K 或 5K 最低分辨率；横图和竖图都会匹配。
- 点击缩略图可打开 Pixiv 原作品页。
- 点击“下载”可保存原图；点击“设为背景”会保存到扩展存储目录并自动重新应用背景。
- 每页最多加载 24 张缩略图，可通过“上一页”和“下一页”浏览 Pixiv 的真实搜索页。

搜索仅请求 Pixiv 的公开安全分级结果，不读取登录 Cookie。扩展还会根据作品限制标记和多语言 Tag，在本地再次过滤成人、裸露、性暗示、猎奇与血腥内容。可以在设置中的 `glassCanvas.pixivBlockedTags` 添加需要额外屏蔽的完整 Tag。启发式过滤无法保证绝对无遗漏。

缩略图会由扩展进程下载并转成 data URI 后交给 Webview。图片版权归原作者所有，请遵守作品页的使用规则。Pixiv 的网页接口并非稳定扩展 API，站点调整后此功能可能需要随版本更新。

## 可调项目

- `image`：绝对路径、`file:` URI、HTTPS URL 或 base64 `data:image` URI。
- `opacity`：背景图可见度，范围 `0`–`1`。
- `scope`：整个工作台，或只显示在编辑器区域。
- `size` / `position` / `repeat`：填充、对齐和重复方式。
- `blur` / `brightness` / `saturation`：滤镜效果。
- `blendMode`：图片和界面的混合方式。

本地和网络图片都会先校验文件特征，再转换成 data URI 写入样式，不会向网页暴露本地文件路径。支持 PNG、JPEG、GIF、WebP、BMP、AVIF 和 ICO，单张图片上限为 10 MB。SVG 暂不支持，以避免图片中引用外部资源。

## 重要说明

VS Code 官方扩展 API 不支持为整个工作台设置背景图片。为了实现这个效果，本扩展会修改：

```text
<VS Code appRoot>/out/vs/workbench/workbench.desktop.main.css
```

因此：

- VS Code 可能提示“安装似乎已损坏”。这是核心文件校验发现样式被修改；扩展不会篡改或关闭校验。
- VS Code 更新会覆盖背景。下次启动时扩展只会提示你是否重新应用，不会静默修改。
- 系统级安装可能没有写权限。扩展不会执行 `sudo` 或自动提权；请只为上述 CSS 文件授予当前用户写权限。
- Web 版 VS Code 不受支持。Remote SSH / WSL 场景中扩展仍在本地 UI 侧执行。
- macOS 修改应用包可能影响签名，建议了解风险后再使用。

运行 **Glass Canvas: 停用并移除背景** 会只删除本扩展带标记的样式块，不会覆盖其他扩展的修改。首次应用前，无本扩展补丁的 CSS 会按 VS Code 版本和 SHA-256 保存到扩展全局存储目录。

恢复方式：

- 常规恢复：运行 **Glass Canvas: 停用并移除背景**。
- 如果高透明度影响操作，按 `Ctrl+Alt+Shift+F12`；macOS 使用 `Cmd+Alt+Shift+F12`。随后按 Enter 可接受“立即重载”。
- 标记损坏时：运行 **Glass Canvas: 紧急恢复最近备份**。它会替换整份 CSS，可能覆盖其他美化扩展后续的修改，因此只作为兜底。
- 查看备份：运行 **Glass Canvas: 打开备份目录**。

卸载扩展前请先执行“停用并移除背景”；VS Code 不会在卸载扩展时自动撤销安装文件补丁。

## 开发

项目没有运行时依赖：

```bash
npm test
npm run check
npm run package
```

调试时在 VS Code 中打开本目录并按 `F5`，然后在扩展开发宿主中运行 Glass Canvas 命令。为避免修改日常使用的 VS Code，请优先执行单元测试，不要在开发宿主里点击“应用”命令。
