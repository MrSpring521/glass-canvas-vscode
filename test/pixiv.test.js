'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  extensionForMime,
  isBlockedBuiltInTag,
  isWorkSafeArtwork,
  matchesResolution,
  normalizeArtwork,
  normalizePage,
  normalizeResolution
} = require('../src/pixiv');

test('normalizes resolution presets and accepts landscape or portrait', () => {
  assert.equal(normalizeResolution('3840x2160'), '3840x2160');
  assert.equal(normalizeResolution('invalid'), 'any');
  assert.equal(matchesResolution(1920, 1080, '1920x1080'), true);
  assert.equal(matchesResolution(1080, 1920, '1920x1080'), true);
  assert.equal(matchesResolution(1919, 1080, '1920x1080'), false);
  assert.equal(matchesResolution(800, 600, 'any'), true);
});

test('normalizes Pixiv page numbers to a safe supported range', () => {
  assert.equal(normalizePage(2), 2);
  assert.equal(normalizePage('8'), 8);
  assert.equal(normalizePage(0), 1);
  assert.equal(normalizePage(1001), 1000);
  assert.equal(normalizePage('oops'), 1);
});

test('normalizes only trusted Pixiv artwork thumbnails', () => {
  assert.deepEqual(normalizeArtwork({
    id: '123',
    title: 'Sky',
    userName: 'Painter',
    width: 2560,
    height: 1440,
    pageCount: 2,
    url: 'https://i.pximg.net/c/250x250/example.jpg'
  }), {
    id: '123',
    title: 'Sky',
    author: 'Painter',
    width: 2560,
    height: 1440,
    pageCount: 2,
    thumbnail: 'https://i.pximg.net/c/250x250/example.jpg'
  });
  assert.equal(normalizeArtwork({
    id: '123', width: 100, height: 100, url: 'https://example.com/image.jpg'
  }), undefined);
});

test('maps image MIME types to safe file extensions', () => {
  assert.equal(extensionForMime('image/jpeg'), 'jpg');
  assert.equal(extensionForMime('image/png'), 'png');
  assert.equal(extensionForMime('application/octet-stream'), 'img');
});

test('filters restricted, adult and grotesque Pixiv tags', () => {
  assert.equal(isWorkSafeArtwork({ xRestrict: 1, restrict: 0, tags: ['风景'] }), false);
  assert.equal(isWorkSafeArtwork({ xRestrict: 0, restrict: 1, tags: ['风景'] }), false);
  assert.equal(isWorkSafeArtwork({ xRestrict: 0, restrict: 0, tags: ['R-18'] }), false);
  assert.equal(isWorkSafeArtwork({ xRestrict: 0, restrict: 0, tags: ['血腥'] }), false);
  assert.equal(isWorkSafeArtwork({ xRestrict: 0, restrict: 0, tags: ['風景', '星空'] }), true);
  assert.equal(isBlockedBuiltInTag('Ｒ－１８Ｇ'), true);
});

test('supports exact custom blocked tags without broad substring matches', () => {
  const artwork = { xRestrict: 0, restrict: 0, tags: ['AIイラスト', '風景'] };
  assert.equal(isWorkSafeArtwork(artwork, ['AIイラスト']), false);
  assert.equal(isWorkSafeArtwork(artwork, ['AI']), true);
});
