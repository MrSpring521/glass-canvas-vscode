'use strict';

const https = require('node:https');
const { detectMime, toDataUri } = require('./core');

const PIXIV_WEB_HOST = 'www.pixiv.net';
const PIXIV_IMAGE_HOST = 'i.pximg.net';
const MAX_JSON_BYTES = 5 * 1024 * 1024;
const MAX_THUMBNAIL_BYTES = 2 * 1024 * 1024;
const MAX_DOWNLOAD_BYTES = 40 * 1024 * 1024;
const SEARCH_RESULT_LIMIT = 24;
const PIXIV_SOURCE_PAGE_SIZE = 60;
const MAX_SEARCH_PAGE = 1000;
const RESOLUTIONS = Object.freeze({
  any: [0, 0],
  '1920x1080': [1920, 1080],
  '2560x1440': [2560, 1440],
  '3840x2160': [3840, 2160],
  '5120x2880': [5120, 2880]
});
const BLOCKED_CJK_FRAGMENTS = Object.freeze([
  '18禁', '成人向け', '成人漫画', '色情', '情色', '全裸', '裸体', '裸女', '裸男', '裸身', '裸婦',
  'ヌード', '乳首', '乳头', '奶头', '巨乳', '爆乳', '胸チラ', 'パンチラ', '下着', '内衣',
  'ランジェリー', '水着', '泳装', '比基尼', '性交', 'セックス', '性器', '陰部', '阴部',
  '調教', '调教', '凌辱', '触手', '觸手', 'フェチ', 'グロ', 'ゴア', '猟奇', '獵奇',
  '猎奇', '流血', '血腥', '肢解', '断肢', '斷肢', '死体', '屍体', '尸体', '腐尸',
  'ロリ', '幼女'
]);
const BLOCKED_LATIN_TAGS = new Set([
  'r18', 'r18g', 'nsfw', 'hentai', 'porn', 'pornography', 'erotic', 'ecchi', 'nude', 'nudity',
  'naked', 'sex', 'sexy', 'boobs', 'breasts', 'nipples', 'lingerie', 'underwear', 'bikini',
  'swimsuit', 'bdsm', 'bondage', 'fetish', 'tentacle', 'gore', 'guro', 'blood', 'bloody',
  'dismemberment', 'corpse', 'bodyhorror', 'loli', 'lolicon'
]);

function normalizeResolution(value) {
  return Object.hasOwn(RESOLUTIONS, value) ? value : 'any';
}

function normalizePage(value) {
  const page = Number(value);
  return Number.isInteger(page) ? Math.min(MAX_SEARCH_PAGE, Math.max(1, page)) : 1;
}

function matchesResolution(width, height, preset) {
  const [minimumWidth, minimumHeight] = RESOLUTIONS[normalizeResolution(preset)];
  if (minimumWidth === 0) {
    return true;
  }
  return (
    (width >= minimumWidth && height >= minimumHeight)
    || (width >= minimumHeight && height >= minimumWidth)
  );
}

function normalizeTag(value) {
  return String(value || '').normalize('NFKC').trim().toLowerCase();
}

function isBlockedBuiltInTag(value) {
  const normalized = normalizeTag(value);
  if (!normalized) {
    return false;
  }
  const compact = normalized.replace(/[^\p{L}\p{N}]+/gu, '');
  if (BLOCKED_LATIN_TAGS.has(normalized) || BLOCKED_LATIN_TAGS.has(compact)) {
    return true;
  }
  return BLOCKED_CJK_FRAGMENTS.some(fragment => normalized.includes(fragment));
}

function isWorkSafeArtwork(item, customBlockedTags = []) {
  if (Number(item?.xRestrict) !== 0 || Number(item?.restrict) !== 0) {
    return false;
  }
  const tags = Array.isArray(item?.tags) ? item.tags : [];
  if (tags.some(isBlockedBuiltInTag)) {
    return false;
  }
  const custom = new Set(
    (Array.isArray(customBlockedTags) ? customBlockedTags : [])
      .slice(0, 100)
      .map(normalizeTag)
      .filter(Boolean)
  );
  return !tags.some(tag => custom.has(normalizeTag(tag)));
}

