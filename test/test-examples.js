/* =========================================================================
 * 74VM 内置示例验证 — 每个示例 × 三种模式
 * node test/test-examples.js
 *
 * 对每个示例检查:
 *   [结构] 导线引脚号全部存在 (load 不丢线), 无输出-输出对撞;
 *   [面包板] 60 列单板自动摆放不溢出 (所有引脚孔位有效), 自动布线跳线孔位
 *            有效, 派生网表与原理图等价, DIP/有源元件全部判上电;
 *   [面包板仿真] 用派生网表重跑功能检查 (证明面包板模式真的能跑);
 *   [PCB] 自动布局全部落在板内;
 *   [功能] 原理图模式下的电路行为 (真值表/计数/移位/协议时序)。
 * ========================================================================= */
'use strict';

const { Engine, Sim } = require('../js/engine.js');
const { LIB } = require('../js/chips.js');
const { EXAMPLES } = require('../js/examples.js');
const { BB } = require('../js/breadboard.js');
const { PCB } = require('../js/pcb.js');

const { V0, V1, VZ, VX } = Sim;

let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; console.log('    ✓ ' + name); }
  else { fail++; console.log('    ✗ ' + name + (extra !== undefined ? '  →  ' + JSON.stringify(extra) : '')); }
}

/* ---------------- 小工具 ---------------- */

function loadSim(ex) {
  const sim = new Engine(LIB);
  const b = ex.build();
  sim.load({ chips: b.chips, wires: b.wires });
  return sim;
}
const ofType = (sim, t) => Array.from(sim.chips.values()).filter(c => c.type === t);
function one(sim, t, label) {
  let arr = ofType(sim, t);
  if (label) arr = arr.filter(c => (c.props.label || '') === label);
  if (arr.length !== 1) throw new Error(`期望 1 个 ${t}${label ? '(' + label + ')' : ''}, 实际 ${arr.length}`);
  return arr[0];
}
const swByLabel = (sim, label) => one(sim, 'SW', label);
const V = (sim, ch, pin) => sim.pinDisplay(ch.pinByNum[pin]);
const setSw = (sim, sw, v) => sim.driveNow(sw, 1, v);

/** 推进时钟恰好 n 个上升沿 (半周期步进采样); 返回实际数出 */
function clockEdges(sim, src, n, maxIter) {
  let last = V(sim, src, 1), risers = 0;
  for (let i = 0; i < (maxIter || n * 4) && risers < n; i++) {
    sim.advance(250000);                    // CLOCK/NE555 freq=2 → 半周期 250ms
    const v = V(sim, src, 1);
    if (last === V0 && v === V1) risers++;
    last = v;
  }
  return risers;
}
/** 让沿后 1~3µs 的门延迟输出落定 (UI 每帧重绘, 肉眼无感) */
const settle = sim => sim.advance(100);

function partition(wires) {
  const parent = new Map();
  const find = k => { let r = k; while (parent.get(r) !== r) r = parent.get(r); return r; };
  const ensure = k => { if (!parent.has(k)) parent.set(k, k); };
  for (const w of wires) {
    ensure(w.a[0] + ':' + w.a[1]); ensure(w.b[0] + ':' + w.b[1]);
    const ra = find(w.a[0] + ':' + w.a[1]), rb = find(w.b[0] + ':' + w.b[1]);
    if (ra !== rb) parent.set(ra, rb);
  }
  const groups = new Map();
  for (const k of parent.keys()) {
    const r = find(k);
    if (!groups.has(r)) groups.set(r, []);
    groups.get(r).push(k);
  }
  return Array.from(groups.values()).map(g => g.sort()).sort();
}

/** 面包板全流程: 摆放 + 布线 + 派生网表 + 供电标志 */
function toBreadboard(ex) {
  const sim = loadSim(ex);
  BB.autoPlace(sim);
  const r = BB.autoWire(sim, sim.wiresRaw());
  const derived = BB.deriveWires(sim, r.jumpers);
  sim.setWiresRaw(derived);
  const info = BB.computeNets(sim, r.jumpers);
  for (const c of sim.chips.values()) c.powered = BB.chipPowered(info, c);
  return { sim, r, info };
}

/* ---------------- 每示例功能检查 (对原理图/面包板网表同样适用) ---------------- */

