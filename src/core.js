'use strict';

const PATCH_SCHEMA = 2;
const START_MARKER = `/* GLASS CANVAS:START schema=${PATCH_SCHEMA} */`;
const END_MARKER = '/* GLASS CANVAS:END */';
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const ALLOWED_MIME_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'image/bmp',
  'image/avif',
  'image/x-icon',
  'image/vnd.microsoft.icon'
]);

const VALID_SCOPES = new Set(['workbench', 'editor']);
const VALID_SIZES = new Set(['cover', 'contain', 'auto', 'stretch']);
const VALID_POSITIONS = new Set([
  'center',
  'top',
  'bottom',
  'left',
  'right',
  'top left',
  'top right',
  'bottom left',
  'bottom right'
]);
const VALID_REPEATS = new Set(['no-repeat', 'repeat', 'repeat-x', 'repeat-y']);
const VALID_BLEND_MODES = new Set(['normal', 'soft-light', 'overlay', 'screen', 'multiply']);

function clampNumber(value, fallback, min, max) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback;
}

function oneOf(value, values, fallback) {
  return values.has(value) ? value : fallback;
}

function normalizeSettings(input = {}) {
  return {
    opacity: clampNumber(input.opacity, 0.16, 0, 1),
    scope: oneOf(input.scope, VALID_SCOPES, 'workbench'),
    size: oneOf(input.size, VALID_SIZES, 'cover'),
    position: oneOf(input.position, VALID_POSITIONS, 'center'),
    repeat: oneOf(input.repeat, VALID_REPEATS, 'no-repeat'),
    blur: clampNumber(input.blur, 0, 0, 40),
    brightness: clampNumber(input.brightness, 1, 0, 2),
    saturation: clampNumber(input.saturation, 1, 0, 3),
    blendMode: oneOf(input.blendMode, VALID_BLEND_MODES, 'normal')
  };
}

function escapeCssString(value) {
  return String(value)
    .replaceAll('\\', '\\\\')
    .replaceAll('"', '\\"')
    .replaceAll('\r', '')
    .replaceAll('\n', '\\A ');
}

function buildBackgroundCss(imageDataUri, rawSettings) {
  const dataMatch = /^data:(image\/[a-z0-9.+-]+);base64,[a-z0-9+/=]+$/i.exec(imageDataUri);
  if (!dataMatch || !ALLOWED_MIME_TYPES.has(dataMatch[1].toLowerCase())) {
    throw new Error('背景图必须是有效的 base64 data:image URI。');
  }

  const settings = normalizeSettings(rawSettings);
  const isEditor = settings.scope === 'editor';
  const selector = isEditor
    ? '.monaco-workbench .part.editor > .content::before'
    : 'body::after';
  const position = isEditor ? 'absolute' : 'fixed';
  const backgroundSize = settings.size === 'stretch' ? '100% 100%' : settings.size;
  const bleed = settings.blur > 0 ? Math.ceil(settings.blur * 1.5) : 0;
  const inset = bleed > 0 ? `-${bleed}px` : '0';

  return `${START_MARKER}
${selector} {
  content: "" !important;
  position: ${position} !important;
  inset: ${inset} !important;
  display: block !important;
  pointer-events: none !important;
  user-select: none !important;
  z-index: 1900 !important;
  background-image: url("${escapeCssString(imageDataUri)}") !important;
  background-position: ${settings.position} !important;
  background-size: ${backgroundSize} !important;
  background-repeat: ${settings.repeat} !important;
  opacity: ${settings.opacity} !important;
  filter: blur(${settings.blur}px) brightness(${settings.brightness}) saturate(${settings.saturation}) !important;
  mix-blend-mode: ${settings.blendMode} !important;
}
${END_MARKER}`;
}

