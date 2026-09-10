/* =========================================================================
 * 74VM 模式测试 — 面包板 / PCB / 立创EDA导出
 * node test/test-modes.js
 * ========================================================================= */
'use strict';

const { Engine, Sim } = require('../js/engine.js');
const { LIB } = require('../js/chips.js');
const { EXAMPLES } = require('../js/examples.js');
const { BB } = require('../js/breadboard.js');
const { PCB } = require('../js/pcb.js');
const EasyEDA = require('../js/easyeda.js');

let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (extra !== undefined ? '  →  ' + JSON.stringify(extra) : '')); }
}

/** 把网表转成引脚划分 (网络集合), 用于等价性比较 */
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

console.log('\n[1] DIP 引脚→孔位映射 (物理引脚号, 电源脚空置)');
{
  const sim = new Engine(LIB);
  const n = sim.addChip('7400', 0, 0);
  n.bb = { kind: 'dip', board: 0, col: 5, flip: false };
  check('引脚1 → 0:e5', BB.pinHole(n, 1) === '0:e5', BB.pinHole(n, 1));
  check('引脚6 → 0:e10 (引脚7=GND 空置)', BB.pinHole(n, 6) === '0:e10');
  check('引脚8 → 0:f11', BB.pinHole(n, 8) === '0:f11');
  check('引脚13 → 0:f6', BB.pinHole(n, 13) === '0:f6');
  n.bb.flip = true;
  check('翻转后引脚1 → 0:f11', BB.pinHole(n, 1) === '0:f11');
  check('翻转后引脚13 → 0:e10', BB.pinHole(n, 13) === '0:e10');
}

console.log('\n[2] 孔位连通与派生网表');
{
  const sim = new Engine(LIB);
  const a = sim.addChip('7400', 0, 0);
  const b = sim.addChip('7404', 0, 0);
  a.bb = { kind: 'dip', board: 0, col: 3, flip: false };   // 7400.1 → 0:e3
  b.bb = { kind: 'dip', board: 0, col: 20, flip: false };  // 7404.1 → 0:e20
  // 跳线: 0:a3 (与 0:e3 同组) ↔ 0:b20 (与 0:e20 同组)
  const wires = BB.deriveWires(sim, [{ id: 1, a: '0:a3', b: '0:b20' }]);
  check('组内孔连通: 7400.1 ↔ 7404.1',
    wires.length === 1 && wires[0].a[0] === a.id && wires[0].a[1] === 1 && wires[0].b[1] === 1, wires);
  // 电源轨整条连通 (自身无引脚不产生网络)
  const wires2 = BB.deriveWires(sim, [{ id: 2, a: '0:R1-5', b: '0:R1-50' }]);
  check('电源轨自身不产生引脚网络', wires2.length === 0);
  // 不同板的同名孔不连通
  const wires3 = BB.deriveWires(sim, [{ id: 3, a: '0:a3', b: '1:a20' }]);
  check('跨板孔位互不连通', wires3.length === 0);
}

console.log('\n[3] 自动摆放+接线: 面包板网表与原理图网表等价 (全部示例)');
{
  let allOK = true, bad = [];
  for (const ex of EXAMPLES) {
    try {
      const sim = new Engine(LIB);
      const b = ex.build();
      sim.load({ chips: b.chips, wires: b.wires });
      const before = partition(sim.wiresRaw());
      BB.autoPlace(sim);
      const r = BB.autoWire(sim, sim.wiresRaw());
      const after = partition(BB.deriveWires(sim, r.jumpers));
      if (JSON.stringify(before) !== JSON.stringify(after)) {
        allOK = false; bad.push(ex.name);
      }
      // 跳线端点必须都存在
      for (const j of r.jumpers) {
        if (!BB.holePos(j.a) || !BB.holePos(j.b)) { allOK = false; bad.push(ex.name + ':坏孔位'); }
      }
    } catch (err) { allOK = false; bad.push(ex.name + ':' + err.message); }
  }
  check('8 个示例网表等价', allOK, bad);
}

