/* =========================================================================
 * 74VM 引擎单元测试 — node test/test-engine.js
 * ========================================================================= */
'use strict';

const { Engine, Sim } = require('../js/engine.js');
const { LIB } = require('../js/chips.js');
const { EXAMPLES } = require('../js/examples.js');

const VX = Sim.VX;
let pass = 0, fail = 0;

function check(name, cond, extra) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (extra !== undefined ? '  →  ' + JSON.stringify(extra) : '')); }
}

function makeSim() { return new Engine(LIB); }

// 便捷: 放一个开关(可驱动电平), 默认0
function addSwitch(sim, on = 0) {
  const sw = sim.addChip('SW', 0, 0, 0, {}, { on });
  return sw;
}
const V = (sim, ch, pin) => sim.pinDisplay(ch.pinByNum[pin]);

console.log('\n[1] 7400 与非门基础逻辑');
{
  const sim = makeSim();
  const a = addSwitch(sim), b = addSwitch(sim);
  const n = sim.addChip('7400', 0, 0);
  sim.addWire(a, 1, n, 1);
  sim.addWire(b, 1, n, 2);
  sim.driveNow(a, 1, 1); sim.driveNow(b, 1, 1);
  check('NAND(1,1) = 0', V(sim, n, 3) === 0, V(sim, n, 3));
  sim.driveNow(a, 1, 0);
  check('NAND(0,1) = 1', V(sim, n, 3) === 1, V(sim, n, 3));
  sim.driveNow(b, 1, 0);
  check('NAND(0,0) = 1', V(sim, n, 3) === 1);
}

console.log('\n[2] 悬空输入 = X, 并传播');
{
  const sim = makeSim();
  const n = sim.addChip('7400', 0, 0);
  check('无输入 → 输出 X', V(sim, n, 3) === VX, V(sim, n, 3));
}

console.log('\n[3] SR 锁存器 (7400 交叉耦合)');
{
  const sim = makeSim();
  const s = addSwitch(sim), r = addSwitch(sim);
  const n = sim.addChip('7400', 0, 0);
  sim.addWire(s, 1, n, 1);        // ~S → 1A
  sim.addWire(r, 1, n, 5);        // ~R → 2B
  sim.addWire(n, 3, n, 4);        // 1Y → 2A
  sim.addWire(n, 6, n, 2);        // 2Y → 1B
  check('S̄=R̄=0 禁止态: Q=~Q=1', V(sim, n, 3) === 1 && V(sim, n, 6) === 1, [V(sim, n, 3), V(sim, n, 6)]);
  sim.driveNow(s, 1, 1);          // S̄=1, R̄=0 → 复位 Q=0
  check('R̄=0 复位: Q=0, ~Q=1', V(sim, n, 3) === 0 && V(sim, n, 6) === 1, [V(sim, n, 3), V(sim, n, 6)]);
  sim.driveNow(r, 1, 1);          // 都为1 → 保持
  check('保持: Q=0, ~Q=1', V(sim, n, 3) === 0 && V(sim, n, 6) === 1);
  sim.driveNow(s, 1, 0);          // S̄=0 置位
  check('S̄=0 置位: Q=1, ~Q=0', V(sim, n, 3) === 1 && V(sim, n, 6) === 0, [V(sim, n, 3), V(sim, n, 6)]);
  sim.driveNow(s, 1, 1);          // 保持
  check('再次保持: Q=1, ~Q=0', V(sim, n, 3) === 1 && V(sim, n, 6) === 0);
}

console.log('\n[4] 7474 D 触发器分频');
{
  const sim = makeSim();
  const clk = addSwitch(sim);
  const ff = sim.addChip('7474', 0, 0);
  sim.addWire(clk, 1, ff, 3);
  sim.addWire(ff, 6, ff, 2);      // ~Q → D
  check('上电 Q=0', V(sim, ff, 5) === 0, V(sim, ff, 5));
  let q = 0;
  for (let i = 0; i < 10; i++) {
    sim.driveNow(clk, 1, 1);
    sim.driveNow(clk, 1, 0);
    const now = V(sim, ff, 5);
    q = 1 - q;
    if (now !== q) { check('第' + (i + 1) + '个时钟沿翻转', false, now); q = now; }
  }
  check('10 个时钟沿后 Q=0 (10偶数)', V(sim, ff, 5) === 0, V(sim, ff, 5));
}