const FUNCS = {
  'SR 锁存器': (sim) => {
    const sS = swByLabel(sim, '~S 置位'), sR = swByLabel(sim, '~R 复位');
    const q = one(sim, 'LED', 'Q'), nq = one(sim, 'LED', '~Q');
    // 上电禁止态: 两输出同为 1
    check('上电: Q=~Q=1 (S=R=0 禁止态)', V(sim, q, 1) === V1 && V(sim, nq, 1) === V1,
      [V(sim, q, 1), V(sim, nq, 1)]);
    setSw(sim, sS, 1);   // 释放 ~S: 保持复位 (R 仍有效)
    check('~S=1: Q=0, ~Q=1', V(sim, q, 1) === V0 && V(sim, nq, 1) === V1);
    setSw(sim, sR, 1);   // 双方都无效 → 保持
    check('保持: Q=0, ~Q=1', V(sim, q, 1) === V0 && V(sim, nq, 1) === V1);
    setSw(sim, sS, 0);   // 置位
    check('置位: Q=1, ~Q=0', V(sim, q, 1) === V1 && V(sim, nq, 1) === V0);
    setSw(sim, sS, 1);   // 保持
    check('置位保持: Q=1', V(sim, q, 1) === V1);
    setSw(sim, sR, 0);   // 复位
    check('复位: Q=0, ~Q=1', V(sim, q, 1) === V0 && V(sim, nq, 1) === V1);
  },

  'D 触发器二分频': (sim) => {
    const ff = one(sim, '7474'), clk = one(sim, 'CLOCK');
    let q = V(sim, ff, 5);
    let ok = true;
    for (let k = 1; k <= 6; k++) {
      if (clockEdges(sim, clk, 1) !== 1) { ok = false; break; }
      settle(sim);
      const nq = V(sim, ff, 5);
      if (nq !== (q ? V0 : V1)) { ok = false; break; }   // 每个上升沿翻转一次
      q = nq === V1 ? 1 : 0;
    }
    check('6 个时钟沿 Q 逐沿翻转 (二分频)', ok);
  },

  '半加器': (sim) => {
    const sA = swByLabel(sim, 'A'), sB = swByLabel(sim, 'B');
    const s = one(sim, 'LED', 'S 和'), c = one(sim, 'LED', 'C 进位');
    let ok = true, detail;
    for (const [a, bb] of [[0, 0], [0, 1], [1, 0], [1, 1]]) {
      setSw(sim, sA, a); setSw(sim, sB, bb);
      if (V(sim, s, 1) !== (a ^ bb) || V(sim, c, 1) !== (a & bb)) { ok = false; detail = [a, bb]; break; }
    }
    check('S=A⊕B, C=A·B 全真值表', ok, detail);
  },

  '4位全加器': (sim) => {
    // 位名按手册: A4/B4/S4 为最高位, 开关自上而下 = 高位在前
    const A = {}, Bb = {};
    for (let i = 0; i < 4; i++) { A[i] = swByLabel(sim, 'A' + (4 - i)); Bb[i] = swByLabel(sim, 'B' + (4 - i)); }
    const S = [0, 1, 2, 3].map(i => one(sim, 'LED', 'S' + (4 - i)));
    const ledC = one(sim, 'LED', 'C4 进位');
    const setN = (sws, v) => { for (let i = 0; i < 4; i++) setSw(sim, sws[i], (v >> (3 - i)) & 1); };
    let ok = true, detail;
    for (const [a, b2] of [[5, 3], [9, 9], [0, 0], [15, 1], [7, 8]]) {
      setN(A, a); setN(Bb, b2);
      settle(sim);
      const sum = a + b2;
      const got = [0, 1, 2, 3].map(i => V(sim, S[i], 1)) + '';
      const exp = [(sum >> 3) & 1, (sum >> 2) & 1, (sum >> 1) & 1, sum & 1] + '';
      if (got !== exp || V(sim, ledC, 1) !== (sum > 15 ? V1 : V0)) { ok = false; detail = [a, b2, got, exp]; break; }
    }
    check('5+3 / 9+9 / 0+0 / 15+1 / 7+8 全对 (含 C4)', ok, detail);
  },

  '3-8 译码器': (sim) => {
    const sw = { A: swByLabel(sim, 'A'), B: swByLabel(sim, 'B'), C: swByLabel(sim, 'C') };
    const outs = [['Y0', 15], ['Y1', 14], ['Y2', 13], ['Y3', 12], ['Y4', 11], ['Y5', 10], ['Y6', 9], ['Y7', 7]]
      .map(([nm, pin]) => [one(sim, 'LED', nm), pin]);
    let ok = true, detail;
    for (let m = 0; m < 8; m++) {
      setSw(sim, sw.A, m & 1); setSw(sim, sw.B, (m >> 1) & 1); setSw(sim, sw.C, (m >> 2) & 1);
      for (let i = 0; i < 8; i++) {
        const v = V(sim, outs[i][0], 1);
        if (v !== (i === m ? V0 : V1)) { ok = false; detail = [m, 'Y' + i, v]; break; }
      }
      if (!ok) break;
    }
    check('8 个地址: 仅选中 Y 输出 0 (低有效)', ok, detail);
  },

  '8选1数据选择器': (sim) => {
    const sw = { A: swByLabel(sim, 'A'), B: swByLabel(sim, 'B'), C: swByLabel(sim, 'C') };
    const y = one(sim, 'LED', 'Y'), ny = one(sim, 'LED', '~Y');
    let ok = true, detail;
    for (let m = 0; m < 8; m++) {
      setSw(sim, sw.A, m & 1); setSw(sim, sw.B, (m >> 1) & 1); setSw(sim, sw.C, (m >> 2) & 1);
      const exp = m < 4 ? V1 : V0;   // D0~D3=1, D4~D7=0
      if (V(sim, y, 1) !== exp || V(sim, ny, 1) !== (exp ? V0 : V1)) { ok = false; detail = [m]; break; }
    }
    check('地址 0~7: Y 选通 D0~D3=1 / D4~D7=0, ~Y 互补', ok, detail);
  },

  'JK触发器翻转': (sim) => {
    const jk = one(sim, '7476'), clk = one(sim, 'CLOCK');
    let q = V(sim, jk, 6);
    let ok = q === V0;
    for (let k = 1; ok && k <= 6; k++) {
      if (clockEdges(sim, clk, 1) !== 1) { ok = false; break; }
      settle(sim);
      const nq = V(sim, jk, 6);
      if (nq !== (q ? V0 : V1)) { ok = false; break; }
      q = nq === V1 ? 1 : 0;
    }
    check('J=K=1: Q 从 0 起每沿翻转', ok);
  },

  '4位计数器': (sim) => {
    const cnt = one(sim, '74161'), clk = one(sim, 'CLOCK');
    if (clockEdges(sim, clk, 5) !== 5) { check('计 5 个时钟沿', false); return; }
    settle(sim);
    const qa = V(sim, cnt, 14), qb = V(sim, cnt, 13), qc = V(sim, cnt, 12), qd = V(sim, cnt, 11);
    check('5 个沿后 QA~QD = 1010 (QA 为低位 = 5)', [qa, qb, qc, qd] + '' === [V1, V0, V1, V0] + '', [qa, qb, qc, qd]);
    clockEdges(sim, clk, 11);      // 再 11 沿 → 16 → 回零
    settle(sim);
    check('计满 16 回零', [V(sim, cnt, 14), V(sim, cnt, 13), V(sim, cnt, 12), V(sim, cnt, 11)]
      .every(v => v === V0));
  },

  '数码管计数': (sim) => {
    const disp = one(sim, 'SEG7'), clk = one(sim, 'CLOCK');
    if (clockEdges(sim, clk, 3) !== 3) { check('计 3 个时钟沿', false); return; }
    settle(sim);
    // 数字 3 = a b c d g 亮 (0x4F)
    const seg = [1, 2, 3, 4, 5, 6, 7].map(p => V(sim, disp, p));
    check('计到 3: 数码管段 a b c d g 亮', seg + '' === [V1, V1, V1, V1, V0, V0, V1] + '', seg);
    clockEdges(sim, clk, 6);       // 计到 9
    settle(sim);
    const seg9 = [1, 2, 3, 4, 5, 6, 7].map(p => V(sim, disp, p));
    check('计到 9: 段 a b c d f g 亮 (0x6F)', seg9 + '' === [V1, V1, V1, V1, V0, V1, V1] + '', seg9);
  },

  '8位移位锁存': (sim) => {
    const reg = one(sim, '74595'), clk = one(sim, 'CLOCK');
    const swD = swByLabel(sim, '串行数据'), btn = one(sim, 'BTN');
    const QS = [15, 1, 2, 3, 4, 5, 6, 7];
    setSw(sim, swD, 1);
    if (clockEdges(sim, clk, 8) !== 8) { check('移入 8 位', false); return; }
    settle(sim);
    check('移入全 1 但未锁存 → 输出仍全 0', QS.every(p => V(sim, reg, p) === V0),
      QS.map(p => V(sim, reg, p)));
    sim.driveNow(btn, 1, 1); sim.driveNow(btn, 1, 0);   // 锁存脉冲
    check('锁存后输出全 1', QS.every(p => V(sim, reg, p) === V1), QS.map(p => V(sim, reg, p)));
    setSw(sim, swD, 0);
    clockEdges(sim, clk, 1);
    settle(sim);
    sim.driveNow(btn, 1, 1); sim.driveNow(btn, 1, 0);
    check('再移入 0 并锁存: Q0=0, 其余 1', V(sim, reg, 15) === V0 &&
      [1, 2, 3, 4, 5, 6, 7].every(p => V(sim, reg, p) === V1),
      QS.map(p => V(sim, reg, p)));
  },

  '环形振荡器': (sim) => {
    const inv = one(sim, '7404');
    // 门延迟 1µs → 周期 6µs; 用事件量增长证明持续振荡, 用非整周期步长采样证明电平翻转
    let ev0 = sim.eventCount;
    sim.advance(50);
    const evRate = sim.eventCount - ev0;
    let last = V(sim, inv, 6), changes = 0;
    for (const dt of [50, 7, 50, 13, 50, 11, 50]) {
      sim.advance(dt);
      const v = V(sim, inv, 6);
      if (v !== last) changes++;
      last = v;
    }
    check('持续振荡: 事件量爆发增长 (50µs >100 事件)', evRate > 100, evRate);
    check('输出电平翻转 (非整周期采样 ≥2 次)', changes >= 2, changes);
  },

  '三态总线': (sim) => {
    const tr = one(sim, '74245');
    const sDir = swByLabel(sim, 'DIR'), sOE = swByLabel(sim, '~OE 使能');
    check('DIR=1, ~OE=0: B0=A0=1', V(sim, tr, 19) === V1);
    setSw(sim, sOE, 1);            // ~OE=1 → 高阻
    check('~OE=1: B0 高阻 Z', V(sim, tr, 19) === VZ, V(sim, tr, 19));
    setSw(sim, sOE, 0);
    check('恢复使能: B0=1', V(sim, tr, 19) === V1);
    setSw(sim, sDir, 0);           // DIR=0: B→A; B 悬空 (io 读回 Z) → A 保持 VCC 的 1
    check('DIR=0 (B→A): B0 释放为 Z', V(sim, tr, 19) === VZ, V(sim, tr, 19));
    check('DIR=0: A0 网仍由 VCC 驱动为 1', V(sim, tr, 2) === V1, V(sim, tr, 2));
    setSw(sim, sDir, 1);
    check('恢复 DIR=1: B0=1', V(sim, tr, 19) === V1);
  },

  'NE555 时钟闪烁灯': (sim) => {
    const t5 = one(sim, 'NE555');
    let last = V(sim, t5, 3), risers = 0, sawZ = false, sawLoDisch = false;
    for (let i = 0; i < 10; i++) {
      sim.advance(250000);
      const v = V(sim, t5, 3);
      if (last === V0 && v === V1) risers++;
      if (v === V1 && V(sim, t5, 7) === VZ) sawZ = true;
      if (v === V0 && V(sim, t5, 7) === V0) sawLoDisch = true;
      last = v;
    }
    check('2Hz → 2.5s 内 5 个上升沿 (50% 占空比)', risers === 5, risers);
    check('DISCH: OUT 高时截止 Z, OUT 低时导通 0', sawZ && sawLoDisch, [sawZ, sawLoDisch]);
  },

  'PS/2 扫描码接收': (sim) => {
    const reg = one(sim, '74164'), kb = one(sim, 'PS2');
    const QS = [3, 4, 5, 6, 9, 10, 11, 12];
    // PS2 空闲 CLK 恒高: 上电网络解析对该恒高产生一次虚上升沿, 移入空闲 DATA=1
    check('上电: 仅 Q0=1 (空闲时钟虚沿, 与真实硬件一致)', QS.map(p => V(sim, reg, p)) + '' ===
      [V1, V0, V0, V0, V0, V0, V0, V0] + '', QS.map(p => V(sim, reg, p)));
    kb.state.queue.push(0x1C);     // 'A' 的 Set 2 make 码
    sim.reevalAll();
    sim.advance(3000);             // 一帧 11 位 ≈ 1ms
    // 帧 = 0(start) 00011100(d0..d7) 0(奇校验) 1(stop); 12 次移位后 v=0xE1
    check("发 'A' (0x1C) 后 Q0~Q7 = 10000111", QS.map(p => V(sim, reg, p)) + '' ===
      [V1, V0, V0, V0, V0, V1, V1, V1] + '', QS.map(p => V(sim, reg, p)));
    kb.state.queue.push(0xF0);     // break 前缀
    sim.reevalAll();
    sim.advance(3000);
    check("续发 0xF0 后移位推进 (v=0x3F)", (reg.state.v & 0xFF) === 0x3F,
      reg.state.v.toString(2));
  },

  '矩阵键盘扫描': (sim) => {
    const kb = one(sim, 'KB44');
    const sA = swByLabel(sim, '扫描 A'), sB = swByLabel(sim, '扫描 B');
    const rows = [5, 6, 7, 8];
    const rowV = () => rows.map(p => V(sim, kb, p));
    // 扫描第 3 列 (C3, 地址 m=2 → B=1), 按住 (行1, 列2)
    kb.state.keys['1,2'] = 1;
    sim.evalChip(kb); sim.flush();
    setSw(sim, sA, 0); setSw(sim, sB, 1);
    check('选中 C3 + 按住 (R2,C3): 仅 R2=1', rowV() + '' === [V0, V1, V0, V0] + '', rowV());
    // 切到第 1 列: 该键不在选中列 → 全 0
    setSw(sim, sB, 0);
    check('切回 C1: 同一颗键不响应', rowV().every(v => v === V0), rowV());
    // 按两颗 (R1,C1 与 R4,C1), 扫描 C1 → R1 与 R4 亮
    kb.state.keys['0,0'] = 1; kb.state.keys['3,0'] = 1;
    sim.evalChip(kb); sim.flush();
    check('扫描 C1 双键: R1 与 R4 亮', rowV() + '' === [V1, V0, V0, V1] + '', rowV());
    // 松开全部
    delete kb.state.keys['0,0']; delete kb.state.keys['3,0']; delete kb.state.keys['1,2'];
    sim.evalChip(kb); sim.flush();
    check('松开后行全部回 0 (内置下拉)', rowV().every(v => v === V0), rowV());
  },

  '1602 液晶打字机': (sim) => {
    const lcd = one(sim, 'LCD1602');
    const sRS = swByLabel(sim, 'RS'), btnE = one(sim, 'BTN');
    const D = {};
    for (let i = 0; i < 8; i++) D[i] = swByLabel(sim, 'D' + i);
    const setData = v => { for (let i = 0; i < 8; i++) setSw(sim, D[i], (v >> i) & 1); };
    const strobe = () => { sim.driveNow(btnE, 1, 1); sim.driveNow(btnE, 1, 0); };
    setSw(sim, sRS, 0);            // 指令模式
    setData(0x01); strobe();       // 清屏
    check('RS=0 发 0x01 清屏', lcd.state.ddram.every(c => c === ' '));
    setSw(sim, sRS, 1);            // 数据模式
    setData(0x48); strobe();       // 'H'
    setData(0x69); strobe();       // 'i'
    check("RS=1 写入 'Hi'", lcd.state.ddram[0] === 'H' && lcd.state.ddram[1] === 'i',
      lcd.state.ddram.slice(0, 3));
    setData(0xD6); strobe(); setData(0xD0); strobe();   // GB2312 '中'
    check('GB2312 双字节写入 中', lcd.state.ddram[2] === '中', lcd.state.ddram[2]);
    setSw(sim, sRS, 0);
    setData(0x80 | 0x40); strobe();   // 地址 → 第二行行首
    setSw(sim, sRS, 1);
    setData(0x41); strobe();          // 'A'
    check('定位 0x40 后写入第二行', lcd.state.ddram[0x40] === 'A');
  },
};

