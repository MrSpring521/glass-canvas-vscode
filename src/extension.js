'use strict';

const crypto = require('node:crypto');
const fsp = require('node:fs/promises');
const https = require('node:https');
const os = require('node:os');
const path = require('node:path');
const { fileURLToPath } = require('node:url');
const vscode = require('vscode');
const {
  ALLOWED_MIME_TYPES,
  MAX_IMAGE_BYTES,
  buildBackgroundCss,
  detectMime,
  hasAnyInjectedCss,
  hasInjectedCss,
  injectCss,
  removeInjectedCss,
  toDataUri
} = require('./core');
const { openPixivSearch } = require('./pixivPanel');

const CONFIG_SECTION = 'glassCanvas';
const CONSENT_KEY = 'unsupportedPatchAccepted';
const OUTPUT_NAME = 'Glass Canvas';
const LOCK_STALE_MS = 5 * 60 * 1000;

let output;
let changingConfiguration = false;
let settingsPromptTimer;

function log(message) {
  output?.appendLine(`[${new Date().toISOString()}] ${message}`);
}

function getConfiguration() {
  return vscode.workspace.getConfiguration(CONFIG_SECTION);
}

function getVisualSettings() {
  const config = getConfiguration();
  return {
    opacity: config.get('opacity'),
    scope: config.get('scope'),
    size: config.get('size'),
    position: config.get('position'),
    repeat: config.get('repeat'),
    blur: config.get('blur'),
    brightness: config.get('brightness'),
    saturation: config.get('saturation'),
    blendMode: config.get('blendMode')
  };
}

async function updateGlobalSetting(key, value) {
  changingConfiguration = true;
  try {
    await getConfiguration().update(key, value, vscode.ConfigurationTarget.Global);
  } finally {
    changingConfiguration = false;
  }
}

async function findWorkbenchCss() {
  if (vscode.env.uiKind === vscode.UIKind.Web || !vscode.env.appRoot) {
    throw new Error('网页版 VS Code 不支持修改工作台背景。');
  }

  const applicationRoot = await fsp.realpath(vscode.env.appRoot);
  const candidates = [path.join(applicationRoot, 'out', 'vs', 'workbench', 'workbench.desktop.main.css')];

  for (const candidate of candidates) {
    try {
      const realCandidate = await fsp.realpath(candidate);
      const relative = path.relative(applicationRoot, realCandidate);
      if (relative.startsWith('..') || path.isAbsolute(relative)) {
        throw new Error('工作台样式文件位于 VS Code 应用目录之外。');
      }
      const stat = await fsp.stat(realCandidate);
      if (stat.isFile() && stat.size >= 1024 && stat.size <= 50 * 1024 * 1024) {
        return realCandidate;
      }
    } catch {
      // Continue with the next known layout.
    }
  }
  throw new Error(`找不到 VS Code 工作台样式文件。应用目录：${vscode.env.appRoot}`);
}

function resolveLocalPath(value) {
  if (value.startsWith('file:')) {
    return fileURLToPath(value);
  }
  if (value === '~') {
    return os.homedir();
  }
  if (value.startsWith(`~${path.sep}`) || value.startsWith('~/') || value.startsWith('~\\')) {
    return path.join(os.homedir(), value.slice(2));
  }
  if (path.isAbsolute(value)) {
    return value;
  }

  const localWorkspace = vscode.workspace.workspaceFolders?.find(folder => folder.uri.scheme === 'file');
  if (!localWorkspace) {
    throw new Error('相对图片路径需要一个本地工作区；推荐使用“选择背景图”命令。');
  }
  return path.resolve(localWorkspace.uri.fsPath, value);
}

async function readLocalImage(value) {
  const imagePath = resolveLocalPath(value);
  const stat = await fsp.stat(imagePath);
  if (!stat.isFile()) {
    throw new Error(`背景图不是文件：${imagePath}`);
  }
  if (stat.size > MAX_IMAGE_BYTES) {
    throw new Error(`背景图不能超过 ${MAX_IMAGE_BYTES / 1024 / 1024} MB。`);
  }
  const buffer = await fsp.readFile(imagePath);
  const mime = detectMime(buffer);
  return toDataUri(buffer, mime);
}