console.log('\n[5] 74161 计数器 (计数/进位/置数)');
{
  const sim = makeSim();
  const vcc = sim.addChip('VCC', 0, 0);
  const clk = addSwitch(sim);
  const cnt = sim.addChip('74161', 0, 0);
  sim.addWire(clk, 1, cnt, 2);
  sim.addWire(vcc, 1, cnt, 1);    // ~CLR
  sim.addWire(vcc, 1, cnt, 9);    // ~LOAD
  sim.addWire(vcc, 1, cnt, 7);    // ENP
  sim.addWire(vcc, 1, cnt, 10);   // ENT
  const pulse = () => { sim.driveNow(clk, 1, 1); sim.driveNow(clk, 1, 0); };
  for (let i = 0; i < 5; i++) pulse();
  const q = V(sim, cnt, 14) | (V(sim, cnt, 13) << 1) | (V(sim, cnt, 12) << 2) | (V(sim, cnt, 11) << 3);
  check('5 个脉冲后 = 5 (0101)', q === 5, q);
  for (let i = 5; i < 15; i++) pulse();
  const q2 = V(sim, cnt, 14) | (V(sim, cnt, 13) << 1) | (V(sim, cnt, 12) << 2) | (V(sim, cnt, 11) << 3);
  check('15 个脉冲后 = 15 且 RCO=1', q2 === 15 && V(sim, cnt, 15) === 1, [q2, V(sim, cnt, 15)]);
  pulse();
  const q3 = V(sim, cnt, 14) | (V(sim, cnt, 13) << 1) | (V(sim, cnt, 12) << 2) | (V(sim, cnt, 11) << 3);
  check('16 个脉冲后回绕 = 0', q3 === 0, q3);
}

console.log('\n[6] 74283 四位加法器 1101+0110=10011');
{
  const sim = makeSim();
  const sws = [13, 12, 11, 10, 9, 8, 7, 6].map(() => addSwitch(sim));
  const A = [sws[7], sws[6], sws[5], sws[4]]; // A1..A4 = 1,0,1,1
  const B = [sws[3], sws[2], sws[1], sws[0]]; // B1..B4 = 0,1,1,0
  const add = sim.addChip('74283', 0, 0);
  const gnd = sim.addChip('GND', 0, 0);
  sim.addWire(gnd, 1, add, 7);     // C0 = 0
  const av = [1, 0, 1, 1], bv = [0, 1, 1, 0];
  const AP = [5, 3, 14, 12], BP = [6, 2, 15, 11];
  A.forEach((sw, i) => { sim.addWire(sw, 1, add, AP[i]); if (av[i]) sim.driveNow(sw, 1, 1); });
  B.forEach((sw, i) => { sim.addWire(sw, 1, add, BP[i]); if (bv[i]) sim.driveNow(sw, 1, 1); });
  const s = V(sim, add, 4) | (V(sim, add, 1) << 1) | (V(sim, add, 13) << 2) | (V(sim, add, 10) << 3);
  const sum = s | (V(sim, add, 9) << 4);
  check('1101+0110 = 10011 (19)', sum === 19, sum);
}

