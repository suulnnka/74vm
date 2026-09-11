/* =========================================================================
 * 74VM 元件库 — 组合逻辑 / 触发器 / 计数移位 / 存储器家族
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

/* ========================= 组合逻辑 ========================= */

/* 7448 BCD→七段译码 (共阴, 段输出高有效) */
const SEG_DIGITS = [0x3F, 0x06, 0x5B, 0x4F, 0x66, 0x6D, 0x7D, 0x07, 0x7F, 0x6F];

def('7448', 'BCD→七段译码器', '组合逻辑', [
  L(1, 'B', 'in'), L(2, 'C', 'in'), L(3, '~LT', 'in'), L(4, '~BI', 'in'), L(5, '~RBI', 'in'), L(6, 'D', 'in'), L(7, 'A', 'in'),
  R(15, 'f', 'out'), R(14, 'g', 'out'), R(13, 'a', 'out'), R(12, 'b', 'out'), R(11, 'c', 'out'), R(10, 'd', 'out'), R(9, 'e', 'out'),
], {
  detail: '将 4 位 BCD 码译成七段显示码 (段输出高有效, 配共阴数码管)。\n引脚: A~D 为 BCD 输入 (D 为最高位), a~g 为段输出; ~LT 试灯、~BI 灭灯、~RBI 灭零, 均低有效。',
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
  detail: '将 3 位地址译成 8 根选通线 (输出低有效)。\n引脚: A/B/C 为地址 (C 为最高位), Y0~Y7 为输出, 选中者输出 0 其余为 1; G1=1 且 ~G2A=~G2B=0 时使能, 否则输出全 1。',
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
  detail: '内含 2 个独立的 2线-4线译码器 (输出低有效)。\n引脚: 每组 A/B 为地址 (B 为高位), Y0~Y3 为输出, 选中者输出 0; ~E 使能 (低有效, 无效时输出全 1)。',
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
  detail: '8 选 1 数据选择器, 从 8 路数据中按地址选 1 路输出。\n引脚: D0~D7 为数据输入, A/B/C 为地址 (C 为最高位), Y 与 ~Y 为互补输出; ~ST 选通 (低有效, 无效时 Y=0)。',
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
  detail: '内含 2 个 4选1 数据选择器, 地址公用。\n引脚: 1I0~1I3、2I0~2I3 为各自数据输入, S1/S0 为公共地址 (S1 为高位), 1Y/2Y 为输出, 1~G/2~G 为各组选通 (低有效, 无效时 Y=0)。',
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
  detail: '内含 4 个 2选1 数据选择器 (同相输出)。\n引脚: 每组 A/B 为数据输入, Y 为输出; SEL=0 选 A、SEL=1 选 B; ~ST 选通 (低有效, 无效时输出全 0)。',
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
  detail: '4 位二进制全加器, 带进位输入输出。\n引脚: A1~A4、B1~B4 为加数输入 (4 为最高位), C0 为低位进位输入; S1~S4 为和输出, C4 为进位输出 (级联用)。',
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
  detail: '比较两个 4 位二进制数的大小。\n引脚: A0~A3、B0~B3 为数据输入; Q>、Q=、Q< 输出比较结果; IN>、IN=、IN< 为级联输入, 接低位片结果。',
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
  detail: '内含 2 个上升沿触发的 D 触发器。\n引脚: 每组 D 为数据、CK 为时钟 (上升沿存入), Q 与 ~Q 互补输出; ~PRE 异步置 1、~CLR 异步清 0, 均低有效 (不用时接高)。',
  volatile: true,                                  // 全局开机: 状态清零 (见 engine.powerOn)
  rebase(ch, e) {                                  // 边沿基线对齐当前电平 (防全量重评估产生假沿)
    ch.state.pck0 = e.read(3) === V1 ? 1 : 0;
    ch.state.pck1 = e.read(11) === V1 ? 1 : 0;
  },
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
  detail: '内含 2 个上升沿触发的 JK 触发器。\n引脚: 每组 J/K 为输入、CK 为时钟 (上升沿触发, J=K=1 时翻转), Q 与 ~Q 互补输出; ~PRE/~CLR 异步置 1/清 0 (低有效)。',
  volatile: true,
  rebase(ch, e) {
    ch.state.pck0 = e.read(1) === V1 ? 1 : 0;
    ch.state.pck1 = e.read(15) === V1 ? 1 : 0;
  },
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
  detail: '4 个上升沿 D 触发器, 时钟与清零公用。\n引脚: D0~D3 为数据输入, CK 上升沿统一锁存, ~CLR 低有效清零; 每位有 Q 与 ~Q 互补输出。',
  volatile: true,
  rebase(ch, e) { ch.state.pck = e.read(1) === V1 ? 1 : 0; },
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
  detail: '8 个上升沿 D 触发器, 三态输出, 适合挂总线。\n引脚: D1~D8 为数据输入, CK 上升沿统一锁存; ~OE 输出使能 (低有效, 无效时 Q 呈高阻)。',
  volatile: true,
  rebase(ch, e) { ch.state.pck = e.read(11) === V1 ? 1 : 0; },
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
  detail: '4 位同步二进制计数器, 支持预置与级联。\n引脚: CK 上升沿计数, A~D 为预置数据, ~LOAD 同步置数、~CLR 异步清零 (均低有效); ENP/ENT 为计数使能, QA~QD 输出, RCO 为进位输出 (计到 15 且 ENT=1 时为 1)。',
  volatile: true,
  rebase(ch, e) { ch.state.pck = e.read(2) === V1 ? 1 : 0; },
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
  detail: '8 位串入并出移位寄存器。\n引脚: A、B 相与后为串行输入, CK 上升沿移位, ~CLR 低有效清零; Q0~Q7 为并行输出 (Q0 为最新移入位)。',
  volatile: true,
  rebase(ch, e) { ch.state.pck = e.read(8) === V1 ? 1 : 0; },
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
  detail: "8 位移位寄存器 + 输出锁存 (三态), 常用于 IO 扩展与级联。\n引脚: DS 串行输入, SH_CP 上升沿移位, ST_CP 上升沿把移位内容送到输出, ~OE 低有效使能输出, ~MR 低有效复位; Q0~Q7 并行输出, Q7' 供级联。",
  volatile: true,
  rebase(ch, e) {
    ch.state.psh = e.read(11) === V1 ? 1 : 0;
    ch.state.pst = e.read(12) === V1 ? 1 : 0;
  },
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

/* ========================= 存储器 =========================
 * 以真实器件型号建模, 新型号只需提供 mem 配置 + 引脚表:
 *   mem = { kind:'rom'|'ram', size, mask, addr:[脚...低位在前], data:[脚...],
 *           ce/cs/cs2/oe/we: { pin, low }, weWriteHigh }
 *   - 地址/数据脚号按型号排布: 74 系列样式 (74187/74S472/74189/6116) 为压缩编号
 *     (电源脚省略, 面包板视为常供电); AT28C64B/AT28C256/6264 为真实 DIP-28 编号,
 *     电源脚 14/28 省略, 由 lib.pwr 声明供电腿; 地址悬空/未知位按 0 (弱上拉策略)
 *   - CE/CS/WE/OE 低有效用 low:true; cs2 = 第二片选 (如 6264 的 CS2, 高有效 low:false);
 *     悬空/未知视为"未动作" (6264 的 CS2 悬空即不选中, 与实物一致)
 *   - RAM / EEPROM (kind:'rom' 且带 we 的电改写型) 写入时数据位含未知则跳过,
 *     避免悬空总线破坏内容
 *   - weWriteHigh: true=WE 高电平写 (如 74189), false=WE 低电平写 (如 6116/EEPROM) */

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
  const sel = memActive(e, m.ce) && memActive(e, m.cs) && memActive(e, m.cs2);
  if (m.kind === 'rom' && !m.we) {   // 纯 ROM/PROM: 片选 + /OE 使能读出
    for (let i = 0; i < m.data.length; i++)
      e.drive(m.data[i], sel && memActive(e, m.oe) ? ((mem[a] >> i) & 1) : VZ, 3);
    return;
  }
  // RAM / EEPROM: /WE 有效写入 (X 视为读), 读输出由 /OE 使能
  const weLevel = m.weWriteHigh ? V1 : V0;
  const writing = sel && e.read(m.we.pin) === weLevel;
  if (writing) {
    let v = 0, ok = true;
    for (let i = 0; i < m.data.length; i++) {
      const b = e.read(m.data[i]);
      if (b === VX) { ok = false; break; }   // 悬空总线: 不写入
      if (b === V1) v |= 1 << i;
    }
    if (ok) mem[a] = v & m.mask;
  }
  const driving = sel && !writing && memActive(e, m.oe);
  const v = mem[a] || 0;
  for (let i = 0; i < m.data.length; i++)
    e.drive(m.data[i], driving ? ((v >> i) & 1) : VZ, 3);
}
/** 存储器元件定义: 按 mem.kind 自动归类 — ROM/PROM/EEPROM (kind='rom') 入 ROM 类,
 *  RAM/SRAM (kind='ram') 入 RAM 类; extra 追加定义项 (如真实电源脚 pwr) */

function defMem(type, desc, mem, pins, detail, extra) {
  def(type, desc, mem.kind === 'rom' ? 'ROM' : 'RAM', pins, Object.assign(
    { mem, detail, defaults: { mem: memDefault(mem, mem.kind === 'rom') }, eval: memEval }, extra || {}));
}

/* 74187 — 256×4 TTL ROM, A0..A7 + O1..O4, 常驱动 */
defMem('74187', 'ROM 256×4', { kind: 'rom', size: 256, mask: 0x0F,
  addr: [1, 2, 3, 4, 5, 6, 7, 8], data: [9, 10, 11, 12] }, [
  L(1, 'A0', 'in'), L(2, 'A1', 'in'), L(3, 'A2', 'in'), L(4, 'A3', 'in'),
  L(5, 'A4', 'in'), L(6, 'A5', 'in'), L(7, 'A6', 'in'), L(8, 'A7', 'in'),
  R(9, 'O1', 'out'), R(10, 'O2', 'out'), R(11, 'O3', 'out'), R(12, 'O4', 'out'),
], '256×4 位只读存储器 (ROM), 出厂内容为地址值, 可烧录自定义内容。\n引脚: A0~A7 为地址输入 (寻址 256), O1~O4 为数据输出 (4 位, 常驱动无高阻)。');

/* 74S472 — 512×8 PROM, A0..A8 + /CE + D0..D7, /CE 低有效使能输出 */
defMem('74S472', 'PROM 512×8', { kind: 'rom', size: 512, mask: 0xFF,
  addr: [1, 2, 3, 4, 5, 6, 7, 8, 9], data: [11, 12, 13, 14, 15, 16, 17, 18],
  ce: { pin: 10, low: true } }, [
  L(1, 'A0', 'in'), L(2, 'A1', 'in'), L(3, 'A2', 'in'), L(4, 'A3', 'in'),
  L(5, 'A4', 'in'), L(6, 'A5', 'in'), L(7, 'A6', 'in'), L(8, 'A7', 'in'),
  L(9, 'A8', 'in'), L(10, '/CE', 'in'),
  R(11, 'D0', 'out'), R(12, 'D1', 'out'), R(13, 'D2', 'out'), R(14, 'D3', 'out'),
  R(15, 'D4', 'out'), R(16, 'D5', 'out'), R(17, 'D6', 'out'), R(18, 'D7', 'out'),
], '512×8 位可编程只读存储器 (PROM)。\n引脚: A0~A8 为地址输入 (寻址 512), D0~D7 为数据输出; /CE 片选低有效, 无效时输出高阻。');

/* 74189 — 16×4 RAM, /CS /WE 低有效; /WE=1 写, /WE=0 读, 三态输出 */
defMem('74189', 'RAM 16×4', { kind: 'ram', size: 16, mask: 0x0F,
  addr: [1, 2, 3, 4], data: [7, 8, 9, 10],
  cs: { pin: 5, low: true }, we: { pin: 6, low: true }, weWriteHigh: true }, [
  L(1, 'A0', 'in'), L(2, 'A1', 'in'), L(3, 'A2', 'in'), L(4, 'A3', 'in'),
  L(5, '/CS', 'in'), L(6, '/WE', 'in'),
  R(7, 'D1', 'io'), R(8, 'D2', 'io'), R(9, 'D3', 'io'), R(10, 'D4', 'io'),
], '16×4 位随机存取存储器 (RAM)。\n引脚: A0~A3 为地址输入 (寻址 16), D1~D4 为双向三态数据总线; /CS、/WE 均低有效: /WE=0 写入, /WE=1 读出。');

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
], '2048×8 位静态随机存取存储器 (SRAM)。\n引脚: A0~A10 为地址输入 (寻址 2048), D0~D7 为双向三态数据总线; /CS、/OE、/WE 均低有效: /WE=0 写入, /WE=1 且 /OE=0 读出。');

