/* =========================================================================
 * 74VM PCB 模式 — 封装布局 / 飞线 / 自动布局 (单位: mm)
 *
 * ch.pcb = {x, y, rot}  元件中心坐标 (mm, rot ∈ 0/90/180/270)
 * DIP 封装: 两排孔, 行距 7.62mm (0.3"), 孔距 2.54mm
 * IO 元件: 排针 (2.54mm 间距)
 * ========================================================================= */
(function (global) {
'use strict';

const LIBREF = () => (global.CHIPS || (global.window && global.window.CHIPS) || {}).LIB || {};
const isIO = t => { const d = LIBREF()[t]; return !!(d && d.custom); };

const BOARD = { w: 100, h: 80 };      // 板子尺寸 mm
const PITCH = 2.54;
const DIP_ROW_SPAN = 7.62;            // 0.3" DIP 两排间距

/** 封装信息 (DIP 按物理引脚数, 电源脚位空置) */
function footprint(type) {
  const d = LIBREF()[type];
  if (!d) return null;
  const n = d.pins.length;
  if (isIO(type)) {
    return { kind: 'header', pins: n, w: Math.max(n, 1) * PITCH + 2.54, h: 2.54 + 2.54 };
  }
  let phys = 0;
  for (const p of d.pins) if (p.num > phys) phys = p.num;
  phys = phys + (phys % 2);
  phys = Math.max(phys, n);
  const span = Math.ceil(phys / 2);
  return { kind: 'dip', pins: n, phys, span, w: DIP_ROW_SPAN + 2.54, h: (span - 1) * PITCH + 2.54 };
}

function rotXY(x, y, r) {
  if (r === 90) return { x: -y, y: x };
  if (r === 180) return { x: -x, y: -y };
  if (r === 270) return { x: y, y: -x };
  return { x, y };
}

/** 引脚焊盘中心 (mm, 元件坐标系 → 板坐标) */
function padPos(ch, pinNum) {
  const fp = footprint(ch.type);
  if (!fp || !ch.pcb) return null;
  let lx = 0, ly = 0;
  if (fp.kind === 'dip') {
    const span = fp.span;
    const len = (span - 1) * PITCH;
    if (pinNum <= span) { lx = -DIP_ROW_SPAN / 2; ly = -len / 2 + (pinNum - 1) * PITCH; }
    else { lx = DIP_ROW_SPAN / 2; ly = len / 2 - (pinNum - span - 1) * PITCH; }
  } else {
    const n = fp.pins;
    const len = (n - 1) * PITCH;
    const idx = ch.pins.findIndex(p => p.num === pinNum);
    lx = -len / 2 + idx * PITCH; ly = 0;
  }
  const v = rotXY(lx, ly, ch.pcb.rot || 0);
  return { x: ch.pcb.x + v.x, y: ch.pcb.y + v.y };
}

/** 元件包围盒 (mm, 轴对齐) */
function chipRect(ch) {
  const fp = footprint(ch.type);
  if (!fp || !ch.pcb) return null;
  const r = (ch.pcb.rot || 0) % 180 === 90;
  const w = r ? fp.h : fp.w, h = r ? fp.w : fp.h;
  return { x: ch.pcb.x - w / 2, y: ch.pcb.y - h / 2, w, h };
}

/** 引脚网络划分 (来自原理图网表 sim.wires) */
function pinNets(sim) {
  const parent = new Map();
  const key = (cid, pn) => cid + ':' + pn;
  const find = k => { let r = k; while (parent.get(r) !== r) r = parent.get(r); return r; };
  const union = (a, b) => { const ra = find(a), rb = find(b); if (ra !== rb) parent.set(ra, rb); };
  const ensure = k => { if (!parent.has(k)) parent.set(k, k); };
  for (const ch of sim.chips.values()) for (const p of ch.pins) ensure(key(ch.id, p.num));
  for (const w of sim.wires) {
    union(key(w.a.chip.id, w.a.num), key(w.b.chip.id, w.b.num));
  }
  const nets = new Map();
  for (const ch of sim.chips.values())
    for (const p of ch.pins) {
      const r = find(key(ch.id, p.num));
      if (!nets.has(r)) nets.set(r, []);
      nets.get(r).push({ chip: ch, pinNum: p.num });
    }
  return Array.from(nets.values());
}

/** 飞线: 每网络自第一引脚星形连接 [{a:{chip,pinNum}, b:{...}, netIdx}] */
function ratsnest(sim) {
  const out = [];
  pinNets(sim).forEach((pins, i) => {
    for (let k = 1; k < pins.length; k++)
      out.push({ a: pins[0], b: pins[k], netIdx: i });
  });
  return out;
}

/** 自动布局: 按原理图 x 顺序从左到右、放不下换行 */
function autoPlace(sim) {
  const chips = Array.from(sim.chips.values()).sort((a, b) => a.x - b.x || a.id - b.id);
  let x = 10, y = 14, rowH = 0;
  for (const ch of chips) {
    const fp = footprint(ch.type);
    if (!fp) continue;
    const r = ch.pcb && ch.pcb.rot || 0;
    const w = fp.w + 4, h = fp.h + 4;
    if (x + w > BOARD.w - 6) { x = 10; y += rowH + 4; rowH = 0; }
    if (y + h > BOARD.h - 4) y = 14;   // 超出则回到开头(交叠, 极少发生)
    ch.pcb = { x: Math.round((x + w / 2) * 2) / 2, y: Math.round((y + h / 2) * 2) / 2, rot: r };
    x += w;
    rowH = Math.max(rowH, h);
  }
  return true;
}

const PCB = { BOARD, PITCH, DIP_ROW_SPAN, footprint, padPos, chipRect, pinNets, ratsnest, autoPlace };
global.PCB = PCB;
if (typeof module !== 'undefined' && module.exports) module.exports = { PCB };

})(typeof window !== 'undefined' ? window : globalThis);