console.log('\n[7] 7448 七段译码 (数字 5 → 0x6D)');
{
  const sim = makeSim();
  const vcc = sim.addChip('VCC', 0, 0);
  const seg = sim.addChip('7448', 0, 0);
  sim.addWire(vcc, 1, seg, 3);    // ~LT
  sim.addWire(vcc, 1, seg, 4);    // ~BI
  const AP = [7, 1, 2, 6];        // A B C D
  const sws = AP.map(() => addSwitch(sim));
  sws.forEach((sw, i) => sim.addWire(sw, 1, seg, AP[i]));
  // 数字5 = 0101
  sim.driveNow(sws[0], 1, 1); sim.driveNow(sws[2], 1, 1);
  const P = [13, 12, 11, 10, 9, 15, 14]; // a..g
  let bits = 0;
  P.forEach((p, i) => { if (V(sim, seg, p) === 1) bits |= 1 << i; });
  check('5 → 段码 0x6D', bits === 0x6D, '0x' + bits.toString(16));
  // 灭零: RBI=0 且输入0 → 全灭
  const gnd = sim.addChip('GND', 0, 0);
  sim.addWire(gnd, 1, seg, 5);
  sim.driveNow(sws[0], 1, 0); sim.driveNow(sws[2], 1, 0);
  let all = true;
  P.forEach(p => { if (V(sim, seg, p) !== 0) all = false; });
  check('RBI=0 灭零', all);
}

console.log('\n[8] 74245 三态收发器');
{
  const sim = makeSim();
  const dir = addSwitch(sim, 1), oe = addSwitch(sim, 0);
  const vcc = sim.addChip('VCC', 0, 0);
  const tr = sim.addChip('74245', 0, 0);
  const ledProbeA = addSwitch(sim); // 不接, 仅占位
  sim.addWire(dir, 1, tr, 1);
  sim.addWire(oe, 1, tr, 11);
  sim.addWire(vcc, 1, tr, 2);      // A0=1
  check('DIR=1,~OE=0: B0 = A0 = 1', V(sim, tr, 19) === 1, V(sim, tr, 19));
  sim.driveNow(oe, 1, 1);          // ~OE=1 → 高阻
  check('~OE=1: B0 引脚 Z', V(sim, tr, 19) === 'Z', V(sim, tr, 19));
  sim.driveNow(oe, 1, 0);
  sim.driveNow(dir, 1, 0);         // 反向 B→A: B0 悬空 → A0 = X? (A0 同时被VCC驱动→冲突)
  check('DIR=0: A0 与 VCC 冲突 → X', V(sim, tr, 2) === VX, V(sim, tr, 2));
}

console.log('\n[9] 环形振荡器自启动 (7404×3)');
{
  const sim = makeSim();
  const inv = sim.addChip('7404', 0, 0);
  sim.addWire(inv, 2, inv, 3);
  sim.addWire(inv, 4, inv, 5);
  sim.addWire(inv, 6, inv, 1);
  sim.setRunning(false);
  const ev0 = sim.eventCount;
  sim.advance(100); // 100µs, 不含时钟
  check('事件持续产生 (振荡运行)', sim.eventCount > ev0 + 100, sim.eventCount - ev0);
  check('输出在 0/1 间取值', [0, 1].includes(V(sim, inv, 2)), V(sim, inv, 2));
}

console.log('\n[10] 74138 译码器');
{
  const sim = makeSim();
  const vcc = sim.addChip('VCC', 0, 0), gnd = sim.addChip('GND', 0, 0);
  const dec = sim.addChip('74138', 0, 0);
  const sa = addSwitch(sim, 1), sb = addSwitch(sim, 0), sc = addSwitch(sim, 1);
  sim.addWire(vcc, 1, dec, 6); sim.addWire(gnd, 1, dec, 4); sim.addWire(gnd, 1, dec, 5);
  sim.addWire(sa, 1, dec, 1); sim.addWire(sb, 1, dec, 2); sim.addWire(sc, 1, dec, 3);
  // 地址 CBA = 101 = 5 → Y5(引脚10) = 0 其余 1
  const outs = [15, 14, 13, 12, 11, 10, 9, 7];
  let ok = true;
  outs.forEach((p, i) => { if (V(sim, dec, p) !== (i === 5 ? 0 : 1)) ok = false; });
  check('CBA=101 → Y5 有效(低)', ok);
}