function downloadHttps(url, redirectsLeft = 5) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const succeed = value => {
      if (!settled) {
        settled = true;
        resolve(value);
      }
    };
    const fail = error => {
      if (!settled) {
        settled = true;
        reject(error);
      }
    };

    const request = https.get(url, {
      headers: {
        'User-Agent': 'Glass-Canvas-VSCode/0.2.3',
        Accept: 'image/*'
      },
      timeout: 15_000
    }, response => {
      const status = response.statusCode || 0;
      if (status >= 300 && status < 400 && response.headers.location) {
        response.resume();
        if (redirectsLeft === 0) {
          fail(new Error('背景图 URL 重定向次数过多。'));
          return;
        }
        const redirect = new URL(response.headers.location, url);
        if (redirect.protocol !== 'https:') {
          fail(new Error('为保护隐私，远程背景图及其重定向必须使用 HTTPS。'));
          return;
        }
        downloadHttps(redirect, redirectsLeft - 1).then(succeed, fail);
        return;
      }
      if (status !== 200) {
        response.resume();
        fail(new Error(`下载背景图失败：HTTP ${status}`));
        return;
      }

      const declaredLength = Number(response.headers['content-length'] || 0);
      if (declaredLength > MAX_IMAGE_BYTES) {
        response.resume();
        fail(new Error(`背景图不能超过 ${MAX_IMAGE_BYTES / 1024 / 1024} MB。`));
        return;
      }

      const chunks = [];
      let length = 0;
      response.on('data', chunk => {
        length += chunk.length;
        if (length > MAX_IMAGE_BYTES) {
          const error = new Error(`背景图不能超过 ${MAX_IMAGE_BYTES / 1024 / 1024} MB。`);
          fail(error);
          response.destroy(error);
          return;
        }
        chunks.push(chunk);
      });
      response.on('end', () => {
        if (settled) {
          return;
        }
        const buffer = Buffer.concat(chunks);
        const mime = detectMime(buffer);
        try {
          succeed(toDataUri(buffer, mime));
        } catch (error) {
          fail(error);
        }
      });
      response.on('error', fail);
    });
    request.on('timeout', () => {
      const error = new Error('下载背景图超时。');
      fail(error);
      request.destroy(error);
    });
    request.on('error', fail);
  });
}

async function resolveImageSource(value) {
  const source = String(value || '').trim();
  if (!source) {
    throw new Error('尚未选择背景图。');
  }
  if (/^data:image\//i.test(source)) {
    const match = /^data:(image\/[a-z0-9.+-]+);base64,([a-z0-9+/=]+)$/i.exec(source);
    if (!match || !ALLOWED_MIME_TYPES.has(match[1].toLowerCase())) {
      throw new Error('data:image URI 必须使用受支持格式的 base64 编码。');
    }
    const payload = match[2];
    const buffer = Buffer.from(payload, 'base64');
    const detectedMime = detectMime(buffer);
    return toDataUri(buffer, detectedMime);
  }
  if (/^https:\/\//i.test(source)) {
    return downloadHttps(new URL(source));
  }
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(source) && !source.startsWith('file:')) {
    throw new Error('远程背景图仅支持 HTTPS URL。');
  }
  return readLocalImage(source);
}

