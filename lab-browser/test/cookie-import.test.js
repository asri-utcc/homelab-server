'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { parseCookieFile } = require('../lib/cookie-import');

test('cookie-import: parses Playwright cookie array', () => {
  const input = JSON.stringify([
    {
      name: 'SID',
      value: 'secret-value-1',
      domain: '.example.test',
      path: '/app',
      expires: 1800000000,
      httpOnly: true,
      secure: true,
      sameSite: 'Strict',
    },
  ]);

  const cookies = parseCookieFile(input);
  assert.equal(cookies.length, 1);
  assert.deepEqual(cookies[0], {
    name: 'SID',
    value: 'secret-value-1',
    domain: '.example.test',
    path: '/app',
    expires: 1800000000,
    httpOnly: true,
    secure: true,
    sameSite: 'Strict',
  });
});

test('cookie-import: parses Playwright storageState { cookies: [...] }', () => {
  const input = JSON.stringify({
    cookies: [
      {
        name: 'HSID',
        value: 'secret-value-2',
        domain: 'accounts.example.test',
        path: '/',
        expires: -1,
        httpOnly: false,
        secure: true,
        sameSite: 'None',
      },
    ],
    origins: [{ origin: 'https://accounts.example.test', localStorage: [] }],
  });

  const cookies = parseCookieFile(input);
  assert.equal(cookies.length, 1);
  assert.equal(cookies[0].name, 'HSID');
  assert.equal(cookies[0].domain, 'accounts.example.test');
  assert.equal(cookies[0].expires, -1);
  assert.equal(cookies[0].sameSite, 'None');
});

test('cookie-import: parses Cookie-Editor / EditThisCookie format with expirationDate, session, and sameSite mapping', () => {
  const input = JSON.stringify([
    {
      name: 'c_none',
      value: 'v1',
      domain: '.example.test',
      path: '/',
      expirationDate: 1799999999.75,
      httpOnly: true,
      secure: true,
      sameSite: 'no_restriction',
    },
    {
      name: 'c_lax',
      value: 'v2',
      domain: 'sub.example.test',
      expirationDate: 1799999000,
      sameSite: 'lax',
    },
    {
      name: 'c_strict',
      value: 'v3',
      domain: 'sub.example.test',
      sameSite: 'strict',
      session: true,
      expirationDate: 1799999000,
    },
    {
      name: 'c_unspec',
      value: 'v4',
      domain: 'sub.example.test',
      sameSite: 'unspecified',
    },
    {
      name: 'c_null',
      value: 'v5',
      domain: 'sub.example.test',
      sameSite: null,
    },
    {
      name: '',
      value: 'skip-no-name',
      domain: 'sub.example.test',
    },
    {
      name: 'skip_no_domain',
      value: 'v6',
    },
  ]);

  const cookies = parseCookieFile(input);
  assert.equal(cookies.length, 5);

  assert.equal(cookies[0].sameSite, 'None');
  assert.equal(cookies[0].expires, 1799999999.75);
  assert.equal(cookies[0].httpOnly, true);
  assert.equal(cookies[0].secure, true);

  assert.equal(cookies[1].sameSite, 'Lax');
  assert.equal(cookies[1].expires, 1799999000);
  assert.equal(cookies[1].path, '/');

  assert.equal(cookies[2].sameSite, 'Strict');
  assert.equal(cookies[2].expires, -1);

  assert.equal(cookies[3].sameSite, 'Lax');
  assert.equal(cookies[3].expires, -1);

  assert.equal(cookies[4].sameSite, 'Lax');
});

test('cookie-import: throws on empty, invalid JSON, or unsupported shape', () => {
  assert.throws(() => parseCookieFile(''), /empty/i);
  assert.throws(() => parseCookieFile('{bad json'), /invalid cookie json/i);
  assert.throws(() => parseCookieFile('{"foo":"bar"}'), /unsupported cookie format/i);
});