console.log('\n[11] 序列化往返');
{
  const sim = makeSim();
  sim.load({ chips: EXAMPLES[3].build().chips, wires: EXAMPLES[3].build().wires }); // 计数器示例
  sim.advance(50000); // 跑 50ms
  const snap = JSON.parse(JSON.stringify(sim.serialize()));
  const qBefore = snap.chips.map(c => JSON.stringify(c.state)).join('|');
  const sim2 = makeSim();
  sim2.load(snap);
  const qAfter = sim2.serialize().chips.map(c => JSON.stringify(c.state)).join('|');
  check('状态往返一致', qBefore === qAfter);
  check('元件/导线数量一致', sim2.chips.size === sim.chips.size && sim2.wires.length === sim.wires.length);
}

console.log('\n[12] 所有示例可加载且可稳定运行');
{
  let ok = true, bad = [];
  for (const ex of EXAMPLES) {
    try {
      const sim = makeSim();
      const b = ex.build();
      sim.load({ chips: b.chips, wires: b.wires });
      const ev0 = sim.eventCount;
      sim.setRunning(true);
      sim.advance(100000); // 100ms
      if (sim.chips.size !== b.chips.length) { ok = false; bad.push(ex.name + ':元件数'); }
    } catch (err) { ok = false; bad.push(ex.name + ':' + err.message); }
  }
  check('8 个示例加载+运行 100ms 无异常', ok, bad);
}

console.log('\n[13] 供电检查: 未上电芯片输出 X');
{
  const sim = makeSim();
  const a = addSwitch(sim, 1);
  const n = sim.addChip('7400', 0, 0);
  sim.addWire(a, 1, n, 1);
  sim.addWire(a, 1, n, 2);
  check('上电时 NAND(1,1) = 0', V(sim, n, 3) === 0, V(sim, n, 3));
  n.powered = false;
  sim.reevalAll();
  check('未上电 → 输出 X', V(sim, n, 3) === VX, V(sim, n, 3));
  sim.kick();
  check('kick 不破坏未上电输出的 X', V(sim, n, 3) === VX, V(sim, n, 3));
  check('未上电不改变输入引脚呈现', V(sim, n, 1) === 1, V(sim, n, 1));
  n.powered = true;
  sim.reevalAll();
  check('重新上电恢复 NAND(1,1) = 0', V(sim, n, 3) === 0, V(sim, n, 3));
}

console.log('\n[14] PS/2 键盘帧格式 (Set 2, 11 位帧)');
{
  const sim = makeSim();
  const kb = sim.addChip('PS2', 0, 0);
  check('空闲: CLK=DATA=1', V(sim, kb, 1) === 1 && V(sim, kb, 2) === 1, [V(sim, kb, 1), V(sim, kb, 2)]);
  kb.state.queue.push(0x1C);            // 'A' 的 Set 2 Make 码
  sim.evalChip(kb);
  // 以 15µs 步进推进, 在 CLK 下降沿采样 DATA → 解码一帧
  let lastClk = 1;
  const bits = [];
  for (let t = 0; t <= 2000; t += 15) {
    sim.processQueue(t);
    const clk = V(sim, kb, 1);
    if (lastClk === 1 && clk === 0) bits.push(V(sim, kb, 2));
    lastClk = clk;
  }
  check('一帧共 11 位', bits.length === 11, bits);
  check('起始位 0 / 停止位 1', bits[0] === 0 && bits[10] === 1, bits);
  const byte = bits.slice(1, 9).reduce((a2, b2, i) => a2 | (b2 << i), 0);
  check('数据位 LSB 在前 = 0x1C', byte === 0x1C, '0x' + byte.toString(16));
  const ones = bits.slice(1, 9).filter(x => x === 1).length;
  check('奇校验位正确', (ones + bits[9]) % 2 === 1, [ones, bits[9]]);
  check('发完回空闲', V(sim, kb, 1) === 1 && V(sim, kb, 2) === 1);
  check('lastByte 记录最后发送字节', kb.state.lastByte === 0x1C, kb.state.lastByte);
}

