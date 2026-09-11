/* =========================================================================
 * 74VM 多语言支持 — 中文为源语言, t(中文) 返回当前语言文本
 *   I18N.t(s)          查表翻译 (未收录原样返回)
 *   I18N.tf(s, params) 先翻译再替换 {x} 占位符
 *   I18N.setLang(l)    切换并持久化 ('zh' | 'en'), 调用方负责刷新界面
 *   I18N.EN_HELP       英文版帮助正文 (index.html #helpBody 的 innerHTML)
 * 初始语言: 优先取 localStorage 已保存值, 否则跟随本地语言 (首选语言非中文一律英文)
 * ========================================================================= */
(function (global) {
'use strict';

const LS_KEY = '74vm_lang';
let lang = null;
try {
  const saved = localStorage.getItem(LS_KEY);
  if (saved === 'en' || saved === 'zh') lang = saved;
} catch (e) { /* 隐私模式等 */ }
if (!lang) {
  // 未手动选过语言时跟随本地语言: 首选语言为中文则中文, 其余一律英文
  const nav = typeof navigator !== 'undefined' ? navigator : {};
  const prefs = (nav.languages && nav.languages.length) ? nav.languages : [nav.language || ''];
  lang = prefs.some(l => String(l).toLowerCase().indexOf('zh') === 0) ? 'zh' : 'en';
}

function t(s) {
  if (lang === 'zh') return s;
  const dict = window.I18N_EN && window.I18N_EN.dict;
  const r = dict ? dict[s] : undefined;
  return r === undefined ? s : r;
}
function tf(s, params) {
  let r = t(s);
  if (params) for (const k in params) r = r.split('{' + k + '}').join(params[k]);
  return r;
}
function setLang(l) {
  lang = l === 'en' ? 'en' : 'zh';
  try { localStorage.setItem(LS_KEY, lang); } catch (e) { /* 忽略 */ }
}

global.I18N = {
  t, tf, setLang,
  get lang() { return lang; },
  get EN() { return window.I18N_EN && window.I18N_EN.dict; },
  get EN_HELP() { return window.I18N_EN && window.I18N_EN.help; },
};

})(typeof window !== 'undefined' ? window : globalThis);