function startMarkers(source) {
  return Array.from(
    source.matchAll(/\/\* GLASS CANVAS:START(?: schema=(\d+))? \*\//gu),
    match => ({ index: match.index, marker: match[0], schema: match[1] ? Number(match[1]) : 0 })
  );
}

function hasAnyInjectedCss(source) {
  const starts = startMarkers(source);
  const ends = markerPositions(source, END_MARKER);
  return starts.length === 1
    && ends.length === 1
    && starts[0].index < ends[0]
    && hasMarkerBoundaries(source, starts[0].index, ends[0] + END_MARKER.length);
}

function hasInjectedCss(source) {
  const starts = startMarkers(source);
  const ends = markerPositions(source, END_MARKER);
  return starts.length === 1
    && starts[0].marker === START_MARKER
    && ends.length === 1
    && starts[0].index < ends[0]
    && hasMarkerBoundaries(source, starts[0].index, ends[0] + END_MARKER.length);
}

function hasMarkerBoundaries(source, start, end) {
  return source[start - 1] === '\n' && source[end] === '\n';
}

function markerPositions(source, marker) {
  const positions = [];
  let offset = 0;
  while (offset < source.length) {
    const position = source.indexOf(marker, offset);
    if (position === -1) {
      break;
    }
    positions.push(position);
    offset = position + marker.length;
  }
  return positions;
}

function removeInjectedCss(source) {
  const starts = startMarkers(source);
  const ends = markerPositions(source, END_MARKER);
  if (starts.length === 0 && ends.length === 0) {
    if (source.includes('/* GLASS CANVAS:START')) {
      throw new Error('检测到无法识别的 Glass Canvas 标记，已停止修改以保护文件。');
    }
    return source;
  }
  if (starts.length !== 1 || ends.length !== 1 || starts[0].index >= ends[0]) {
    throw new Error('检测到重复、反向或不完整的 Glass Canvas 标记，已停止修改以保护文件。');
  }

  const start = starts[0].index;
  const end = ends[0] + END_MARKER.length;
  if (!hasMarkerBoundaries(source, start, end)) {
    throw new Error('Glass Canvas 样式块边界异常，已停止修改以保护文件。');
  }
  return source.slice(0, start - 1) + source.slice(end + 1);
}

function injectCss(source, generatedCss) {
  if (!generatedCss.startsWith(START_MARKER) || !generatedCss.endsWith(END_MARKER)) {
    throw new Error('拒绝写入没有完整 Glass Canvas 标记的样式。');
  }
  const clean = removeInjectedCss(source);
  const sourceMapPattern = /\/\*# sourceMappingURL=[^\r\n]*?\*\//u;
  const sourceMap = clean.match(sourceMapPattern);
  const insertionPoint = sourceMap?.index ?? clean.length;
  return `${clean.slice(0, insertionPoint)}\n${generatedCss}\n${clean.slice(insertionPoint)}`;
}

function detectMime(buffer) {
  if (buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return 'image/png';
  }
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return 'image/jpeg';
  }
  if (buffer.subarray(0, 4).toString('ascii') === 'GIF8') {
    return 'image/gif';
  }
  if (buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP') {
    return 'image/webp';
  }
  if (buffer.subarray(0, 2).toString('ascii') === 'BM') {
    return 'image/bmp';
  }
  if (
    buffer.subarray(4, 8).toString('ascii') === 'ftyp'
    && /avif|avis/u.test(buffer.subarray(8, 32).toString('ascii'))
  ) {
    return 'image/avif';
  }
  if (buffer[0] === 0x00 && buffer[1] === 0x00 && buffer[2] === 0x01 && buffer[3] === 0x00) {
    return 'image/x-icon';
  }
  return undefined;
}

function toDataUri(buffer, mime) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    throw new Error('背景图为空。');
  }
  if (buffer.length > MAX_IMAGE_BYTES) {
    throw new Error(`背景图不能超过 ${MAX_IMAGE_BYTES / 1024 / 1024} MB。`);
  }
  if (!ALLOWED_MIME_TYPES.has(mime || '')) {
    throw new Error('无法识别图片格式。支持 PNG、JPEG、GIF、WebP、BMP、AVIF 和 ICO。');
  }
  return `data:${mime};base64,${buffer.toString('base64')}`;
}

module.exports = {
  ALLOWED_MIME_TYPES,
  END_MARKER,
  MAX_IMAGE_BYTES,
  PATCH_SCHEMA,
  START_MARKER,
  buildBackgroundCss,
  detectMime,
  hasAnyInjectedCss,
  hasInjectedCss,
  injectCss,
  normalizeSettings,
  removeInjectedCss,
  toDataUri
};