console.log('\n[15] PS/2 → 74164 接收 + 多字节队列');
{
  const sim = makeSim();
  const kb = sim.addChip('PS2', 0, 0);
  const sr = sim.addChip('74164', 0, 0);
  sim.addWire(kb, 1, sr, 8);            // CLK → CK (上升沿移位)
  sim.addWire(kb, 2, sr, 1);            // DATA → A&B
  sim.addWire(kb, 2, sr, 2);
  kb.state.queue.push(0x1C);            // 'A'
  sim.evalChip(kb);
  sim.flush();                          // 定时器链全部执行完
  // 11 个上升沿移位后寄存器 = 帧尾 8 位: d2..d7 + 校验 + 停止
  // 0x1C: d=00011100, 奇校验=0, 停止=1 → 1110 0001 = 0xE1
  const q = [3, 4, 5, 6, 9, 10, 11, 12].map(p => V(sim, sr, p));
  const reg = q.reduce((a2, b2, i) => a2 | ((b2 === 1 ? 1 : 0) << i), 0);
  check('74164 收到帧尾 8 位 = 0xE1', reg === 0xE1, '0x' + reg.toString(16));
  // 连续两字节 Break 'A' = F0 1C → 共 22 个 CLK 下降沿
  const t0 = sim.simTime;
  kb.state.queue.push(0xF0, 0x1C);
  sim.evalChip(kb);
  let lastClk = 1, edges = 0;
  for (let t = t0; t <= t0 + 3000; t += 15) {
    sim.processQueue(t);
    const clk = V(sim, kb, 1);
    if (lastClk === 1 && clk === 0) edges++;
    lastClk = clk;
  }
  check('两帧共 22 个时钟脉冲', edges === 22, edges);
  check('队列清空并回空闲', kb.state.queue.length === 0 && V(sim, kb, 1) === 1 && V(sim, kb, 2) === 1);
}

console.log('\n[15] 供电检查: 未上电时钟不振荡');
{
  const sim = makeSim();
  const ck = sim.addChip('CLOCK', 0, 0, 0, { freq: 1000 });   // 1kHz → 半周期 500µs
  sim.advance(10000);
  check('上电时钟振荡 (时间推进 ≥10ms)', sim.simTime >= 10000, sim.simTime);
  ck.powered = false;
  const ph = ck.state.phase, tStop = sim.simTime;
  sim.advance(10000);
  check('未上电时钟停振 (相位与时间冻结)', ck.state.phase === ph && sim.simTime === tStop,
    [ck.state.phase, sim.simTime]);
  ck.powered = true;
  const tBefore = sim.simTime;
  sim.advance(10000);
  check('重新上电恢复振荡', sim.simTime - tBefore >= 9999, sim.simTime - tBefore);
  check('CLOCK 输出脚相位在 0/1 间翻转', ck.state.phase === 0 || ck.state.phase === 1);
}

console.log('\n[16] NE555 真实时钟 (无稳态振荡 / ~RST 门控 / 供电检查)');
{
  const sim = makeSim();
  const t5 = sim.addChip('NE555', 0, 0, 0, { freq: 1000 });   // 1kHz → 半周期 500µs
  check('引脚表为真实 DIP-8 子集', LIB['NE555'].pins.map(p => p.num).join(',') === '2,3,4,7,6');
  check('上电先输出低半周期', V(sim, t5, 3) === 0, V(sim, t5, 3));
  let last = V(sim, t5, 3), risers = 0;
  const t0 = sim.simTime;
  for (let t = t0; t <= t0 + 10000; t += 100) {
    sim.processQueue(t);
    const v = V(sim, t5, 3);
    if (last === 0 && v === 1) risers++;
    last = v;
  }
  check('1kHz → 10ms 内 10 个上升沿', risers === 10, risers);
  check('DISCH 在 OUT 低电平期导通 (0)', V(sim, t5, 7) === 0, V(sim, t5, 7));

  // ~RST (4脚, 低有效) 门控
  const sw = sim.addChip('SW', 0, 0, 0, {}, { on: 1 });
  sim.addWire(sw, 1, t5, 4);
  sim.driveNow(sw, 1, 0);
  check('~RST 低 → OUT 复位为 0', V(sim, t5, 3) === 0);
  const tHold = sim.simTime;
  sim.advance(5000);
  check('~RST 低期间停振', V(sim, t5, 3) === 0 && sim.simTime === tHold, sim.simTime);
  sim.driveNow(sw, 1, 1);
  const tR = sim.simTime;
  sim.advance(5000);
  check('~RST 释放恢复振荡', sim.simTime - tR >= 4999, sim.simTime - tR);

  // 供电检查
  t5.powered = false;
  sim.reevalAll();
  check('未上电 → OUT 为 X', V(sim, t5, 3) === VX, V(sim, t5, 3));
  t5.powered = true;
  sim.reevalAll();
  const tP = sim.simTime;
  sim.advance(5000);
  check('重新上电恢复振荡', sim.simTime - tP >= 4999, sim.simTime - tP);
}