console.log('\n[4] 面包板模式仿真 (半加器真值表)');
{
  const sim = new Engine(LIB);
  const b = EXAMPLES[2].build(); // 半加器
  sim.load({ chips: b.chips, wires: b.wires });
  BB.autoPlace(sim);
  const r = BB.autoWire(sim, sim.wiresRaw());
  sim.setWiresRaw(BB.deriveWires(sim, r.jumpers));
  const sws = Array.from(sim.chips.values()).filter(c => c.type === 'SW');
  const leds = Array.from(sim.chips.values()).filter(c => c.type === 'LED');
  const xor = Array.from(sim.chips.values()).find(c => c.type === '7486');
  const and = Array.from(sim.chips.values()).find(c => c.type === '7408');
  // 输入与门/异或门对应开关: 通过现有连线识别 A/B
  const V = (ch, pin) => sim.pinDisplay(ch.pinByNum[pin]);
  const set = (a, bb) => { sim.driveNow(sws[0], 1, a); sim.driveNow(sws[1], 1, bb); };
  const truth = [];
  for (const [a, bb] of [[0, 0], [0, 1], [1, 0], [1, 1]]) {
    set(a, bb);
    truth.push([a ^ bb, a & bb, V(xor, 3), V(and, 3)]);
  }
  let ok = true;
  for (const t of truth) if (t[0] !== t[2] || t[1] !== t[3]) ok = false;
  check('S=A⊕B, C=A·B 全真值表', ok, truth);
}

console.log('\n[5] PCB: 焊盘位置 / 自动布局 / 飞线');
{
  const sim = new Engine(LIB);
  const n = sim.addChip('7400', 0, 0);
  n.pcb = { x: 50, y: 40, rot: 0 };
  const p1 = PCB.padPos(n, 1);
  const p13 = PCB.padPos(n, 13);
  check('引脚1 左上, 引脚13 右上一排 (VCC脚位空置)', p1.x < p13.x && Math.abs((p13.y - p1.y) - 2.54) < 1e-9, [p1, p13]);
  check('行距 = 7.62mm', Math.abs((p13.x - p1.x) - 7.62) < 1e-9);
  const p2 = PCB.padPos(n, 2);
  check('列距 = 2.54mm', Math.abs((p2.y - p1.y) - 2.54) < 1e-9);
  n.pcb.rot = 90;
  const p1r = PCB.padPos(n, 1);
  check('旋转90°生效', p1r.x > 50 && p1r.y < 40, p1r);

  // 布局与飞线
  const b = EXAMPLES[0].build(); // SR锁存器
  sim.load({ chips: b.chips, wires: b.wires });
  PCB.autoPlace(sim);
  let inBounds = true;
  for (const ch of sim.chips.values()) {
    const r = PCB.chipRect(ch);
    if (r.x < 0 || r.y < 0 || r.x + r.w > PCB.BOARD.w || r.y + r.h > PCB.BOARD.h) inBounds = false;
  }
  check('自动布局均在板内', inBounds);
  const rn = PCB.ratsnest(sim);
  // SR示例 6 根导线, 每根一跳 → 6 条飞线
  check('飞线数 = 原理图导线数', rn.length === sim.wires.length, [rn.length, sim.wires.length]);
}

