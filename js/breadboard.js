/* =========================================================================
 * 74VM 面包板模式 — 孔位模型 / 连通性 / 自动摆放 / 自动接线
 *
 * 面包板结构:
 *   顶部电源轨: R1(红 +), R2(蓝 -)     每条轨整条连通
 *   主区: 行 a b c d e | 沟道 | f g h i j   (每列每半区 5 孔连通)
 *   底部电源轨: R3(蓝 -), R4(红 +)
 * DIP 芯片横跨沟道: 引脚 1..n/2 在 e 行自左向右, 引脚 n/2+1..n 在 f 行自右向左
 * 接线规则: 每孔至多插一根跳线; 芯片引脚/模块腿已占用的孔不可再插线
 *   (autoWire 与界面接线共同保证; 元件放置避开已插跳线的孔)
 * 供电模型: DIP 电源脚 (默认 GND=物理中间脚 / VCC=物理最大脚, lib.pwr 可按真实引脚覆盖)
 *   所在列需跳线接通电源轨, 未上电芯片由引擎强制输出 X; 电源轨视为已接通台式电源
 * ========================================================================= */
(function (global) {
'use strict';

const LIBREF = () => (global.CHIPS || (global.window && global.window.CHIPS) || {}).LIB || {};
const LIB_isIO = t => { const d = LIBREF()[t]; return !!(d && d.custom); };

const PITCH = 16;          // 孔距 (世界像素)
const ROW_IO_W = 18;   // IO 元件端部占位: 一个孔宽 (含 2px 边距)
let COLS = 60;             // 列数 (可通过 setCols 自定义, 20~240)
const ROWS_TOP = ['a', 'b', 'c', 'd', 'e'];
const ROWS_BOT = ['f', 'g', 'h', 'i', 'j'];

const RAILS = [
  { id: 'R1', color: '#d9534f', label: '+', y: 24 },
  { id: 'R2', color: '#4a90d9', label: '\u2212', y: 42 },
  { id: 'R3', color: '#4a90d9', label: '\u2212', y: 292 },
  { id: 'R4', color: '#d9534f', label: '+', y: 310 },
];
const ROW_Y = { a: 80, b: 96, c: 112, d: 128, e: 144, f: 178, g: 194, h: 210, i: 226, j: 242 };
const BOARD = { x: 8, y: 8, w: 40 + COLS * PITCH, h: 330 };   // 板体外框
const CHANNEL_Y = 161;                                       // 中央沟道中心

/** 自定义列数 (20~240), 同步板宽 */
function setCols(n) {
  COLS = Math.max(20, Math.min(240, Math.round(Number(n) || 60)));
  BOARD.w = 40 + COLS * PITCH;
  return COLS;
}
const getCols = () => COLS;

/* 多块板: 纵向排列, 每块板有独立的孔组/电源轨 */
let BOARDS = 1;
const BOARD_H = 330, BOARD_GAP = 30;
const boardY = i => i * (BOARD_H + BOARD_GAP);
function setBoards(n) {
  BOARDS = Math.max(1, Math.min(6, Math.round(Number(n) || 1)));
  return BOARDS;
}
const getBoards = () => BOARDS;
const totalH = () => BOARDS * BOARD_H + (BOARDS - 1) * BOARD_GAP;

/** 列号(1基) → x 坐标 */
const colX = c => 40 + (c - 1) * PITCH;
const railById = id => RAILS.find(r => r.id === id);

/** 孔位键: "板号:行列" (如 "0:e12") / "板号:轨-列" (如 "1:R1-5") */
function holePos(key) {
  const s = String(key);
  const ci = s.indexOf(':');
  if (ci < 0) return null;
  const b = +s.slice(0, ci), rest = s.slice(ci + 1);
  if (!(b >= 0 && b < BOARDS)) return null;
  if (rest[0] === 'R') {
    const m = rest.split('-');
    const r = railById(m[0]);
    const col = +m[1];
    if (!r || col < 1 || col > COLS) return null;
    return { x: colX(col), y: boardY(b) + r.y, board: b, rail: r };
  }
  const row = rest[0];
  const col = +rest.slice(1);
  if (!(row in ROW_Y) || col < 1 || col > COLS) return null;
  return { x: colX(col), y: boardY(b) + ROW_Y[row], board: b, row, col };
}

/** 孔位内部连通组 (按板隔离): 主区每列每半区一组, 电源轨整条一组 */
function groupOf(key) {
  const s = String(key);
  const ci = s.indexOf(':');
  if (ci < 0) return null;
  const b = s.slice(0, ci), rest = s.slice(ci + 1);
  if (rest[0] === 'R') return b + ':rail:' + rest.split('-')[0];
  const col = rest.slice(1);
  const half = ROWS_TOP.includes(rest[0]) ? 'T' : 'B';
  return b + ':g:' + half + ':' + col;
}

/** 组内全部孔位键 */
function groupHoles(g) {
  const ci = g.indexOf(':');
  const b = g.slice(0, ci), rest = g.slice(ci + 1);
  if (rest.startsWith('rail:')) {
    const rid = rest.slice(5);
    const out = [];
    for (let c = 1; c <= COLS; c++) out.push(b + ':' + rid + '-' + c);
    return out;
  }
  // rest = "g:T:12"
  const half = rest[2], col = rest.slice(4);
  const rows = half === 'T' ? ROWS_TOP : ROWS_BOT;
  return rows.map(r2 => b + ':' + r2 + col);
}

/** 物理 DIP 引脚数 (建模省略电源脚, 取最大脚号并向上取偶: 13→14) */
function physPins(ch) {
  let m = 0;
  for (const p of ch.pins) if (p.num > m) m = p.num;
  m = m + (m % 2);                       // 取偶
  return Math.max(m, ch.pins.length);
}
/** DIP 占用列数 */
function dipSpan(ch) { return Math.ceil(physPins(ch) / 2); }

/* ---------- 放置模型 ---------- */
/** ch.bb = {kind:'dip', col, flip} | {kind:'row', row, col} | {kind:'rail', rail, col} */

/** 有源虚拟元件: 无电源脚但需要供电的模块, 在信号脚两侧带隐式 VCC/GND 腿 */
const ACTIVE_CUSTOM = { CLOCK: true, PS2: true };
const isActiveCustom = t => !!ACTIVE_CUSTOM[t];
/** 行模块占位腿数 (有源虚拟元件 = 信号脚 + 两侧电源腿) */
const legCount = ch => ch.pins.length + (isActiveCustom(ch.type) ? 2 : 0);
/** 行模块盒高: LCD 模块盒加高留出可读屏面 (其余 26, 单脚 18) */
const ROW_BOX_H = { LCD1602: 64, LCD12864: 96 };
const rowBoxH = ch => legCount(ch) === 1 ? ROW_IO_W : (ROW_BOX_H[ch.type] || 26);

/** 元件某引脚所在孔位 (未放置返回 null); DIP 按物理引脚号定位, 电源脚位置空置 */
function pinHole(ch, pinNum) {
  const bb = ch.bb;
  if (!bb) return null;
  const b = (bb.board || 0) + ':';
  if (bb.kind === 'dip') {
    const phys = physPins(ch);
    const span = Math.ceil(phys / 2);
    if (pinNum <= span) {
      const col = bb.col + (bb.flip ? span - pinNum : pinNum - 1);
      return b + (bb.flip ? 'f' : 'e') + col;
    }
    const col = bb.col + (bb.flip ? pinNum - span - 1 : phys - pinNum);
    return b + (bb.flip ? 'e' : 'f') + col;
  }
  if (bb.kind === 'row') {
    const idx = ch.pins.findIndex(p => p.num === pinNum);
    return b + bb.row + (bb.col + (isActiveCustom(ch.type) ? 1 : 0) + Math.max(0, idx));
  }
  if (bb.kind === 'rail') return b + bb.rail + '-' + bb.col;
  return null;
}

/** 行模块腿位列表: [{hole, pin|null, pol}] — 有源虚拟元件两端为隐式电源腿 (pol: 1=+ 2=−) */
function rowLegs(ch) {
  if (!ch.bb || ch.bb.kind !== 'row') return null;
  const b = (ch.bb.board || 0) + ':';
  const active = isActiveCustom(ch.type);
  const off = active ? 1 : 0;
  const legs = [];
  if (active) legs.push({ hole: b + ch.bb.row + ch.bb.col, pol: 1 });
  ch.pins.forEach((p, i) => legs.push({ hole: b + ch.bb.row + (ch.bb.col + off + i), pin: p }));
  if (active) legs.push({ hole: b + ch.bb.row + (ch.bb.col + off + ch.pins.length), pol: 2 });
  return legs;
}

/** 元件占据的孔位集合 (含有源虚拟元件的隐式电源腿) */
function chipHoles(ch) {
  const out = [];
  for (const p of ch.pins) { const h = pinHole(ch, p.num); if (h) out.push(h); }
  const legs = rowLegs(ch);
  if (legs) for (const l of legs) if (!l.pin && !out.includes(l.hole)) out.push(l.hole);
  return out;
}

/**
 * 元件在面包板上的模块矩形 — 绘制与命中的唯一来源, 尺寸严格按格:
 *   DIP: 跨列数 × 孔距 (电源脚位空置), 高 60 (覆盖 e/f 行 + 沟道)
 *   主区 IO 模块: (脚数+1) × 孔距, 居中于引脚跨度上方
 *   电源轨元件: 2 × 孔距
 */
function chipRect(ch) {
  const bb = ch.bb;
  if (!bb) return null;
  const oy = boardY(bb.board || 0);
  if (bb.kind === 'dip') {
    const span = dipSpan(ch);
    const p = holePos((bb.board || 0) + ':e' + bb.col);
    if (!p) return null;
    // 机体上下加宽: 盖住 e/f 两排 (各超出 8px), 引脚号可印入机体
    return { x: colX(bb.col) - PITCH / 2, y: oy + ROW_Y.e - 8, w: span * PITCH, h: ROW_Y.f - ROW_Y.e + 16 };
  }
  if (bb.kind === 'row') {
    const n = legCount(ch);
    const p0 = holePos((bb.board || 0) + ':' + bb.row + bb.col);
    if (!p0) return null;
    // 宽度 = (n-1) 列距 + 端部一个孔宽 (18): 相邻孔位仍可放其他 IO 元件
    const w = (n - 1) * PITCH + ROW_IO_W;
    const cx = colX(bb.col) + (n - 1) * PITCH / 2;
    // 上半区(a-e): 盒在孔上方; 下半区(f-j): 盒在孔下方(腿朝上), 不遮中央沟道/DIP
    // 单脚元件盒 18×18 近方形; LCD 盒加高留出屏面
    const lower = ROWS_BOT.includes(bb.row);
    const bh = rowBoxH(ch);
    const boxY = lower ? p0.y + 8 : p0.y - 8 - bh;
    return { x: cx - w / 2, y: lower ? p0.y - 8 : boxY, w, h: bh + 8 };
  }
  const p = holePos((bb.board || 0) + ':' + bb.rail + '-' + bb.col);
  if (!p) return null;
  const top = bb.rail === 'R1' || bb.rail === 'R2';
  return { x: p.x - ROW_IO_W / 2, y: top ? p.y - 26 : p.y - 6, w: ROW_IO_W, h: 24 };
}

/** 孔位占用: holeKey → {chip, pinNum} (含有源虚拟元件的隐式电源腿, pinNum=null) */
function occupancy(sim) {
  const occ = new Map();
  for (const ch of sim.chips.values()) {
    if (!ch.bb) continue;
    for (const h of chipHoles(ch)) occ.set(h, { chip: ch, pinNum: null });
  }
  return occ;
}

/**
 * DIP 占用的列区间是否空闲 (同板 DIP 不重叠):
 *   a~j 整列无其他元件的腿/引脚 — 同列组落腿会经金属条短路;
 *   e/f 行 (DIP 引脚插入行) 另须避开 blocked 集 (已插跳线的孔, 每孔一线)。
 */
function dipColsFree(sim, self, board, col, span, blocked) {
  const occ = occupancy(sim);
  for (let c = col; c < col + span; c++) {
    for (const row of ROWS_TOP.concat(ROWS_BOT)) {
      const o = occ.get(board + ':' + row + c);
      if (o && o.chip !== self) return false;
    }
    if (blocked) for (const row of ['e', 'f']) {
      if (blocked.has(board + ':' + row + c)) return false;
    }
  }
  for (const ch of sim.chips.values()) {
    if (ch === self || !ch.bb || ch.bb.kind !== 'dip') continue;
    if ((ch.bb.board || 0) !== board) continue;
    const s2 = dipSpan(ch);
    const a0 = ch.bb.col, a1 = ch.bb.col + s2 - 1;
    const b0 = col, b1 = col + span - 1;
    if (b0 <= a1 && a0 <= b1) return false;
  }
  return true;
}

/* ---------- 连通性 ---------- */
/**
 * 计算面包板电气网络 (并查集):
 *   组内连通 + 轨内连通 + 跳线连接
 * 返回 { holeNet: Map(holeKey→netIdx), netPins: [ [{chip,pinNum}...] ], netHoles: [holeKey...] }
 */
function computeNets(sim, jumpers) {
  const parent = new Map();
  const find = k => { let r = k; while (parent.get(r) !== r) r = parent.get(r); return r; };
  const union = (a, b) => { const ra = find(a), rb = find(b); if (ra !== rb) parent.set(ra, rb); };

  // 所有出现过的组/轨作为节点
  const nodes = new Set();
  const ensure = k => { if (!parent.has(k)) parent.set(k, k); };
  for (const ch of sim.chips.values()) {
    if (!ch.bb) continue;
    for (const h of chipHoles(ch)) { ensure(groupOf(h)); nodes.add(groupOf(h)); }
  }
  for (const j of jumpers) {
    for (const h of [j.a, j.b]) { if (holePos(h)) { ensure(groupOf(h)); nodes.add(groupOf(h)); } }
  }
  for (const j of jumpers) {
    if (!holePos(j.a) || !holePos(j.b)) continue;
    union(groupOf(j.a), groupOf(j.b));
  }

  // 组 → 网编号
  const rootIdx = new Map();
  const netPins = [], netHoles = [], netGroups = [];
  const netIdx = g => {
    const r = find(g);
    if (!rootIdx.has(r)) { rootIdx.set(r, netPins.length); netPins.push([]); netHoles.push([]); netGroups.push(new Set()); }
    return rootIdx.get(r);
  };
  const holeNet = new Map();
  const touchGroup = g => {
    const idx = netIdx(g);
    netGroups[idx].add(g);
    for (const h of groupHoles(g)) { holeNet.set(h, idx); netHoles[idx].push(h); }
  };
  for (const g of nodes) touchGroup(g);

  for (const ch of sim.chips.values()) {
    if (!ch.bb) continue;
    for (const p of ch.pins) {
      const h = pinHole(ch, p.num);
      if (!h || !holeNet.has(h)) continue;
      netPins[holeNet.get(h)].push({ chip: ch, pinNum: p.num, hole: h });
    }
  }
  return { holeNet, netPins, netHoles, netGroups };
}

/** 由面包板状态派生引脚↔引脚网表 (每网生成支撑树) */
function deriveWires(sim, jumpers) {
  const { netPins } = computeNets(sim, jumpers);
  const wires = [];
  for (const pins of netPins) {
    if (pins.length < 2) continue;
    for (let i = 1; i < pins.length; i++) {
      wires.push({ a: [pins[0].chip.id, pins[0].pinNum], b: [pins[i].chip.id, pins[i].pinNum] });
    }
  }
  return wires;
}

/* ---------- 供电检查 ---------- */
/** 电源腿孔位: DIP = 物理电源脚 (默认 GND=中间脚/VCC=最大脚, lib.pwr 可覆盖如 NE555 的 1/8),
 *  有源虚拟元件 = 行两端隐式腿; 其余返回 null */
function powerHoles(ch) {
  if (!ch.bb) return null;
  const d0 = LIBREF()[ch.type];
  // 理想化存储模型 (74S472/6116/74187/74189): 引脚为压缩编号且无电源脚,
  // 供电腿猜测会落在信号脚所在列上造成短路 — 视为常供电, 不生成供电跳线
  if (d0 && d0.mem && !d0.pwr) return null;
  if (ch.bb.kind === 'dip') {
    const d = LIBREF()[ch.type];
    if (d && d.pwr) return { gnd: pinHole(ch, d.pwr.gnd), vcc: pinHole(ch, d.pwr.vcc) };
    const phys = physPins(ch);
    return { gnd: pinHole(ch, phys / 2), vcc: pinHole(ch, phys) };
  }
  if (ch.bb.kind === 'row' && isActiveCustom(ch.type)) {
    const b = (ch.bb.board || 0) + ':';
    return { vcc: b + ch.bb.row + ch.bb.col, gnd: b + ch.bb.row + (ch.bb.col + legCount(ch) - 1) };
  }
  return null;
}

/** 网络电源极性: 0 无 / 1 = + / 2 = − / 3 = +−冲突 (看电源轨组或 VCC/GND 源引脚) */
function netPower(info, idx) {
  if (!info || idx == null || !info.netGroups[idx]) return 0;
  let pol = 0;
  for (const p of info.netPins[idx] || []) {
    if (p.chip.type === 'VCC') pol |= 1;
    else if (p.chip.type === 'GND') pol |= 2;
  }
  for (const g of info.netGroups[idx]) {
    if (/:rail:R[14]$/.test(g)) pol |= 1;
    else if (/:rail:R[23]$/.test(g)) pol |= 2;
  }
  return pol;
}

/** 孔位所在网络的电源极性 (未入网 → 0) */
function holeNetPower(info, hole) {
  return info && info.holeNet.has(hole) ? netPower(info, info.holeNet.get(hole)) : 0;
}

/** 芯片供电判定 (面包板模式): DIP 与有源虚拟元件 (CLOCK/PS2) 要求 VCC 列带 + 且 GND 列带 −;
 *  无源虚拟元件 (custom: 开关/按键/LED/探针/VCC/GND…) 本身无电源概念, 一律不检查 */
function chipPowered(info, ch) {
  if (LIB_isIO(ch.type) && !isActiveCustom(ch.type)) return true;
  if (!ch.bb) return true;
  const ph = powerHoles(ch);
  if (!ph) return true;
  return (holeNetPower(info, ph.vcc) & 1) !== 0 && (holeNetPower(info, ph.gnd) & 2) !== 0;
}

/* ---------- 自动摆放 ---------- */
function autoPlace(sim) {
  const chips = Array.from(sim.chips.values());
  const dippable = ch => !LIB_isIO(ch.type);
  const ios = chips.filter(c => !dippable(c)).sort((x, y) => x.x - y.x || x.id - y.id);
  const dips = chips.filter(dippable).sort((x, y) => x.x - y.x || x.id - y.id);

  let col = 1, board = 0;
  for (const ch of dips) {
    const span = dipSpan(ch);
    if (col + span - 1 > COLS) {
      if (board < BOARDS - 1) board++;
      col = 1;
    }
    while (!dipColsFree(sim, ch, board, col, span) && col < COLS) col++;
    ch.bb = { kind: 'dip', board, col: Math.min(col, COLS - span + 1), flip: (ch.bb && ch.bb.flip) || false };
    col += span + 1;
  }
  // IO 元件: VCC/GND 上电源轨, 其余放 a 行 — 只能落在不含 DIP 引脚的列
  // (DIP 引脚占 e/f 行, 所在列组 a~e 连通; IO 腿落进同列会与 DIP 引脚直接短路)
  const dipCols = new Map();   // board → Set(DIP 引脚列)
  for (const ch of dips) {
    const b = ch.bb.board, s = dipSpan(ch);
    if (!dipCols.has(b)) dipCols.set(b, new Set());
    const set = dipCols.get(b);
    for (let c = ch.bb.col; c < ch.bb.col + s; c++) set.add(c);
  }
  const ioCols = new Map();    // board → Set(IO 腿列)
  let railColP = 2, railColN = 2, rowBoard = 0, rowCol = 2;
  for (const ch of ios) {
    const n = legCount(ch);
    if (ch.type === 'VCC') { ch.bb = { kind: 'rail', board: 0, rail: 'R1', col: railColP }; railColP += 3; }
    else if (ch.type === 'GND') { ch.bb = { kind: 'rail', board: 0, rail: 'R2', col: railColN }; railColN += 3; }
    else {
      let placed = false;
      outer:
      for (let b = 0; b < BOARDS; b++) {
        if (!ioCols.has(b)) ioCols.set(b, new Set());
        const used = ioCols.get(b);
        for (let c = 2; c + n - 1 <= COLS; c++) {
          let ok = true;
          for (let k = 0; k < n; k++)
            if ((dipCols.get(b) && dipCols.get(b).has(c + k)) || used.has(c + k)) { ok = false; c += k; break; }
          if (ok) {
            ch.bb = { kind: 'row', board: b, row: 'a', col: c };
            for (let k = 0; k < n; k++) used.add(c + k);
            placed = true;
            break outer;
          }
        }
      }
      if (!placed) ch.bb = { kind: 'row', board: rowBoard, row: 'a', col: Math.min(rowCol, COLS - 1) };
      else {
        rowBoard = ch.bb.board; rowCol = ch.bb.col + n;
      }
    }
  }
  return true;
}

/* ---------- 自动接线 (从原理图网表生成跳线) ---------- */
/**
 * 物理规则: 每孔至多插一根跳线; 芯片引脚/模块腿占用的孔不可再插线。
 * 做法: 每个电气网络取其引脚所在的连通组为节点 (同组引脚经组内金属条天然连通,
 *   组内只借空闲孔出线)。含电源轨组的网络 (VCC/GND 源在轨上) 星形 — 各列组直连
 *   电源轨; 其余链式 — 按板/列排序依次相连, 每组至多进出各一线端。组内选孔距
 *   参考点就近; 电源腿所在列组保留给供电 (信号线落入会经电源轨短路两个网络)。
 * 最后为每颗 DIP / 有源虚拟元件生成 VCC/GND → 电源轨的供电跳线。
 */
function autoWire(sim, schematicWires) {
  // 原理图引脚网络
  const parent = new Map();
  const find = k => { let r = k; while (parent.get(r) !== r) r = parent.get(r); return r; };
  const union = (a, b) => { const ra = find(a), rb = find(b); if (ra !== rb) parent.set(ra, rb); };
  const ensure = k => { if (!parent.has(k)) parent.set(k, k); };
  for (const ch of sim.chips.values()) for (const p of ch.pins) ensure(ch.id + ':' + p.num);
  for (const w of schematicWires || []) {
    ensure(w.a[0] + ':' + w.a[1]); ensure(w.b[0] + ':' + w.b[1]);
    union(w.a[0] + ':' + w.a[1], w.b[0] + ':' + w.b[1]);
  }
  const nets = new Map();
  for (const ch of sim.chips.values()) {
    if (!ch.bb) continue;
    for (const p of ch.pins) {
      const r = find(ch.id + ':' + p.num);
      if (!nets.has(r)) nets.set(r, []);
      nets.get(r).push({ chip: ch, pinNum: p.num });
    }
  }

  const occ = occupancy(sim);   // 芯片占用孔 (DIP 引脚 / IO 腿 / 轨上 VCC-GND), 不可插线
  const used = new Map();       // 孔 → 线端数 (每孔至多 1; 兜底复用时计警告)
  const take = h => used.set(h, (used.get(h) || 0) + 1);
  // 电源腿所在列整组保留给供电: 信号跳线落入会经电源轨把两个网络短路
  const pwrBlocked = new Set();
  for (const ch of sim.chips.values()) {
    if (!ch.bb) continue;
    const ph = powerHoles(ch);
    if (!ph) continue;
    for (const h of [ph.vcc, ph.gnd]) for (const hk of groupHoles(groupOf(h))) pwrBlocked.add(hk);
  }

  let warn = 0;
  /** 组内选孔: 非芯片占用, 距参考点曼哈顿距离最近的空闲孔。
   *  kind='signal': 另须避开电源腿列组 (落入会经电源轨短路两个网络);
   *  kind='power': 另须避开 e/f 腿行 — DIP 电源脚物理插在该孔 (建模省略引脚,
   *  occupancy 不含它, 须显式排除)。空闲孔耗尽时兜底取线端最少的孔并计警告。 */
  const pickHole = (g, from, kind) => {
    let best = null, bestD = 0, bestLoad = 0;
    for (const h of groupHoles(g)) {
      if (occ.get(h)) continue;
      const row = h.slice(h.indexOf(':') + 1, h.indexOf(':') + 2);
      if (kind === 'signal' && pwrBlocked.has(h)) continue;
      if (kind === 'power' && (row === 'e' || row === 'f')) continue;
      const p = holePos(h);
      const d = Math.abs(p.x - from.x) + Math.abs(p.y - from.y);
      const load = used.get(h) || 0;
      if (best == null || load < bestLoad || (load === bestLoad && d < bestD)) {
        best = h; bestD = d; bestLoad = load;
      }
    }
    if (!best) return null;
    if (bestLoad > 0) warn++;
    return best;
  };

  const jumpers = [];
  for (const [, pins] of nets) {
    if (pins.length < 2) continue;
    // 网络 → 连通组 (锚点 = 组内第一个引脚孔); 同组多引脚无需跳线
    const anchor = new Map();
    for (const p of pins) {
      const h = pinHole(p.chip, p.pinNum);
      if (!h) continue;
      const g = groupOf(h);
      if (!anchor.has(g)) anchor.set(g, h);
    }
    if (anchor.size < 2) continue;
    const groups = Array.from(anchor.keys());
    const railG = groups.find(g => /:rail:/.test(g));
    if (railG) {
      // 电源网络: 以电源轨为枢纽, 各列组直连电源轨 (列端贴自身引脚, 轨端贴该列)
      for (const g of groups) {
        if (g === railG) continue;
        const hB = pickHole(g, holePos(anchor.get(g)), 'signal');
        if (!hB) { warn++; continue; }
        const hA = pickHole(railG, holePos(hB), 'signal');
        if (!hA) { warn++; continue; }
        jumpers.push({ a: hA, b: hB });
        take(hA); take(hB);
      }
    } else {
      // 信号网络: 按板/列排序链式相连 (每组成都至多 2 线端, 5 孔组必有空位)
      groups.sort((x, y) => {
        const px = holePos(anchor.get(x)), py = holePos(anchor.get(y));
        return (px.board - py.board) || (px.x - py.x) || (px.y - py.y);
      });
      for (let i = 1; i < groups.length; i++) {
        const hA = pickHole(groups[i - 1], holePos(anchor.get(groups[i])), 'signal');
        if (!hA) { warn++; continue; }
        const hB = pickHole(groups[i], holePos(hA), 'signal');
        if (!hB) { warn++; continue; }
        jumpers.push({ a: hA, b: hB });
        take(hA); take(hB);
      }
    }
  }

  // 供电跳线: 每颗 DIP / 有源虚拟元件的 VCC/GND 电源腿列组 → 电源轨
  // (电源轨视为已接通台式电源; 轨端避开已用/被 VCC-GND 元件占用的孔;
  //  无源虚拟元件本身无电源概念, 与供电检查一致地不生成)
  for (const ch of sim.chips.values()) {
    if (!ch.bb) continue;
    if (LIB_isIO(ch.type) && !isActiveCustom(ch.type)) continue;
    const ph = powerHoles(ch);
    if (!ph) continue;
    const b = ch.bb.board || 0;
    for (const [hole, rail] of [[ph.vcc, 'R1'], [ph.gnd, 'R2']]) {
      const src = pickHole(groupOf(hole), holePos(hole), 'power');   // 腿列组内就近取空闲孔
      const dst = src && pickHole(b + ':rail:' + rail, holePos(src), 'power');
      if (!src || !dst) { warn++; continue; }
      jumpers.push({ a: src, b: dst, pwr: true });
      take(src); take(dst);
    }
  }
  return { jumpers, warn };
}

const BB = {
  PITCH, ROW_IO_W, ROWS_TOP, ROWS_BOT, RAILS, ROW_Y, BOARD, CHANNEL_Y,
  getCols, setCols, getBoards, setBoards, boardY, BOARD_H, BOARD_GAP, totalH,
  colX, holePos, groupOf, groupHoles, physPins, dipSpan, pinHole, chipHoles, chipRect,
  occupancy, dipColsFree, computeNets, deriveWires, autoPlace, autoWire,
  powerHoles, netPower, holeNetPower, chipPowered,
  isActiveCustom, legCount, rowLegs, rowBoxH,
};
global.BB = BB;
if (typeof module !== 'undefined' && module.exports) module.exports = { BB };

})(typeof window !== 'undefined' ? window : globalThis);