console.log('\n[17] 4×4 矩阵键盘 (行列扫描)');
{
  const sim = makeSim();
  const kb = sim.addChip('KB44', 0, 0);
  const R = r => V(sim, kb, 5 + r);               // 行脚 R1..R4
  // 列脚 C1..C4 经开关驱动 (主机扫描), 断开开关 = 列未驱动
  const sws = [0, 1, 2, 3].map(() => addSwitch(sim));
  const cw = [0, 1, 2, 3].map(c => sim.addWire(sws[c], 1, kb, 1 + c));
  const setC = (c, v) => sim.driveNow(sws[c], 1, v);
  check('无按键: 行脚 = 下拉电平 0', [0, 1, 2, 3].every(r => R(r) === 0), [0, 1, 2, 3].map(R));

  // 按下 键(行1,列0) ('4' 键), 列1 驱动 1 (列高有效扫描)
  setC(0, 1);
  kb.state.keys['1,0'] = 1;
  sim.evalChip(kb); sim.flush();
  check('列1=1 且按下(行1,列1): 行1=1 其余=0', R(1) === 1 && R(0) === 0 && R(2) === 0 && R(3) === 0,
    [0, 1, 2, 3].map(R));
  setC(0, 0);                                     // 扫描到别的列
  check('扫描列0=0: 行1 回 0', R(1) === 0, R(1));

  // 同一行两个键分别在不同列被按下, 两列均为 1 → 行 1
  setC(0, 1);
  kb.state.keys['1,1'] = 1;
  sim.evalChip(kb); sim.flush();
  check('两键在两列且均为 1: 行1=1', R(1) === 1, R(1));

  // 列未驱动 (断开开关) + 按键按下 → 行 X
  sim.removeWire(cw[0].id);
  sim.removeWire(cw[1].id);
  sim.evalChip(kb); sim.flush();
  check('按下的列未驱动 → 行输出 X', R(1) === VX, R(1));

  // 上拉模式: 空闲 1, 列低有效扫描 (按下且列 0 → 行 0)
  const kb2 = sim.addChip('KB44', 0, 0, 0, { pull: 1 });
  const R2 = r => V(sim, kb2, 5 + r);
  const lo = sim.addChip('GND', 0, 0);
  sim.addWire(lo, 1, kb2, 1);                     // C1 接低
  check('上拉: 空闲行 = 1', [0, 1, 2, 3].every(r => R2(r) === 1), [0, 1, 2, 3].map(R2));
  kb2.state.keys['2,0'] = 1;                      // 按下 键(行2,列1)
  sim.evalChip(kb2); sim.flush();
  check('上拉+列低有效: 按下行 = 0 其余 = 1', R2(2) === 0 && R2(0) === 1 && R2(1) === 1 && R2(3) === 1,
    [0, 1, 2, 3].map(R2));

  // 瞬时性: 载入不恢复按住状态
  const snap = JSON.parse(JSON.stringify({ s: kb2.state }));
  const sim2 = makeSim();
  const kb3 = sim2.addChip('KB44', 0, 0, 0, { pull: 1 }, snap.s);
  check('载入后按住状态清空', Object.keys(kb3.state.keys || {}).length === 0, kb3.state.keys);
}

console.log('\n========================================');
console.log(`结果: ${pass} 通过, ${fail} 失败`);
process.exit(fail ? 1 : 0);
