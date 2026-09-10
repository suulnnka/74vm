/* =========================================================================
 * 74VM 立创EDA (EasyEDA 标准版) PCB 源文件导出器
 *
 * 格式依据 docs.easyeda.com Document Format:
 *   - docType "3" = PCB, 坐标单位 mil (由 canvas 第12字段声明)
 *   - PAD   (20字段): PAD~shape~x~y~w~h~layer~net~number~holeR~points~rot~id~holeLen~slot~plated~locked~paste~solder~holeCenter
 *   - TRACK (7字段):  TRACK~lineWidth~layer~net~points~id~locked
 *   - RECT  (13字段): RECT~x~y~w~h~layer~id~locked~strokeWidth~fill~transform~net~c_etype
 * 层: 1=顶层铜 2=底层铜 3=顶丝印 13=板框
 * 焊盘带网络名 → 立创EDA打开后显示飞线, 可直接使用其自动布线
 * ========================================================================= */
(function (global) {
'use strict';

const MIL_PER_MM = 39.370078740157481;
const LAYER_TOP = 1, LAYER_SILK = 3, LAYER_OUTLINE = 13;
const PAD_DIA = 68;      // mil ≈ 1.73mm
const HOLE_DIA = 35;     // mil ≈ 0.89mm
const SILK_W = 8;        // mil

const LIBREF = () => (global.CHIPS || (global.window && global.window.CHIPS) || {}).LIB || {};
const isIO = t => { const d = LIBREF()[t]; return !!(d && d.custom); };

/** mm → mil(带偏移, 保证坐标为正) */
function makeConvert() {
  const OX = 1500, OY = 1200;
  return {
    x: mm => Math.round((mm * MIL_PER_MM + OX) * 10) / 10,
    y: mm => Math.round((mm * MIL_PER_MM + OY) * 10) / 10,
  };
}

/** 网络命名: VCC/GND 优先, 其余 N1.. (顺序稳定) */
function nameNets(pinNets) {
  const names = [];
  let n = 0;
  for (const pins of pinNets) {
    let name = null;
    for (const p of pins) {
      if (p.chip.type === 'VCC') { name = 'VCC'; break; }
      if (p.chip.type === 'GND') { name = 'GND'; break; }
    }
    if (!name) name = 'N' + (++n);
    names.push(name);
  }
  // 去重 (多个网络可能都被命名为 VCC? 不可能: VCC 元件引脚只有一个网络)
  return names;
}

/** 位号: IC→U1.., IO→P1.. */
function assignRefs(sim) {
  const refs = new Map();
  let u = 0, p = 0;
  const chips = Array.from(sim.chips.values()).sort((a, b) => a.id - b.id);
  for (const ch of chips) {
    refs.set(ch.id, isIO(ch.type) ? 'P' + (++p) : 'U' + (++u));
  }
  return refs;
}

/**
 * 生成立创EDA PCB JSON
 * @param sim 引擎实例 (wires = 原理图网表, chips 带 pcb 布局)
 * @param PCBmod pcb.js 模块
 * @returns { ok, json, missing:[type...], netNames }
 */
function buildEasyEDA(sim, PCBmod) {
  const C = makeConvert();
  let idSeq = 0;
  const nid = () => 'gge74vm' + (++idSeq);
  const shapes = [];

  // 板框 (4条边, 层13)
  const bw = PCBmod.BOARD.w * MIL_PER_MM, bh = PCBmod.BOARD.h * MIL_PER_MM;
  const ox = 1500, oy = 1200;
  const corners = [[ox, oy], [ox + bw, oy], [ox + bw, oy + bh], [ox, oy + bh]];
  for (let i = 0; i < 4; i++) {
    const [x1, y1] = corners[i], [x2, y2] = corners[(i + 1) % 4];
    shapes.push(`TRACK~10~${LAYER_OUTLINE}~~${Math.round(x1 * 10) / 10} ${Math.round(y1 * 10) / 10} ${Math.round(x2 * 10) / 10} ${Math.round(y2 * 10) / 10}~${nid()}~0`);
  }

  const pinNets = PCBmod.pinNets(sim);
  const netNames = nameNets(pinNets);
  const netOfPin = new Map();   // "chipId:pinNum" → net name
  pinNets.forEach((pins, i) => {
    for (const p of pins) netOfPin.set(p.chip.id + ':' + p.pinNum, netNames[i]);
  });
  const refs = assignRefs(sim);

  const missing = [];
  const chips = Array.from(sim.chips.values()).sort((a, b) => a.id - b.id);
  for (const ch of chips) {
    if (!ch.pcb) { missing.push(ch.type); continue; }
    const rect = PCBmod.chipRect(ch);
    // 丝印外框
    shapes.push(`RECT~${C.x(rect.x)}~${C.y(rect.y)}~${Math.round((rect.w * MIL_PER_MM) * 10) / 10}~${Math.round((rect.h * MIL_PER_MM) * 10) / 10}~${LAYER_SILK}~${nid()}~0~${SILK_W}~~~~`);
    // 1脚标记 (小方块丝印)
    const p1 = PCBmod.padPos(ch, ch.pins[0].num);
    if (p1) {
      shapes.push(`RECT~${C.x(p1.x - 1.2)}~${C.y(p1.y - 1.2)}~${Math.round(2.4 * MIL_PER_MM)}~${Math.round(2.4 * MIL_PER_MM)}~${LAYER_SILK}~${nid()}~0~${SILK_W}~~~~`);
    }
    // 焊盘 (椭圆 THT, 层11=多层)
    for (const pin of ch.pins) {
      const pos = PCBmod.padPos(ch, pin.num);
      if (!pos) continue;
      const net = netOfPin.get(ch.id + ':' + pin.num) || '';
      const X = C.x(pos.x), Y = C.y(pos.y);
      shapes.push(`PAD~ELLIPSE~${X}~${Y}~${PAD_DIA}~${PAD_DIA}~11~${net}~${pin.num}~${HOLE_DIA}~~0~${nid()}~0~~Y~0~~~${X},${Y}`);
    }
  }

  const doc = {
    head: {
      docType: '3',
      editorVersion: '6.5.40',
      newgId: true,
      c_para: { prefix: true },
      x: 0, y: 0,
    },
    canvas: `CA~1000~1000~#000000~yes~#FFFFFF~10~1000~1000~line~0.5~mil~1~45~~0.5~${ox + Math.round(bw / 2)}~${oy + Math.round(bh / 2)}~0~yes`,
    shape: shapes,
  };
  return { ok: missing.length === 0, json: JSON.stringify(doc, null, 2), missing, netNames };
}

/** 通用网表 JSON (供未来自有自动布线器使用) */
function buildNetlist(sim, PCBmod) {
  const pinNets = PCBmod.pinNets(sim);
  const netNames = nameNets(pinNets);
  const refs = assignRefs(sim);
  const components = [], nets = [];
  for (const ch of Array.from(sim.chips.values()).sort((a, b) => a.id - b.id)) {
    components.push({
      ref: refs.get(ch.id), type: ch.type, footprint: isIO(ch.type) ? 'HDR-' + ch.pins.length : 'DIP-' + ch.pins.length,
      placed: !!ch.pcb,
      pins: ch.pins.map(p => ({ num: p.num, name: p.name })),
    });
  }
  pinNets.forEach((pins, i) => {
    nets.push({
      name: netNames[i],
      pins: pins.map(p => [refs.get(p.chip.id), p.pinNum]),
    });
  });
  return { format: '74vm-netlist', version: 1, components, nets };
}

const EasyEDA = { buildEasyEDA, buildNetlist };
global.EasyEDAExport = EasyEDA;
if (typeof module !== 'undefined' && module.exports) module.exports = EasyEDA;

})(typeof window !== 'undefined' ? window : globalThis);
