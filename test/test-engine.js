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

console.log('\n========================================');
console.log(`结果: ${pass} 通过, ${fail} 失败`);
process.exit(fail ? 1 : 0);