function assertPixivUrl(value, expectedHost) {
  const url = value instanceof URL ? value : new URL(value);
  if (url.protocol !== 'https:' || url.hostname !== expectedHost || url.username || url.password) {
    throw new Error('Pixiv 返回了不受信任的资源地址。');
  }
  return url;
}

function requestBuffer(value, options = {}, redirectsLeft = 3) {
  const url = assertPixivUrl(value, options.host);
  const maximumBytes = options.maximumBytes;
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (callback, value) => {
      if (!settled) {
        settled = true;
        callback(value);
      }
    };
    const fail = error => finish(reject, error);

    const request = https.get(url, {
      headers: {
        Accept: options.accept,
        Referer: options.referer,
        'User-Agent': 'Glass-Canvas-VSCode/0.2.3'
      },
      timeout: 20_000
    }, response => {
      const status = response.statusCode || 0;
      if (status >= 300 && status < 400 && response.headers.location) {
        response.resume();
        if (redirectsLeft === 0) {
          fail(new Error('Pixiv 资源重定向次数过多。'));
          return;
        }
        try {
          const redirect = assertPixivUrl(new URL(response.headers.location, url), options.host);
          requestBuffer(redirect, options, redirectsLeft - 1).then(
            value => finish(resolve, value),
            fail
          );
        } catch (error) {
          fail(error);
        }
        return;
      }
      if (status !== 200) {
        response.resume();
        fail(new Error(`Pixiv 请求失败：HTTP ${status}`));
        return;
      }

      const declaredLength = Number(response.headers['content-length'] || 0);
      if (declaredLength > maximumBytes) {
        response.resume();
        fail(new Error(`Pixiv 资源超过大小限制（${Math.round(maximumBytes / 1024 / 1024)} MB）。`));
        return;
      }

      const chunks = [];
      let length = 0;
      response.on('data', chunk => {
        length += chunk.length;
        if (length > maximumBytes) {
          const error = new Error(`Pixiv 资源超过大小限制（${Math.round(maximumBytes / 1024 / 1024)} MB）。`);
          fail(error);
          response.destroy(error);
          return;
        }
        chunks.push(chunk);
      });
      response.on('end', () => finish(resolve, Buffer.concat(chunks)));
      response.on('error', fail);
    });
    request.on('timeout', () => {
      const error = new Error('连接 Pixiv 超时。');
      fail(error);
      request.destroy(error);
    });
    request.on('error', fail);
  });
}

async function requestPixivJson(pathname, searchParams) {
  const url = new URL(pathname, `https://${PIXIV_WEB_HOST}`);
  if (searchParams) {
    url.search = searchParams.toString();
  }
  const buffer = await requestBuffer(url, {
    host: PIXIV_WEB_HOST,
    maximumBytes: MAX_JSON_BYTES,
    accept: 'application/json',
    referer: `https://${PIXIV_WEB_HOST}/`
  });
  let response;
  try {
    response = JSON.parse(buffer.toString('utf8'));
  } catch {
    throw new Error('Pixiv 返回了无法解析的数据。');
  }
  if (response?.error || !response?.body) {
    throw new Error(response?.message || 'Pixiv 搜索暂时不可用。');
  }
  return response.body;
}

function normalizeArtwork(item) {
  const width = Number(item?.width);
  const height = Number(item?.height);
  if (!/^\d+$/u.test(String(item?.id)) || !Number.isFinite(width) || !Number.isFinite(height)) {
    return undefined;
  }
  let thumbnail;
  try {
    thumbnail = assertPixivUrl(item.url, PIXIV_IMAGE_HOST).toString();
  } catch {
    return undefined;
  }
  return {
    id: String(item.id),
    title: String(item.title || `Pixiv ${item.id}`),
    author: String(item.userName || ''),
    width,
    height,
    thumbnail,
    pageCount: Math.max(1, Number(item.pageCount) || 1)
  };
}