async function ensureBackup(context, cssPath, contents) {
  const backupDirectory = path.join(context.globalStorageUri.fsPath, 'backups');
  await fsp.mkdir(backupDirectory, { recursive: true });
  const hash = sha256(contents);
  const backup = path.join(backupDirectory, `${backupFilePrefix(cssPath)}${hash}.css`);
  try {
    const existing = await fsp.readFile(backup, 'utf8');
    if (sha256(existing) !== hash) {
      throw new Error(`现有备份校验失败：${backup}`);
    }
    return backup;
  } catch (error) {
    if (error?.code !== 'ENOENT') {
      throw error;
    }
  }

  const temporary = `${backup}.${process.pid}-${crypto.randomUUID()}.tmp`;
  let handle;
  try {
    handle = await fsp.open(temporary, 'wx', 0o600);
    await handle.writeFile(contents, 'utf8');
    await handle.sync();
    await handle.close();
    handle = undefined;
    await fsp.rename(temporary, backup);
  } catch (error) {
    await handle?.close().catch(() => undefined);
    await fsp.rm(temporary, { force: true }).catch(() => undefined);
    throw error;
  }

  const verification = await fsp.readFile(backup, 'utf8');
  if (sha256(verification) !== hash) {
    throw new Error(`备份写入校验失败：${backup}`);
  }
  log(`已备份无 Glass Canvas 补丁的工作台样式：${backup}`);
  return backup;
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function backupFilePrefix(cssPath) {
  const safeVersion = vscode.version.replace(/[^a-z0-9._-]/gi, '_');
  const targetHash = sha256(cssPath).slice(0, 12);
  return `workbench-${safeVersion}-${targetHash}-`;
}

function isProcessRunning(pid) {
  if (!Number.isInteger(pid) || pid <= 0) {
    return false;
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === 'EPERM';
  }
}

async function withPatchLock(cssPath, task) {
  const targetHash = sha256(cssPath).slice(0, 24);
  const lockPath = path.join(os.tmpdir(), `glass-canvas-${targetHash}.lock`);
  let handle;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      handle = await fsp.open(lockPath, 'wx', 0o600);
      break;
    } catch (error) {
      if (error?.code !== 'EEXIST') {
        throw error;
      }

      let stale = false;
      try {
        const [metadata, stat] = await Promise.all([
          fsp.readFile(lockPath, 'utf8').then(JSON.parse).catch(() => ({})),
          fsp.stat(lockPath)
        ]);
        stale = Date.now() - stat.mtimeMs > LOCK_STALE_MS && !isProcessRunning(metadata.pid);
      } catch (inspectionError) {
        stale = inspectionError?.code === 'ENOENT';
      }

      if (stale && attempt === 0) {
        await fsp.rm(lockPath, { force: true });
        continue;
      }
      const busy = new Error('另一个 VS Code 窗口正在修改同一份工作台样式，请稍后重试。');
      busy.code = 'GLASS_CANVAS_BUSY';
      throw busy;
    }
  }

  if (!handle) {
    throw new Error('无法取得 Glass Canvas 写入锁。');
  }

  try {
    await handle.writeFile(JSON.stringify({ pid: process.pid, createdAt: new Date().toISOString(), cssPath }));
    await handle.sync();
    return await task();
  } finally {
    await handle.close().catch(() => undefined);
    await fsp.rm(lockPath, { force: true }).catch(() => undefined);
  }
}

async function replaceFile(cssPath, expectedCurrent, contents) {
  let handle;
  try {
    handle = await fsp.open(cssPath, 'r+');

    const latest = await fsp.readFile(cssPath, 'utf8');
    if (latest !== expectedCurrent) {
      throw new Error('工作台样式在写入期间被其他进程修改，已安全中止；请重新执行命令。');
    }

    const bytes = Buffer.from(contents, 'utf8');
    let offset = 0;
    while (offset < bytes.length) {
      const { bytesWritten } = await handle.write(bytes, offset, bytes.length - offset, offset);
      if (bytesWritten === 0) {
        throw new Error('写入工作台样式时没有取得进展。');
      }
      offset += bytesWritten;
    }
    await handle.truncate(bytes.length);
    await handle.sync();
  } catch (error) {
    await handle?.close().catch(() => undefined);
    handle = undefined;
    if (error instanceof Error) {
      error.glassCanvasWorkbenchPath = cssPath;
    }
    throw error;
  } finally {
    await handle?.close().catch(() => undefined);
  }

  const verification = await fsp.readFile(cssPath, 'utf8');
  if (verification !== contents) {
    const error = new Error('写入后的工作台样式校验失败；原文件备份仍保存在扩展存储目录。');
    error.glassCanvasWorkbenchPath = cssPath;
    throw error;
  }
}