/* AT28C64B — EEPROM 8K×8, 真实 DIP-28 引脚 (1 脚 RDY/~BUSY 开漏输出与 26 脚 NC 省略,
 * 14/28 电源脚经 pwr 建模, 面包板需接电源轨); /CE /OE /WE 低有效, /WE=0 电改写 */
defMem('AT28C64B', 'EEPROM 8K×8', { kind: 'rom', size: 8192, mask: 0xFF,
  addr: [10, 9, 8, 7, 6, 5, 4, 3, 25, 24, 23, 21, 2], data: [11, 12, 13, 15, 16, 17, 18, 19],
  ce: { pin: 20, low: true }, oe: { pin: 22, low: true }, we: { pin: 27, low: true }, weWriteHigh: false }, [
  L(2, 'A12', 'in'), L(3, 'A7', 'in'), L(4, 'A6', 'in'), L(5, 'A5', 'in'),
  L(6, 'A4', 'in'), L(7, 'A3', 'in'), L(8, 'A2', 'in'), L(9, 'A1', 'in'), L(10, 'A0', 'in'),
  L(11, 'D0', 'io'), L(12, 'D1', 'io'), L(13, 'D2', 'io'),
  R(27, '/WE', 'in'), R(25, 'A8', 'in'), R(24, 'A9', 'in'), R(23, 'A11', 'in'),
  R(22, '/OE', 'in'), R(21, 'A10', 'in'), R(20, '/CE', 'in'),
  R(19, 'D7', 'io'), R(18, 'D6', 'io'), R(17, 'D5', 'io'), R(16, 'D4', 'io'), R(15, 'D3', 'io'),
], '8192×8 位电可擦除可编程只读存储器 (EEPROM), 内容随存档保存, 可右键十六进制编辑, 也能像 SRAM 一样电改写。\n引脚: 真实 DIP-28 编号, A0~A12 为地址, D0~D7 双向三态总线; /CE、/OE、/WE 均低有效: /WE=0 写入, /WE=1 且 /OE=0 读出; 14 脚 GND、28 脚 VCC (面包板需跳线接电源轨)。',
  { pwr: { vcc: 28, gnd: 14 } });

