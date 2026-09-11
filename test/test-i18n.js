/* =========================================================================
 * 74VM I18N 测试 — 初始语言探测 (localStorage 优先, 否则跟随本地语言)
 * node test/test-i18n.js
 * ========================================================================= */
'use strict';

const vm = require('vm');
const fs = require('fs');
const path = require('path');

const CODE = fs.readFileSync(path.join(__dirname, '..', 'js', 'i18n.js'), 'utf8');

let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (extra !== undefined ? '  →  ' + JSON.stringify(extra) : '')); }
}

/** 在受控沙箱里加载 i18n.js, 返回探测到的初始语言 */
function loadLang({ saved, languages, language, throwOnRead } = {}) {
  const ctx = {
    localStorage: {
      getItem: () => { if (throwOnRead) throw new Error('SecurityError'); return saved === undefined ? null : saved; },
      setItem: () => {},
    },
  };
  if (languages !== undefined || language !== undefined) {
    ctx.navigator = { languages: languages || [], language: language || '' };
  }
  vm.createContext(ctx);
  vm.runInContext(CODE, ctx);
  return ctx.I18N.lang;
}

/* --- 已保存的选择优先 --- */
check('已保存 en → en',            loadLang({ saved: 'en' }) === 'en');
check('已保存 zh → zh',            loadLang({ saved: 'zh' }) === 'zh');
check('已保存非法值 → 走探测(英文系统→en)', loadLang({ saved: 'jp', languages: ['en-US'] }) === 'en');
check('已保存非法值 → 走探测(中文系统→zh)', loadLang({ saved: 'jp', languages: ['zh-CN'] }) === 'zh');

/* --- 未保存: 跟随本地语言, 非中文一律英文 --- */
check('zh-CN → zh',                loadLang({ languages: ['zh-CN', 'en'] }) === 'zh');
check('zh-TW → zh',                loadLang({ languages: ['zh-TW', 'en'] }) === 'zh');
check('大小写不敏感 ZH → zh',       loadLang({ languages: ['ZH', 'en'] }) === 'zh');
check('en-US → en',                loadLang({ languages: ['en-US'] }) === 'en');
check('ja → en',                   loadLang({ languages: ['ja', 'en-US'] }) === 'en');
check('de → en',                   loadLang({ languages: ['de-DE', 'fr'] }) === 'en');

/* --- 回退路径 --- */
check('languages 为空时用 language', loadLang({ languages: [], language: 'zh-HK' }) === 'zh');
check('language 也缺失 → en',       loadLang({ languages: [], language: '' }) === 'en');
check('无 navigator 对象 → en',     loadLang({}) === 'en');
check('localStorage 抛异常 → 探测生效', loadLang({ throwOnRead: true, languages: ['zh-CN'] }) === 'zh');

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