console.log('\n[6] 立创EDA 导出格式');
{
  const sim = new Engine(LIB);
  const b = EXAMPLES[5].build(); // 数码管计数 (含VCC)
  sim.load({ chips: b.chips, wires: b.wires });
  PCB.autoPlace(sim);
  const r = EasyEDA.buildEasyEDA(sim, PCB);
  const doc = JSON.parse(r.json);
  check('docType = 3', doc.head.docType === '3');
  check('canvas 单位 mil', doc.canvas.split('~')[11] === 'mil');
  const pads = doc.shape.filter(s => s.startsWith('PAD~'));
  const tracks = doc.shape.filter(s => s.startsWith('TRACK~'));
  const rects = doc.shape.filter(s => s.startsWith('RECT~'));
  const totalPins = Array.from(sim.chips.values()).reduce((s, c) => s + c.pins.length, 0);
  check('焊盘数 = 引脚总数', pads.length === totalPins, [pads.length, totalPins]);
  check('板框 4 条线', tracks.length === 4);
  check('丝印矩形 = 元件数×2', rects.length === sim.chips.size * 2);
  check('网络含 VCC', r.netNames.includes('VCC'), r.netNames);
  const padFields = pads[0].split('~');
  check('PAD 20 字段', padFields.length === 20, padFields.length);
  check('焊盘带网络名', pads.some(p => p.split('~')[7] === 'VCC'));
  // 网表导出
  const nl = EasyEDA.buildNetlist(sim, PCB);
  check('网表结构完整', nl.format === '74vm-netlist' && nl.components.length === sim.chips.size &&
        nl.nets.length > 0 && nl.nets.every(n => n.pins.length >= 1));
}

console.log('\n[7] 模式切换往返: 原理图 → 面包板 → 原理图');
{
  const sim = new Engine(LIB);
  const b = EXAMPLES[0].build();
  sim.load({ chips: b.chips, wires: b.wires });
  const before = sim.wiresRaw();
  const beforePart = partition(before);
  BB.autoPlace(sim);
  const r = BB.autoWire(sim, before);
  sim.setWiresRaw(BB.deriveWires(sim, r.jumpers));   // 进入面包板
  const bbPart = partition(sim.wiresRaw());
  sim.setWiresRaw(before);                            // 回到原理图
  const afterPart = partition(sim.wiresRaw());
  check('面包板网表等价', JSON.stringify(beforePart) === JSON.stringify(bbPart));
  check('返回原理图后网表还原', JSON.stringify(beforePart) === JSON.stringify(afterPart));
}

console.log('\n[8] 自定义尺寸与模块矩形按格对齐');
{
  BB.setCols(30);
  check('setCols 生效', BB.getCols() === 30);
  check('板宽同步', BB.BOARD.w === 40 + 30 * BB.PITCH, BB.BOARD.w);
  check('超范围孔位无效', BB.holePos('0:e31') === null);
  check('范围内孔位有效', !!BB.holePos('0:e30'));
  BB.setCols(500); check('列数上限 240', BB.getCols() === 240);
  BB.setCols(10);  check('列数下限 20', BB.getCols() === 20);
  BB.setCols(60);

  const sim = new Engine(LIB);
  const n = sim.addChip('7400', 0, 0);
  n.bb = { kind: 'dip', board: 0, col: 5, flip: false };
  const r1 = BB.chipRect(n);
  check('DIP 模块宽 = 跨列×孔距 (7×16)', r1.w === 7 * BB.PITCH, r1.w);
  check('DIP 模块左缘对齐孔位', r1.x === BB.colX(5) - BB.PITCH / 2);
  check('DIP 引脚孔均在模块内', n.pins.every(p => {
    const h = BB.pinHole(n, p.num), hp = BB.holePos(h);
    return hp.x >= r1.x && hp.x <= r1.x + r1.w;
  }));
  const seg = sim.addChip('SEG7', 0, 0);
  seg.bb = { kind: 'row', board: 0, row: 'a', col: 3 };
  const r2 = BB.chipRect(seg);
  const cx = BB.colX(3) + 7 * BB.PITCH / 2;   // 8脚跨度中心
  check('SEG7 模块居中于引脚跨度', Math.abs(r2.x + r2.w / 2 - cx) < 1e-9, [r2.x + r2.w / 2, cx]);
  check('SEG7 宽 = (8-1)×孔距+28', r2.w === 7 * BB.PITCH + 28, r2.w);
  check('SEG7 引脚腿都在模块水平范围内', seg.pins.every(p => {
    const hp = BB.holePos(BB.pinHole(seg, p.num));
    return hp.x >= r2.x && hp.x <= r2.x + r2.w;
  }));
  const led = sim.addChip('LED', 0, 0);
  led.bb = { kind: 'row', board: 0, row: 'a', col: 40 };
  const r3 = BB.chipRect(led);
  check('单脚模块宽 = 28px (不占邻列)', r3.w === 28, r3.w);
  const vcc = sim.addChip('VCC', 0, 0);
  vcc.bb = { kind: 'rail', board: 0, rail: 'R1', col: 10 };
  const r4 = BB.chipRect(vcc);
  check('电源轨模块宽 = 2×孔距 且居中于孔', r4.w === 2 * BB.PITCH && Math.abs(r4.x + r4.w / 2 - BB.colX(10)) < 1e-9);
}

