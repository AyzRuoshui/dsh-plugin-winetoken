// -*- coding: utf-8 -*-
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const {
  resolveApiKey,
  readCredentialsRefs,
  saveCredentialsRef
} = require('../src/credentials.js');

test('Credentials - 识别 ZHAIZHU_API_KEY 别名并成功解析', () => {
  const originalWinetoken = process.env.WINETOKEN_API_KEY;
  const originalZhaizhu = process.env.ZHAIZHU_API_KEY;

  try {
    delete process.env.WINETOKEN_API_KEY;
    process.env.ZHAIZHU_API_KEY = 'sk-zhaizhu-test-token-12345678';

    const res = resolveApiKey({ autoAlias: false });
    assert.equal(res.hasKey, true, '必须能识别到别名 Key');
    assert.equal(res.apiKey, 'sk-zhaizhu-test-token-12345678', '必须匹配到正确的别名内容');
    assert.equal(res.keyName, 'ZHAIZHU_API_KEY', '必须标明来源键名为 ZHAIZHU_API_KEY');
  } finally {
    if (originalWinetoken) process.env.WINETOKEN_API_KEY = originalWinetoken;
    else delete process.env.WINETOKEN_API_KEY;

    if (originalZhaizhu) process.env.ZHAIZHU_API_KEY = originalZhaizhu;
    else delete process.env.ZHAIZHU_API_KEY;
  }
});

test('Credentials - 换行符注入安全防御', () => {
  assert.throws(() => {
    saveCredentialsRef('TEST_KEY', 'sk-xxx\nmalicious_yaml: true');
  }, /换行符/, '必须拒绝包含换行符的恶意 key 注入');
});