async function confirmUnsupportedPatch(context) {
  if (context.globalState.get(CONSENT_KEY) === true) {
    return true;
  }

  const accept = '我了解，继续';
  const choice = await vscode.window.showWarningMessage(
    'VS Code 没有官方全局背景图 API。Glass Canvas 需要修改一份安装样式文件；这可能触发“安装已损坏”提示，且更新后需要重新应用。',
    { modal: true },
    accept
  );
  if (choice !== accept) {
    return false;
  }
  await context.globalState.update(CONSENT_KEY, true);
  return true;
}

function describeWriteFailure(error) {
  if (
    error?.glassCanvasWorkbenchPath
    && (error?.code === 'EACCES' || error?.code === 'EPERM' || error?.code === 'EROFS')
  ) {
    return `没有权限写入 VS Code 安装文件：${error.glassCanvasWorkbenchPath}。请仅为这个文件授予当前用户写权限，然后重新应用；扩展不会自动提权。`;
  }
  return error instanceof Error ? error.message : String(error);
}

async function promptReload(message) {
  const reload = '立即重载';
  const choice = await vscode.window.showInformationMessage(message, reload, '稍后');
  if (choice === reload) {
    await vscode.commands.executeCommand('workbench.action.reloadWindow');
  }
}

async function applyBackground(context, options = {}) {
  try {
    if (!(await confirmUnsupportedPatch(context))) {
      return false;
    }

    const cssPath = await findWorkbenchCss();
    const imageDataUri = await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: 'Glass Canvas：正在准备背景图…'
      },
      () => resolveImageSource(getConfiguration().get('image'))
    );
    const generated = buildBackgroundCss(imageDataUri, getVisualSettings());
    const changed = await withPatchLock(cssPath, async () => {
      const current = await fsp.readFile(cssPath, 'utf8');
      const baseline = removeInjectedCss(current);
      await ensureBackup(context, cssPath, baseline);
      const next = injectCss(current, generated);
      if (next === current) {
        return false;
      }
      await replaceFile(cssPath, current, next);
      log(`已应用背景：${cssPath}`);
      return true;
    });
    await updateGlobalSetting('enabled', true);

    if (!options.quiet) {
      await promptReload(changed ? '背景已应用，重载窗口后生效。' : '背景配置没有变化。');
    }
    return true;
  } catch (error) {
    const message = describeWriteFailure(error);
    log(`应用失败：${error?.stack || error}`);
    const showLog = '查看日志';
    const choice = await vscode.window.showErrorMessage(`Glass Canvas：${message}`, showLog);
    if (choice === showLog) {
      output.show(true);
    }
    return false;
  }
}

async function disableBackground(context) {
  try {
    const cssPath = await findWorkbenchCss();
    const changed = await withPatchLock(cssPath, async () => {
      const current = await fsp.readFile(cssPath, 'utf8');
      const next = removeInjectedCss(current);
      if (next === current) {
        return false;
      }
      await replaceFile(cssPath, current, next);
      log(`已移除背景：${cssPath}`);
      return true;
    });
    await updateGlobalSetting('enabled', false);
    await promptReload(changed ? '背景已移除，重载窗口后生效。' : '未检测到已注入的背景样式。');
  } catch (error) {
    const message = describeWriteFailure(error);
    log(`移除失败：${error?.stack || error}`);
    await vscode.window.showErrorMessage(`Glass Canvas：${message}`);
  }
}

