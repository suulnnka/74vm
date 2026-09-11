/* =========================================================================
 * 74VM 元件库 — 总线接口家族
 * 数据模块: 向 js/chips.js 提供的 CHIPS 上下文注册 def 定义。
 * 浏览器: 在 chips.js 之后以 <script> 加载; Node: 由 chips.js require 并注入上下文。
 * ========================================================================= */
(function (factory) {
'use strict';
if (typeof module !== 'undefined' && module.exports) module.exports = factory;
else factory(window.CHIPS);
})(function (C) {
const { VX, V0, V1, VZ } = C.Sim;
const { LIB, def, L, R } = C;
const global = C.global;   // 家族内的 global.xxx 导出 (如 ps2ParseScript)

/* ========================= 总线接口 ========================= */

/* 74245 八路总线收发器 (DIR=1: A→B; DIR=0: B→A; ~OE=0 使能) */
def('74245', '八路总线收发器', '总线接口', [
  L(1, 'DIR', 'in'), L(2, 'A0', 'io'), L(3, 'A1', 'io'), L(4, 'A2', 'io'), L(5, 'A3', 'io'), L(6, 'A4', 'io'), L(7, 'A5', 'io'), L(8, 'A6', 'io'), L(9, 'A7', 'io'),
  R(19, 'B0', 'io'), R(18, 'B1', 'io'), R(17, 'B2', 'io'), R(16, 'B3', 'io'), R(15, 'B4', 'io'), R(14, 'B5', 'io'), R(13, 'B6', 'io'), R(12, 'B7', 'io'), R(11, '~OE', 'in'),
], {
  eval(ch, e) {
    const A = [2, 3, 4, 5, 6, 7, 8, 9], B = [19, 18, 17, 16, 15, 14, 13, 12];
    const en = e.readLo(11);
    const dir = e.read(1);
    for (let i = 0; i < 8; i++) {
      if (!en || dir === VX) { e.drive(A[i], 'Z', 2); e.drive(B[i], 'Z', 2); }
      else if (dir === 1) { e.drive(A[i], 'Z', 2); e.drive(B[i], e.read(A[i]), 2); }
      else { e.drive(B[i], 'Z', 2); e.drive(A[i], e.read(B[i]), 2); }
    }
  },
});
});
