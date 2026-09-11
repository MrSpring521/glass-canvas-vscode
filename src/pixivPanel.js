'use strict';

const crypto = require('node:crypto');
const os = require('node:os');
const path = require('node:path');
const vscode = require('vscode');
const { MAX_IMAGE_BYTES } = require('./core');
const { downloadPixivArtwork, extensionForMime, searchPixiv } = require('./pixiv');

let activePanel;

function safeFileName(title, id, extension) {
  const stem = String(title || 'pixiv')
    .replace(/[\\/:*?"<>|\u0000-\u001f]/gu, '_')
    .replace(/\s+/gu, ' ')
    .trim()
    .slice(0, 70) || 'pixiv';
  return `${stem}-${id}.${extension}`;
}

async function downloadForBackground(artworkId) {
  try {
    return await downloadPixivArtwork(artworkId, 'original', MAX_IMAGE_BYTES);
  } catch (originalError) {
    try {
      return await downloadPixivArtwork(artworkId, 'regular', MAX_IMAGE_BYTES);
    } catch {
      throw originalError;
    }
  }
}

async function saveDownloadedImage(artwork) {
  const downloaded = await vscode.window.withProgress({
    location: vscode.ProgressLocation.Notification,
    title: `Glass Canvas：正在下载「${artwork.title}」…`
  }, () => downloadPixivArtwork(artwork.id));
  const extension = extensionForMime(downloaded.mime);
  const defaultUri = vscode.Uri.file(path.join(os.homedir(), safeFileName(artwork.title, artwork.id, extension)));
  const target = await vscode.window.showSaveDialog({
    title: '保存 Pixiv 图片',
    defaultUri,
    filters: { '图片': [extension] }
  });
  if (!target) {
    return false;
  }
  await vscode.workspace.fs.writeFile(target, downloaded.buffer);
  await vscode.window.showInformationMessage(`Glass Canvas：图片已保存到 ${target.fsPath || target.toString()}`);
  return true;
}

async function storeBackgroundImage(context, artwork) {
  const downloaded = await vscode.window.withProgress({
    location: vscode.ProgressLocation.Notification,
    title: `Glass Canvas：正在准备「${artwork.title}」…`
  }, () => downloadForBackground(artwork.id));
  const extension = extensionForMime(downloaded.mime);
  const directory = vscode.Uri.joinPath(context.globalStorageUri, 'pixiv-backgrounds');
  await vscode.workspace.fs.createDirectory(directory);
  const target = vscode.Uri.joinPath(directory, `${artwork.id}-p0.${extension}`);
  await vscode.workspace.fs.writeFile(target, downloaded.buffer);
  return target.fsPath;
}

function getNonce() {
  return crypto.randomBytes(18).toString('base64url');
}

function getWebviewHtml(webview) {
  const nonce = getNonce();
  const csp = [
    "default-src 'none'",
    "img-src data:",
    `style-src 'nonce-${nonce}'`,
    `script-src 'nonce-${nonce}'`
  ].join('; ');
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="${csp}">
  <title>Pixiv 找图</title>
  <style nonce="${nonce}">
    :root { color-scheme: light dark; }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      padding: 20px;
      color: var(--vscode-foreground);
      background: var(--vscode-editor-background);
      font-family: var(--vscode-font-family);
    }
    .shell { max-width: 1180px; margin: 0 auto; }
    h1 { margin: 0 0 6px; font-size: 22px; font-weight: 650; }
    .subtitle { margin: 0 0 18px; color: var(--vscode-descriptionForeground); }
    form {
      position: sticky;
      top: 0;
      z-index: 2;
      display: grid;
      grid-template-columns: minmax(180px, 1fr) minmax(150px, 220px) auto;
      gap: 10px;
      padding: 12px;
      border: 1px solid var(--vscode-panel-border);
      border-radius: 8px;
      background: var(--vscode-editorWidget-background);
      box-shadow: 0 6px 20px color-mix(in srgb, var(--vscode-widget-shadow) 28%, transparent);
    }
    input, select, button {
      min-height: 34px;
      border: 1px solid var(--vscode-input-border, transparent);
      border-radius: 4px;
      font: inherit;
    }
    input, select {
      padding: 6px 9px;
      color: var(--vscode-input-foreground);
      background: var(--vscode-input-background);
      outline: none;
    }
    input:focus, select:focus { border-color: var(--vscode-focusBorder); }
    button {
      padding: 6px 12px;
      color: var(--vscode-button-foreground);
      background: var(--vscode-button-background);
      cursor: pointer;
    }
    button:hover { background: var(--vscode-button-hoverBackground); }
    button.secondary {
      color: var(--vscode-button-secondaryForeground);
      background: var(--vscode-button-secondaryBackground);
    }
    button.secondary:hover { background: var(--vscode-button-secondaryHoverBackground); }
    button:disabled { opacity: .55; cursor: wait; }
    #status { min-height: 42px; padding: 13px 2px 9px; color: var(--vscode-descriptionForeground); }
    #status.error { color: var(--vscode-errorForeground); }
    .pagination { display: flex; align-items: center; justify-content: center; gap: 10px; margin: 2px 0 14px; }
    .pagination[hidden] { display: none; }
    .pagination button { min-width: 92px; }
    #page-label { min-width: 120px; color: var(--vscode-descriptionForeground); text-align: center; }
    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
      gap: 14px;
    }
    .card {
      overflow: hidden;
      border: 1px solid var(--vscode-panel-border);
      border-radius: 8px;
      background: var(--vscode-sideBar-background);
    }
    .preview {
      display: grid;
      width: 100%;
      aspect-ratio: 1 / 1;
      place-items: center;
      border: 0;
      border-radius: 0;
      padding: 0;
      background: var(--vscode-editorWidget-background);
      overflow: hidden;
    }
    .preview img { width: 100%; height: 100%; object-fit: cover; }
    .missing { color: var(--vscode-descriptionForeground); }
    .body { padding: 11px; }
    .title { overflow: hidden; margin: 0 0 5px; font-weight: 650; text-overflow: ellipsis; white-space: nowrap; }
    .meta { overflow: hidden; margin-bottom: 10px; color: var(--vscode-descriptionForeground); font-size: 12px; text-overflow: ellipsis; white-space: nowrap; }
    .actions { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
    .notice {
      margin-top: 18px;
      padding-top: 12px;
      border-top: 1px solid var(--vscode-panel-border);
      color: var(--vscode-descriptionForeground);
      font-size: 12px;
      line-height: 1.6;
    }
    @media (max-width: 620px) {
      body { padding: 12px; }
      form { grid-template-columns: 1fr; }
      .grid { grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); }
    }
  </style>
</head>
<body>
  <main class="shell">
    <h1>Pixiv 找图</h1>
    <p class="subtitle">搜索公开、安全分级的插画；工作模式会再次过滤成人与猎奇 Tag。</p>
    <form id="search-form">
      <input id="tag" name="tag" maxlength="100" value="风景" aria-label="Pixiv Tag" placeholder="输入 Tag，例如：风景、星空" autofocus>
      <select id="resolution" name="resolution" aria-label="最低分辨率">
        <option value="any">不限分辨率</option>
        <option value="1920x1080">至少 1920 × 1080</option>
        <option value="2560x1440">至少 2560 × 1440</option>
        <option value="3840x2160">至少 3840 × 2160</option>
        <option value="5120x2880">至少 5120 × 2880</option>
      </select>
      <button id="search-button" type="submit">搜索</button>
    </form>
    <div id="status">输入 Tag 后开始搜索。</div>
    <nav id="pagination" class="pagination" aria-label="搜索结果分页" hidden>
      <button id="previous-page" class="secondary" type="button">← 上一页</button>
      <span id="page-label">第 1 页</span>
      <button id="next-page" class="secondary" type="button">下一页 →</button>
    </nav>
    <section id="results" class="grid" aria-live="polite"></section>
    <p class="notice">工作模式采用分级标记与 Tag 双重过滤，但无法保证绝对无遗漏。图片版权归原作者所有；下载和使用时请遵守 Pixiv 作品页面标注的使用规则。<br>Glass Canvas © 2026 MrSpring521 · MIT License</p>
  </main>
  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    const form = document.getElementById('search-form');
    const tagInput = document.getElementById('tag');
    const resolutionSelect = document.getElementById('resolution');
    const searchButton = document.getElementById('search-button');
    const status = document.getElementById('status');
    const results = document.getElementById('results');
    const pagination = document.getElementById('pagination');
    const previousPage = document.getElementById('previous-page');
    const nextPage = document.getElementById('next-page');
    const pageLabel = document.getElementById('page-label');
    const previous = vscode.getState();
    if (previous?.tag) tagInput.value = previous.tag;
    if (previous?.resolution) resolutionSelect.value = previous.resolution;
    let currentPage = 1;
    let totalPages = 1;
    let searchedTag = previous?.tag || tagInput.value;
    let searchedResolution = previous?.resolution || resolutionSelect.value;

    function setStatus(message, error = false) {
      status.textContent = message;
      status.classList.toggle('error', error);
    }

    function setSearching(searching) {
      searchButton.disabled = searching;
      searchButton.textContent = searching ? '搜索中…' : '搜索';
      previousPage.disabled = searching || currentPage <= 1;
      nextPage.disabled = searching || currentPage >= totalPages;
    }

    function requestSearch(page, useFormValues) {
      if (useFormValues) {
        searchedTag = tagInput.value.trim();
        searchedResolution = resolutionSelect.value;
      }
      if (!searchedTag) {
        setStatus('请输入要搜索的 Tag。', true);
        tagInput.focus();
        return;
      }
      currentPage = Math.max(1, page);
      vscode.setState({ tag: searchedTag, resolution: searchedResolution, page: currentPage });
      setSearching(true);
      setStatus('正在加载第 ' + currentPage + ' 页…');
      results.replaceChildren();
      vscode.postMessage({
        type: 'search',
        tag: searchedTag,
        resolution: searchedResolution,
        page: currentPage
      });
    }

    function actionButton(label, secondary, handler) {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = label;
      if (secondary) button.className = 'secondary';
      button.addEventListener('click', handler);
      return button;
    }

    function render(items) {
      results.replaceChildren();
      for (const item of items) {
        const card = document.createElement('article');
        card.className = 'card';
        const preview = document.createElement('button');
        preview.type = 'button';
        preview.className = 'preview';
        preview.title = '在 Pixiv 打开原作品';
        preview.addEventListener('click', () => vscode.postMessage({ type: 'open', id: item.id }));
        if (item.thumbnailDataUri) {
          const image = document.createElement('img');
          image.src = item.thumbnailDataUri;
          image.alt = item.title;
          preview.append(image);
        } else {
          const missing = document.createElement('span');
          missing.className = 'missing';
          missing.textContent = '缩略图加载失败';
          preview.append(missing);
        }
        const body = document.createElement('div');
        body.className = 'body';
        const title = document.createElement('p');
        title.className = 'title';
        title.textContent = item.title;
        title.title = item.title;
        const meta = document.createElement('div');
        meta.className = 'meta';
        meta.textContent = item.width + ' × ' + item.height + ' · ' + item.author + (item.pageCount > 1 ? ' · ' + item.pageCount + ' 张' : '');
        const actions = document.createElement('div');
        actions.className = 'actions';
        actions.append(
          actionButton('下载', true, () => vscode.postMessage({ type: 'download', artwork: item })),
          actionButton('设为背景', false, () => vscode.postMessage({ type: 'apply', artwork: item }))
        );
        body.append(title, meta, actions);
        card.append(preview, body);
        results.append(card);
      }
    }

    form.addEventListener('submit', event => {
      event.preventDefault();
      totalPages = 1;
      requestSearch(1, true);
    });
    previousPage.addEventListener('click', () => requestSearch(currentPage - 1, false));
    nextPage.addEventListener('click', () => requestSearch(currentPage + 1, false));

    window.addEventListener('message', event => {
      const message = event.data;
      if (message.type === 'results') {
        currentPage = message.page;
        totalPages = message.totalPages;
        setSearching(false);
        render(message.items);
        pagination.hidden = false;
        pageLabel.textContent = '第 ' + currentPage + ' / ' + totalPages + ' 页';
        setStatus(
          message.items.length
            ? '本页找到 ' + message.items.length + ' 张符合条件的图片；Pixiv 共 ' + message.total + ' 条原始结果。'
            : '第 ' + currentPage + ' 页没有符合分辨率与安全条件的图片，可以继续翻页。'
        );
      } else if (message.type === 'error') {
        setSearching(false);
        setStatus(message.message, true);
      } else if (message.type === 'action') {
        setStatus(message.message, Boolean(message.error));
      }
    });
  </script>
</body>
</html>`;
}

function isArtworkMessage(value) {
  return value
    && /^\d+$/u.test(String(value.id))
    && typeof value.title === 'string'
    && value.title.length <= 300;
}

async function openPixivSearch(context, applyImage) {
  if (activePanel) {
    activePanel.reveal(vscode.ViewColumn.Beside);
    return;
  }
  const panel = vscode.window.createWebviewPanel(
    'glassCanvas.pixivSearch',
    'Pixiv 找图',
    vscode.ViewColumn.Beside,
    { enableScripts: true, retainContextWhenHidden: true }
  );
  activePanel = panel;
  panel.webview.html = getWebviewHtml(panel.webview);
  panel.onDidDispose(() => {
    if (activePanel === panel) {
      activePanel = undefined;
    }
  }, undefined, context.subscriptions);

  panel.webview.onDidReceiveMessage(async message => {
    try {
      if (message?.type === 'search') {
        const blockedTags = vscode.workspace.getConfiguration('glassCanvas').get('pixivBlockedTags', []);
        const result = await searchPixiv(message.tag, message.resolution, blockedTags, message.page);
        await panel.webview.postMessage({ type: 'results', ...result });
        return;
      }
      if (message?.type === 'open' && /^\d+$/u.test(String(message.id))) {
        await vscode.env.openExternal(vscode.Uri.parse(`https://www.pixiv.net/artworks/${message.id}`));
        return;
      }
      if (!isArtworkMessage(message?.artwork)) {
        throw new Error('无效的 Pixiv 作品信息。');
      }
      if (message.type === 'download') {
        const saved = await saveDownloadedImage(message.artwork);
        await panel.webview.postMessage({
          type: 'action',
          message: saved ? '图片下载完成。' : '已取消下载。'
        });
        return;
      }
      if (message.type === 'apply') {
        const imagePath = await storeBackgroundImage(context, message.artwork);
        const applied = await applyImage(imagePath);
        await panel.webview.postMessage({
          type: 'action',
          error: !applied,
          message: applied ? '背景已写入；按提示重载窗口后生效。' : '背景应用未完成，请查看 VS Code 通知。'
        });
      }
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      await panel.webview.postMessage({
        type: message?.type === 'search' ? 'error' : 'action',
        error: true,
        message: `Glass Canvas：${detail}`
      });
    }
  }, undefined, context.subscriptions);
}

module.exports = { getWebviewHtml, openPixivSearch, safeFileName };