async function mapWithConcurrency(items, concurrency, mapper) {
  const result = new Array(items.length);
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      result[index] = await mapper(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  return result;
}

async function searchPixiv(tag, resolution = 'any', customBlockedTags = [], page = 1) {
  const normalizedTag = String(tag || '').trim().slice(0, 100);
  if (!normalizedTag) {
    throw new Error('请输入要搜索的 Pixiv Tag。');
  }
  const preset = normalizeResolution(resolution);
  const normalizedPage = normalizePage(page);
  const params = new URLSearchParams({
    word: normalizedTag,
    order: 'date_d',
    mode: 'safe',
    p: String(normalizedPage),
    s_mode: 's_tag',
    type: 'all',
    lang: 'zh'
  });
  const body = await requestPixivJson(`/ajax/search/artworks/${encodeURIComponent(normalizedTag)}`, params);
  const rawItems = body?.illustManga?.data;
  if (!Array.isArray(rawItems)) {
    throw new Error('Pixiv 搜索结果结构已发生变化。');
  }
  const total = Math.max(0, Number(body?.illustManga?.total) || 0);
  const totalPages = Math.max(1, Math.min(MAX_SEARCH_PAGE, Math.ceil(total / PIXIV_SOURCE_PAGE_SIZE)));

  const seen = new Set();
  const artworks = rawItems
    .filter(item => isWorkSafeArtwork(item, customBlockedTags))
    .map(normalizeArtwork)
    .filter(Boolean)
    .filter(item => {
      if (seen.has(item.id) || !matchesResolution(item.width, item.height, preset)) {
        return false;
      }
      seen.add(item.id);
      return true;
    })
    .slice(0, SEARCH_RESULT_LIMIT);

  const items = await mapWithConcurrency(artworks, 6, async artwork => {
    try {
      const buffer = await requestBuffer(artwork.thumbnail, {
        host: PIXIV_IMAGE_HOST,
        maximumBytes: MAX_THUMBNAIL_BYTES,
        accept: 'image/*',
        referer: `https://${PIXIV_WEB_HOST}/`
      });
      return { ...artwork, thumbnailDataUri: toDataUri(buffer, detectMime(buffer)) };
    } catch {
      return { ...artwork, thumbnailDataUri: '' };
    }
  });
  return { items, page: normalizedPage, total, totalPages };
}

async function getPixivPage(artworkId) {
  const id = String(artworkId || '');
  if (!/^\d+$/u.test(id)) {
    throw new Error('无效的 Pixiv 作品 ID。');
  }
  const pages = await requestPixivJson(`/ajax/illust/${id}/pages`, new URLSearchParams({ lang: 'zh' }));
  const first = Array.isArray(pages) ? pages[0] : undefined;
  if (!first?.urls?.original || !first?.urls?.regular) {
    throw new Error('这个 Pixiv 作品没有可下载的静态图片。');
  }
  return {
    id,
    width: Number(first.width) || 0,
    height: Number(first.height) || 0,
    original: assertPixivUrl(first.urls.original, PIXIV_IMAGE_HOST).toString(),
    regular: assertPixivUrl(first.urls.regular, PIXIV_IMAGE_HOST).toString()
  };
}

async function downloadPixivArtwork(artworkId, quality = 'original', maximumBytes = MAX_DOWNLOAD_BYTES) {
  const page = await getPixivPage(artworkId);
  const url = quality === 'regular' ? page.regular : page.original;
  const buffer = await requestBuffer(url, {
    host: PIXIV_IMAGE_HOST,
    maximumBytes,
    accept: 'image/*',
    referer: `https://${PIXIV_WEB_HOST}/artworks/${page.id}`
  });
  const mime = detectMime(buffer);
  if (!mime) {
    throw new Error('Pixiv 下载内容不是受支持的图片。');
  }
  return { buffer, mime, page, url };
}

function extensionForMime(mime) {
  return ({
    'image/png': 'png',
    'image/jpeg': 'jpg',
    'image/gif': 'gif',
    'image/webp': 'webp',
    'image/bmp': 'bmp',
    'image/avif': 'avif',
    'image/x-icon': 'ico',
    'image/vnd.microsoft.icon': 'ico'
  })[mime] || 'img';
}

module.exports = {
  MAX_DOWNLOAD_BYTES,
  RESOLUTIONS,
  downloadPixivArtwork,
  extensionForMime,
  isBlockedBuiltInTag,
  isWorkSafeArtwork,
  matchesResolution,
  normalizeArtwork,
  normalizePage,
  normalizeResolution,
  searchPixiv
};
