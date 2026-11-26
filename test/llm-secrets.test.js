const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { LLMClient } = require('../server/llm/client');
const config = require('../config/default.json');

function withEnvironment(fn) {
  const originalFile = process.env.LLM_API_KEY_FILE;
  const originalKey = process.env.LLM_API_KEY;
  return Promise.resolve().then(fn).finally(() => {
    if (originalFile === undefined) delete process.env.LLM_API_KEY_FILE;
    else process.env.LLM_API_KEY_FILE = originalFile;
    if (originalKey === undefined) delete process.env.LLM_API_KEY;
    else process.env.LLM_API_KEY = originalKey;
  });
}

test('secret file takes precedence, trims whitespace, and is used for authorization', () => withEnvironment(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'willowbrook-secret-test-'));
  const originalFetch = global.fetch;
  try {
    const file = path.join(dir, 'secret');
    fs.writeFileSync(file, '  example-file-token\n');
    process.env.LLM_API_KEY_FILE = file;
    process.env.LLM_API_KEY = 'example-env-token';
    let authorization;
    global.fetch = async (url, options) => {
      authorization = options.headers.Authorization;
      return { ok: true, json: async () => ({choices: [{message: {content: 'ok'}}]}) };
    };
    const client = new LLMClient(config, {reserve: () => true});
    await client.complete('system', 'user');
    assert.equal(authorization, 'Bearer example-file-token');
  } finally { global.fetch = originalFetch; fs.rmSync(dir, {recursive: true, force: true}); }
}));

test('environment API key is used when no file is configured', () => withEnvironment(() => {
  delete process.env.LLM_API_KEY_FILE;
  process.env.LLM_API_KEY = 'example-env-token';
  assert.equal(new LLMClient(config, {}).apiKey, 'example-env-token');
}));

test('missing, empty-path, and unreadable configured files fail without fallback or secret disclosure', () => withEnvironment(() => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'willowbrook-secret-test-'));
  const originalRead = fs.readFileSync;
  try {
    process.env.LLM_API_KEY = 'example-env-token';
    process.env.LLM_API_KEY_FILE = path.join(dir, 'missing');
    assert.throws(() => new LLMClient(config, {}), /Unable to read configured LLM_API_KEY_FILE \(ENOENT\)/);
    process.env.LLM_API_KEY_FILE = '';
    assert.throws(() => new LLMClient(config, {}), /Unable to read configured LLM_API_KEY_FILE/);
    process.env.LLM_API_KEY_FILE = 'unreadable';
    fs.readFileSync = () => { const err = new Error('example-env-token should never be printed'); err.code = 'EACCES'; throw err; };
    assert.throws(() => new LLMClient(config, {}), err =>
      err.message === 'Unable to read configured LLM_API_KEY_FILE (EACCES)');
  } finally { fs.readFileSync = originalRead; fs.rmSync(dir, {recursive: true, force: true}); }
}));

test('provider and transport failures redact the secret from logs', () => withEnvironment(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'willowbrook-secret-test-'));
  const originalFetch = global.fetch;
  const originalWarn = console.warn;
  try {
    const file = path.join(dir, 'secret');
    fs.writeFileSync(file, 'example-secret-token\n');
    process.env.LLM_API_KEY_FILE = file;
    const messages = [];
    console.warn = (...args) => messages.push(args.join(' '));
    const client = new LLMClient({...config, llm: {...config.llm, maxRetries: 1}}, {reserve: () => true});
    global.fetch = async () => ({ok: false, status: 401, text: async () => 'rejected example-secret-token'});
    await client.complete('system', 'user');
    global.fetch = async () => { throw new Error('transport example-secret-token'); };
    await client.complete('system', 'user');
    assert.equal(messages.length, 2);
    assert.ok(messages.every(message => message.includes('[REDACTED]')));
    assert.ok(messages.every(message => !message.includes('example-secret-token')));
  } finally { global.fetch = originalFetch; console.warn = originalWarn; fs.rmSync(dir, {recursive: true, force: true}); }
}));
