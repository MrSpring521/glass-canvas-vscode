'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  END_MARKER,
  START_MARKER,
  buildBackgroundCss,
  detectMime,
  hasAnyInjectedCss,
  hasInjectedCss,
  injectCss,
  normalizeSettings,
  removeInjectedCss,
  toDataUri
} = require('../src/core');

const PIXEL = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);
const DATA_URI = toDataUri(PIXEL, 'image/png');

test('normalizes unsafe and out-of-range settings', () => {
  assert.deepEqual(normalizeSettings({
    opacity: 99,
    scope: 'body{}',
    size: 'stretch',
    position: 'center; color:red',
    repeat: 'wat',
    blur: -2,
    brightness: 8,
    saturation: '2',
    blendMode: 'difference'
  }), {
    opacity: 1,
    scope: 'workbench',
    size: 'stretch',
    position: 'center',
    repeat: 'no-repeat',
    blur: 0,
    brightness: 2,
    saturation: 2,
    blendMode: 'normal'
  });
});

test('builds a pointer-safe top-level workbench overlay', () => {
  const css = buildBackgroundCss(DATA_URI, { opacity: 0.2, blur: 4 });
  assert.match(css, /body::after/u);
  assert.match(css, /pointer-events: none/u);
  assert.match(css, /z-index: 1900/u);
  assert.match(css, /opacity: 0\.2/u);
  assert.match(css, /filter: blur\(4px\)/u);
  assert.ok(css.startsWith(START_MARKER));
  assert.ok(css.endsWith(END_MARKER));
});

test('supports editor-only scope and stretch sizing', () => {
  const css = buildBackgroundCss(DATA_URI, { scope: 'editor', size: 'stretch' });
  assert.match(css, /\.part\.editor > \.content::before/u);
  assert.match(css, /position: absolute/u);
  assert.match(css, /background-size: 100% 100%/u);
});

test('injects before source map and replaces an existing block', () => {
  const original = 'body{color:red}\n/*# sourceMappingURL=x.map*/\n';
  const first = injectCss(original, buildBackgroundCss(DATA_URI, { opacity: 0.1 }));
  const second = injectCss(first, buildBackgroundCss(DATA_URI, { opacity: 0.3 }));
  assert.equal(second.split(START_MARKER).length - 1, 1);
  assert.match(second, /opacity: 0\.3/u);
  assert.ok(second.indexOf(END_MARKER) < second.indexOf('sourceMappingURL'));
  assert.equal(removeInjectedCss(second), original);
  assert.equal(hasInjectedCss(second), true);
  assert.equal(hasAnyInjectedCss(second), true);
});

test('recognizes and removes a legacy schema marker', () => {
  const legacy = 'x\n/* GLASS CANVAS:START */\na{}\n/* GLASS CANVAS:END */\ny';
  assert.equal(hasInjectedCss(legacy), false);
  assert.equal(hasAnyInjectedCss(legacy), true);
  assert.equal(removeInjectedCss(legacy), 'xy');
});

test('refuses malformed data URIs and incomplete markers', () => {
  assert.throws(() => buildBackgroundCss('javascript:alert(1)', {}), /data:image/u);
  assert.throws(() => buildBackgroundCss('data:image/svg+xml;base64,PHN2Zz4=', {}), /data:image/u);
  assert.throws(() => removeInjectedCss(`x\n${START_MARKER}\ny`), /不完整/u);
  assert.throws(() => removeInjectedCss(`x\n${END_MARKER}\ny`), /不完整/u);
  const duplicate = `x\n${START_MARKER}\na\n${END_MARKER}\n\n${START_MARKER}\nb\n${END_MARKER}\n`;
  assert.throws(() => removeInjectedCss(duplicate), /重复/u);
  const badBoundary = `x${START_MARKER}\na\n${END_MARKER}\ny`;
  assert.equal(hasInjectedCss(badBoundary), false);
  assert.equal(hasAnyInjectedCss(badBoundary), false);
  assert.throws(() => removeInjectedCss(badBoundary), /边界异常/u);
});

test('detects common image signatures', () => {
  assert.equal(detectMime(PIXEL), 'image/png');
  assert.equal(detectMime(Buffer.from([0xff, 0xd8, 0xff, 0x00])), 'image/jpeg');
  assert.equal(detectMime(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>')), undefined);
});