/* AT28C256 — EEPROM 32K×8, 真实 DIP-28 引脚, 与 62256 SRAM 兼容 (1 脚 A14, 26 脚 A13) */
defMem('AT28C256', 'EEPROM 32K×8', { kind: 'rom', size: 32768, mask: 0xFF,
  addr: [10, 9, 8, 7, 6, 5, 4, 3, 25, 24, 23, 21, 2, 26, 1], data: [11, 12, 13, 15, 16, 17, 18, 19],
  ce: { pin: 20, low: true }, oe: { pin: 22, low: true }, we: { pin: 27, low: true }, weWriteHigh: false }, [
  L(1, 'A14', 'in'), L(2, 'A12', 'in'), L(3, 'A7', 'in'), L(4, 'A6', 'in'), L(5, 'A5', 'in'),
  L(6, 'A4', 'in'), L(7, 'A3', 'in'), L(8, 'A2', 'in'), L(9, 'A1', 'in'), L(10, 'A0', 'in'),
  L(11, 'D0', 'io'), L(12, 'D1', 'io'), L(13, 'D2', 'io'),
  R(27, '/WE', 'in'), R(26, 'A13', 'in'), R(25, 'A8', 'in'), R(24, 'A9', 'in'), R(23, 'A11', 'in'),
  R(22, '/OE', 'in'), R(21, 'A10', 'in'), R(20, '/CE', 'in'),
  R(19, 'D7', 'io'), R(18, 'D6', 'io'), R(17, 'D5', 'io'), R(16, 'D4', 'io'), R(15, 'D3', 'io'),
], '32768×8 位电可擦除可编程只读存储器 (EEPROM), 适合存放自制 CPU 的程序。\n引脚: 真实 DIP-28 编号 (与 62256 SRAM 兼容), A0~A14 为地址, D0~D7 双向三态总线; /CE、/OE、/WE 均低有效: /WE=0 写入, /WE=1 且 /OE=0 读出; 14 脚 GND、28 脚 VCC。',
  { pwr: { vcc: 28, gnd: 14 } });

