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

/** 按名称找示例 (不依赖索引顺序) */
const exByName = s => EXAMPLES.find(e => e.name.includes(s));

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
      if (ex.bb) { BB.setCols(ex.bb.cols); BB.setBoards(ex.bb.boards); }
      else { BB.setCols(60); BB.setBoards(1); }
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
  check(`全部 ${EXAMPLES.length} 个示例网表等价`, allOK, bad);
}

console.log('\n[4] 面包板模式仿真 (半加器真值表)');
{
  const sim = new Engine(LIB);
  const b = exByName('半加器').build();
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
  const b = exByName('SR 锁存器').build();
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
  const b = exByName('数码管计数').build(); // 含VCC
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
  const b = exByName('SR 锁存器').build();
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
  check('SEG7 宽 = (8-1)×孔距+18 (端部一个孔宽)', r2.w === 7 * BB.PITCH + BB.ROW_IO_W, r2.w);
  check('SEG7 引脚腿都在模块水平范围内', seg.pins.every(p => {
    const hp = BB.holePos(BB.pinHole(seg, p.num));
    return hp.x >= r2.x && hp.x <= r2.x + r2.w;
  }));
  const led = sim.addChip('LED', 0, 0);
  led.bb = { kind: 'row', board: 0, row: 'a', col: 40 };
  const r3 = BB.chipRect(led);
  check('单脚模块宽 = 18px (一个孔宽, 近方形)', r3.w === BB.ROW_IO_W && r3.h === BB.ROW_IO_W + 8, r3.w);
  const lcd = sim.addChip('LCD1602', 0, 0);
  lcd.bb = { kind: 'row', board: 0, row: 'a', col: 12 };
  const r5 = BB.chipRect(lcd);
  check('LCD1602 盒加高 (rowBoxH), 宽仍随腿跨', r5.h === BB.rowBoxH(lcd) + 8 && BB.rowBoxH(lcd) > 26 && r5.w === 9 * BB.PITCH + BB.ROW_IO_W, [r5.w, r5.h]);
  check('LCD1602 腿孔都在盒水平范围内', lcd.pins.every(p => {
    const hp = BB.holePos(BB.pinHole(lcd, p.num));
    return hp.x >= r5.x && hp.x <= r5.x + r5.w;
  }));
  const g64 = sim.addChip('LCD12864', 0, 0);
  g64.bb = { kind: 'row', board: 0, row: 'j', col: 12 };
  const r6 = BB.chipRect(g64);
  check('LCD12864 盒加高且盒体位于腿孔下方', BB.rowBoxH(g64) > BB.rowBoxH(lcd) && r6.y === BB.holePos('0:j12').y - 8, [r6.h, r6.y]);
  const clk = sim.addChip('CLOCK', 0, 0);
  clk.bb = { kind: 'row', board: 0, row: 'a', col: 45 };
  const r7 = BB.chipRect(clk);
  check('普通 IO 模块盒高不变 (26+8)', r7.h === 34, r7.h);
  const vcc = sim.addChip('VCC', 0, 0);
  vcc.bb = { kind: 'rail', board: 0, rail: 'R1', col: 10 };
  const r4 = BB.chipRect(vcc);
  check('电源轨模块宽 = 一个孔宽 且居中于孔', r4.w === BB.ROW_IO_W && Math.abs(r4.x + r4.w / 2 - BB.colX(10)) < 1e-9);
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
  const b = exByName('SR 锁存器').build();
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

console.log('\n[8] 存储器 (74187 / 74S472 / 74189 / 6116 / AT28C64B / AT28C256 / 6264)');
{
  const sim = new Engine(LIB);
  // 用开关驱动所有控制/地址/数据脚 (无网络的引脚不会触发重评估, 必须真实连线)
  let swSeq = 0;
  const swBus = (chip, pins) => {
    const sws = [];
    for (let i = 0; i < pins.length; i++) {
      const s = sim.addChip('SW', 0, 0, 0, { _seq: ++swSeq });
      sws.push(s);
      sim.addWire(s, 1, chip, pins[i]);
    }
    const set = v => { for (let i = 0; i < sws.length; i++) sim.driveNow(sws[i], 1, (v >> i) & 1); };
    return { sws, set };
  };
  const readD = (chip, pins) => {
    let v = 0;
    for (let i = 0; i < pins.length; i++) if (sim.pinDisplay(chip.pinByNum[pins[i]]) === 1) v |= 1 << i;
    return v;
  };
  // 断开某芯片数据脚上的开关线 (模拟总线释放)
  const cutData = (chip, dataPins) => {
    for (const w of [...sim.wires].filter(w =>
      (w.a.chip === chip && dataPins.includes(w.a.num)) ||
      (w.b.chip === chip && dataPins.includes(w.b.num)))) sim.removeWire(w.id);
  };

  // 74187 — ROM 256×4, 出厂内容 = 地址低 4 位
  const rom = sim.addChip('74187', 0, 0);
  const romA = swBus(rom, LIB['74187'].mem.addr);
  romA.set(0xA5);
  check('74187 地址 0xA5 读出 0x5 (出厂=地址低4位)', readD(rom, LIB['74187'].mem.data) === 0x05);

  // 74189 — RAM 16×4, /CS /WE 低有效, /WE=1 写
  const ram = sim.addChip('74189', 0, 0);
  const ramA = swBus(ram, LIB['74189'].mem.addr);
  const ramD = swBus(ram, LIB['74189'].mem.data);
  const ramCS = swBus(ram, [5]), ramWE = swBus(ram, [6]);
  ramA.set(0x3); ramD.set(0x9);
  ramCS.set(0);                     // /CS=0 选中
  ramWE.set(1);                     // /WE=1 写入
  // 读回: 断开数据开关 (模拟总线释放) → /WE=0 → RAM 驱动数据线
  const dataWires = [...sim.wires].filter(w =>
    (w.a.chip === ram && w.a.num >= 7) || (w.b.chip === ram && w.b.num >= 7));
  for (const w of dataWires) sim.removeWire(w.id);
  ramWE.set(0);
  check('74189 写 0x9 @3 后读回 0x9', readD(ram, LIB['74189'].mem.data) === 0x9);
  ramCS.set(1);                     // /CS=1 未选中
  check('74189 未选中数据线高阻', sim.pinDisplay(ram.pinByNum[7]) === 'Z');

  // 74S472 — PROM 512×8, /CE=10 低有效使能输出
  const pr = sim.addChip('74S472', 0, 0);
  const prA = swBus(pr, LIB['74S472'].mem.addr);
  const prCE = swBus(pr, [10]);
  prA.set(0x101);
  prCE.set(0);                      // /CE=0 使能
  check('74S472 地址 0x101 读出 0x01', readD(pr, LIB['74S472'].mem.data) === 0x01);
  prCE.set(1);                      // /CE=1
  check('74S472 /CE=1 输出高阻', sim.pinDisplay(pr.pinByNum[11]) === 'Z');

  // 6116 — SRAM 2K×8, /CS /OE /WE 低有效, /WE=0 写
  const sr = sim.addChip('6116', 0, 0);
  const srA = swBus(sr, LIB['6116'].mem.addr);
  const srD = swBus(sr, LIB['6116'].mem.data);
  const srCS = swBus(sr, [21]), srOE = swBus(sr, [22]), srWE = swBus(sr, [12]);
  srA.set(0x7FF); srD.set(0x5A);
  srCS.set(0); srOE.set(0);
  srWE.set(0);                      // /WE=0 写入
  srWE.set(1);                      // /WE=1 读
  check('6116 写 0x5A @0x7FF 读回 0x5A', readD(sr, LIB['6116'].mem.data) === 0x5A);

  // AT28C64B — EEPROM 8K×8, 真实 DIP-28 引脚, /CE /OE /WE 低有效, /WE=0 电改写
  const e64 = sim.addChip('AT28C64B', 0, 0);
  check('AT28C64B 物理 28 脚 DIP (跨 14 列)', BB.physPins(e64) === 28 && BB.dipSpan(e64) === 14);
  check('AT28C64B 真实电源脚 pwr = VCC28/GND14', LIB['AT28C64B'].pwr && LIB['AT28C64B'].pwr.vcc === 28 && LIB['AT28C64B'].pwr.gnd === 14);
  e64.bb = { kind: 'dip', board: 0, col: 20, flip: false };
  const ph64 = BB.powerHoles(e64);
  check('AT28C64B 供电腿孔位 VCC→0:f20 / GND→0:e33', ph64 && ph64.vcc === '0:f20' && ph64.gnd === '0:e33', ph64);
  e64.bb = null;
  const e64A = swBus(e64, LIB['AT28C64B'].mem.addr);
  const e64CE = swBus(e64, [20]), e64OE = swBus(e64, [22]), e64WE = swBus(e64, [27]);
  e64CE.set(0); e64OE.set(0); e64WE.set(1);
  e64A.set(0x1234);
  check('AT28C64B 地址 0x1234 出厂读出 0x34 (内容=地址低8位)', readD(e64, LIB['AT28C64B'].mem.data) === 0x34);
  const e64D = swBus(e64, LIB['AT28C64B'].mem.data);
  e64D.set(0x9D);
  e64WE.set(0); e64WE.set(1);       // /WE=0 电改写 (EEPROM 像 SRAM 一样可写)
  cutData(e64, LIB['AT28C64B'].mem.data);
  check('AT28C64B /WE=0 写 0x9D @0x1234 读回', readD(e64, LIB['AT28C64B'].mem.data) === 0x9D);
  e64A.set(0x0234);                 // A12=0: 另一单元, 仍为出厂值 (证明 A12 参与译码)
  check('AT28C64B A12 参与译码 (0x0234 读出厂 0x34)', readD(e64, LIB['AT28C64B'].mem.data) === 0x34);
  e64CE.set(1);
  check('AT28C64B /CE=1 数据线高阻', sim.pinDisplay(e64.pinByNum[11]) === 'Z');
  e64CE.set(0);

  // AT28C256 — EEPROM 32K×8, 高位地址 A13 (26 脚) / A14 (1 脚) 参与译码
  const e2 = sim.addChip('AT28C256', 0, 0);
  check('AT28C256 物理 28 脚 DIP + 真实电源脚', BB.physPins(e2) === 28 && LIB['AT28C256'].pwr.vcc === 28 && LIB['AT28C256'].pwr.gnd === 14);
  const e2A = swBus(e2, LIB['AT28C256'].mem.addr);
  const e2CE = swBus(e2, [20]), e2OE = swBus(e2, [22]), e2WE = swBus(e2, [27]);
  e2CE.set(0); e2OE.set(0); e2WE.set(1);
  e2A.set(0x3FFF);
  check('AT28C256 地址 0x3FFF 出厂读出 0xFF', readD(e2, LIB['AT28C256'].mem.data) === 0xFF);
  const e2D = swBus(e2, LIB['AT28C256'].mem.data);
  e2D.set(0xAB);
  e2WE.set(0); e2WE.set(1);         // 写 0xAB @0x3FFF (A14=0, A13=1)
  cutData(e2, LIB['AT28C256'].mem.data);
  e2A.set(0x7FFF);                  // A14=1: 不同单元, 出厂 0xFF
  check('AT28C256 A14 参与译码 (0x7FFF 读 0xFF 非 0xAB)', readD(e2, LIB['AT28C256'].mem.data) === 0xFF);
  e2A.set(0x3FFF);
  check('AT28C256 0x3FFF 读回 0xAB', readD(e2, LIB['AT28C256'].mem.data) === 0xAB);
  e2OE.set(1);
  check('AT28C256 /OE=1 数据线高阻', sim.pinDisplay(e2.pinByNum[11]) === 'Z');
  e2OE.set(0);

  // 6264 — SRAM 8K×8, 双片选: /CS1 (20 脚) 低有效 + CS2 (26 脚) 高有效
  const s6 = sim.addChip('6264', 0, 0);
  check('6264 物理 28 脚 DIP + 真实电源脚', BB.physPins(s6) === 28 && LIB['6264'].pwr.vcc === 28 && LIB['6264'].pwr.gnd === 14);
  const s6A = swBus(s6, LIB['6264'].mem.addr);
  const s6D = swBus(s6, LIB['6264'].mem.data);
  const s6CS = swBus(s6, [20]), s6CS2 = swBus(s6, [26]), s6OE = swBus(s6, [22]), s6WE = swBus(s6, [27]);
  s6A.set(0x001); s6D.set(0x5A);
  s6CS.set(0); s6CS2.set(1); s6OE.set(0);
  s6WE.set(0); s6WE.set(1);         // 双片选有效时 /WE=0 写入
  cutData(s6, LIB['6264'].mem.data);
  check('6264 写 0x5A @1 读回', readD(s6, LIB['6264'].mem.data) === 0x5A);
  s6CS2.set(0);                     // CS2 高有效: 拉低即失效
  check('6264 CS2=0 数据线高阻', sim.pinDisplay(s6.pinByNum[11]) === 'Z');
  s6CS2.set(1);
  check('6264 CS2=1 恢复读出', readD(s6, LIB['6264'].mem.data) === 0x5A);
  s6CS.set(1);
  check('6264 /CS1=1 数据线高阻', sim.pinDisplay(s6.pinByNum[11]) === 'Z');

  // 内容随存档保存
  const saved = JSON.parse(JSON.stringify({
    chips: Array.from(sim.chips.values()).map(c => ({ type: c.type, props: c.props })),
  }));
  check('74189 内容随存档保存', saved.chips.find(c => c.type === '74189').props.mem[3] === 0x9);
  check('6116 内容随存档保存', saved.chips.find(c => c.type === '6116').props.mem[0x7FF] === 0x5A);
  check('AT28C64B 内容随存档保存', saved.chips.find(c => c.type === 'AT28C64B').props.mem[0x1234] === 0x9D);
  check('AT28C256 内容随存档保存', saved.chips.find(c => c.type === 'AT28C256').props.mem[0x3FFF] === 0xAB);
  check('6264 内容随存档保存', saved.chips.find(c => c.type === '6264').props.mem[1] === 0x5A);

  // 旧通用型号迁移: ROM→74187 / RAM→6116
  const legacy = { chips: [
    { type: 'ROM', props: { mem: new Array(256).fill(0xAB) } },
    { type: 'RAM', props: { mem: new Array(256).fill(0) } },
  ], wires: [] };
  const MEM_ALIAS = { ROM: '74187', RAM: '6116' };
  for (const c of legacy.chips) {
    if (!MEM_ALIAS[c.type]) continue;
    const nm = MEM_ALIAS[c.type];
    const m = LIB[nm].mem;
    const old = c.props && Array.isArray(c.props.mem) ? c.props.mem : [];
    const mem = new Array(m.size).fill(0);
    for (let i = 0; i < Math.min(old.length, m.size); i++) mem[i] = old[i] & m.mask;
    c.type = nm;
    c.props = Object.assign({}, c.props, { mem });
  }
  const mRom = legacy.chips[0], mRam = legacy.chips[1];
  check('旧 ROM 迁移为 74187 且内容按掩码截取', mRom.type === '74187' && mRom.props.mem[0xAB] === 0x0B);
  check('旧 RAM 迁移为 6116 且补零到 2048', mRam.type === '6116' && mRam.props.mem.length === 2048);
}

console.log('\n[11] 供电: 电源脚孔位 / 自动供电跳线 / 供电判定');
{
  const sim = new Engine(LIB);
  const n = sim.addChip('7400', 0, 0);   // 14 脚: GND=7, VCC=14
  BB.autoPlace(sim);                     // col=1
  const ph = BB.powerHoles(n);
  check('VCC 脚 → 0:f1, GND 脚 → 0:e7', ph.vcc === '0:f1' && ph.gnd === '0:e7', ph);

  const r = BB.autoWire(sim, []);
  const pwr = r.jumpers.filter(j => j.pwr);
  check('每颗 DIP 生成 2 根供电跳线', pwr.length === 2, pwr.length);
  check('供电跳线一端在电源轨', pwr.every(j => /:R[12]-/.test(j.b)), pwr);
  check('供电跳线不落在芯片腿行 e/f', pwr.every(j => !/^[01]:[ef]/.test(j.a)), pwr);

  let info = BB.computeNets(sim, r.jumpers);
  check('VCC 列带 + (极性 1)', (BB.holeNetPower(info, ph.vcc) & 1) === 1, BB.holeNetPower(info, ph.vcc));
  check('GND 列带 − (极性 2)', (BB.holeNetPower(info, ph.gnd) & 2) === 2, BB.holeNetPower(info, ph.gnd));
  check('chipPowered = true', BB.chipPowered(info, n) === true);

  // 去掉供电跳线 → 未上电; 无源虚拟元件不做供电检查 (按元件性质豁免, 与放置形态无关)
  info = BB.computeNets(sim, r.jumpers.filter(j => !j.pwr));
  check('移除供电跳线后 chipPowered = false', BB.chipPowered(info, n) === false);
  const io = sim.addChip('LED', 0, 0);
  io.bb = { kind: 'dip', board: 0, col: 40, flip: false };   // 虚拟元件即使摆成 DIP 也不检查
  check('无源虚拟元件不做供电检查 (含 DIP 形态)', BB.chipPowered(info, io) === true);
  check('全部无源单脚元件均豁免',
    ['SW', 'BTN', 'LED', 'PROBE', 'VCC', 'GND'].every(t => {
      const c = sim.addChip(t, 0, 0);
      c.bb = { kind: 'dip', board: 0, col: 45, flip: false };
      return BB.chipPowered(info, c) === true;
    }));

  // 有源虚拟元件 (CLOCK/PS2): 信号脚两侧带隐式电源腿, 需跳线接通电源轨
  const ck = sim.addChip('CLOCK', 0, 0);
  ck.bb = { kind: 'row', board: 0, row: 'a', col: 20 };
  check('CLOCK 占 3 列 (VCC腿+CLK+GND腿)', BB.legCount(ck) === 3 && BB.rowLegs(ck).length === 3);
  check('CLOCK 信号腿右移一列 → 0:a21', BB.pinHole(ck, 1) === '0:a21');
  const phC = BB.powerHoles(ck);
  check('CLOCK 电源腿在两端 a20/a22', phC.vcc === '0:a20' && phC.gnd === '0:a22', phC);
  let infoC = BB.computeNets(sim, r.jumpers);
  check('CLOCK 未接电 → 未上电', BB.chipPowered(infoC, ck) === false);
  const rC = BB.autoWire(sim, []);
  infoC = BB.computeNets(sim, rC.jumpers);
  check('自动布线为 CLOCK 生成供电跳线 → 上电', BB.chipPowered(infoC, ck) === true);
  check('CLOCK 电源腿列带 +− 极性',
    (BB.holeNetPower(infoC, '0:a20') & 1) === 1 && (BB.holeNetPower(infoC, '0:a22') & 2) === 2);

  const kb = sim.addChip('PS2', 0, 0);
  kb.bb = { kind: 'row', board: 0, row: 'a', col: 30 };
  check('PS2 占 4 列 (VCC腿+CLK+DATA+GND腿)', BB.legCount(kb) === 4 && BB.pinHole(kb, 1) === '0:a31');
  const rK = BB.autoWire(sim, []);
  check('PS2 上电 (供电跳线生成)', BB.chipPowered(BB.computeNets(sim, rK.jumpers), kb) === true);

  // NE555: 真实 DIP-8 电源脚位 (1脚GND / 8脚VCC, lib.pwr 覆盖默认约定)
  const n5 = sim.addChip('NE555', 0, 0);
  n5.bb = { kind: 'dip', board: 0, col: 50 };
  check('NE555 DIP 跨 4 列', BB.dipSpan(n5) === 4);
  const ph5 = BB.powerHoles(n5);
  check('NE555 电源孔: VCC=f50, GND=e50 (真实引脚)', ph5.vcc === '0:f50' && ph5.gnd === '0:e50', ph5);
  const r5 = BB.autoWire(sim, []);
  const info5 = BB.computeNets(sim, r5.jumpers);
  check('NE555 供电跳线 → 上电', BB.chipPowered(info5, n5) === true);

  // 接线规则: 轨上 VCC/GND 元件占用的轨孔不可再插线, 全部孔位至多一根跳线
  const vcc = sim.addChip('VCC', 0, 0), gnd = sim.addChip('GND', 0, 0);
  vcc.bb = { kind: 'rail', board: 0, rail: 'R1', col: 5 };
  gnd.bb = { kind: 'rail', board: 0, rail: 'R2', col: 5 };
  const rV = BB.autoWire(sim, []);
  const srcHoles = ['0:R1-5', '0:R2-5'];
  check('供电轨元件占用的轨孔不插跳线',
    rV.jumpers.every(j => !srcHoles.includes(j.a) && !srcHoles.includes(j.b)), srcHoles);
  {
    const occH = BB.occupancy(sim);
    const onChip = [], load = new Map();
    for (const j of rV.jumpers) for (const h of [j.a, j.b]) {
      if (occH.get(h)) onChip.push(h);
      load.set(h, (load.get(h) || 0) + 1);
    }
    check('跳线不落在任何芯片占用孔 (含轨上元件)', onChip.length === 0, onChip.slice(0, 6));
    check('每孔至多一根跳线', [...load.values()].every(n => n === 1), [...load.entries()].filter(([, n]) => n > 1));
  }

  // 网表等价性不受供电跳线影响 (电源网络无引脚, 不派生导线)
  const b = exByName('半加器').build();
  const sim2 = new Engine(LIB);
  sim2.load({ chips: b.chips, wires: b.wires });
  const before = partition(sim2.wiresRaw());
  BB.autoPlace(sim2);
  const r2 = BB.autoWire(sim2, sim2.wiresRaw());
  const part = partition(BB.deriveWires(sim2, r2.jumpers));
  check('含供电跳线时网表仍等价', JSON.stringify(before) === JSON.stringify(part));

  // 面包板全流程: 供电后半加器芯片正常工作
  sim2.setWiresRaw(BB.deriveWires(sim2, r2.jumpers));
  const info2 = BB.computeNets(sim2, r2.jumpers);
  for (const c of sim2.chips.values()) c.powered = BB.chipPowered(info2, c);
  const xor = Array.from(sim2.chips.values()).find(c => c.type === '7486');
  check('半加器芯片上电', xor.powered === true);
  check('上电后输出确定', sim2.pinDisplay(xor.pinByNum[3]) !== 'X', sim2.pinDisplay(xor.pinByNum[3]));
}

console.log('\n[9] LCD1602 液晶 (HD44780 接口 + 中文字库)');
{
  const sim = new Engine(LIB);
  const lcd = sim.addChip('LCD1602', 0, 0);
  const rs = sim.addChip('SW', 0, 0), en = sim.addChip('SW', 0, 0);
  sim.addWire(rs, 1, lcd, 1);
  sim.addWire(en, 1, lcd, 2);
  const db = [];
  for (let i = 0; i < 8; i++) {
    const s2 = sim.addChip('SW', 0, 0);
    db.push(s2);
    sim.addWire(s2, 1, lcd, 3 + i);
  }
  const setByte = v => { for (let i = 0; i < 8; i++) sim.driveNow(db[i], 1, (v >> i) & 1); };
  const strobe = () => { sim.driveNow(en, 1, 1); sim.driveNow(en, 1, 0); };

  sim.driveNow(rs, 1, 0);            // RS=0 指令模式
  setByte(0x01); strobe();           // 清屏
  setByte(0x80); strobe();           // 设置地址 0 (第一行行首)
  sim.driveNow(rs, 1, 1);            // RS=1 数据模式
  setByte(0x48); strobe();           // 'H'
  setByte(0x69); strobe();           // 'i'
  check('LCD1602 写入 ASCII "Hi"', lcd.state.ddram[0] === 'H' && lcd.state.ddram[1] === 'i',
    lcd.state.ddram.slice(0, 3));

  setByte(0xD6); strobe(); setByte(0xD0); strobe();   // GB2312 双字节 '中'
  check('LCD1602 中文双字节写入 (GB2312 中)', lcd.state.ddram[2] === '中', lcd.state.ddram[2]);

  sim.driveNow(rs, 1, 0);
  setByte(0x01); strobe();           // 清屏
  check('LCD1602 清屏后 DDRAM 全空格', lcd.state.ddram.slice(0, 5).every(c => c === ' '));

  setByte(0x80 | 0x40); strobe();    // 地址 0x40 = 第二行行首
  sim.driveNow(rs, 1, 1);
  setByte(0x41); strobe();           // 'A'
  check('LCD1602 地址 0x40 写入第二行', lcd.state.ddram[0x40] === 'A');

  // 光标随写入推进, 内容随存档序列化
  const saved = JSON.parse(JSON.stringify(lcd.state));
  check('LCD1602 显示内容随存档保存', saved.ddram[0] === ' ' && saved.ddram[0x40] === 'A' && saved.ddram.length === 80);
}

console.log('\n[10] LCD12864 图形液晶 (ST7920: 文字层 + 图形层)');
{
  const sim = new Engine(LIB);
  const lcd = sim.addChip('LCD12864', 0, 0);
  const rs = sim.addChip('SW', 0, 0), en = sim.addChip('SW', 0, 0);
  sim.addWire(rs, 1, lcd, 1);
  sim.addWire(en, 1, lcd, 2);
  const db = [];
  for (let i = 0; i < 8; i++) {
    const s2 = sim.addChip('SW', 0, 0);
    db.push(s2);
    sim.addWire(s2, 1, lcd, 3 + i);
  }
  const setByte = v => { for (let i = 0; i < 8; i++) sim.driveNow(db[i], 1, (v >> i) & 1); };
  const strobe = () => { sim.driveNow(en, 1, 1); sim.driveNow(en, 1, 0); };
  const cmd = b => { sim.driveNow(rs, 1, 0); setByte(b); strobe(); };
  const dat = b => { sim.driveNow(rs, 1, 1); setByte(b); strobe(); };

  cmd(0x01);                        // 清屏 (文字 + 图形)
  check('12864 清屏: DDRAM 全空格', lcd.state.ddram.every(c => c === ' '));
  check('12864 清屏: GDRAM 全零', lcd.state.gdram.every(b2 => b2 === 0));

  cmd(0x80);                        // 文字地址 0 (第 1 行行首)
  sim.driveNow(rs, 1, 1);
  dat(0x48); dat(0x69);             // "Hi"
  check('12864 文字层写入 "Hi"', lcd.state.ddram[0] === 'H' && lcd.state.ddram[1] === 'i');

  cmd(0x36);                        // 扩充指令集 + 开图形
  cmd(0x80 | 5);                    // GDRAM 行 Y=5
  cmd(0x80 | 2);                    // 字节列 X=2
  dat(0xFF);                        // 8 像素全亮
  check('12864 图形写入 GDRAM[5][2]=0xFF', lcd.state.gdram[5 * 16 + 2] === 0xFF);
  check('12864 图形写入后列自动 +1 指向 X=3', lcd.state.gx === 3);
  cmd(0x30);                        // 回基本指令集
  cmd(0x80 | 2);                    // 文字地址 2
  sim.driveNow(rs, 1, 1);
  dat(0x58);                        // 'X'
  check('12864 基本指令集文字地址 2 写入 X', lcd.state.ddram[2] === 'X');

  // 显示内容随存档序列化
  const saved = JSON.parse(JSON.stringify(lcd.state));
  check('12864 文字随存档保存', saved.ddram[2] === 'X');
  check('12864 图形随存档保存', saved.gdram[5 * 16 + 2] === 0xFF);
}

console.log('\n[11] PS/2 测试脚本');
{
  // 脚本解析
  const acts = ps2ParseScript('type hi\nsleep 500\ntype 2\nkey Enter\n# 注释\n\n');
  check('脚本解析: 4 条动作', acts.length === 4, acts);
  check('脚本解析: sleep 换算微秒', acts[1].type === 'sleep' && acts[1].us === 500000);
  check('脚本解析: key Enter 含按下与断开码', acts[3].type === 'bytes' &&
    acts[3].bytes.join(',') === '90,240,90');
  // 字符 → 扫描码
  check('字符码: a = 0x1C', ps2CharCodes('a')[0] === 0x1C);
  check('字符码: A 自动夹 Shift (12,1C,F0,1C,F0,12)', ps2CharCodes('A').join(',') === '18,28,240,28,240,18');
  check('字符码: 换行 = Enter (0x5A)', ps2CharCodes('\n')[0] === 0x5A);
  check('字符码: ! = Shift+1 (含 Break)', ps2CharCodes('!').join(',') === '18,22,240,22,240,18');

  // 运行: 通过真实 PS/2 协议把 "hi!" 打进电路 (由 CLK/DATA 接收方验证较重,
  // 这里验证队列投喂与排空、运行状态收敛)
  const sim = new Engine(LIB);
  const ps2 = sim.addChip('PS2', 0, 0);
  ps2.state.script = 'type hi!\nsleep 2\ntype x';
  ps2.state.running = true;
  ps2.state.run = { acts: ps2ParseScript(ps2.state.script), i: 0, ci: 0 };
  sim.evalChip(ps2);
  sim.advance(60000);              // 推进 60ms: 发送帧 + 2ms 等待全部完成
  check('脚本运行完成状态收敛', ps2.state.running === false && ps2.state.queue.length === 0);
  check('最后一个发送字节为 x 的 Break 码 (0x22)', ps2.state.lastByte === 0x22, ps2.state.lastByte);
}

console.log(`结果: ${pass} 通过, ${fail} 失败`);
process.exit(fail ? 1 : 0);