console.log('\n[9] 多块面包板 (纵向排列)');
{
  BB.setBoards(1);
  check('默认 1 块板', BB.getBoards() === 1);
  BB.setBoards(3);
  check('setBoards 生效', BB.getBoards() === 3);
  BB.setBoards(9); check('板数上限 6', BB.getBoards() === 6);
  BB.setBoards(2);
  const p0 = BB.holePos('0:e5'), p1 = BB.holePos('1:e5');
  check('板1 孔位纵向偏移', p1.y === p0.y + BB.BOARD_H + BB.BOARD_GAP, [p0.y, p1.y]);
  check('不同板同名列不连通', BB.groupOf('0:e5') !== BB.groupOf('1:e5'));
  check('不同板电源轨不连通', BB.groupOf('0:R1-5') !== BB.groupOf('1:R1-5'));
  check('总高 = 板数×板高+间隔', BB.totalH() === 2 * BB.BOARD_H + BB.BOARD_GAP);

  // 自动摆放溢出到第二块板
  const sim = new Engine(LIB);
  BB.setCols(20);   // 小板子迫使溢出
  for (let i = 0; i < 6; i++) sim.addChip('7400', i * 50, 0);
  BB.autoPlace(sim);
  const boards = new Set(Array.from(sim.chips.values()).map(c => c.bb.board));
  check('放不下时溢出到下一块板', boards.size === 2, Array.from(boards));
  const rB1 = BB.chipRect(Array.from(sim.chips.values()).find(c => c.bb.board === 1));
  check('板1 元件矩形带纵向偏移', Math.abs(rB1.y - (BB.BOARD_H + BB.BOARD_GAP + BB.CHANNEL_Y - 25)) < 1e-9, rB1.y);

  // 两块板下的网表等价性
  const b = EXAMPLES[0].build();
  sim.load({ chips: b.chips, wires: b.wires });
  BB.setCols(60);
  BB.autoPlace(sim);
  const r = BB.autoWire(sim, sim.wiresRaw());
  const part1 = partition(sim.wiresRaw());
  const part2 = partition(BB.deriveWires(sim, r.jumpers));
  check('双板模式网表仍等价', JSON.stringify(part1) === JSON.stringify(part2));
  BB.setBoards(1);
}
console.log('');
console.log('[10] 原理图元件尺寸均为偶数格 (56px 倍数, 边框压网格线)');
{
  let ok = true, bad = [];
  for (const t of Object.keys(LIB)) {
    const d = LIB[t];
    if (!d.size) continue;
    const w = d.size.w, h = d.size.h;
    if (w % 56 !== 0 || (h != null && h % 56 !== 0)) { ok = false; bad.push(t + ' ' + w + 'x' + h); }
  }
  check('IO 元件声明尺寸全部 56 倍数', ok, bad);
}

console.log(`结果: ${pass} 通过, ${fail} 失败`);
process.exit(fail ? 1 : 0);