async function pickImage() {
  const selection = await vscode.window.showOpenDialog({
    canSelectFiles: true,
    canSelectFolders: false,
    canSelectMany: false,
    title: '选择 Glass Canvas 背景图',
    filters: {
      '图片': ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'avif', 'ico']
    }
  });
  if (!selection?.[0]) {
    return undefined;
  }
  if (selection[0].scheme !== 'file') {
    await vscode.window.showErrorMessage('Glass Canvas 目前只支持从本机文件系统选择图片。');
    return undefined;
  }
  return selection[0].fsPath;
}

async function selectImage() {
  const image = await pickImage();
  if (image) {
    await updateGlobalSetting('image', image);
  }
  return image;
}

async function quickSetup(context) {
  const image = await pickImage();
  if (!image) {
    return;
  }
  const currentOpacity = getConfiguration().get('opacity', 0.16);
  const input = await vscode.window.showInputBox({
    title: '设置背景图可见度',
    prompt: '输入 0–1；推荐 0.08–0.25，以免影响代码阅读。',
    value: String(currentOpacity),
    validateInput(value) {
      if (value.trim() === '') {
        return '请输入 0 到 1 之间的数字。';
      }
      const number = Number(value);
      return Number.isFinite(number) && number >= 0 && number <= 1 ? undefined : '请输入 0 到 1 之间的数字。';
    }
  });
  if (input === undefined) {
    return;
  }
  await updateGlobalSetting('image', image);
  await updateGlobalSetting('opacity', Number(input));
  await applyBackground(context);
}

async function findLatestBackup(context, cssPath) {
  const directory = path.join(context.globalStorageUri.fsPath, 'backups');
  const prefix = backupFilePrefix(cssPath);
  let names;
  try {
    names = await fsp.readdir(directory);
  } catch (error) {
    if (error?.code === 'ENOENT') {
      throw new Error('当前 VS Code 版本还没有可用备份。');
    }
    throw error;
  }

  const candidates = await Promise.all(
    names
      .filter(name => name.startsWith(prefix) && name.endsWith('.css'))
      .map(async name => {
        const backupPath = path.join(directory, name);
        const stat = await fsp.stat(backupPath);
        return { backupPath, mtimeMs: stat.mtimeMs, name };
      })
  );
  candidates.sort((left, right) => right.mtimeMs - left.mtimeMs);

  for (const candidate of candidates) {
    const expectedHash = candidate.name.slice(prefix.length, -'.css'.length);
    const contents = await fsp.readFile(candidate.backupPath, 'utf8');
    if (/^[a-f0-9]{64}$/u.test(expectedHash) && sha256(contents) === expectedHash) {
      return { ...candidate, contents };
    }
    log(`忽略校验失败的备份：${candidate.backupPath}`);
  }
  throw new Error('当前 VS Code 版本没有通过完整性校验的备份。');
}

async function restoreLatestBackup(context) {
  try {
    const cssPath = await findWorkbenchCss();
    const backup = await findLatestBackup(context, cssPath);
    const restore = '恢复备份';
    const choice = await vscode.window.showWarningMessage(
      '紧急恢复会用当前 VS Code 版本的最近备份替换整份工作台 CSS，可能覆盖其他美化扩展之后的修改。通常应优先使用“停用并移除背景”。',
      { modal: true },
      restore
    );
    if (choice !== restore) {
      return false;
    }

    const changed = await withPatchLock(cssPath, async () => {
      const current = await fsp.readFile(cssPath, 'utf8');
      if (current === backup.contents) {
        return false;
      }
      await replaceFile(cssPath, current, backup.contents);
      log(`已从备份恢复工作台样式：${backup.backupPath}`);
      return true;
    });
    await updateGlobalSetting('enabled', false);
    await promptReload(changed ? '备份已恢复，重载窗口后生效。' : '工作台样式已经与备份一致。');
    return true;
  } catch (error) {
    const message = describeWriteFailure(error);
    log(`恢复备份失败：${error?.stack || error}`);
    await vscode.window.showErrorMessage(`Glass Canvas：${message}`);
    return false;
  }
}

