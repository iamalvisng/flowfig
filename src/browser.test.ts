import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findBrowser } from './browser.ts';

const has =
  (...paths: string[]) =>
  (p: string) =>
    paths.includes(p);
const MAC = (n: string) => `/Applications/${n}.app/Contents/MacOS/${n}`;
const LINUX = [
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/snap/bin/chromium',
  '/usr/bin/microsoft-edge',
  '/usr/bin/brave-browser',
  '/opt/google/chrome/chrome',
];
const WIN_ENV = {
  PROGRAMFILES: 'C:\\Program Files',
  'PROGRAMFILES(X86)': 'C:\\Program Files (x86)',
  LOCALAPPDATA: 'C:\\Users\\a\\AppData\\Local',
};

test('findBrowser on macOS checks Chrome, Edge, Chromium and Brave in that order', () => {
  const r = findBrowser({ platform: 'darwin', env: {}, exists: has(MAC('Chromium')) });
  assert.equal(r.path, MAC('Chromium'));
  assert.deepEqual(r.checked, [MAC('Google Chrome'), MAC('Microsoft Edge'), MAC('Chromium')]);
});

test('findBrowser on Linux checks the standard paths in order', () => {
  const r = findBrowser({ platform: 'linux', env: {}, exists: has('/usr/bin/chromium', '/opt/google/chrome/chrome') });
  assert.equal(r.path, '/usr/bin/chromium');
  assert.deepEqual(r.checked, LINUX.slice(0, 3));
});

test('findBrowser on Windows checks each program folder that is set, joined with backslashes', () => {
  const edge = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
  const r = findBrowser({ platform: 'win32', env: WIN_ENV, exists: has(edge) });
  assert.equal(r.path, edge);
  assert.equal(r.checked.length, 6);
  assert.equal(r.checked[0], 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe');
  assert.equal(findBrowser({ platform: 'win32', env: { LOCALAPPDATA: 'D:\\L' }, exists: has() }).checked.length, 4);
});

test('CHROME_PATH wins over a standard path, and a missing CHROME_PATH is the only path checked', () => {
  const all = () => true;
  assert.deepEqual(findBrowser({ platform: 'darwin', env: { CHROME_PATH: '/opt/x/chrome' }, exists: all }), {
    path: '/opt/x/chrome',
    checked: ['/opt/x/chrome'],
  });
  assert.deepEqual(findBrowser({ platform: 'linux', env: { CHROME_PATH: '/opt/x/chrome' }, exists: has(...LINUX) }), {
    path: null,
    checked: ['/opt/x/chrome'],
  });
});

test('with no browser, checked holds every path of the system', () => {
  assert.deepEqual(findBrowser({ platform: 'darwin', env: {}, exists: has() }), {
    path: null,
    checked: ['Google Chrome', 'Microsoft Edge', 'Chromium', 'Brave Browser'].map(MAC),
  });
  assert.deepEqual(findBrowser({ platform: 'linux', env: {}, exists: has() }).checked, LINUX);
  assert.equal(findBrowser({ platform: 'win32', env: WIN_ENV, exists: has() }).checked.length, 12);
});
