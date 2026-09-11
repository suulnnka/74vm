/* =========================================================================
 * 74VM 元件库 — 74 系列芯片定义 (真实 DIP 引脚编号, 电源脚省略)
 *
 * pins: L()=左侧引脚(自上而下), R()=右侧引脚(自上而下, 与DIP编号反向)
 *   dir: 'in' 输入 / 'out' 输出 / 'io' 双向(三态)
 *
 * 门电路芯片用 gates: [{o:输出脚号, i:[输入脚号], f:'nand'...}]
 * 复杂芯片用 eval(ch, e): e.read/readLo/readHi/drive/notv, ch.state 保存内部状态
 *
 * 描述字段: desc = 功能简述 (一句话, 侧栏/画布/放置提示显示, 不写操作方式)
 *           detail = 功能描述 (功能 + 引脚 IO 说明, 悬停浮窗与右键"查看描述"显示)
 *
 * 元件定义按家族拆分在 js/chips/*.js; 本文件是聚合入口与共享上下文
 * (LIB / def / L / R / Sim 电平常量), Node 测试经 require 同步加载全部家族。
 * ========================================================================= */
(function (global) {
'use strict';

const LIB = {};
function def(type, desc, cat, pins, extra) {
  LIB[type] = Object.assign({ type, desc, cat, pins }, extra || {});
}
const L = (num, name, dir) => ({ num, name, dir, side: 'L' });
const R = (num, name, dir) => ({ num, name, dir, side: 'R' });

const CHIPS = {
  LIB, def, L, R,
  Sim: global.EngineModule.Sim,   // 家族文件所需的电平常量来源
  global,                         // 家族文件中 global.xxx 全局导出仍指向浏览器 window
};
global.CHIPS = CHIPS;

if (typeof module !== 'undefined' && module.exports) {
  // Node (测试): 同步加载全部家族后导出
  module.exports = CHIPS;
  require('./chips/gates.js')(CHIPS);
  require('./chips/logic.js')(CHIPS);
  require('./chips/interface.js')(CHIPS);
  require('./chips/bus.js')(CHIPS);
}
})(typeof window !== 'undefined' ? window : globalThis);