/* 6264 — SRAM 8K×8, 真实 DIP-28 引脚; 双片选 /CS1 (20 脚, 低有效) + CS2 (26 脚,
 * 高有效, 悬空不选中 — 需接 VCC), /WE=0 写 */
defMem('6264', 'SRAM 8K×8', { kind: 'ram', size: 8192, mask: 0xFF,
  addr: [10, 9, 8, 7, 6, 5, 4, 3, 25, 24, 23, 21, 2], data: [11, 12, 13, 15, 16, 17, 18, 19],
  cs: { pin: 20, low: true }, cs2: { pin: 26, low: false }, oe: { pin: 22, low: true },
  we: { pin: 27, low: true }, weWriteHigh: false }, [
  L(2, 'A12', 'in'), L(3, 'A7', 'in'), L(4, 'A6', 'in'), L(5, 'A5', 'in'),
  L(6, 'A4', 'in'), L(7, 'A3', 'in'), L(8, 'A2', 'in'), L(9, 'A1', 'in'), L(10, 'A0', 'in'),
  L(11, 'D0', 'io'), L(12, 'D1', 'io'), L(13, 'D2', 'io'),
  R(27, '/WE', 'in'), R(26, 'CS2', 'in'), R(25, 'A8', 'in'), R(24, 'A9', 'in'), R(23, 'A11', 'in'),
  R(22, '/OE', 'in'), R(21, 'A10', 'in'), R(20, '/CS1', 'in'),
  R(19, 'D7', 'io'), R(18, 'D6', 'io'), R(17, 'D5', 'io'), R(16, 'D4', 'io'), R(15, 'D3', 'io'),
], '8192×8 位静态随机存取存储器 (SRAM)。\n引脚: 真实 DIP-28 编号, A0~A12 为地址, D0~D7 双向三态总线; 双片选: /CS1 低有效 + CS2 高有效 (悬空即不选中, 不用时须接 VCC); /WE=0 写入, /WE=1 且 /OE=0 读出; 14 脚 GND、28 脚 VCC。',
  { pwr: { vcc: 28, gnd: 14 } });
});
