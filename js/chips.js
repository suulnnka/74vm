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
def('74374', '八D触发器·三态', '触发器/锁存', [
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

def('SW', '开关·单击切换', '输入/输出', [R(1, 'Q', 'out')], {
  custom: true, hideNums: true, size: { w: 56, h: 56 },
  init(ch) { const p = ch.pinByNum[1]; p.driven = ch.state.on ? 1 : 0; },
});

def('BTN', '按键·按住=1', '输入/输出', [R(1, 'Q', 'out')], {
  custom: true, hideNums: true, size: { w: 56, h: 56 },
  init(ch) { ch.pinByNum[1].driven = 0; },
});

def('CLOCK', '时钟源·右键改频率', '输入/输出', [R(1, 'CLK', 'out')], {
  custom: true, hideNums: true, size: { w: 56, h: 56 },
  osc: {},                                  // 无稳态源: 引擎按帧扫描推进 (见 engine.advance)
  defaults: { freq: 2 },
  init(ch) { ch.state.phase = ch.state.phase || 0; ch.pinByNum[1].driven = ch.state.phase ? 1 : 0; },
});

/* NE555 定时器 — 真实 DIP-8 封装 (1脚GND / 8脚VCC, 需供电), 无稳态振荡输出时钟。
 * 数字化抽象: OUT 按 freq 50% 占空比翻转 (~RST 低电平停振并复位),
 * DISCH 为真实放电管行为 (OUT 低电平期导通=0, 高电平期截止=Z);
 * TRIG/THRES 在无稳态下由外部 RC 驱动, 数字模型不单独建模。 */
function ne555OscTick(ch, eng) {
  ch.state.hi = (eng.readPin(ch, 4) === V0) ? 0 : (ch.state.hi ? 0 : 1);   // ~RST 低: 强制低
  eng.applyPin(ch.pinByNum[3], ch.state.hi ? V1 : V0);
  eng.applyPin(ch.pinByNum[7], ch.state.hi ? VZ : V0);
}
def('NE555', 'NE555 定时器·时钟(右键改频率)', '输入/输出', [
  L(2, 'TRIG', 'in'), L(3, 'OUT', 'out'), L(4, '~RST', 'in'),
  R(7, 'DISCH', 'out'), R(6, 'THRES', 'in'),
], {
  pwr: { vcc: 8, gnd: 1 },                  // 真实电源脚位 (非 74 系列约定)
  osc: { tick: ne555OscTick },
  defaults: { freq: 2 },
  init(ch) { ch.state.hi = 0; ch.pinByNum[3].driven = V0; ch.pinByNum[7].driven = V0; },
  eval(ch, e) {
    if (ch.powered === false || e.readLo(4)) ch.state.hi = 0;   // ~RST 低: 立即复位
    e.drive(3, ch.state.hi ? V1 : V0, 0);                       // 重申相位 (结构变化后)
    e.drive(7, ch.state.hi ? VZ : V0, 0);
  },
});

def('LED', 'LED 指示灯', '输入/输出', [L(1, 'IN', 'in')], {
  custom: true, hideNums: true, size: { w: 56, h: 56 },
});

def('SEG7', '七段数码管·共阴', '输入/输出', [
  L(1, 'a', 'in'), L(2, 'b', 'in'), L(3, 'c', 'in'), L(4, 'd', 'in'),
  L(5, 'e', 'in'), L(6, 'f', 'in'), L(7, 'g', 'in'), L(8, 'dp', 'in'),
], { custom: true, hideNums: true, size: { w: 168 } });

def('PROBE', '逻辑探针·显示电平', '输入/输出', [L(1, 'IN', 'in')], {
  custom: true, hideNums: true, size: { w: 56, h: 56 },
});

def('VCC', '电源 +5V·恒1', '输入/输出', [R(1, '5V', 'out')], {
  custom: true, hideNums: true, size: { w: 56, h: 56 },
  init(ch) { ch.pinByNum[1].driven = 1; },
});

def('GND', '地 GND·恒0', '输入/输出', [R(1, 'GND', 'out')], {
  custom: true, hideNums: true, size: { w: 56, h: 56 },
  init(ch) { ch.pinByNum[1].driven = 0; },
});

/* ---------------- PS/2 键盘 ----------------
 * 点击元件聚焦后用真实键盘打字, 按标准 PS/2 协议在 CLK/DATA 上串行发送:
 *   帧 = 起始位0 + 8数据位(LSB在前) + 奇校验位 + 停止位1, 共 11 个时钟脉冲
 *   键盘主动产生 ~16.7kHz 时钟 (半周期 30µs); DATA 在 CLK 高电平期间建立,
 *   CLK 低电平期间保持稳定 → 主机在 CLK 下降沿或上升沿采样均可
 * 扫描码为 PS/2 默认的 Set 2: 按下发 Make 码, 松开发 Break 码 (0xF0 + Make),
 * 扩展键 (方向键/右 Ctrl 等) 前缀 0xE0; CapsLock 按下/松开都发 Make (无 Break)
 * 键位按 e.code (物理键位) 映射, 与操作系统键盘布局无关 (映射表在 app.js)
 * 待发字节队列在 state.queue (随存档保存), 发送中的帧状态在 ch._ps2 (仅运行期) */
const PS2_HALF = 30;   // CLK 半周期 µs (~16.7kHz)

/* Set 2 扫描码表 (按物理键位 e.code) 与扩展键前缀表 */
const PS2_CODE = {
  KeyA: 0x1C, KeyB: 0x32, KeyC: 0x21, KeyD: 0x23, KeyE: 0x24, KeyF: 0x2B,
  KeyG: 0x34, KeyH: 0x33, KeyI: 0x43, KeyJ: 0x3B, KeyK: 0x42, KeyL: 0x4B,
  KeyM: 0x3A, KeyN: 0x31, KeyO: 0x44, KeyP: 0x4D, KeyQ: 0x15, KeyR: 0x2D,
  KeyS: 0x1B, KeyT: 0x2C, KeyU: 0x3C, KeyV: 0x2A, KeyW: 0x1D, KeyX: 0x22,
  KeyY: 0x35, KeyZ: 0x1A,
  Digit1: 0x16, Digit2: 0x1E, Digit3: 0x26, Digit4: 0x25, Digit5: 0x2E,
  Digit6: 0x36, Digit7: 0x3D, Digit8: 0x3E, Digit9: 0x46, Digit0: 0x45,
  Enter: 0x5A, Space: 0x29, Backspace: 0x66, Escape: 0x76, Tab: 0x0D,
  CapsLock: 0x58,
  F1: 0x05, F2: 0x06, F3: 0x04, F4: 0x0C, F5: 0x03, F6: 0x0B,
  F7: 0x83, F8: 0x0A, F9: 0x01, F10: 0x09, F11: 0x78, F12: 0x07,
  Minus: 0x55, Equal: 0x4E, BracketLeft: 0x54, BracketRight: 0x5B,
  Backslash: 0x5D, Semicolon: 0x4C, Quote: 0x52, Backquote: 0x0E,
  Comma: 0x41, Period: 0x49, Slash: 0x4A,
  ShiftLeft: 0x12, ShiftRight: 0x59, ControlLeft: 0x14, AltLeft: 0x11,
  Numpad0: 0x70, Numpad1: 0x69, Numpad2: 0x72, Numpad3: 0x7A,
  Numpad4: 0x6B, Numpad5: 0x73, Numpad6: 0x74, Numpad7: 0x6C,
  Numpad8: 0x75, Numpad9: 0x7D, NumpadMultiply: 0x7C, NumpadSubtract: 0x7B,
  NumpadAdd: 0x79, NumpadDecimal: 0x71,
};
const PS2_EXT = {
  ArrowUp: 0x75, ArrowDown: 0x72, ArrowLeft: 0x6B, ArrowRight: 0x74,
  ControlRight: 0x14, AltRight: 0x11, NumpadEnter: 0x5A, NumpadDivide: 0x4A,
  Home: 0x6C, End: 0x69, PageUp: 0x7D, PageDown: 0x7A,
  Insert: 0x70, Delete: 0x71, MetaLeft: 0x5B, MetaRight: 0x5C, ContextMenu: 0x5D,
};

/* 字符 → 扫描码序列 (美式布局; 大写/上位符号自动夹 Shift) */
const PS2_CHAR = (() => {
  const m = { ' ': [0x29, 0xF0, 0x29], '\n': [0x5A, 0xF0, 0x5A], '\t': [0x0D, 0xF0, 0x0D] };
  for (const ec in PS2_CODE) {
    if (/^Key[A-Z]$/.test(ec)) {
      const L = ec.slice(3);
      const k = PS2_CODE[ec];
      m[L.toLowerCase()] = [k, 0xF0, k];
      m[L] = [0x12, k, 0xF0, k, 0xF0, 0x12];
    } else if (/^Digit[0-9]$/.test(ec)) {
      m[ec[5]] = [PS2_CODE[ec], 0xF0, PS2_CODE[ec]];
    }
  }
  const shifted = { '!': 'Digit1', '@': 'Digit2', '#': 'Digit3', '$': 'Digit4',
    '%': 'Digit5', '^': 'Digit6', '&': 'Digit7', '*': 'Digit8', '(': 'Digit9',
    ')': 'Digit0', '~': 'Backquote', '_': 'Minus', '+': 'Equal',
    '{': 'BracketLeft', '}': 'BracketRight', '|': 'Backslash', ':': 'Semicolon',
    '"': 'Quote', '<': 'Comma', '>': 'Period', '?': 'Slash' };
  for (const c in shifted) { const k = PS2_CODE[shifted[c]]; m[c] = [0x12, k, 0xF0, k, 0xF0, 0x12]; }
  const plain = { '-': 'Minus', '=': 'Equal', '[': 'BracketLeft', ']': 'BracketRight',
    '\\': 'Backslash', ';': 'Semicolon', "'": 'Quote', ',': 'Comma',
    '.': 'Period', '/': 'Slash', '`': 'Backquote' };
  for (const c in plain) m[c] = [PS2_CODE[plain[c]], 0xF0, PS2_CODE[plain[c]]];
  return m;
})();
function ps2CharCodes(c) {
  if (PS2_CHAR[c]) return PS2_CHAR[c];
  if (c == null) return null;   // 调试: 越界访问时打印现场
  console.error('DBG ps2CharCodes got:', JSON.stringify(c));
  const up = c.toUpperCase();
  const code = PS2_CODE['Key' + up];
  return code != null ? [0x12, code, 0xF0, code, 0xF0, 0x12] : null;   // 其他大写字母兜底
}

/* 测试脚本: 每行一条 type 文本 / sleep 毫秒 / key 键名; # 与空行忽略 */
function ps2ParseScript(text) {
  const acts = [];
  for (const raw of String(text).split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#') || line.startsWith('//')) continue;
    const sl = line.match(/^sleep\s+(\d+)(ms|s)?$/i);
    if (sl) { acts.push({ type: 'sleep', us: +sl[1] * (sl[2] && sl[2].toLowerCase() === 's' ? 1000000 : 1000) }); continue; }
    const ky = line.match(/^key\s+([A-Za-z0-9]+)$/);
    if (ky) {
      let name = ky[1];
      name = name.charAt(0).toUpperCase() + name.slice(1);
      const code = PS2_CODE[name] != null ? PS2_CODE[name] : PS2_EXT[name];
      if (code != null) {
        const bytes = PS2_EXT[name] != null
          ? [0xE0, code, 0xE0, 0xF0, code]
          : [code, 0xF0, code];
        acts.push({ type: 'bytes', bytes });
      }
      continue;
    }
    const tp = line.match(/^type\s+([\s\S]*)$/);
    acts.push({ type: 'type', text: tp ? tp[1] : line });
  }
  return acts;
}

/** 脚本运行器: 引擎定时器驱动; 等发送排空 → 逐动作投喂字节 */
function ps2ScriptTick(ch, e) {
  if (!ch.state.running) { DBG('die: not running'); ch._sTick = false; return; }
  const run = ch.state.run;
  if (!run) { DBG('die: no run'); ch._sTick = false; return; }
  if ((ch._ps2 && ch._ps2.active) || ch.state.queue.length >= 56) {
    e.schedule(200, () => ps2ScriptTick(ch, e));            // 等帧/队列排空
    return;
  }
  if (run.i >= run.acts.length) {                            // 脚本完成
    ch.state.running = false;
    ch._sTick = false;
    delete ch.state.run;
    if (typeof window !== 'undefined')
      window.dispatchEvent(new CustomEvent('ps2scriptdone', { detail: { id: ch.id } }));
    return;
  }
  const a = run.acts[run.i];
  if (a.type === 'sleep') {
    run.i++;
    e.schedule(a.us, () => ps2ScriptTick(ch, e));
    return;
  }
  if (a.type === 'bytes') {
    ch.state.queue.push(...a.bytes);
    run.i++;
    ps2KickSend(ch, e);
    e.schedule(2000, () => ps2ScriptTick(ch, e));
    return;
  }
  if (run.ci >= a.text.length) {                             // 本行打完
    run.i++; run.ci = 0;
    e.schedule(500, () => ps2ScriptTick(ch, e));
    return;
  }
  if (run.ci >= a.text.length) { console.error('DBG ci overshoot in same tick', run.ci, a.text.length, a.text); }
  const codes = ps2CharCodes(a.text[run.ci]);
  run.ci++;
  if (codes) {
    if (ch.state.queue.length + codes.length > 64) {         // 队列将满: 等待
      e.schedule(200, () => ps2ScriptTick(ch, e));
      return;
    }
    ch.state.queue.push(...codes);
    ps2KickSend(ch, e);
  }
  e.schedule(4000, () => ps2ScriptTick(ch, e));              // 字符间 4ms
}
function ps2KickSend(ch, e) {
  if (!ch._ps2 || !ch._ps2.active) {         // 空闲: 重新启动发送状态机
    ch._ps2 = { active: true, phase: 0, bit: 0, bits: null, byte: 0 };
    ps2Tick(ch, e);
  }
}

/** 一字节的 11 个帧位: 0 + d0..d7 + 奇校验 + 1 */
function ps2FrameBits(byte) {
  const bits = [0];
  let ones = 0;
  for (let i = 0; i < 8; i++) { const b = (byte >> i) & 1; bits.push(b); ones += b; }
  bits.push(ones % 2 === 0 ? 1 : 0);   // 补 1 使 数据+校验 中 1 的个数为奇
  bits.push(1);
  return bits;
}

/** 发送状态机: 建 DATA(30µs) → CLK 低(30µs, 采样) → CLK 高(30µs) → 下一位 */
function ps2Tick(ch, e) {
  const t = ch._ps2;
  if (!t || !t.active) return;
  if (t.phase === 0) {                      // CLK 高电平期: 建立 DATA
    if (!t.bits || t.bit >= t.bits.length) {
      if (!ch.state.queue.length) {         // 队列空 → 回空闲
        t.active = false;
        e.drive(1, V1, 0); e.drive(2, V1, 0);
        return;
      }
      t.byte = ch.state.queue.shift();
      ch.state.lastByte = t.byte;
      t.bits = ps2FrameBits(t.byte);
      t.bit = 0;
    }
    e.drive(2, t.bits[t.bit], 0);
    t.phase = 1;
  } else if (t.phase === 1) {               // CLK 下降沿 (主机采样点)
    e.drive(1, V0, 0);
    t.phase = 2;
  } else {                                  // CLK 上升沿
    e.drive(1, V1, 0);
    t.bit++;
    t.phase = 0;
  }
  e.schedule(PS2_HALF, () => ps2Tick(ch, e));
}

def('PS2', 'PS/2键盘·点击后打字', '输入/输出', [
  R(1, 'CLK', 'out'), R(2, 'DATA', 'out'),
], {
  custom: true, hideNums: true, size: { w: 168, h: 112 },
  init(ch) {
    const s = ch.state;
    if (!Array.isArray(s.queue)) s.queue = [];
    s.running = false; delete s.run;         // 载入/上电: 脚本从头开始
    ch._ps2 = null;                          // 载入/上电: 丢弃发送中的帧
    ch.pinByNum[1].driven = V1;              // 空闲: CLK/DATA 均为高
    ch.pinByNum[2].driven = V1;
  },
  eval(ch, e) {
    const t = ch._ps2;
    if (ch.state.running && !ch._sTick) {    // 脚本运行器: 引擎定时器驱动
      ch._sTick = true;
      e.schedule(100, () => ps2ScriptTick(ch, e));   // _sTick 由链存活期持有
    }
    if (t && t.active) return;               // 发送中: 状态机经 timer 自驱动
    if (!ch.state.queue.length) return;
    ch._ps2 = { active: true, phase: 0, bit: 0, bits: null, byte: 0 };
    ps2Tick(ch, e);
  },
});

global.PS2_CODE = PS2_CODE;
global.PS2_EXT = PS2_EXT;
global.ps2ParseScript = ps2ParseScript;
global.ps2CharCodes = ps2CharCodes;

/* ---------------- 4×4 矩阵键盘 ----------------
 * 16 个按键按 4×4 排列, 8 个引脚 = 4 列 (C1..C4, 输入, 接主机扫描驱动)
 * + 4 行 (R1..R4, 输出, 接主机读取)。按键 (行r, 列c) 按下 = 行 r 与列 c 接通。
 * 行脚由元件驱动 (等效内置下拉/上拉电阻, 仿真无电阻元件):
 *   该行无按键按下 → 输出 props.pull 电平 (0=下拉·空闲0, 1=上拉·空闲1)
 *   按下的键所在列 = 1 → 行输出 1; 全为 0 → 0; 列未驱动(X) → 行输出 X
 * 支持 上拉+列低有效 (经典 74138/74145 扫描) 或 下拉+列高有效 两种极性。
 * state.keys = { "行,列": 1 } 记录按住中的键 (瞬时器件, 不随存档恢复) */
def('KB44', '4×4矩阵键盘·按住按键', '输入/输出', [
  L(1, 'C1', 'in'), L(2, 'C2', 'in'), L(3, 'C3', 'in'), L(4, 'C4', 'in'),
  R(5, 'R1', 'out'), R(6, 'R2', 'out'), R(7, 'R3', 'out'), R(8, 'R4', 'out'),
], {
  custom: true, hideNums: true, size: { w: 168, h: 168 },
  defaults: { pull: 0 },
  init(ch) {
    ch.state.keys = {};
    const idle = Number(ch.props.pull) ? V1 : V0;
    for (let i = 0; i < 4; i++) ch.pinByNum[5 + i].driven = idle;
  },
  eval(ch, e) {
    const idle = Number(ch.props.pull) ? V1 : V0;
    const keys = ch.state.keys || (ch.state.keys = {});
    for (let r = 0; r < 4; r++) {
      let has1 = false, hasX = false, pressed = false;
      for (let c = 0; c < 4; c++) {
        if (!keys[r + ',' + c]) continue;
        pressed = true;
        const cv = e.read(1 + c);
        if (cv === V1) has1 = true;
        else if (cv === VX) hasX = true;
      }
      e.drive(5 + r, has1 ? V1 : (hasX ? VX : (pressed ? V0 : idle)), 2);
    }
  },
});

/* ========================= 存储器 =========================
 * 以真实器件型号建模, 新型号只需提供 mem 配置 + 引脚表:
 *   mem = { kind:'rom'|'ram', size, mask, addr:[脚...低位在前], data:[脚...],
 *           ce/cs/we/oe: { pin, low } , weWriteHigh }
 *   - 地址/数据脚号按型号排布; 地址悬空/未知位按 0 (弱上拉策略)
 *   - CE/CS/WE/OE 低有效用 low:true; 悬空/未知视为"未动作"
 *   - RAM 写入时数据位含未知则跳过, 避免悬空总线破坏内容
 *   - weWriteHigh: true=WE 高电平写 (如 74189), false=WE 低电平写 (如 6116)
 * 注意: 引脚号为仿真简化排布 (电源脚省略), 与实物封装图未必一致 */

function memDefault(m, identity) {
  const a = new Array(m.size).fill(0);
  if (identity) for (let i = 0; i < m.size; i++) a[i] = i & m.mask;   // ROM 出厂: 内容=地址
  return a;
}
function memOf(ch, m, identity) {
  if (!ch.props.mem || ch.props.mem.length !== m.size) {
    ch.props.mem = memDefault(m, identity && m.kind === 'rom');
  }
  return ch.props.mem;
}
function memAddrBits(e, addr) {
  let a = 0;
  for (let i = 0; i < addr.length; i++) if (e.read(addr[i]) === V1) a |= 1 << i;
  return a;
}
function memActive(e, c) {   // 使能脚: low=true 低有效; 无该脚 = 恒使能
  if (!c) return true;
  return c.low ? e.read(c.pin) === V0 : e.read(c.pin) === V1;
}
function memEval(ch, e) {
  const m = LIB[ch.type].mem;
  const mem = memOf(ch, m, true);
  const a = memAddrBits(e, m.addr);
  const ce = memActive(e, m.ce) && memActive(e, m.cs) && memActive(e, m.oe);
  if (m.kind === 'rom') {
    for (let i = 0; i < m.data.length; i++)
      e.drive(m.data[i], ce ? ((mem[a] >> i) & 1) : VZ, 3);
    return;
  }
  // RAM
  const weLevel = m.weWriteHigh ? V1 : V0;
  const writing = e.read(m.we.pin) === weLevel;   // 极性由 weWriteHigh 决定; X → 视为读
  if (ce && writing) {
    let v = 0, ok = true;
    for (let i = 0; i < m.data.length; i++) {
      const b = e.read(m.data[i]);
      if (b === VX) { ok = false; break; }   // 悬空总线: 不写入
      if (b === V1) v |= 1 << i;
    }
    if (ok) mem[a] = v & m.mask;
  }
  const driving = ce && !writing && memActive(e, m.oe);
  const v = mem[a] || 0;
  for (let i = 0; i < m.data.length; i++)
    e.drive(m.data[i], driving ? ((v >> i) & 1) : VZ, 3);
}
/** 存储器元件定义 (ROM/PROM: kind='rom'; RAM/SRAM: kind='ram') */
function defMem(type, desc, mem, pins) {
  def(type, desc, '存储器', pins, { mem, defaults: { mem: memDefault(mem, mem.kind === 'rom') }, eval: memEval });
}

/* 74187 — 256×4 TTL ROM, A0..A7 + O1..O4, 常驱动 */
defMem('74187', 'ROM 256×4', { kind: 'rom', size: 256, mask: 0x0F,
  addr: [1, 2, 3, 4, 5, 6, 7, 8], data: [9, 10, 11, 12] }, [
  L(1, 'A0', 'in'), L(2, 'A1', 'in'), L(3, 'A2', 'in'), L(4, 'A3', 'in'),
  L(5, 'A4', 'in'), L(6, 'A5', 'in'), L(7, 'A6', 'in'), L(8, 'A7', 'in'),
  R(9, 'O1', 'out'), R(10, 'O2', 'out'), R(11, 'O3', 'out'), R(12, 'O4', 'out'),
]);

/* 74S472 — 512×8 PROM, A0..A8 + /CE + D0..D7, /CE 低有效使能输出 */
defMem('74S472', 'PROM 512×8', { kind: 'rom', size: 512, mask: 0xFF,
  addr: [1, 2, 3, 4, 5, 6, 7, 8, 9], data: [11, 12, 13, 14, 15, 16, 17, 18],
  ce: { pin: 10, low: true } }, [
  L(1, 'A0', 'in'), L(2, 'A1', 'in'), L(3, 'A2', 'in'), L(4, 'A3', 'in'),
  L(5, 'A4', 'in'), L(6, 'A5', 'in'), L(7, 'A6', 'in'), L(8, 'A7', 'in'),
  L(9, 'A8', 'in'), L(10, '/CE', 'in'),
  R(11, 'D0', 'out'), R(12, 'D1', 'out'), R(13, 'D2', 'out'), R(14, 'D3', 'out'),
  R(15, 'D4', 'out'), R(16, 'D5', 'out'), R(17, 'D6', 'out'), R(18, 'D7', 'out'),
]);

/* 74189 — 16×4 RAM, /CS /WE 低有效; /WE=1 写, /WE=0 读, 三态输出 */
defMem('74189', 'RAM 16×4', { kind: 'ram', size: 16, mask: 0x0F,
  addr: [1, 2, 3, 4], data: [7, 8, 9, 10],
  cs: { pin: 5, low: true }, we: { pin: 6, low: true }, weWriteHigh: true }, [
  L(1, 'A0', 'in'), L(2, 'A1', 'in'), L(3, 'A2', 'in'), L(4, 'A3', 'in'),
  L(5, '/CS', 'in'), L(6, '/WE', 'in'),
  R(7, 'D1', 'io'), R(8, 'D2', 'io'), R(9, 'D3', 'io'), R(10, 'D4', 'io'),
]);

/* 6116 — SRAM 2K×8, /CS /WE /OE 低有效; /WE=0 写, /WE=1 且 /OE=0 读 */
defMem('6116', 'SRAM 2K×8', { kind: 'ram', size: 2048, mask: 0xFF,
  addr: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11], data: [13, 14, 15, 16, 17, 18, 19, 20],
  cs: { pin: 21, low: true }, oe: { pin: 22, low: true }, we: { pin: 12, low: true }, weWriteHigh: false }, [
  L(1, 'A0', 'in'), L(2, 'A1', 'in'), L(3, 'A2', 'in'), L(4, 'A3', 'in'),
  L(5, 'A4', 'in'), L(6, 'A5', 'in'), L(7, 'A6', 'in'), L(8, 'A7', 'in'),
  L(9, 'A8', 'in'), L(10, 'A9', 'in'), L(11, 'A10', 'in'), L(12, '/WE', 'in'),
  R(13, 'D0', 'io'), R(14, 'D1', 'io'), R(15, 'D2', 'io'), R(16, 'D3', 'io'),
  R(17, 'D4', 'io'), R(18, 'D5', 'io'), R(19, 'D6', 'io'), R(20, 'D7', 'io'),
  L(21, '/CS', 'in'), L(22, '/OE', 'in'),
]);


/* ========================= 1602 字符型液晶 =========================
 * HD44780 风格接口: RS (1=数据/0=指令) + E (上升沿锁存) + 8 位数据总线,
 * RW 内部接地 (只写). 内置中文字库: 数据字节 >= 0x80 时与下一字节组成
 * GB2312 双字节编码, 合成一个汉字写入光标处; ASCII 字节单字节直写.
 * 常用指令: 0x01 清屏, 0x02/0x03 回 home, 0x80|n 设置地址
 * (第一行 0x00~0x27, 第二行 0x40~0x67). 地址悬空/未知按 0. */

let _gb2312 = null;
function lcdDataByte(e) {
  let v = 0;
  for (let i = 0; i < 8; i++) if (e.read(3 + i) === V1) v |= 1 << i;
  return v;
}
function lcdNext(a) { return a === 0x27 ? 0x40 : (a >= 0x67 ? 0 : a + 1); }
function lcdPush(ch, b) {
  const dd = ch.state.ddram;
  if (b < 0x80) {
    dd[ch.state.cur] = String.fromCharCode(b);
  } else if (ch.state.pending == null) {
    ch.state.pending = b;                        // 汉字首字节, 等待次字节
    return;
  } else {
    try {
      _gb2312 = _gb2312 || new TextDecoder('gb2312');
      dd[ch.state.cur] = _gb2312.decode(new Uint8Array([ch.state.pending, b]));
    } catch (err) { dd[ch.state.cur] = '?'; }
    ch.state.pending = null;
  }
  ch.state.cur = lcdNext(ch.state.cur);
}
function lcdExecCmd(ch, cmd) {
  const dd = ch.state.ddram;
  if (cmd === 0x01) {                            // 清屏
    for (let i = 0; i < 80; i++) dd[i] = ' ';
    ch.state.cur = 0; ch.state.pending = null;
  } else if (cmd === 0x02 || cmd === 0x03) {     // 回 home
    ch.state.cur = 0; ch.state.pending = null;
  } else if (cmd >= 0x80) {                      // 设置 DDRAM 地址
    const a = cmd & 0x7F;
    ch.state.cur = a < 80 ? a : 0;
    ch.state.pending = null;
  }
}
function lcdEnsureState(ch) {
  if (ch.state.ddram && ch.state.ddram.length === 80) return;
  const dd = new Array(80).fill(' ');
  const t1 = 'Hello, 74VM!', t2 = '中文液晶测试';
  [...t1].forEach((c, i) => { dd[i] = c; });
  [...t2].forEach((c, i) => { dd[0x40 + i] = c; });
  ch.state.ddram = dd;
  ch.state.cur = 0;
  ch.state.pending = null;
  ch.state.prevE = 0;
}

def('LCD1602', '1602 液晶·内置中文字库', '输入/输出', [
  L(1, 'RS', 'in'), L(2, 'E', 'in'),
  R(3, 'D0', 'in'), R(4, 'D1', 'in'), R(5, 'D2', 'in'), R(6, 'D3', 'in'),
  R(7, 'D4', 'in'), R(8, 'D5', 'in'), R(9, 'D6', 'in'), R(10, 'D7', 'in'),
], {
  custom: true, hideNums: true, size: { w: 224, h: 112 },
  init(ch) { lcdEnsureState(ch); },
  eval(ch, e) {
    lcdEnsureState(ch);
    const en = e.read(2);
    const rising = en === V1 && ch.state.prevE !== V1;   // E 上升沿锁存
    ch.state.prevE = en;
    if (!rising) return;
    if (e.read(1) === V1) lcdPush(ch, lcdDataByte(e));   // RS=1 数据
    else lcdExecCmd(ch, lcdDataByte(e));                 // RS=0 指令
  },
});

function lcdPush12864(dd, b, ch) {
  if (b < 0x80) {
    dd[ch.state.cur] = String.fromCharCode(b);
  } else if (ch.state.pending == null) {
    ch.state.pending = b;
    return;
  } else {
    try {
      _gb2312 = _gb2312 || new TextDecoder('gb2312');
      dd[ch.state.cur] = _gb2312.decode(new Uint8Array([ch.state.pending, b]));
    } catch (err) { dd[ch.state.cur] = '?'; }
    ch.state.pending = null;
  }
  ch.state.cur = (ch.state.cur + 1) % 64;
}

/* ========================= 12864 图形液晶 (ST7920 风格) =========================
 * 同 1602 接口 (RS+E+8 位数据, RW 接地), 双层显示:
 *   文字层 DDRAM 4 行 × 16 半宽字符 (基本指令集 0x30, 地址 0x00~0x3F 线性),
 *   GB2312 双字节合成汉字 (占 1 格, 仿真简化);
 *   图形层 GDRAM 128×64 像素 (扩充指令集 0x34/0x36 开图形, 0x80|y 设行、
 *   0x80|x 设字节列, 每次 1 字节 = 8 像素, 列自动 +1);
 *   0x01 清空两层, 0x02 文字回 home. 渲染: 图形点阵 + 文字叠加. */

function lcd12864Ensure(ch) {
  if (!ch.state.ddram || ch.state.ddram.length !== 64) {
    const dd = new Array(64).fill(' ');
    const put = (row, str) => { [...str].slice(0, 16).forEach((c, i) => { dd[row * 16 + i] = c; }); };
    put(0, '12864 图形液晶');
    put(1, 'ST7920 中文库');
    ch.state.ddram = dd;
    ch.state.cur = 0;
  }
  if (!ch.state.gdram || ch.state.gdram.length !== 1024) {
    const g = new Array(1024).fill(0);
    for (let x = 0; x < 128; x++) { g[x >> 3] |= 0x80 >> (x & 7); g[63 * 16 + (x >> 3)] |= 0x80 >> (x & 7); }
    for (let y = 0; y < 64; y++) { g[y * 16] |= 0x80; g[y * 16 + 15] |= 0x01; }
    ch.state.gdram = g;   // 出厂演示: 屏幕四周一圈边框
  }
  if (ch.state.ext == null) {
    ch.state.ext = false; ch.state.gOn = false;
    ch.state.gStage = 0; ch.state.gy = 0; ch.state.gx = 0;
    ch.state.cur = 0; ch.state.prevE = 0;
  }
}

def('LCD12864', '12864 图形液晶·中文字库', '输入/输出', [
  L(1, 'RS', 'in'), L(2, 'E', 'in'),
  R(3, 'D0', 'in'), R(4, 'D1', 'in'), R(5, 'D2', 'in'), R(6, 'D3', 'in'),
  R(7, 'D4', 'in'), R(8, 'D5', 'in'), R(9, 'D6', 'in'), R(10, 'D7', 'in'),
], {
  custom: true, hideNums: true, size: { w: 280, h: 168 },
  init(ch) { lcd12864Ensure(ch); },
  eval(ch, e) {
    lcd12864Ensure(ch);
    const en = e.read(2);
    const rising = en === V1 && ch.state.prevE !== V1;
    ch.state.prevE = en;
    if (!rising) return;
    const b = lcdDataByte(e);
    const dd = ch.state.ddram;
    if (e.read(1) === V1) {                          // 数据写入
      if (ch.state.ext && ch.state.gOn) {            // 图形模式: 1 字节 = 8 像素
        ch.state.gdram[ch.state.gy * 16 + ch.state.gx] = b;
        ch.state.gx = (ch.state.gx + 1) % 16;
      } else {
        lcdPush12864(dd, b, ch);
      }
      return;
    }
    // 指令
    if (b === 0x01) {                                // 清屏: 文字 + 图形
      dd.fill(' ');
      ch.state.gdram.fill(0);
      ch.state.cur = 0; ch.state.gStage = 0; ch.state.pending = null;
    } else if (b === 0x02) {                         // 文字回 home
      ch.state.cur = 0;
    } else if (b === 0x30) {                         // 基本指令集
      ch.state.ext = false;
    } else if (b === 0x34 || b === 0x36) {           // 扩充指令集 (0x36 同时开图形)
      ch.state.ext = true;
      ch.state.gOn = b === 0x36;
    } else if (b >= 0x80) {                          // 设地址
      const a = b & 0x7F;
      if (ch.state.ext) {                            // 图形地址: 先行 Y 后字节列 X
        if (ch.state.gStage === 0) { ch.state.gy = a & 63; ch.state.gStage = 1; }
        else { ch.state.gx = a & 15; ch.state.gStage = 0; }
      } else {
        ch.state.cur = a < 64 ? a : 0;
      }
    }
  },
});

const CHIPS = { LIB };
global.CHIPS = CHIPS;
if (typeof module !== 'undefined' && module.exports) module.exports = CHIPS;

})(typeof window !== 'undefined' ? window : globalThis);