async function checkAfterUpdate(context) {
  try {
    const cssPath = await findWorkbenchCss();
    const current = await fsp.readFile(cssPath, 'utf8');
    const enabled = getConfiguration().get('enabled');
    const currentPatch = hasInjectedCss(current);
    const anyPatch = hasAnyInjectedCss(current);
    const malformedPatch = current.includes('GLASS CANVAS:') && !anyPatch;

    if (malformedPatch) {
      const restore = '紧急恢复备份';
      const choice = await vscode.window.showErrorMessage(
        '检测到不完整或重复的 Glass Canvas 样式标记。为保护 VS Code，扩展不会自动改写该文件。',
        restore
      );
      if (choice === restore) {
        await restoreLatestBackup(context);
      }
      return;
    }

    if (enabled && !currentPatch) {
      const apply = '重新应用';
      const reason = anyPatch
        ? 'Glass Canvas 检测到旧版背景样式，需要升级后才能继续使用。'
        : 'Glass Canvas 背景样式已不存在，通常是因为 VS Code 刚完成更新。';
      const choice = await vscode.window.showWarningMessage(reason, apply, '忽略');
      if (choice === apply) {
        await applyBackground(context);
      }
      return;
    }

    if (!enabled && anyPatch) {
      const remove = '移除背景';
      const choice = await vscode.window.showInformationMessage(
        'Glass Canvas 设置为关闭，但工作台中仍有背景样式。',
        remove,
        '保留'
      );
      if (choice === remove) {
        await disableBackground(context);
      }
    }
  } catch (error) {
    log(`启动检查失败：${error?.stack || error}`);
  }
}

async function openBackupFolder(context) {
  const backupDirectory = vscode.Uri.joinPath(context.globalStorageUri, 'backups');
  await vscode.workspace.fs.createDirectory(backupDirectory);
  await vscode.commands.executeCommand('revealFileInOS', backupDirectory);
}

function activate(context) {
  output = vscode.window.createOutputChannel(OUTPUT_NAME);
  context.subscriptions.push(output);

  const commands = [
    vscode.commands.registerCommand('glassCanvas.openPixivSearch', () => openPixivSearch(context, async imagePath => {
      await updateGlobalSetting('image', imagePath);
      return applyBackground(context);
    })),
    vscode.commands.registerCommand('glassCanvas.quickSetup', () => quickSetup(context)),
    vscode.commands.registerCommand('glassCanvas.selectImage', async () => {
      const image = await selectImage();
      if (image && getConfiguration().get('enabled')) {
        await applyBackground(context);
      }
    }),
    vscode.commands.registerCommand('glassCanvas.apply', () => applyBackground(context)),
    vscode.commands.registerCommand('glassCanvas.disable', () => disableBackground(context)),
    vscode.commands.registerCommand('glassCanvas.restoreLatestBackup', () => restoreLatestBackup(context)),
    vscode.commands.registerCommand('glassCanvas.openSettings', () => {
      vscode.commands.executeCommand('workbench.action.openSettings', '@ext:glass-canvas-local.glass-canvas');
    }),
    vscode.commands.registerCommand('glassCanvas.openBackupFolder', () => openBackupFolder(context))
  ];
  context.subscriptions.push(...commands);

  context.subscriptions.push(vscode.workspace.onDidChangeConfiguration(event => {
    if (changingConfiguration || !event.affectsConfiguration(CONFIG_SECTION)) {
      return;
    }
    clearTimeout(settingsPromptTimer);
    settingsPromptTimer = setTimeout(async () => {
      if (getConfiguration().get('enabled')) {
        const apply = '立即应用';
        const choice = await vscode.window.showInformationMessage('Glass Canvas 设置已更改，需要重新应用才能生效。', apply);
        if (choice === apply) {
          await applyBackground(context);
        }
      } else {
        await checkAfterUpdate(context);
      }
    }, 600);
  }));

  checkAfterUpdate(context);
}

function deactivate() {
  clearTimeout(settingsPromptTimer);
  settingsPromptTimer = undefined;
  output = undefined;
}

module.exports = { activate, deactivate };