/* ---------------- 主流程 ---------------- */

console.log(`\n共 ${EXAMPLES.length} 个内置示例, 逐个验证三种模式…\n`);

for (const ex of EXAMPLES) {
  console.log('▶ ' + ex.name);
  // 面包板规模: 示例可声明 bb: {cols, boards}, 否则用应用默认 60 列单板
  if (ex.bb) { BB.setCols(ex.bb.cols); BB.setBoards(ex.bb.boards); }
  else { BB.setCols(60); BB.setBoards(1); }

  /* [结构] 引脚号全部有效 (load 不静默丢线), 且无输出对撞 */
  {
    const raw = ex.build();
    const sim = loadSim(ex);
    check(`结构: ${raw.wires.length} 根导线全部有效`, sim.wires.length === raw.wires.length,
      [raw.wires.length, sim.wires.length]);
    const id2ch = new Map(Array.from(sim.chips.values()).map(c => [c.id, c]));
    const clash = raw.wires.filter(w => {
      const pa = id2ch.get(w.a[0]) && id2ch.get(w.a[0]).pinByNum[w.a[1]];
      const pb = id2ch.get(w.b[0]) && id2ch.get(w.b[0]).pinByNum[w.b[1]];
      return pa && pb && pa.dir === 'out' && pb.dir === 'out';
    });
    check('结构: 无 输出↔输出 直连', clash.length === 0, clash);
  }

  /* [面包板] 摆放不溢出 / 跳线孔位有效 / 网表等价 / 全部上电 */
  let bb;
  {
    const sim = loadSim(ex);
    BB.autoPlace(sim);
    const missing = [];
    for (const c of sim.chips.values()) {
      if (!c.bb) missing.push(c.type + ':未放置');
      else for (const p of c.pins) if (!BB.pinHole(c, p.num)) missing.push(c.type + ':p' + p.num);
    }
    check('面包板: 60 列单板自动摆放, 全部引脚孔位有效', missing.length === 0, missing);
    const r = BB.autoWire(sim, sim.wiresRaw());
    const badJ = r.jumpers.filter(j => !BB.holePos(j.a) || !BB.holePos(j.b));
    check(`面包板: ${r.jumpers.length} 根跳线孔位全部有效`, badJ.length === 0, badJ);
    /* 物理规则: 每孔至多一根跳线; 芯片引脚/模块腿占用的孔不可插线 */
    {
      const occH = BB.occupancy(sim);
      const onChip = [], load = new Map();
      for (const j of r.jumpers) for (const h of [j.a, j.b]) {
        if (occH.get(h)) onChip.push(h);
        load.set(h, (load.get(h) || 0) + 1);
      }
      const stacked = Array.from(load.entries()).filter(([, n]) => n > 1).map(([h]) => h);
      check('面包板: 跳线端全部落在空闲孔 (不插芯片占用孔)', onChip.length === 0, onChip.slice(0, 8));
      check('面包板: 每孔至多一根跳线 (无堆叠)', stacked.length === 0, stacked.slice(0, 8));
    }
    const before = partition(sim.wiresRaw());
    const after = partition(BB.deriveWires(sim, r.jumpers));
    check('面包板: 派生网表与原理图等价', JSON.stringify(before) === JSON.stringify(after));
    const info = BB.computeNets(sim, r.jumpers);
    const unpowered = Array.from(sim.chips.values())
      .filter(c => BB.isActiveCustom(c.type) || !LIB[c.type].custom)
      .filter(c => !BB.chipPowered(info, c))
      .map(c => c.type);
    check('面包板: DIP/有源元件全部判上电', unpowered.length === 0, unpowered);
    bb = toBreadboard(ex);
  }

  /* [PCB] 自动布局全部在板内 */
  {
    const sim = loadSim(ex);
    PCB.autoPlace(sim);
    const out = [];
    for (const c of sim.chips.values()) {
      const rc = PCB.chipRect(c);
      if (rc.x < 0 || rc.y < 0 || rc.x + rc.w > PCB.BOARD.w || rc.y + rc.h > PCB.BOARD.h)
        out.push(c.type);
    }
    check('PCB: 自动布局全部落在 100×80 板内', out.length === 0, out);
  }

  /* [功能] 原理图 + 面包板 (派生网表) 各跑一遍 */
  const fn = FUNCS[ex.name.split(' (')[0]] || FUNCS[ex.name];
  if (!fn) { console.log('    (无功能检查)'); continue; }
  try {
    fn(loadSim(ex));
    console.log('    ✓ 原理图模式功能通过');
    pass++;
  } catch (err) {
    fail++;
    console.log('    ✗ 原理图模式功能异常: ' + err.message);
  }
  try {
    fn(bb.sim);
    console.log('    ✓ 面包板模式 (派生网表) 功能通过');
    pass++;
  } catch (err) {
    fail++;
    console.log('    ✗ 面包板模式功能异常: ' + err.message);
  }
  console.log('');
}

console.log(`结果: ${pass} 通过, ${fail} 失败`);
process.exit(fail ? 1 : 0);
