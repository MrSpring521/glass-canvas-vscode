'use strict';

const assert = require('node:assert/strict');
const fsp = require('node:fs/promises');
const Module = require('node:module');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

test('activates and registers every command without touching the workbench', () => {
  const originalLoad = Module._load;
  const registered = [];
  const disposable = () => ({ dispose() {} });
  const vscode = {
    workspace: {
      getConfiguration() {
        return {
          get(key, fallback) {
            return key === 'enabled' ? false : fallback;
          },
          async update() {}
        };
      },
      onDidChangeConfiguration() {
        return disposable();
      }
    },
    window: {
      createOutputChannel() {
        return { appendLine() {}, dispose() {}, show() {} };
      }
    },
    commands: {
      registerCommand(identifier) {
        registered.push(identifier);
        return disposable();
      }
    },
    ConfigurationTarget: { Global: 1 },
    env: {},
    UIKind: { Web: 2 }
  };

  Module._load = function mockedLoad(request, parent, isMain) {
    return request === 'vscode' ? vscode : originalLoad(request, parent, isMain);
  };

  try {
    const modulePath = require.resolve('../src/extension');
    delete require.cache[modulePath];
    const extension = require(modulePath);
    const context = {
      subscriptions: [],
      globalState: { get() {}, async update() {} },
      globalStorageUri: {}
    };
    extension.activate(context);

    assert.deepEqual(registered, [
      'glassCanvas.openPixivSearch',
      'glassCanvas.quickSetup',
      'glassCanvas.selectImage',
      'glassCanvas.apply',
      'glassCanvas.disable',
      'glassCanvas.restoreLatestBackup',
      'glassCanvas.openSettings',
      'glassCanvas.openBackupFolder'
    ]);
    assert.equal(context.subscriptions.length, 10);
  } finally {
    Module._load = originalLoad;
  }
});

test('applies and removes a patch against an isolated fake VS Code app', async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'glass-canvas-test-'));
  const appRoot = path.join(root, 'app');
  const workbenchDirectory = path.join(appRoot, 'out', 'vs', 'workbench');
  const cssPath = path.join(workbenchDirectory, 'workbench.desktop.main.css');
  const imagePath = path.join(root, 'wallpaper.png');
  const storagePath = path.join(root, 'storage');
  const originalCss = `.monaco-workbench{color:red}${'x'.repeat(1100)}\n/*# sourceMappingURL=test.map*/\n`;
  await fsp.mkdir(workbenchDirectory, { recursive: true });
  await fsp.writeFile(cssPath, originalCss);
  await fsp.writeFile(imagePath, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));

  const originalLoad = Module._load;
  const handlers = new Map();
  const settings = new Map([
    ['enabled', false],
    ['image', imagePath],
    ['opacity', 0.2],
    ['scope', 'workbench'],
    ['size', 'cover'],
    ['position', 'center'],
    ['repeat', 'no-repeat'],
    ['blur', 0],
    ['brightness', 1],
    ['saturation', 1],
    ['blendMode', 'normal']
  ]);
  const disposable = () => ({ dispose() {} });
  const asUri = fsPath => ({ fsPath, scheme: 'file' });
  const vscode = {
    workspace: {
      workspaceFolders: undefined,
      getConfiguration() {
        return {
          get(key, fallback) {
            return settings.has(key) ? settings.get(key) : fallback;
          },
          async update(key, value) {
            settings.set(key, value);
          }
        };
      },
      onDidChangeConfiguration() {
        return disposable();
      },
      fs: {
        async createDirectory(uri) {
          await fsp.mkdir(uri.fsPath, { recursive: true });
        },
        stat(uri) {
          return fsp.stat(uri.fsPath);
        },
        writeFile(uri, bytes) {
          return fsp.writeFile(uri.fsPath, bytes);
        }
      }
    },
    window: {
      createOutputChannel() {
        return { appendLine() {}, dispose() {}, show() {} };
      },
      withProgress(_options, task) {
        return task();
      },
      async showWarningMessage(_message, optionsOrItem, ...items) {
        const choices = typeof optionsOrItem === 'object' ? items : [optionsOrItem, ...items];
        if (choices.includes('我了解，继续')) {
          return '我了解，继续';
        }
        return choices.includes('恢复备份') ? '恢复备份' : undefined;
      },
      async showInformationMessage() {
        return '稍后';
      },
      async showErrorMessage(message) {
        assert.fail(message);
      }
    },
    commands: {
      registerCommand(identifier, handler) {
        handlers.set(identifier, handler);
        return disposable();
      },
      async executeCommand() {}
    },
    Uri: {
      joinPath(base, ...segments) {
        return asUri(path.join(base.fsPath, ...segments));
      }
    },
    ConfigurationTarget: { Global: 1 },
    ProgressLocation: { Notification: 15 },
    env: { appRoot, uiKind: 1 },
    UIKind: { Desktop: 1, Web: 2 },
    version: '1.134.0-test'
  };

  Module._load = function mockedLoad(request, parent, isMain) {
    return request === 'vscode' ? vscode : originalLoad(request, parent, isMain);
  };

  try {
    const modulePath = require.resolve('../src/extension');
    delete require.cache[modulePath];
    const extension = require(modulePath);
    const globalState = new Map();
    const context = {
      subscriptions: [],
      globalState: {
        get(key) { return globalState.get(key); },
        async update(key, value) { globalState.set(key, value); }
      },
      globalStorageUri: asUri(storagePath)
    };
    extension.activate(context);

    assert.equal(await handlers.get('glassCanvas.apply')(), true);
    const patched = await fsp.readFile(cssPath, 'utf8');
    assert.match(patched, /\/\* GLASS CANVAS:START schema=2 \*\//u);
    assert.equal(settings.get('enabled'), true);

    await handlers.get('glassCanvas.disable')();
    assert.equal(await fsp.readFile(cssPath, 'utf8'), originalCss);
    assert.equal(settings.get('enabled'), false);
    assert.equal((await fsp.readdir(path.join(storagePath, 'backups'))).length, 1);

    assert.equal(await handlers.get('glassCanvas.apply')(), true);
    await fsp.writeFile(cssPath, `.monaco-workbench{${'z'.repeat(1200)}}`);
    assert.equal(await handlers.get('glassCanvas.restoreLatestBackup')(), true);
    assert.equal(await fsp.readFile(cssPath, 'utf8'), originalCss);
    assert.equal(settings.get('enabled'), false);
  } finally {
    Module._load = originalLoad;
    await fsp.rm(root, { recursive: true, force: true });
  }
});
