/* =========================================================================
 * 74VM 元件库 — 74 系列芯片定义 (真实 DIP 引脚编号, 电源脚省略)
 *
 * pins: L()=左侧引脚(自上而下), R()=右侧引脚(自上而下, 与DIP编号反向)
 *   dir: 'in' 输入 / 'out' 输出 / 'io' 双向(三态)
 *
 * 门电路芯片用 gates: [{o:输出脚号, i:[输入脚号], f:'nand'...}]
 * 复杂芯片用 eval(ch, e): e.read/readLo/readHi/drive/notv, ch.state 保存内部状态
 * ========================================================================= */
(function (global) {
'use strict';

const { VX, V0, V1, VZ } = global.EngineModule.Sim;

const L = (num, name, dir) => ({ num, name, dir, side: 'L' });
const R = (num, name, dir) => ({ num, name, dir, side: 'R' });

const LIB = {};
function def(type, desc, cat, pins, extra) {
  LIB[type] = Object.assign({ type, desc, cat, pins }, extra || {});
}

/* ========================= 门电路 ========================= */

def('7400', '四2输入与非门', '门电路', [
  L(1, '1A', 'in'), L(2, '1B', 'in'), L(3, '1Y', 'out'), L(4, '2A', 'in'), L(5, '2B', 'in'), L(6, '2Y', 'out'),
  R(13, '4B', 'in'), R(12, '4A', 'in'), R(11, '4Y', 'out'), R(10, '3B', 'in'), R(9, '3A', 'in'), R(8, '3Y', 'out'),
], { gates: [{ o: 3, i: [1, 2], f: 'nand' }, { o: 6, i: [4, 5], f: 'nand' }, { o: 8, i: [9, 10], f: 'nand' }, { o: 11, i: [12, 13], f: 'nand' }] });

def('7402', '四2输入或非门', '门电路', [
  L(1, '1Y', 'out'), L(2, '1A', 'in'), L(3, '1B', 'in'), L(4, '2Y', 'out'), L(5, '2A', 'in'), L(6, '2B', 'in'),
  R(13, '4Y', 'out'), R(12, '4B', 'in'), R(11, '4A', 'in'), R(10, '3Y', 'out'), R(9, '3B', 'in'), R(8, '3A', 'in'),
], { gates: [{ o: 1, i: [2, 3], f: 'nor' }, { o: 4, i: [5, 6], f: 'nor' }, { o: 10, i: [8, 9], f: 'nor' }, { o: 13, i: [11, 12], f: 'nor' }] });

def('7404', '六反相器', '门电路', [
  L(1, '1A', 'in'), L(2, '1Y', 'out'), L(3, '2A', 'in'), L(4, '2Y', 'out'), L(5, '3A', 'in'), L(6, '3Y', 'out'),
  R(13, '6A', 'in'), R(12, '6Y', 'out'), R(11, '5A', 'in'), R(10, '5Y', 'out'), R(9, '4A', 'in'), R(8, '4Y', 'out'),
], { gates: [{ o: 2, i: [1], f: 'not' }, { o: 4, i: [3], f: 'not' }, { o: 6, i: [5], f: 'not' }, { o: 8, i: [9], f: 'not' }, { o: 10, i: [11], f: 'not' }, { o: 12, i: [13], f: 'not' }] });

def('7408', '四2输入与门', '门电路', [
  L(1, '1A', 'in'), L(2, '1B', 'in'), L(3, '1Y', 'out'), L(4, '2A', 'in'), L(5, '2B', 'in'), L(6, '2Y', 'out'),
  R(13, '4B', 'in'), R(12, '4A', 'in'), R(11, '4Y', 'out'), R(10, '3B', 'in'), R(9, '3A', 'in'), R(8, '3Y', 'out'),
], { gates: [{ o: 3, i: [1, 2], f: 'and' }, { o: 6, i: [4, 5], f: 'and' }, { o: 8, i: [9, 10], f: 'and' }, { o: 11, i: [12, 13], f: 'and' }] });

def('7410', '三3输入与非门', '门电路', [
  L(1, '1A', 'in'), L(2, '1B', 'in'), L(3, '2A', 'in'), L(4, '2B', 'in'), L(5, '2C', 'in'), L(6, '2Y', 'out'),
  R(13, '3Y', 'out'), R(12, '3C', 'in'), R(11, '3B', 'in'), R(10, '3A', 'in'), R(9, '1C', 'in'), R(8, '1Y', 'out'),
], { gates: [{ o: 8, i: [1, 2, 9], f: 'nand' }, { o: 6, i: [3, 4, 5], f: 'nand' }, { o: 13, i: [10, 11, 12], f: 'nand' }] });

def('7411', '三3输入与门', '门电路', [
  L(1, '1A', 'in'), L(2, '1B', 'in'), L(3, '2A', 'in'), L(4, '2B', 'in'), L(5, '2C', 'in'), L(6, '2Y', 'out'),
  R(13, '3Y', 'out'), R(12, '3C', 'in'), R(11, '3B', 'in'), R(10, '3A', 'in'), R(9, '1C', 'in'), R(8, '1Y', 'out'),
], { gates: [{ o: 8, i: [1, 2, 9], f: 'and' }, { o: 6, i: [3, 4, 5], f: 'and' }, { o: 13, i: [10, 11, 12], f: 'and' }] });

def('7420', '双4输入与非门', '门电路', [
  L(1, '1A', 'in'), L(2, '1B', 'in'), L(4, '1C', 'in'), L(5, '1D', 'in'), L(6, '1Y', 'out'),
  R(13, '2D', 'in'), R(12, '2C', 'in'), R(10, '2B', 'in'), R(9, '2A', 'in'), R(8, '2Y', 'out'),
], { gates: [{ o: 6, i: [1, 2, 4, 5], f: 'nand' }, { o: 8, i: [9, 10, 12, 13], f: 'nand' }] });

def('7421', '双4输入与门', '门电路', [
  L(1, '1A', 'in'), L(2, '1B', 'in'), L(4, '1C', 'in'), L(5, '1D', 'in'), L(6, '1Y', 'out'),
  R(13, '2D', 'in'), R(12, '2C', 'in'), R(10, '2B', 'in'), R(9, '2A', 'in'), R(8, '2Y', 'out'),
], { gates: [{ o: 6, i: [1, 2, 4, 5], f: 'and' }, { o: 8, i: [9, 10, 12, 13], f: 'and' }] });

def('7432', '四2输入或门', '门电路', [
  L(1, '1A', 'in'), L(2, '1B', 'in'), L(3, '1Y', 'out'), L(4, '2A', 'in'), L(5, '2B', 'in'), L(6, '2Y', 'out'),
  R(13, '4B', 'in'), R(12, '4A', 'in'), R(11, '4Y', 'out'), R(10, '3B', 'in'), R(9, '3A', 'in'), R(8, '3Y', 'out'),
], { gates: [{ o: 3, i: [1, 2], f: 'or' }, { o: 6, i: [4, 5], f: 'or' }, { o: 8, i: [9, 10], f: 'or' }, { o: 11, i: [12, 13], f: 'or' }] });

def('7486', '四2输入异或门', '门电路', [
  L(1, '1A', 'in'), L(2, '1B', 'in'), L(3, '1Y', 'out'), L(4, '2A', 'in'), L(5, '2B', 'in'), L(6, '2Y', 'out'),
  R(13, '4B', 'in'), R(12, '4A', 'in'), R(11, '4Y', 'out'), R(10, '3B', 'in'), R(9, '3A', 'in'), R(8, '3Y', 'out'),
], { gates: [{ o: 3, i: [1, 2], f: 'xor' }, { o: 6, i: [4, 5], f: 'xor' }, { o: 8, i: [9, 10], f: 'xor' }, { o: 11, i: [12, 13], f: 'xor' }] });

/* ========================= 组合逻辑 ========================= */

/* 7448 BCD→七段译码 (共阴, 段输出高有效) */
const SEG_DIGITS = [0x3F, 0x06, 0x5B, 0x4F, 0x66, 0x6D, 0x7D, 0x07, 0x7F, 0x6F];
def('7448', 'BCD→七段译码器', '组合逻辑', [
  L(1, 'B', 'in'), L(2, 'C', 'in'), L(3, '~LT', 'in'), L(4, '~BI', 'in'), L(5, '~RBI', 'in'), L(6, 'D', 'in'), L(7, 'A', 'in'),
  R(15, 'f', 'out'), R(14, 'g', 'out'), R(13, 'a', 'out'), R(12, 'b', 'out'), R(11, 'c', 'out'), R(10, 'd', 'out'), R(9, 'e', 'out'),
], {
  eval(ch, e) {
    const A = e.read(7), B = e.read(1), C = e.read(2), D = e.read(6);
    const lt = e.readLo(3), bi = e.readLo(4), rbi = e.readLo(5);
    const P = [13, 12, 11, 10, 9, 15, 14]; // a b c d e f g
    let seg;
    if (bi) seg = 0;
    else if (lt) seg = 0x7F;
    else if ([A, B, C, D].indexOf(VX) >= 0) seg = null;
    else {
      const n = (D << 3) | (C << 2) | (B << 1) | A;
      seg = n > 9 ? 0 : ((rbi && n === 0) ? 0 : SEG_DIGITS[n]);
    }
    for (let i = 0; i < 7; i++) e.drive(P[i], seg === null ? VX : ((seg >> i) & 1), 2);
  },
});

/* 74138 3线-8线译码器 (输出低有效) */
def('74138', '3线-8线译码器', '组合逻辑', [
  L(1, 'A', 'in'), L(2, 'B', 'in'), L(3, 'C', 'in'), L(4, '~G2A', 'in'), L(5, '~G2B', 'in'), L(6, 'G1', 'in'), L(7, 'Y7', 'out'),
  R(15, 'Y0', 'out'), R(14, 'Y1', 'out'), R(13, 'Y2', 'out'), R(12, 'Y3', 'out'), R(11, 'Y4', 'out'), R(10, 'Y5', 'out'), R(9, 'Y6', 'out'),
], {
  eval(ch, e) {
    const OUT = [15, 14, 13, 12, 11, 10, 9, 7];
    if (!e.readHi(6) || !e.readLo(4) || !e.readLo(5)) {
      for (const p of OUT) e.drive(p, 1, 2);
      return;
    }
    const a = e.read(1), b = e.read(2), c = e.read(3);
    if (a === VX || b === VX || c === VX) {
      for (const p of OUT) e.drive(p, VX, 2);
      return;
    }
    const m = (c << 2) | (b << 1) | a;
    OUT.forEach((p, i) => e.drive(p, i === m ? 0 : 1, 2));
  },
});

/* 74139 双2线-4线译码器 (输出低有效) */
def('74139', '双2线-4线译码器', '组合逻辑', [
  L(1, '1~E', 'in'), L(2, '1A', 'in'), L(3, '1B', 'in'), L(4, '1Y0', 'out'), L(5, '1Y1', 'out'), L(6, '1Y2', 'out'), L(7, '1Y3', 'out'),
  R(15, '2Y0', 'out'), R(14, '2Y1', 'out'), R(13, '2Y2', 'out'), R(12, '2Y3', 'out'), R(11, '2B', 'in'), R(10, '2A', 'in'), R(9, '2~E', 'in'),
], {
  eval(ch, e) {
    const units = [{ E: 1, a: 2, b: 3, Y: [4, 5, 6, 7] }, { E: 9, a: 10, b: 11, Y: [15, 14, 13, 12] }];
    for (const u of units) {
      if (!e.readLo(u.E)) { for (const p of u.Y) e.drive(p, 1, 2); continue; }
      const a = e.read(u.a), b = e.read(u.b);
      if (a === VX || b === VX) { for (const p of u.Y) e.drive(p, VX, 2); continue; }
      const m = (b << 1) | a;
      u.Y.forEach((p, i) => e.drive(p, i === m ? 0 : 1, 2));
    }
  },
});

/* 74151 8选1数据选择器 */
def('74151', '8选1数据选择器', '组合逻辑', [
  L(1, 'D3', 'in'), L(2, 'D2', 'in'), L(3, 'D1', 'in'), L(4, 'D0', 'in'), L(5, '~Y', 'out'), L(6, 'Y', 'out'), L(7, '~ST', 'in'),
  R(15, 'D4', 'in'), R(14, 'D5', 'in'), R(13, 'D6', 'in'), R(12, 'D7', 'in'), R(11, 'A', 'in'), R(10, 'B', 'in'), R(9, 'C', 'in'),
], {
  eval(ch, e) {
    let y;
    if (!e.readLo(7)) { y = 0; }               // 选通无效 → Y=0
    else {
      const A = e.read(11), B = e.read(10), C = e.read(9);
      if (A === VX || B === VX || C === VX) y = VX;
      else {
        const m = (C << 2) | (B << 1) | A;
        const D = [4, 3, 2, 1, 15, 14, 13, 12];
        y = e.read(D[m]);
      }
    }
    e.drive(6, y, 2);
    e.drive(5, e.notv(y), 2);
  },
});

/* 74153 双4选1数据选择器 */
def('74153', '双4选1数据选择器', '组合逻辑', [
  L(1, '1~G', 'in'), L(2, 'S1', 'in'), L(3, '1I3', 'in'), L(4, '1I2', 'in'), L(5, '1I1', 'in'), L(6, '1I0', 'in'), L(7, '1Y', 'out'),
  R(15, '2~G', 'in'), R(14, 'S0', 'in'), R(13, '2I3', 'in'), R(12, '2I2', 'in'), R(11, '2I1', 'in'), R(10, '2I0', 'in'), R(9, '2Y', 'out'),
], {
  eval(ch, e) {
    const units = [{ G: 1, I: [6, 5, 4, 3], y: 7 }, { G: 15, I: [10, 11, 12, 13], y: 9 }];
    const s0 = e.read(14), s1 = e.read(2);
    for (const u of units) {
      if (!e.readLo(u.G)) { e.drive(u.y, 0, 2); continue; }
      if (s0 === VX || s1 === VX) { e.drive(u.y, VX, 2); continue; }
      e.drive(u.y, e.read(u.I[(s1 << 1) | s0]), 2);
    }
  },
});

/* 74157 四2选1数据选择器 */
def('74157', '四2选1数据选择器', '组合逻辑', [
  L(1, '1A', 'in'), L(2, '1B', 'in'), L(3, '1Y', 'out'), L(4, '2A', 'in'), L(5, '2B', 'in'), L(6, '2Y', 'out'), L(7, '~ST', 'in'),
  R(15, '3A', 'in'), R(14, '3B', 'in'), R(13, '3Y', 'out'), R(12, '4A', 'in'), R(11, '4B', 'in'), R(10, '4Y', 'out'), R(9, 'SEL', 'in'),
], {
  eval(ch, e) {
    const U = [[1, 2, 3], [4, 5, 6], [15, 14, 13], [12, 11, 10]];
    const sel = e.read(9);
    for (const [a, b, y] of U) {
      if (!e.readLo(7)) { e.drive(y, 0, 2); continue; }
      if (sel === VX) { e.drive(y, VX, 2); continue; }
      e.drive(y, e.read(sel ? b : a), 2);
    }
  },
});

/* 74283 4位二进制全加器 */
def('74283', '4位全加器', '组合逻辑', [
  L(1, 'S2', 'out'), L(2, 'B2', 'in'), L(3, 'A2', 'in'), L(4, 'S1', 'out'), L(5, 'A1', 'in'), L(6, 'B1', 'in'), L(7, 'C0', 'in'),
  R(15, 'B3', 'in'), R(14, 'A3', 'in'), R(13, 'S3', 'out'), R(12, 'A4', 'in'), R(11, 'B4', 'in'), R(10, 'S4', 'out'), R(9, 'C4', 'out'),
], {
  eval(ch, e) {
    const A = [5, 3, 14, 12].map(n => e.read(n)); // A1..A4
    const B = [6, 2, 15, 11].map(n => e.read(n)); // B1..B4
    const c0 = e.read(7);
    const all = A.concat(B, [c0]);
    if (all.indexOf(VX) >= 0) {
      for (const p of [4, 1, 13, 10, 9]) e.drive(p, VX, 3);
      return;
    }
    let n = c0;
    for (let i = 0; i < 4; i++) n += (A[i] << i) + (B[i] << i);
    e.drive(4, n & 1, 3);
    e.drive(1, (n >> 1) & 1, 3);
    e.drive(13, (n >> 2) & 1, 3);
    e.drive(10, (n >> 3) & 1, 3);
    e.drive(9, (n >> 4) & 1, 3);
  },
});

/* 7485 4位幅度比较器 */
def('7485', '4位比较器', '组合逻辑', [
  L(1, 'B3', 'in'), L(2, 'IN<', 'in'), L(3, 'IN=', 'in'), L(4, 'IN>', 'in'), L(5, 'Q>', 'out'), L(6, 'Q=', 'out'), L(7, 'Q<', 'out'),
  R(15, 'A3', 'in'), R(14, 'B2', 'in'), R(13, 'A2', 'in'), R(12, 'A1', 'in'), R(11, 'B1', 'in'), R(10, 'A0', 'in'), R(9, 'B0', 'in'),
], {
  eval(ch, e) {
    const A = [10, 12, 13, 15].map(n => e.read(n)); // A0..A3
    const B = [9, 11, 14, 1].map(n => e.read(n));   // B0..B3
    const bad = A.indexOf(VX) >= 0 || B.indexOf(VX) >= 0;
    if (bad) { e.drive(5, VX, 3); e.drive(6, VX, 3); e.drive(7, VX, 3); return; }
    let gt = false, eq = true;
    for (let i = 3; i >= 0; i--) {
      if (A[i] > B[i]) { gt = true; eq = false; break; }
      if (A[i] < B[i]) { gt = false; eq = false; break; }
    }
    if (!eq) {
      e.drive(5, gt ? 1 : 0, 3); e.drive(6, 0, 3); e.drive(7, gt ? 0 : 1, 3);
    } else {
      const lt = e.read(2), lq = e.read(3), gt2 = e.read(4);
      if (lt === VX || lq === VX || gt2 === VX) {
        e.drive(5, VX, 3); e.drive(6, VX, 3); e.drive(7, VX, 3);
      } else {
        e.drive(7, lt, 3); e.drive(6, lq, 3); e.drive(5, gt2, 3);
      }
    }
  },
});

/* ========================= 触发器 ========================= */

/* 7474 双D触发器 (上升沿, 异步预置/清零) */
def('7474', '双D触发器', '触发器/锁存', [
  L(1, '1~CLR', 'in'), L(2, '1D', 'in'), L(3, '1CK', 'in'), L(4, '1~PRE', 'in'), L(5, '1Q', 'out'), L(6, '1~Q', 'out'),
  R(13, '2~CLR', 'in'), R(12, '2D', 'in'), R(11, '2CK', 'in'), R(10, '2~PRE', 'in'), R(9, '2~Q', 'out'), R(8, '2Q', 'out'),
], {
  eval(ch, e) {
    const s = ch.state;
    const G = [[1, 2, 3, 4, 5, 6], [13, 12, 11, 10, 8, 9]]; // [~CLR,D,CK,~PRE,Q,~Q]
    for (let i = 0; i < 2; i++) {
      const [cN, dN, kN, pN, qN, nN] = G[i];
      const clr = e.readLo(cN), pre = e.readLo(pN);
      const d = e.read(dN), ck = e.read(kN);
      const pk = s['pck' + i] == null ? 0 : s['pck' + i];
      s['pck' + i] = ck === 1 ? 1 : 0;
      let q = s['q' + i] == null ? 0 : s['q' + i];
      const oq = q;
      if (clr && pre) q = VX;
      else if (clr) q = 0;
      else if (pre) q = 1;
      else if (pk === 0 && ck === 1) q = (d === VX ? VX : d);
      s['q' + i] = q;
      if (!s['ini' + i]) { s['ini' + i] = 1; e.drive(qN, q, 3); e.drive(nN, e.notv(q), 3); }
      else if (q !== oq) { e.drive(qN, q, 3); e.drive(nN, e.notv(q), 3); }
    }
  },
});

/* 7476 双JK触发器 (上升沿, 异步预置/清零) */
def('7476', '双JK触发器', '触发器/锁存', [
  L(1, '1CK', 'in'), L(2, '1~PRE', 'in'), L(3, '1~CLR', 'in'), L(4, '1J', 'in'), L(5, '1K', 'in'), L(6, '1Q', 'out'), L(7, '1~Q', 'out'),
  R(15, '2CK', 'in'), R(14, '2~PRE', 'in'), R(13, '2~CLR', 'in'), R(12, '2J', 'in'), R(11, '2K', 'in'), R(10, '2Q', 'out'), R(9, '2~Q', 'out'),
], {
  eval(ch, e) {
    const s = ch.state;
    const G = [[1, 2, 3, 4, 5, 6, 7], [15, 14, 13, 12, 11, 10, 9]]; // [CK,~PRE,~CLR,J,K,Q,~Q]
    for (let i = 0; i < 2; i++) {
      const [kN, pN, cN, jN, kkN, qN, nN] = G[i];
      const clr = e.readLo(cN), pre = e.readLo(pN);
      const j = e.read(jN), k = e.read(kkN), ck = e.read(kN);
      const pk = s['pck' + i] == null ? 0 : s['pck' + i];
      s['pck' + i] = ck === 1 ? 1 : 0;
      let q = s['q' + i] == null ? 0 : s['q' + i];
      const oq = q;
      if (clr && pre) q = VX;
      else if (clr) q = 0;
      else if (pre) q = 1;
      else if (pk === 0 && ck === 1) {
        if (j === VX || k === VX) q = VX;
        else if (j && k) q = q === VX ? VX : (q ? 0 : 1);
        else if (j && !k) q = 1;
        else if (!j && k) q = 0;
      }
      s['q' + i] = q;
      if (!s['ini' + i]) { s['ini' + i] = 1; e.drive(qN, q, 3); e.drive(nN, e.notv(q), 3); }
      else if (q !== oq) { e.drive(qN, q, 3); e.drive(nN, e.notv(q), 3); }
    }
  },
});

/* 74175 四D触发器 (互补输出, 公共时钟/清零) */
def('74175', '四D触发器', '触发器/锁存', [
  L(1, 'CK', 'in'), L(2, '~CLR', 'in'), L(3, 'Q0', 'out'), L(4, '~Q0', 'out'), L(5, 'D1', 'in'), L(6, 'Q1', 'out'), L(7, '~Q1', 'out'),
  R(15, 'D0', 'in'), R(14, 'D3', 'in'), R(13, 'Q3', 'out'), R(12, '~Q3', 'out'), R(11, 'D2', 'in'), R(10, 'Q2', 'out'), R(9, '~Q2', 'out'),
], {
  eval(ch, e) {
    const s = ch.state;
    const G = [[15, 3, 4], [5, 6, 7], [11, 10, 9], [14, 13, 12]]; // [D,Q,~Q]
    const ck = e.read(1);
    const clr = e.readLo(2);
    const pk = s.pck == null ? 0 : s.pck;
    s.pck = ck === 1 ? 1 : 0;
    for (let i = 0; i < 4; i++) {
      const [dN, qN, nN] = G[i];
      let q = s['q' + i] == null ? 0 : s['q' + i];
      const oq = q;
      if (clr) q = 0;
      else if (pk === 0 && ck === 1) { const d = e.read(dN); q = d === VX ? VX : d; }
      s['q' + i] = q;
      if (!s['ini' + i]) { s['ini' + i] = 1; e.drive(qN, q, 3); e.drive(nN, e.notv(q), 3); }
      else if (q !== oq) { e.drive(qN, q, 3); e.drive(nN, e.notv(q), 3); }
    }
  },
});

/* 74374 八D触发器 (三态输出) */
def('74374', '八D触发器(三态)', '触发器/锁存', [
  L(1, '~OE', 'in'), L(2, 'D1', 'in'), L(3, 'D2', 'in'), L(4, 'D3', 'in'), L(5, 'D4', 'in'), L(6, 'D5', 'in'), L(7, 'D6', 'in'), L(8, 'D7', 'in'), L(9, 'D8', 'in'),
  R(19, 'Q1', 'io'), R(18, 'Q2', 'io'), R(17, 'Q3', 'io'), R(16, 'Q4', 'io'), R(15, 'Q5', 'io'), R(14, 'Q6', 'io'), R(13, 'Q7', 'io'), R(12, 'Q8', 'io'), R(11, 'CK', 'in'),
], {
  eval(ch, e) {
    const s = ch.state;
    const D = [2, 3, 4, 5, 6, 7, 8, 9], Q = [19, 18, 17, 16, 15, 14, 13, 12];
    const ck = e.read(11);
    const pk = s.pck == null ? 0 : s.pck;
    s.pck = ck === 1 ? 1 : 0;
    const en = e.readLo(1); // ~OE=0 输出使能
    for (let i = 0; i < 8; i++) {
      let q = s['q' + i] == null ? 0 : s['q' + i];
      if (pk === 0 && ck === 1) { const d = e.read(D[i]); q = d === VX ? VX : d; }
      s['q' + i] = q;
      e.drive(Q[i], en ? q : 'Z', 3);
    }
  },
});

/* ========================= 计数 / 移位 ========================= */

/* 74161 4位同步二进制计数器 (异步清零, 同步置数) */
def('74161', '4位二进制计数器', '计数/移位', [
  L(1, '~CLR', 'in'), L(2, 'CK', 'in'), L(3, 'A', 'in'), L(4, 'B', 'in'), L(5, 'C', 'in'), L(6, 'D', 'in'), L(7, 'ENP', 'in'),
  R(15, 'RCO', 'out'), R(14, 'QA', 'out'), R(13, 'QB', 'out'), R(12, 'QC', 'out'), R(11, 'QD', 'out'), R(10, 'ENT', 'in'), R(9, '~LOAD', 'in'),
], {
  eval(ch, e) {
    const s = ch.state;
    if (s.cnt == null) s.cnt = 0;
    const Q = [14, 13, 12, 11]; // QA..QD
    const driveQ = () => {
      for (let i = 0; i < 4; i++) e.drive(Q[i], s.cnt === VX ? VX : (s.cnt >> i) & 1, 3);
    };
    const clr = e.readLo(1);
    const ck = e.read(2);
    const pk = s.pck == null ? 0 : s.pck;
    s.pck = ck === 1 ? 1 : 0;
    if (clr) {
      if (s.cnt !== 0) { s.cnt = 0; driveQ(); }
    } else if (pk === 0 && ck === 1) {
      if (e.readLo(9)) {
        const d = [e.read(3), e.read(4), e.read(5), e.read(6)];
        s.cnt = d.indexOf(VX) >= 0 ? VX : (d[0] | (d[1] << 1) | (d[2] << 2) | (d[3] << 3));
        driveQ();
      } else if (s.cnt !== VX && e.readHi(7) && e.readHi(10)) {
        s.cnt = (s.cnt + 1) & 15;
        driveQ();
      }
    }
    const rco = s.cnt === VX ? VX : ((e.readHi(10) && s.cnt === 15) ? 1 : 0);
    e.drive(15, rco, 2);
    if (!s.ini) { s.ini = 1; driveQ(); }
  },
});

/* 74164 8位串入并出移位寄存器 */
def('74164', '8位移位寄存器', '计数/移位', [
  L(1, 'A', 'in'), L(2, 'B', 'in'), L(3, 'Q0', 'out'), L(4, 'Q1', 'out'), L(5, 'Q2', 'out'), L(6, 'Q3', 'out'),
  R(13, '~CLR', 'in'), R(12, 'Q7', 'out'), R(11, 'Q6', 'out'), R(10, 'Q5', 'out'), R(9, 'Q4', 'out'), R(8, 'CK', 'in'),
], {
  eval(ch, e) {
    const s = ch.state;
    if (s.v == null) { s.v = 0; s.x = 0; }
    const Q = [3, 4, 5, 6, 9, 10, 11, 12];
    const ck = e.read(8);
    const clr = e.readLo(13);
    const pk = s.pck == null ? 0 : s.pck;
    s.pck = ck === 1 ? 1 : 0;
    let changed = false;
    if (clr) {
      if (s.v !== 0 || s.x !== 0) { s.v = 0; s.x = 0; changed = true; }
    } else if (pk === 0 && ck === 1) {
      const a = e.read(1), b = e.read(2);
      let nb, nx = 0;
      if (a === VX || b === VX) { nb = 0; nx = 1; }
      else nb = a & b;
      s.v = ((s.v << 1) | nb) & 0xFF;
      s.x = ((s.x << 1) | nx) & 0xFF;
      changed = true;
    }
    if (!s.ini || changed) {
      s.ini = 1;
    }
    for (let i = 0; i < 8; i++)
      e.drive(Q[i], (s.x >> i) & 1 ? VX : (s.v >> i) & 1, 3);
  },
});

/* 74595 8位移位寄存器(带输出锁存, 三态) */
def('74595', '8位移位锁存器', '计数/移位', [
  L(1, 'Q1', 'io'), L(2, 'Q2', 'io'), L(3, 'Q3', 'io'), L(4, 'Q4', 'io'), L(5, 'Q5', 'io'), L(6, 'Q6', 'io'), L(7, 'Q7', 'io'),
  R(15, 'Q0', 'io'), R(14, 'DS', 'in'), R(13, '~OE', 'in'), R(12, 'ST_CP', 'in'), R(11, 'SH_CP', 'in'), R(10, '~MR', 'in'), R(9, "Q7'", 'out'),
], {
  eval(ch, e) {
    const s = ch.state;
    if (s.sv == null) { s.sv = 0; s.sx = 0; s.lv = 0; s.lx = 0; }
    const Q = [15, 1, 2, 3, 4, 5, 6, 7];
    // 主复位(异步, 仅清移位寄存器)
    if (e.readLo(10)) { if (s.sv !== 0 || s.sx !== 0) { s.sv = 0; s.sx = 0; } }
    // 移位时钟
    const sh = e.read(11);
    const psh = s.psh == null ? 0 : s.psh;
    s.psh = sh === 1 ? 1 : 0;
    if (sh !== VX && psh === 0 && sh === 1) {
      const d = e.read(14);
      const nx = d === VX ? 1 : 0;
      s.sv = ((s.sv << 1) | (d === 1 ? 1 : 0)) & 0xFF;
      s.sx = ((s.sx << 1) | nx) & 0xFF;
    }
    // 锁存时钟
    const st = e.read(12);
    const pst = s.pst == null ? 0 : s.pst;
    s.pst = st === 1 ? 1 : 0;
    if (st !== VX && pst === 0 && st === 1) { s.lv = s.sv; s.lx = s.sx; }
    // 输出
    const en = e.readLo(13); // ~OE=0 输出使能
    for (let i = 0; i < 8; i++) {
      const v = (s.lx >> i) & 1 ? VX : (s.lv >> i) & 1;
      e.drive(Q[i], en ? v : 'Z', 3);
    }
    e.drive(9, (s.sx >> 7) & 1 ? VX : (s.sv >> 7) & 1, 3);
  },
});

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

/* ========================= 输入 / 输出元件 ========================= */

def('SW', '开关(单击切换)', '输入/输出', [R(1, 'Q', 'out')], {
  custom: true, fixedRot: true, hideNums: true, size: { w: 56, h: 56 },
  init(ch) { const p = ch.pinByNum[1]; p.driven = ch.state.on ? 1 : 0; },
});

def('BTN', '按键(按住=1)', '输入/输出', [R(1, 'Q', 'out')], {
  custom: true, fixedRot: true, hideNums: true, size: { w: 56, h: 56 },
  init(ch) { ch.pinByNum[1].driven = 0; },
});

def('CLOCK', '时钟源(右键改频率)', '输入/输出', [R(1, 'CLK', 'out')], {
  custom: true, fixedRot: true, hideNums: true, size: { w: 56, h: 56 },
  defaults: { freq: 2 },
  init(ch) { ch.state.phase = ch.state.phase || 0; ch.pinByNum[1].driven = ch.state.phase ? 1 : 0; },
});

def('LED', 'LED 指示灯', '输入/输出', [L(1, 'IN', 'in')], {
  custom: true, fixedRot: true, hideNums: true, size: { w: 56, h: 56 },
});

def('SEG7', '七段数码管(共阴)', '输入/输出', [
  L(1, 'a', 'in'), L(2, 'b', 'in'), L(3, 'c', 'in'), L(4, 'd', 'in'),
  L(5, 'e', 'in'), L(6, 'f', 'in'), L(7, 'g', 'in'), L(8, 'dp', 'in'),
], { custom: true, fixedRot: true, hideNums: true, size: { w: 168 } });

def('PROBE', '逻辑探针(显示电平)', '输入/输出', [L(1, 'IN', 'in')], {
  custom: true, fixedRot: true, hideNums: true, size: { w: 56, h: 56 },
});

def('VCC', '电源 +5V(恒1)', '输入/输出', [R(1, '5V', 'out')], {
  custom: true, fixedRot: true, hideNums: true, size: { w: 56, h: 56 },
  init(ch) { ch.pinByNum[1].driven = 1; },
});

def('GND', '地 GND(恒0)', '输入/输出', [R(1, 'GND', 'out')], {
  custom: true, fixedRot: true, hideNums: true, size: { w: 56, h: 56 },
  init(ch) { ch.pinByNum[1].driven = 0; },
});

/* ========================= 存储器 ========================= */

const MEM_SIZE = 256;   // 256 × 8bit, A0..A7

function memDefault(identity) {
  const m = new Array(MEM_SIZE).fill(0);
  if (identity) for (let i = 0; i < MEM_SIZE; i++) m[i] = i & 0xFF;   // ROM 出厂: 内容=地址
  return m;
}
/** 地址位 A0..A7 (脚1..8); 悬空/未知位按 0 (弱上拉策略, 与 ~ 引脚一致) */
function memAddr(e) {
  let a = 0;
  for (let i = 0; i < 8; i++) if (e.read(i + 1) === V1) a |= 1 << i;
  return a;
}

def('ROM', 'ROM 256×8 (右键编辑/导入)', '存储器', [
  L(1, 'A0', 'in'), L(2, 'A1', 'in'), L(3, 'A2', 'in'), L(4, 'A3', 'in'),
  L(5, 'A4', 'in'), L(6, 'A5', 'in'), L(7, 'A6', 'in'), L(8, 'A7', 'in'),
  R(9, 'D0', 'out'), R(10, 'D1', 'out'), R(11, 'D2', 'out'), R(12, 'D3', 'out'),
  R(13, 'D4', 'out'), R(14, 'D5', 'out'), R(15, 'D6', 'out'), R(16, 'D7', 'out'),
], {
  defaults: { mem: memDefault(true) },
  eval(ch, e) {
    const a = memAddr(e);
    const m = ch.props.mem || (ch.props.mem = memDefault(true));
    const v = m[a] || 0;
    for (let i = 0; i < 8; i++) e.drive(9 + i, (v >> i) & 1, 3);
  },
});

def('RAM', 'RAM 256×8 (CS/WE 高有效)', '存储器', [
  L(1, 'A0', 'in'), L(2, 'A1', 'in'), L(3, 'A2', 'in'), L(4, 'A3', 'in'),
  L(5, 'A4', 'in'), L(6, 'A5', 'in'), L(7, 'A6', 'in'), L(8, 'A7', 'in'),
  L(9, 'WE', 'in'), L(10, 'CS', 'in'),
  R(11, 'D0', 'io'), R(12, 'D1', 'io'), R(13, 'D2', 'io'), R(14, 'D3', 'io'),
  R(15, 'D4', 'io'), R(16, 'D5', 'io'), R(17, 'D6', 'io'), R(18, 'D7', 'io'),
], {
  defaults: { mem: memDefault(false) },
  eval(ch, e) {
    const m = ch.props.mem || (ch.props.mem = memDefault(false));
    const cs = e.read(10) === V1;   // 片选, 高有效; 悬空/未知 = 未选中
    const we = e.read(9) === V1;    // 写使能, 高有效
    const a = memAddr(e);
    if (!cs) {
      for (let i = 0; i < 8; i++) e.drive(11 + i, VZ, 3);   // 未选中: 数据线高阻
      return;
    }
    if (we) {
      // 写: 数据位含未知 (悬空总线) 时不写入, 避免破坏内容
      let v = 0, ok = true;
      for (let i = 0; i < 8; i++) {
        const b = e.read(11 + i);
        if (b === VX) { ok = false; break; }
        if (b === V1) v |= 1 << i;
      }
      if (ok) m[a] = v;
      for (let i = 0; i < 8; i++) e.drive(11 + i, VZ, 3);   // 写周期数据线保持高阻
    } else {
      const v = m[a] || 0;
      for (let i = 0; i < 8; i++) e.drive(11 + i, (v >> i) & 1, 3);
    }
  },
});

const CHIPS = { LIB };
global.CHIPS = CHIPS;
if (typeof module !== 'undefined' && module.exports) module.exports = CHIPS;

})(typeof window !== 'undefined' ? window : globalThis);
