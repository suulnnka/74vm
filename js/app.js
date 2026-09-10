/* =========================================================================
 * 74VM 界面 — Canvas 渲染 + 指针交互 + 工具栏/菜单/持久化
 * ========================================================================= */
(function () {
'use strict';

const { Engine, Sim } = window.EngineModule;
const LIB = window.CHIPS.LIB;

const canvas = document.getElementById('cv');
const ctx = canvas.getContext('2d');
const holder = document.getElementById('holder');
const tooltipEl = document.getElementById('tooltip');
const ctxMenu = document.getElementById('ctxmenu');

const sim = new Engine(LIB);

/* 多语言: t(中文) 返回当前语言文本, tf(模式, params) 替换 {x} 占位符 */
const t = window.I18N.t;
const tf = window.I18N.tf;

const PIN_GAP = 28, DEFAULT_W = 112;   // 网格 = 28px; 尺寸均为偶数格(56px倍)→边框压线
const DPR = Math.min(2, window.devicePixelRatio || 1);

const app = {
  mode: 'schematic',            // 'schematic' | 'breadboard' | 'pcb'
  cams: {
    schematic: { x: 400, y: 250, zoom: 1 },
    breadboard: { x: 500, y: 175, zoom: 0.9, fitted: false },
    pcb: { x: 50, y: 40, zoom: 4, fitted: false },
  },
  cam: null,                    // 当前模式相机引用 (switchMode 切换)
  schematicWires: null,         // 原理图网表快照 (面包板模式期间引擎使用派生网表)
  bb: { jumpers: [], nextId: 1, placed: false, netInfo: null },
  bbWiring: null,               // 面包板跳线起点 {hole}
  selection: new Set(),          // {kind:'chip'|'wire'|'jumper', id}
  hover: null,                   // {kind, ...}
  wiring: null,                  // {ch, pin, dragging, cursor:{x,y}}
  drag: null,
  ghost: null,                   // 从元件库拖出的 {type, sx, sy, moved}
  speed: 1,
  lastT: performance.now(),
  lastVersion: -1,
  saveTimer: 0,
  statusAcc: 0,
  undoStack: [],
  redoStack: [],
  libShown: true,
  bbLabels: true,   // 面包板元件标识 (关=悬停显示)
  dnd: null,   // 原生拖放状态 {type, x, y}
  kbChip: null,   // PS/2 键盘聚焦的元件 (打字 → 扫描码)
};
app.cam = app.cams.schematic;

/* ================= 几何计算 ================= */

/** 偶数格: 尺寸为 56 的倍数 → 中心吸附 28 时边框恰好压在网格线上 */
function evenCells(px) {
  const cells = Math.ceil(px / PIN_GAP);
  return (cells % 2 === 1 ? cells + 1 : cells) * PIN_GAP;
}
function chipSize(def) {
  if (def.size) {
    const w = def.size.w || DEFAULT_W;
    let h = def.size.h;
    if (h == null) {
      const n = Math.max(def.pins.filter(p => p.side === 'L').length,
                         def.pins.filter(p => p.side === 'R').length, 1);
      h = n * PIN_GAP;
    }
    return { w: evenCells(w), h: evenCells(h) };
  }
  const nL = def.pins.filter(p => p.side === 'L').length;
  const nR = def.pins.filter(p => p.side === 'R').length;
  return { w: DEFAULT_W, h: evenCells(Math.max(nL, nR, 1) * PIN_GAP) };
}

function rotXY(x, y, r) {
  if (r === 90) return { x: -y, y: x };
  if (r === 180) return { x: -x, y: -y };
  if (r === 270) return { x: y, y: -x };
  return { x, y };
}

/** 引脚相对芯片中心的位置 (单脚居中; 多脚落在 28px 槽位中心) */
function pinLocal(ch, pin) {
  const def = LIB[ch.type];
  const { w } = chipSize(def);
  const sameSide = def.pins.filter(p => p.side === pin.side);
  const idx = sameSide.findIndex(p => p.num === pin.num);
  const n = sameSide.length;
  // 引脚按自身跨度居中 (单脚居中; 多脚等距), 与元件高度无关
  const y = n === 1 ? 0 : (idx - (n - 1) / 2) * PIN_GAP;
  return {
    x: pin.side === 'L' ? -w / 2 : w / 2,
    y,
  };
}

function pinWorld(ch, pin) {
  const l = pinLocal(ch, pin);
  const v = rotXY(l.x, l.y, ch.rot || 0);
  return { x: ch.x + v.x, y: ch.y + v.y };
}

function pinNormal(ch, pin) {
  return rotXY(pin.side === 'L' ? -1 : 1, 0, ch.rot || 0);
}

function chipHalf(ch) {
  const { w, h } = chipSize(LIB[ch.type]);
  return (ch.rot || 0) % 180 === 90 ? { x: h / 2, y: w / 2 } : { x: w / 2, y: h / 2 };
}

const snap = v => Math.round(v / 28) * 28;   // 吸附到 28px 主网格

/* ---------- 4×4 矩阵键盘 (KB44) 键位几何与按压 ---------- */

const KB44_CELL = 26, KB44_GAP = 5;              // 键格边长 / 间距 (元件局部坐标)
const KB44_GLYPH = [['1', '2', '3', 'A'], ['4', '5', '6', 'B'], ['7', '8', '9', 'C'], ['*', '0', '#', 'D']];

/** 键格 (行r, 列c, 0基) 在元件局部坐标系中的矩形 */
function kb44CellRect(r, c) {
  const x0 = -(2 * KB44_CELL + 1.5 * KB44_GAP), y0 = -(84 - 26);
  return { x: x0 + c * (KB44_CELL + KB44_GAP), y: y0 + r * (KB44_CELL + KB44_GAP), w: KB44_CELL, h: KB44_CELL };
}

/** 世界坐标 → 元件局部坐标 (逆旋转) */
function chipPointLocal(ch, w) {
  return rotXY(w.x - ch.x, w.y - ch.y, (360 - (ch.rot || 0)) % 360);
}

/** 世界坐标下的键格命中, 返回 {r, c} (0基) 或 null */
function kb44CellAt(ch, w) {
  const p = chipPointLocal(ch, w);
  for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) {
    const q = kb44CellRect(r, c);
    if (p.x >= q.x && p.x <= q.x + q.w && p.y >= q.y && p.y <= q.y + q.h) return { r, c };
  }
  return null;
}

/** 按下/松开一个键并立即结算 (瞬时动作, 不入撤销栈) */
function kb44Press(ch, r, c, on) {
  const keys = ch.state.keys || (ch.state.keys = {});
  if (on) keys[r + ',' + c] = 1;
  else delete keys[r + ',' + c];
  sim.evalChip(ch);
  sim.flush();
}

/** 面包板行模块盒内按比例映射键位 (盒窄高小, 按 x/y 比例切 4×4) */
function kb44CellAtBB(ch, w) {
  const rect = BB.chipRect(ch);
  if (!rect || !ch.bb || ch.bb.kind !== 'row') return null;
  const lower = BB.ROWS_BOT.includes(ch.bb.row);
  const boxY = lower ? rect.y + 8 : rect.y;      // 与 drawBBChip 的盒定位一致
  if (w.x < rect.x || w.x > rect.x + rect.w || w.y < boxY || w.y > boxY + 26) return null;
  const c = Math.max(0, Math.min(3, Math.floor((w.x - rect.x) / rect.w * 4)));
  const r = Math.max(0, Math.min(3, Math.floor((w.y - boxY) / 26 * 4)));
  return { r, c };
}

/* ================= 颜色 ================= */

const COL = {
  v1: '#0f9d58', v0: '#78909c', vx: '#ef6c00', vz: '#9aa4ad',
  body: '#ffffff', bodyBorder: '#8fa1b3', head: '#1f2937', sub: '#5f7183',
  sel: '#0288d1', pinStroke: '#3e4c59', label: '#0277bd',
};
function valColor(v) {
  return v === 1 ? COL.v1 : v === 0 ? COL.v0 : v === 'X' ? COL.vx : COL.vz;
}
const pinValue = pin => sim.pinDisplay(pin);

/* ================= 坐标变换 ================= */

function toWorld(e) {
  const r = canvas.getBoundingClientRect();
  return {
    x: (e.clientX - r.left - r.width / 2) / app.cam.zoom + app.cam.x,
    y: (e.clientY - r.top - r.height / 2) / app.cam.zoom + app.cam.y,
  };
}

/* ================= 渲染 ================= */

let CW = 0, CH = 0;
function resizeCanvas() {
  const r = holder.getBoundingClientRect();
  if (CW !== r.width || CH !== r.height) {
    CW = r.width; CH = r.height;
    canvas.width = Math.round(CW * DPR);
    canvas.height = Math.round(CH * DPR);
  }
}

function rr(x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function draw() {
  resizeCanvas();
  if (app.kbChip && !sim.chips.has(app.kbChip.id)) app.kbChip = null;   // 聚焦元件已删除
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = '#eef1f6';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const z = app.cam.zoom;
  ctx.setTransform(z * DPR, 0, 0, z * DPR,
    DPR * (CW / 2 - app.cam.x * z), DPR * (CH / 2 - app.cam.y * z));

  if (app.mode === 'breadboard') {
    drawBreadboard(z);
  } else if (app.mode === 'pcb') {
    drawPCB(z);
  } else {
    drawGrid(z);
    drawChips(z);            // 元件体 (不含引脚)
    drawWires();             // 导线绘制在元件之上
    drawAllPins(z);          // 引脚最上层, 盖住线端
    drawWiringPreview();
  }
  drawGhost();
}

function drawGrid(z) {
  // 浅色网格线: 28px 次线 + 每4格主线
  const z2 = app.cam.zoom;
  let step = 28;
  while (step * z2 < 11) step *= 2;
  const major = step * 4;
  const x0 = app.cam.x - CW / 2 / z2, x1 = app.cam.x + CW / 2 / z2;
  const y0 = app.cam.y - CH / 2 / z2, y1 = app.cam.y + CH / 2 / z2;
  ctx.lineWidth = 1 / z2;
  // 次网格线
  ctx.strokeStyle = '#e2e8ef';
  ctx.beginPath();
  for (let x = Math.floor(x0 / step) * step; x <= x1; x += step) { ctx.moveTo(x, y0); ctx.lineTo(x, y1); }
  for (let y = Math.floor(y0 / step) * step; y <= y1; y += step) { ctx.moveTo(x0, y); ctx.lineTo(x1, y); }
  ctx.stroke();
  // 主网格线 (每4格)
  ctx.strokeStyle = '#cfd8e3';
  ctx.beginPath();
  for (let x = Math.floor(x0 / major) * major; x <= x1; x += major) { ctx.moveTo(x, y0); ctx.lineTo(x, y1); }
  for (let y = Math.floor(y0 / major) * major; y <= y1; y += major) { ctx.moveTo(x0, y); ctx.lineTo(x1, y); }
  ctx.stroke();
}

function wireEnds(w) {
  const pa = w.a.chip.pinByNum[w.a.num];
  const pb = w.b.chip.pinByNum[w.b.num];
  if (!pa || !pb) return null;
  return { a: pinWorld(w.a.chip, pa), b: pinWorld(w.b.chip, pb),
           na: pinNormal(w.a.chip, pa), nb: pinNormal(w.b.chip, pb) };
}

function bezierPts(e) {
  const d = Math.min(90, Math.hypot(e.b.x - e.a.x, e.b.y - e.a.y) * 0.5 + 24);
  return { c1: { x: e.a.x + e.na.x * d, y: e.a.y + e.na.y * d },
           c2: { x: e.b.x + e.nb.x * d, y: e.b.y + e.nb.y * d } };
}

function wirePath(e) {
  const { c1, c2 } = bezierPts(e);
  ctx.beginPath();
  ctx.moveTo(e.a.x, e.a.y);
  ctx.bezierCurveTo(c1.x, c1.y, c2.x, c2.y, e.b.x, e.b.y);
}

function drawWires() {
  const movingWire = app.wiring && app.wiring.moveWire;
  for (const w of sim.wires) {
    if (w === movingWire) continue;   // 拖动端点的线在预览中绘制
    const e = wireEnds(w);
    if (!e) continue;
    const pa = w.a.chip.pinByNum[w.a.num];
    const v = pa && pa.netObj ? pa.netObj.value : (pa ? sim.pinDisplay(pa) : Sim.VZ);
    const sel = isSelected('wire', w.id);
    const hov = app.hover && app.hover.kind === 'wire' && app.hover.id === w.id;
    if (sel || hov) {
      wirePath(e);
      ctx.strokeStyle = sel ? 'rgba(2,136,209,.5)' : 'rgba(25,45,65,.25)';
      ctx.lineWidth = sel ? 6 : 5;
      ctx.setLineDash([]);
      ctx.stroke();
    }
    wirePath(e);
    ctx.strokeStyle = valColor(v);
    ctx.lineWidth = v === 1 ? 2.6 : 2;
    if (v === 'Z') ctx.setLineDash([5, 4]);
    else ctx.setLineDash([]);
    ctx.stroke();
    ctx.setLineDash([]);
  }
}

function drawChips(z) {
  for (const ch of sim.chips.values()) {
    const def = LIB[ch.type];
    // 通用旋转: 全部元件在局部坐标绘制, 旋转由统一变换完成
    ctx.save();
    ctx.translate(ch.x, ch.y);
    if (ch.rot) ctx.rotate(ch.rot * Math.PI / 180);
    if (def.custom) drawIO(ch, def, z);
    else drawDIP(ch, def, z);
    ctx.restore();
    // 标签
    if (ch.props.label) {
      const half = chipHalf(ch);
      ctx.font = '10px Consolas, monospace';
      ctx.fillStyle = COL.label;
      ctx.textAlign = 'center'; ctx.textBaseline = 'top';
      ctx.fillText(ch.props.label, ch.x, ch.y + half.y + 4);
    }
    // 选中框
    if (isSelected('chip', ch.id)) {
      const half = chipHalf(ch);
      ctx.strokeStyle = COL.sel;
      ctx.lineWidth = 1.2;
      ctx.setLineDash([5, 4]);
      rr(ch.x - half.x - 4, ch.y - half.y - 4, half.x * 2 + 8, half.y * 2 + 8, 7);
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }
}

/** 引脚统一在最上层绘制 (盖住导线端点) */
function drawAllPins(z) {
  for (const ch of sim.chips.values()) drawPins(ch, LIB[ch.type], z);
}

function drawDIP(ch, def, z) {
  const { w, h } = chipSize(def);
  const hov = app.hover && app.hover.kind === 'chip' && app.hover.id === ch.id;
  ctx.fillStyle = COL.body;
  rr(-w / 2, -h / 2, w, h, 6);
  ctx.fill();
  ctx.strokeStyle = isSelected('chip', ch.id) ? COL.sel : (hov ? '#5f7386' : COL.bodyBorder);
  ctx.lineWidth = isSelected('chip', ch.id) ? 1.6 : 1;
  ctx.stroke();

  ctx.fillStyle = COL.head;
  ctx.font = 'bold 13px Consolas, monospace';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(def.type, 0, -8);
  ctx.fillStyle = COL.sub;
  ctx.font = '10px "Segoe UI","Microsoft YaHei",sans-serif';
  ctx.fillText(t(def.desc), 0, 9);
}

/** 引脚圆点 + 名称 + 编号 */
function drawPins(ch, def, z) {
  const showText = z >= 0.65;
  for (const pin of ch.pins) {
    const p = pinWorld(ch, pin);
    const n = pinNormal(ch, pin);
    const v = pinValue(pin);
    // 悬停 / 连线高亮
    const hovPin = app.hover && app.hover.kind === 'pin' && app.hover.pin === pin;
    if (hovPin || (app.wiring && app.wiring.pin === pin)) {
      ctx.beginPath();
      ctx.arc(p.x, p.y, 8, 0, Math.PI * 2);
      ctx.strokeStyle = app.wiring && app.wiring.pin === pin ? COL.sel : '#cfe3f5';
      ctx.lineWidth = 1.4;
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.arc(p.x, p.y, 4.5, 0, Math.PI * 2);
    ctx.fillStyle = valColor(v);
    ctx.fill();
    ctx.strokeStyle = COL.pinStroke;
    ctx.lineWidth = 1.2;
    ctx.stroke();

    if (!showText || def.hideNums) continue;
    // 名称(体内)
    ctx.font = '9.5px Consolas, monospace';
    ctx.fillStyle = '#43566a';
    const ix = -n.x, iy = -n.y; // 朝内
    const lx = p.x + ix * 11, ly = p.y + iy * 11;
    ctx.textBaseline = 'middle';
    if (Math.abs(ix) > Math.abs(iy)) {
      ctx.textAlign = ix > 0 ? 'left' : 'right';
      ctx.fillText(pin.name, lx, ly);
    } else {
      ctx.textAlign = 'center';
      ctx.fillText(pin.name, lx, ly);
    }
    // 引脚号(体外)
    ctx.font = '7.5px Consolas, monospace';
    ctx.fillStyle = '#8a97a5';
    const nx2 = p.x + n.x * 10, ny2 = p.y + n.y * 10;
    if (Math.abs(n.x) > Math.abs(n.y)) {
      ctx.textAlign = n.x > 0 ? 'left' : 'right';
      ctx.textBaseline = 'middle';
    } else {
      ctx.textAlign = 'center';
      ctx.textBaseline = n.y > 0 ? 'top' : 'bottom';
    }
    ctx.fillText(String(pin.num), nx2, ny2);
    ctx.textBaseline = 'middle';
  }
}

/* ---------- 输入/输出元件自定义绘制 ---------- */

function drawIO(ch, def, z) {
  const { w, h } = chipSize(def);   // 局部坐标, 旋转变换由 drawChips 统一施加
  const hov = app.hover && app.hover.kind === 'chip' && app.hover.id === ch.id;
  const half = { x: w / 2, y: h / 2 };

  ctx.fillStyle = COL.body;
  rr(-half.x, -half.y, w, h, 7);
  ctx.fill();
  ctx.strokeStyle = isSelected('chip', ch.id) ? COL.sel : (hov ? '#5f7386' : COL.bodyBorder);
  ctx.lineWidth = isSelected('chip', ch.id) ? 1.6 : 1;
  ctx.stroke();

  switch (ch.type) {
    case 'SW': {
      const on = ch.state.on ? true : false;
      // 居中滑轨 (40 宽, 主体中心)
      rr(-20, -7, 40, 14, 7);
      ctx.fillStyle = on ? 'rgba(15,157,88,.22)' : '#e0e6ec';
      ctx.fill();
      ctx.strokeStyle = on ? COL.v1 : '#9aa7b3';
      ctx.lineWidth = 1.2;
      ctx.stroke();
      // 滑块
      ctx.beginPath();
      ctx.arc(on ? 14 : -14, 0, 6, 0, Math.PI * 2);
      ctx.fillStyle = on ? COL.v1 : '#8a97a5';
      ctx.fill();
      // 状态字 (顶部居中) / 名称 (底部居中)
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.font = '10px Consolas, monospace';
      ctx.fillStyle = on ? COL.v1 : '#6b7a8c';
      ctx.fillText(on ? '1' : '0', 0, -half.y + 10);
      ctx.fillStyle = '#6b7a8c';
      ctx.font = '9px "Segoe UI","Microsoft YaHei",sans-serif';
      ctx.fillText(t('开关'), 0, half.y - 9);
      break;
    }
    case 'BTN': {
      const on = ch.pins[0].driven === 1;
      ctx.beginPath();
      ctx.arc(0, -3, 14, 0, Math.PI * 2);
      if (on) {
        ctx.fillStyle = 'rgba(15,157,88,.28)';
        ctx.fill();
      }
      ctx.strokeStyle = on ? COL.v1 : '#8fa1b3';
      ctx.lineWidth = 1.6;
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(0, -3, 6.5, 0, Math.PI * 2);
      ctx.fillStyle = on ? COL.v1 : '#a8b4c0';
      ctx.fill();
      ctx.font = '9px "Segoe UI","Microsoft YaHei",sans-serif';
      ctx.fillStyle = '#6b7a8c';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(t('按住'), 0, half.y - 9);
      break;
    }
    case 'CLOCK': {
      const ph = ch.state.phase ? 1 : 0;
      ctx.strokeStyle = ph ? COL.v1 : '#0288d1';
      ctx.lineWidth = 1.8;
      ctx.lineJoin = 'round';
      ctx.beginPath();
      const bx = -20, by = 0;   // 紧凑波形 (40 宽) 以元件中心居中
      ctx.moveTo(bx, by + 4);
      ctx.lineTo(bx + 10, by + 4);
      ctx.lineTo(bx + 10, by - 8);
      ctx.lineTo(bx + 20, by - 8);
      ctx.lineTo(bx + 20, by + 4);
      ctx.lineTo(bx + 30, by + 4);
      ctx.lineTo(bx + 30, by - 8);
      ctx.lineTo(bx + 40, by - 8);
      ctx.lineTo(bx + 40, by + 4);
      ctx.stroke();
      ctx.font = '10px Consolas, monospace';
      ctx.fillStyle = '#43566a';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(fmtFreq(ch.props.freq || 2), 0, half.y - 9);
      break;
    }
    case 'LED': {
      const v = pinValue(ch.pins[0]);
      const on = v === 1;
      ctx.save();
      if (on) { ctx.shadowColor = '#ff3b3b'; ctx.shadowBlur = 14; }
      ctx.beginPath();
      ctx.arc(0, 0, 10.5, 0, Math.PI * 2);
      ctx.fillStyle = on ? '#ff4d4d' : '#3a2226';
      ctx.fill();
      ctx.restore();
      ctx.beginPath();
      ctx.arc(0, 0, 10.5, 0, Math.PI * 2);
      ctx.strokeStyle = on ? '#ff8a80' : '#5c2e33';
      ctx.lineWidth = 1.4;
      ctx.stroke();
      break;
    }
    case 'PROBE': {
      const v = pinValue(ch.pins[0]);
      ctx.font = 'bold 16px Consolas, monospace';
      ctx.fillStyle = valColor(v);
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(v === 'Z' ? 'Z' : String(v), 0, -2);
      ctx.fillStyle = '#6b7a8c';
      ctx.font = '9px "Segoe UI","Microsoft YaHei",sans-serif';
      ctx.fillText(t('探针'), 0, half.y - 9);
      break;
    }
    case 'SEG7': {
      const vals = ch.pins.map(p => pinValue(p) === 1); // a b c d e f g dp
      const l = -12, t = -half.y + 22, dw = 84, dh = half.y * 2 - 44;
      const segs = {
        a: [l + 4, t, l + dw - 4, t],
        b: [l + dw, t + 4, l + dw, t + dh / 2 - 4],
        c: [l + dw, t + dh / 2 + 4, l + dw, t + dh - 4],
        d: [l + 4, t + dh, l + dw - 4, t + dh],
        e: [l, t + dh / 2 + 4, l, t + dh - 4],
        f: [l, t + 4, l, t + dh / 2 - 4],
        g: [l + 4, t + dh / 2, l + dw - 4, t + dh / 2],
      };
      ctx.lineCap = 'round';
      ctx.lineWidth = 9;
      const order = ['a', 'b', 'c', 'd', 'e', 'f', 'g'];
      order.forEach((nm, i) => {
        const [x1, y1, x2, y2] = segs[nm];
        ctx.save();
        if (vals[i]) { ctx.shadowColor = '#ff3b3b'; ctx.shadowBlur = 12; }
        ctx.strokeStyle = vals[i] ? '#ff4d4d' : '#3b2126';
        ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
        ctx.restore();
      });
      // dp
      ctx.save();
      if (vals[7]) { ctx.shadowColor = '#ff3b3b'; ctx.shadowBlur = 12; }
      ctx.fillStyle = vals[7] ? '#ff4d4d' : '#3b2126';
      ctx.beginPath(); ctx.arc(l + dw + 6, t + dh - 2, 4.5, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
      // 段名
      if (z >= 0.65) {
        ctx.font = '9px Consolas, monospace';
        ctx.fillStyle = '#6b7a8c';
        ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
        order.forEach((nm, i) => {
          const p = ch.pins[i];
          const lp = pinLocal(ch, p);
          ctx.fillText(nm, lp.x + 14, lp.y);
        });
      }
      break;
    }
    case 'PS2': {
      const t = ch._ps2;
      const focused = app.kbChip === ch;
      if (focused) {
        ctx.fillStyle = 'rgba(2,136,209,.07)';
        rr(-half.x + 2, -half.y + 2, w - 4, h - 4, 6); ctx.fill();
        ctx.setLineDash([5, 4]);
        ctx.strokeStyle = COL.sel; ctx.lineWidth = 1.4;
        rr(-half.x + 2, -half.y + 2, w - 4, h - 4, 6); ctx.stroke();
        ctx.setLineDash([]);
      }
      // 标题 + 发送指示灯
      ctx.textBaseline = 'middle';
      ctx.font = 'bold 11px Consolas, monospace';
      ctx.fillStyle = '#1f2937'; ctx.textAlign = 'left';
      ctx.fillText('PS/2', -half.x + 10, -half.y + 13);
      ctx.beginPath(); ctx.arc(half.x - 12, -half.y + 12, 4, 0, Math.PI * 2);
      ctx.fillStyle = (t && t.active) ? COL.v1 : '#cfd8e3'; ctx.fill();
      ctx.strokeStyle = '#8fa1b3'; ctx.lineWidth = 1; ctx.stroke();
      // 键位网格 (3×10)
      const gx = -half.x + 10, gy = -half.y + 22, gw = w - 20, gh = 56;
      ctx.fillStyle = '#e8edf3';
      rr(gx, gy, gw, gh, 4); ctx.fill();
      ctx.strokeStyle = '#c3cedb'; ctx.lineWidth = 1; ctx.stroke();
      const kw = (gw - 8) / 10, kh = (gh - 8) / 3;
      ctx.fillStyle = '#ffffff';
      ctx.strokeStyle = '#aebbc9';
      for (let r2 = 0; r2 < 3; r2++) for (let c = 0; c < 10; c++) {
        rr(gx + 4 + c * kw + 1, gy + 4 + r2 * kh + 1, kw - 2, kh - 2, 2);
        ctx.fill(); ctx.stroke();
      }
      // 状态行: 发送状态 + 最后发出的扫描码 + 队列积压
      const nq = ch.state.queue.length;
      const lastTxt = ch.state.lastByte != null
        ? '0x' + ch.state.lastByte.toString(16).toUpperCase().padStart(2, '0') : '--';
      ctx.font = '10px Consolas, monospace';
      ctx.fillStyle = '#43566a'; ctx.textAlign = 'center';
      ctx.fillText((t && t.active ? 'TX ' : 'IDLE ') + lastTxt + (nq ? ' +' + nq : ''), 0, gy + gh + 11);
      ctx.font = '9px "Segoe UI","Microsoft YaHei",sans-serif';
      ctx.fillStyle = focused ? COL.sel : '#6b7a8c';
      ctx.fillText(ch.state.running ? I18N.t('▶ 脚本运行中') : (focused ? I18N.t('输入中… Esc 退出') : I18N.t('点击后打字')), 0, half.y - 7);
      break;
    }
    case 'KB44': {
      const pull = Number(ch.props.pull);
      // 顶部: 标题 + 行空闲电平标记
      ctx.textBaseline = 'middle';
      ctx.font = 'bold 11px Consolas, monospace';
      ctx.fillStyle = '#1f2937'; ctx.textAlign = 'left';
      ctx.fillText('4×4', -half.x + 10, -half.y + 13);
      ctx.font = '9px Consolas, monospace';
      ctx.fillStyle = pull ? '#0277bd' : '#6b7a8c';
      ctx.textAlign = 'right';
      ctx.fillText(t(pull ? '上拉' : '下拉'), half.x - 10, -half.y + 13);
      // 4×4 键格 (按住的键高亮)
      for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) {
        const q = kb44CellRect(r, c);
        const on = !!ch.state.keys[r + ',' + c];
        if (on) { ctx.shadowColor = '#ff3b3b'; ctx.shadowBlur = 10; }
        rr(q.x, q.y, q.w, q.h, 4);
        ctx.fillStyle = on ? '#ffd9d9' : '#e8edf3';
        ctx.fill();
        ctx.shadowBlur = 0;
        ctx.strokeStyle = on ? COL.v1 : '#aebbc9';
        ctx.lineWidth = on ? 1.5 : 1;
        ctx.stroke();
        if (z >= 0.65) {
          ctx.fillStyle = on ? '#c62828' : '#6b7a8c';
          ctx.font = '10px Consolas, monospace';
          ctx.textAlign = 'center';
          ctx.fillText(KB44_GLYPH[r][c], q.x + q.w / 2, q.y + q.h / 2 + 0.5);
        }
      }
      // 底部提示
      ctx.font = '9px "Segoe UI","Microsoft YaHei",sans-serif';
      ctx.fillStyle = '#6b7a8c'; ctx.textAlign = 'center';
      ctx.fillText(t('按住按键接通行列'), 0, half.y - 10);
      break;
    }
    case 'LCD1602': {
      // 液晶面板: 蓝底白字, 等宽字体渲染 (非点阵)
      const px = -half.x + 10, py = -half.y + 10, pw = w - 20, ph = h - 20;
      ctx.fillStyle = '#0d47a1';
      rr(px, py, pw, ph, 4);
      ctx.fill();
      ctx.strokeStyle = '#093170';
      ctx.lineWidth = 2;
      ctx.stroke();
      const dd = ch.state.ddram || [];
      const cw = pw / 16, band = (ph - 24) / 2;
      ctx.font = '12px Consolas, "Microsoft YaHei", monospace';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      for (let row = 0; row < 2; row++) {
        const y = py + 12 + band * row + band / 2;
        const base = row === 0 ? 0 : 0x40;
        ctx.fillStyle = 'rgba(227,242,253,.14)';   // 单元格微光带
        ctx.fillRect(px + 2, y - band / 2 + 3, pw - 4, band - 6);
        ctx.fillStyle = '#e3f2fd';
        for (let c = 0; c < 16; c++) {
          const t = dd[base + c];
          if (t && t !== ' ') ctx.fillText(t, px + cw * (c + 0.5), y);
        }
      }
      // 光标 (下划线, 仅可见区)
      const cur = ch.state.cur || 0;
      if (cur < 16 || (cur >= 0x40 && cur < 0x50)) {
        const row = cur >= 0x40 ? 1 : 0;
        const ccol = cur >= 0x40 ? cur - 0x40 : cur;
        const y = py + 12 + band * row + band / 2 + band / 2 - 5;
        ctx.fillStyle = '#e3f2fd';
        ctx.fillRect(px + cw * ccol + 1, y, cw - 2, 2);
      }
      break;
    }
    case 'LCD12864': {
      // 图形液晶: GDRAM 点阵 + DDRAM 文字叠加, 等宽字体
      const px = -half.x + 10, py = -half.y + 10, pw = w - 20, ph = h - 20;
      ctx.fillStyle = '#0d47a1';
      rr(px, py, pw, ph, 4);
      ctx.fill();
      ctx.strokeStyle = '#093170';
      ctx.lineWidth = 2;
      ctx.stroke();
      const g = ch.state.gdram || [];
      const dw = pw / 128, dh2 = ph / 64;
      ctx.fillStyle = '#6ea8e8';
      for (let yy = 0; yy < 64; yy++) {
        for (let bx = 0; bx < 16; bx++) {
          const byte = g[yy * 16 + bx];
          if (!byte) continue;
          for (let k = 0; k < 8; k++) {
            if (byte & (0x80 >> k)) ctx.fillRect(px + (bx * 8 + k) * dw, py + yy * dh2, dw + 0.3, dh2 + 0.3);
          }
        }
      }
      const cw2 = pw / 16;
      ctx.font = '13px Consolas, "Microsoft YaHei", monospace';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillStyle = '#e3f2fd';
      for (let row = 0; row < 4; row++) {
        let t = '';
        for (let c = 0; c < 16; c++) t += ch.state.ddram[row * 16 + c] || ' ';
        if (t.trim()) ctx.fillText(t, px + pw / 2, py + (row + 0.5) * ph / 4);
      }
      break;
    }
    case 'VCC': {
      ctx.strokeStyle = '#d32f2f';
      ctx.lineWidth = 1.8;
      ctx.beginPath();
      ctx.moveTo(-12, 6); ctx.lineTo(-12, -7);
      ctx.moveTo(-18, -7); ctx.lineTo(-6, -7);
      ctx.stroke();
      ctx.font = 'bold 10px Consolas, monospace';
      ctx.fillStyle = '#d32f2f';
      ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
      ctx.fillText('VCC', -1, 0);
      break;
    }
    case 'GND': {
      ctx.strokeStyle = '#607286';
      ctx.lineWidth = 1.8;
      ctx.beginPath();
      ctx.moveTo(-14, -8); ctx.lineTo(-14, 2);
      ctx.moveTo(-20, 2); ctx.lineTo(-8, 2);
      ctx.moveTo(-17, 6); ctx.lineTo(-11, 6);
      ctx.moveTo(-15, 10); ctx.lineTo(-13, 10);
      ctx.stroke();
      ctx.font = 'bold 10px Consolas, monospace';
      ctx.fillStyle = '#607286';
      ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
      ctx.fillText('GND', -2, 0);
      break;
    }
  }
}

function drawWiringPreview() {
  if (!app.wiring) return;
  let src, na;
  if (app.wiring.moveWire) {
    const mw = app.wiring.moveWire;
    const fe = app.wiring.moveEnd === 'a'
      ? { chip: mw.b.chip, num: mw.b.num }
      : { chip: mw.a.chip, num: mw.a.num };
    const pin = fe.chip.pinByNum[fe.num];
    src = pinWorld(fe.chip, pin);
    na = pinNormal(fe.chip, pin);
  } else {
    src = pinWorld(app.wiring.ch, app.wiring.pin);
    na = pinNormal(app.wiring.ch, app.wiring.pin);
  }
  const cur = app.wiring.cursor || src;
  const e = { a: src, b: cur, na, nb: { x: -na.x, y: -na.y } };
  wirePath(e);
  ctx.strokeStyle = COL.sel;
  ctx.lineWidth = 1.8;
  ctx.setLineDash([6, 5]);
  ctx.stroke();
  ctx.setLineDash([]);
}

function drawGhost() {
  if (!app.ghost || app.ghost.hidden) return;
  const def = LIB[app.ghost.type];
  if (!def) return;
  // 光标位于预览盒正中央: (gx, gy) = 鼠标的画布局部坐标, 各盒以此为中心绘制
  const cr = canvas.getBoundingClientRect();
  const gx = app.ghost.sx - cr.left, gy = app.ghost.sy - cr.top;
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  ctx.globalAlpha = 0.92;
  ctx.textBaseline = 'middle';

  if (app.mode === 'breadboard') {
    // 迷你面包板形态: DIP 黑条 / IO 模块
    if (!def.custom) {
      const w = 76, h = 22;
      ctx.fillStyle = '#2b3138';
      rr(gx - w / 2, gy - h / 2, w, h, 4); ctx.fill();
      ctx.strokeStyle = '#454e59'; ctx.lineWidth = 1; ctx.stroke();
      ctx.fillStyle = '#e6eef8';
      ctx.font = 'bold 10px Consolas, monospace';
      ctx.textAlign = 'center';
      ctx.fillText(def.type, gx, gy);
      ctx.fillStyle = '#6b7a8c';
      ctx.font = '9px "Segoe UI","Microsoft YaHei",sans-serif';
      ctx.fillText(t(def.desc), gx, gy + h / 2 + 9);
    } else {
      const w = 44, h = 20;
      ctx.fillStyle = '#242c36';
      rr(gx - w / 2, gy - h / 2, w, h, 4); ctx.fill();
      ctx.strokeStyle = '#454e59'; ctx.lineWidth = 1; ctx.stroke();
      ctx.fillStyle = '#e6eef8';
      ctx.font = 'bold 9px Consolas, monospace';
      ctx.textAlign = 'center';
      ctx.fillText(def.type, gx, gy);
    }
  } else if (app.mode === 'pcb') {
    // 迷你封装: 丝印框 + 双排焊盘
    const w = 40, h = 22;
    ctx.strokeStyle = '#43566a'; ctx.lineWidth = 1.2;
    ctx.strokeRect(gx - w / 2, gy - h / 2, w, h);
    ctx.fillStyle = '#c9a34e';
    for (let i = 0; i < 3; i++) {
      for (const px of [gx - w / 2 + 7, gx + w / 2 - 7]) {
        ctx.beginPath();
        ctx.arc(px, gy - h / 2 + 5 + i * 6, 2.2, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.fillStyle = '#1f2937';
    ctx.font = 'bold 9px Consolas, monospace';
    ctx.textAlign = 'center';
    ctx.fillText(def.type, gx, gy - h / 2 - 7);
  } else {
    // 原理图形态: 白底元件盒
    const w = 104, h = 40;
    ctx.fillStyle = '#ffffff';
    rr(gx - w / 2, gy - h / 2, w, h, 6); ctx.fill();
    ctx.strokeStyle = COL.sel; ctx.lineWidth = 1.4; ctx.stroke();
    ctx.fillStyle = '#1f2937';
    ctx.font = 'bold 12px Consolas, monospace';
    ctx.textAlign = 'center';
    ctx.fillText(def.type, gx, gy - 7);
    ctx.fillStyle = '#6b7a8c';
    ctx.font = '9.5px "Segoe UI","Microsoft YaHei",sans-serif';
    ctx.fillText(t(def.desc), gx, gy + 8);
  }
  ctx.globalAlpha = 1;
}

/* ================= 命中测试 ================= */

function pinAt(w) {
  const th = 9 / app.cam.zoom;
  const arr = Array.from(sim.chips.values());
  for (let i = arr.length - 1; i >= 0; i--) {
    const ch = arr[i];
    for (const pin of ch.pins) {
      const p = pinWorld(ch, pin);
      if (Math.hypot(p.x - w.x, p.y - w.y) < th) return { ch, pin };
    }
  }
  return null;
}

function chipAt(w) {
  const arr = Array.from(sim.chips.values());
  for (let i = arr.length - 1; i >= 0; i--) {
    const ch = arr[i];
    const half = chipHalf(ch);
    if (Math.abs(w.x - ch.x) <= half.x + 2 && Math.abs(w.y - ch.y) <= half.y + 2) return ch;
  }
  return null;
}

function wireAt(w) {
  const th = 9 / app.cam.zoom;
  for (const wI of sim.wires) {
    const e = wireEnds(wI);
    if (!e) continue;
    const { c1, c2 } = bezierPts(e);
    for (let t = 0.04; t <= 1.0001; t += 0.04) {
      const mt = 1 - t;
      const x = mt * mt * mt * e.a.x + 3 * mt * mt * t * c1.x + 3 * mt * t * t * c2.x + t * t * t * e.b.x;
      const y = mt * mt * mt * e.a.y + 3 * mt * mt * t * c1.y + 3 * mt * t * t * c2.y + t * t * t * e.b.y;
      if (Math.hypot(x - w.x, y - w.y) < th) return wI;
    }
  }
  return null;
}

/* ================= 选择 ================= */

function isSelected(kind, id) {
  for (const s of app.selection) if (s.kind === kind && s.id === id) return true;
  return false;
}
function selectOnly(kind, id) { app.selection = new Set([{ kind, id }]); }
function clearSelection() { app.selection = new Set(); }
function pruneSelection() {
  for (const s of Array.from(app.selection)) {
    if (s.kind === 'chip' && !sim.chips.has(s.id)) app.selection.delete(s);
    if (s.kind === 'wire' && !sim.wires.some(w => w.id === s.id)) app.selection.delete(s);
  }
}

/* ================= Toast ================= */

function toast(msg, cls) {
  const el = document.createElement('div');
  el.className = 'toast' + (cls ? ' ' + cls : '');
  el.textContent = msg;
  document.getElementById('toasts').appendChild(el);
  setTimeout(() => { el.style.transition = 'opacity .4s'; el.style.opacity = '0'; }, 2400);
  setTimeout(() => el.remove(), 2900);
}

/* ================= 撤销 / 重做 ================= */

function pushUndo() {
  app.undoStack.push(JSON.stringify(buildSave(false)));
  if (app.undoStack.length > 60) app.undoStack.shift();
  app.redoStack.length = 0;
  syncSchematicWires();
  scheduleSave();
}
function undo() {
  if (!app.undoStack.length) { toast(t('没有可撤销的操作')); return; }
  app.redoStack.push(JSON.stringify(buildSave(false)));
  restoreSave(JSON.parse(app.undoStack.pop()));
  scheduleSave();
}
function redo() {
  if (!app.redoStack.length) { toast(t('没有可重做的操作')); return; }
  app.undoStack.push(JSON.stringify(buildSave(false)));
  restoreSave(JSON.parse(app.redoStack.pop()));
  scheduleSave();
}

/* ================= 保存快照 (原理图网表 + 面包板/PCB 布局) ================= */

function buildSave(withView = true) {
  const save = {
    v: 2,
    time: Math.round(sim.simTime),
    chips: Array.from(sim.chips.values()).map(c => {
      const o = {
        id: c.id, type: c.type, x: Math.round(c.x), y: Math.round(c.y),
        rot: c.rot || 0, props: c.props, state: JSON.parse(JSON.stringify(c.state)),
      };
      if (c.bb) o.bb = c.bb;
      if (c.pcb) o.pcb = c.pcb;
      return o;
    }),
    wires: app.mode === 'breadboard' ? (app.schematicWires || []) : sim.wiresRaw(),
    bb: { jumpers: app.bb.jumpers, placed: app.bb.placed, cols: BB.getCols(), boards: BB.getBoards() },
  };
  // 视图状态: 当前模式 + 各模式相机 (撤销/重做快照不携带, 避免来回跳视图)
  if (withView) save.view = { mode: app.mode, cams: JSON.parse(JSON.stringify(app.cams)) };
  return save;
}

function restoreSave(data) {
  if (!data || !Array.isArray(data.chips)) return;
  // 旧通用型号迁移: ROM→74187, RAM→6116 (内容按新位宽掩码截取; 接线需按新引脚复查)
  const MEM_ALIAS = { ROM: '74187', RAM: '6116' };
  for (const c of data.chips) {
    if (!MEM_ALIAS[c.type]) continue;
    const nm = MEM_ALIAS[c.type];
    const m = LIB[nm].mem;
    const old = c.props && Array.isArray(c.props.mem) ? c.props.mem : [];
    const mem = new Array(m.size).fill(0);
    for (let i = 0; i < Math.min(old.length, m.size); i++) mem[i] = old[i] & m.mask;
    c.type = nm;
    c.props = Object.assign({}, c.props, { mem });
  }
  sim.load({ chips: data.chips, wires: data.wires || [], time: data.time || 0 });
  // 旧存档坐标吸附到 28px 主网格 (连线跟随引脚, 无需修正)
  for (const ch of sim.chips.values()) { ch.x = snap(ch.x); ch.y = snap(ch.y); }
  app.schematicWires = data.wires || [];
  BB.setCols(data.bb && data.bb.cols ? data.bb.cols : 60);
  BB.setBoards(data.bb && data.bb.boards ? data.bb.boards : 1);
  // 旧版跳线键无板号前缀 → 补 "0:"; 元件布局补 board 字段
  app.bb.jumpers = (data.bb && data.bb.jumpers) || [];
  for (const j of app.bb.jumpers) {
    if (!String(j.a).includes(':')) j.a = '0:' + j.a;
    if (!String(j.b).includes(':')) j.b = '0:' + j.b;
    if (j.id == null) j.id = app.bb.nextId++;
    if (j.id >= app.bb.nextId) app.bb.nextId = j.id + 1;
  }
  for (const ch of sim.chips.values()) {
    if (ch.bb && ch.bb.board == null) ch.bb.board = 0;
  }
  app.bb.placed = !!(data.bb && data.bb.placed);
  bbSanitize();
  if (app.mode === 'breadboard') applyBB();
  // 视图状态: 各模式相机 + 上次使用的模式 (旧存档无 view 字段则保持现状)
  if (data.view && data.view.cams) {
    for (const k of ['schematic', 'breadboard', 'pcb']) {
      const c = data.view.cams[k];
      if (c && [c.x, c.y, c.zoom].every(Number.isFinite)) {
        app.cams[k] = { x: c.x, y: c.y, zoom: c.zoom, fitted: !!c.fitted };
      }
    }
    if (['schematic', 'breadboard', 'pcb'].includes(data.view.mode) && data.view.mode !== app.mode) {
      switchMode(data.view.mode);
    }
  }
  clearSelection();
}

/** 原理图模式下任何改动 → 同步原理图网表快照 */
function syncSchematicWires() {
  if (app.mode !== 'breadboard') app.schematicWires = sim.wiresRaw();
}

/** 板子缩小后: 移出超范围(列/板号)的元件与跳线 */
function bbSanitize() {
  const cols = BB.getCols();
  const boards = BB.getBoards();
  for (const ch of sim.chips.values()) {
    const bb = ch.bb;
    if (!bb) continue;
    if ((bb.board || 0) >= boards) { ch.bb = null; continue; }
    if (bb.kind === 'dip') {
      if (bb.col + BB.dipSpan(ch) - 1 > cols) ch.bb = null;
    } else if (bb.kind === 'row') {
      if (bb.col + BB.legCount(ch) - 1 > cols) ch.bb = null;
    } else if (bb.col > cols) ch.bb = null;
  }
  const ok = app.bb.jumpers.filter(j => BB.holePos(j.a) && BB.holePos(j.b));
  if (ok.length !== app.bb.jumpers.length) app.bb.jumpers = ok;
}

/* ================= 持久化 ================= */

const LS_KEY = '74vm:autosave';
let saveTimerId = 0;
function scheduleSave() {
  clearTimeout(saveTimerId);
  saveTimerId = setTimeout(() => doSave(true), 700);
  syncSchematicWires();
}
function doSave(silent) {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(buildSave()));
    if (!silent) toast(t('已保存到浏览器'));
  } catch (e) { if (!silent) toast(tf('保存失败: {m}', { m: e.message }), 'err'); }
}

/* ================= 指针交互 ================= */

canvas.addEventListener('pointerdown', e => {
  hideCtxMenu();
  if (e.button === 2) {   // 右键: 按住拖动 = 平移视图; 松开未拖动 = 弹出菜单
    const w = toWorld(e);
    try { canvas.setPointerCapture(e.pointerId); } catch (err) { }
    app.drag = { kind: 'pan', last: w, right: true, moved: false, sx: e.clientX, sy: e.clientY };
    return;
  }
  if (app.mode === 'breadboard') return bbPointerDown(e);
  if (app.mode === 'pcb') return pcbPointerDown(e);
  const w = toWorld(e);
  try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* 某些环境不支持 */ }

  if (e.button === 1) { app.drag = { kind: 'pan', last: w }; return; }
  if (e.button !== 0) return;

  // 左键按下引脚: 该引脚只连一根线 → 拖动该线此端; 否则新建连线 (Ctrl+拖动强制新建)
  const pinHit = pinAt(w);
  if (pinHit) {
    const attached = sim.wires.filter(wI =>
      (wI.a.chip === pinHit.ch && wI.a.num === pinHit.pin.num) ||
      (wI.b.chip === pinHit.ch && wI.b.num === pinHit.pin.num));
    if (attached.length === 1 && !e.ctrlKey && !e.shiftKey) {
      app.wiring = {
        ch: pinHit.ch, pin: pinHit.pin, dragging: true, cursor: w, startW: w,
        moveWire: attached[0],
        moveEnd: (attached[0].a.chip === pinHit.ch && attached[0].a.num === pinHit.pin.num) ? 'a' : 'b',
      };
    } else {
      app.wiring = { ch: pinHit.ch, pin: pinHit.pin, dragging: true, cursor: w, startW: w };
    }
    return;
  }

  const ch = chipAt(w);
  if (ch) {
    const additive = e.shiftKey || e.ctrlKey;
    if (additive) {
      if (isSelected('chip', ch.id)) app.selection.delete(Array.from(app.selection).find(s => s.kind === 'chip' && s.id === ch.id));
      else app.selection.add({ kind: 'chip', id: ch.id });
    } else if (!isSelected('chip', ch.id)) {
      selectOnly('chip', ch.id);
    }
    const chips = Array.from(app.selection).filter(s => s.kind === 'chip')
      .map(s => sim.chips.get(s.id)).filter(Boolean);
    if (ch.type === 'SW' || ch.type === 'BTN' || ch.type === 'PS2') {
      app.drag = { kind: 'press', ch, start: w, moved: false,
        offs: chips.map(c => ({ c, dx: c.x - w.x, dy: c.y - w.y })) };
      if (ch.type === 'BTN') sim.driveNow(ch, 1, 1); // 按下
    } else if (ch.type === 'KB44') {
      const cell = kb44CellAt(ch, w);
      if (cell) {                                    // 按住键格 = 接通行列
        app.drag = { kind: 'press', ch, key: cell, start: w, moved: false,
          offs: chips.map(c => ({ c, dx: c.x - w.x, dy: c.y - w.y })) };
        pushUndoLite();
        kb44Press(ch, cell.r, cell.c, true);
      } else {                                       // 键格以外 = 拖动元件
        if (app.kbChip) setKbFocus(null);
        app.drag = { kind: 'move', start: w, moved: false,
          offs: chips.map(c => ({ c, dx: c.x - w.x, dy: c.y - w.y })) };
      }
    } else {
      if (app.kbChip) setKbFocus(null);
      app.drag = { kind: 'move', start: w, moved: false,
        offs: chips.map(c => ({ c, dx: c.x - w.x, dy: c.y - w.y })) };
    }
    return;
  }

  const wI = wireAt(w);
  if (wI) { selectOnly('wire', wI.id); return; }

  clearSelection();   // 左键点击空白: 仅取消选择 (平移用右键/中键拖动)
  if (app.kbChip) setKbFocus(null);
});

canvas.addEventListener('pointermove', e => {
  if (app.drag && app.drag.right && !app.drag.moved &&
      Math.hypot(e.clientX - app.drag.sx, e.clientY - app.drag.sy) > 4) app.drag.moved = true;
  if (app.mode === 'breadboard') return bbPointerMove(e);
  if (app.mode === 'pcb') return pcbPointerMove(e);
  const w = toWorld(e);

  // 元件库拖拽幽灵
  if (app.ghost) {
    app.ghost.hidden = false;
    app.ghost.sx = e.clientX; app.ghost.sy = e.clientY;
    app.ghost.moved = Math.hypot(e.clientX - app.ghost.sx0, e.clientY - app.ghost.sy0) > 6;
    const r = canvas.getBoundingClientRect();
    app.ghost.overCv = e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
  }

  if (app.wiring) {
    app.wiring.cursor = w;
    updateHover(w);
    canvas.style.cursor = CURSORS.cross;
    return;
  }

  if (app.drag) {
    if (app.drag.kind === 'pan') {
      app.cam.x -= (w.x - app.drag.last.x);
      app.cam.y -= (w.y - app.drag.last.y);
      canvas.style.cursor = CURSORS.grabbig;
      return;
    }
    const dist = Math.hypot(w.x - app.drag.start.x, w.y - app.drag.start.y) * app.cam.zoom;
    if (app.drag.kind === 'press' && dist > 6 && !app.drag.moved) {
      // 拖动意图: 撤销按键按下
      if (app.drag.ch.type === 'BTN') sim.driveNow(app.drag.ch, 1, 0);
      else if (app.drag.ch.type === 'KB44' && app.drag.key) {
        const k = app.drag.key;                  // 拖动 = 取消按压, 转为移动
        kb44Press(app.drag.ch, k.r, k.c, false);
        app.drag.key = null;
      }
      app.drag.moved = true;
    }
    if (app.drag.kind === 'move' && dist > 3) {
      if (!app.drag.moved) { app.drag.moved = true; pushUndo(); }
    }
    if (app.drag.moved) {
      for (const o of app.drag.offs) {
        o.c.x = snap(w.x + o.dx);
        o.c.y = snap(w.y + o.dy);
      }
      canvas.style.cursor = CURSORS.grabbig;
    }
    return;
  }

  updateHover(w);
});

function updateHover(w) {
  const pinHit = pinAt(w);
  if (pinHit) {
    app.hover = { kind: 'pin', ch: pinHit.ch, pin: pinHit.pin };
    const def = LIB[pinHit.ch.type];
    const dirTxt = t(pinHit.pin.dir === 'in' ? '输入' : pinHit.pin.dir === 'out' ? '输出' : '双向');
    tooltipEl.textContent = tf('{type} · 引脚{num} {name} ({dir})', {
      type: def.type,
      num: def.hideNums ? '' : ' ' + pinHit.pin.num,
      name: pinHit.pin.name,
      dir: dirTxt,
    });
    tooltipEl.style.display = 'block';
    const r = holder.getBoundingClientRect();
    tooltipEl.style.left = (pinHit.ch ? 0 : 0) + 'px'; // 占位, 下方设置
    const p = pinWorld(pinHit.ch, pinHit.pin);
    const sx = (p.x - app.cam.x) * app.cam.zoom + CW / 2;
    const sy = (p.y - app.cam.y) * app.cam.zoom + CH / 2;
    tooltipEl.style.left = (sx + 14) + 'px';
    tooltipEl.style.top = (sy - 10) + 'px';
    canvas.style.cursor = CURSORS.pointer;
    return;
  }
  tooltipEl.style.display = 'none';
  const ch = chipAt(w);
  if (ch) {
    app.hover = { kind: 'chip', id: ch.id };
    canvas.style.cursor = (ch.type === 'SW' || ch.type === 'BTN' || ch.type === 'PS2' || ch.type === 'KB44') ? CURSORS.pointer : CURSORS.grab;
    return;
  }
  const wI = wireAt(w);
  if (wI) { app.hover = { kind: 'wire', id: wI.id }; canvas.style.cursor = CURSORS.pointer; return; }
  app.hover = null;
  canvas.style.cursor = CURSORS.def;
}

canvas.addEventListener('pointerup', e => {
  if (e.button === 2) {   // 右键松开: 拖动过则吞掉随后的菜单事件
    app.rightMoved = !!(app.drag && app.drag.right && app.drag.moved);
    app.drag = null;
    return;
  }
  if (app.mode === 'breadboard') return bbPointerUp(e);
  if (app.mode === 'pcb') return pcbPointerUp(e);
  const w = toWorld(e);

  // 连线: 松开在目标引脚上完成/移动线端, 其他位置取消
  if (app.wiring) {
    const hit = pinAt(w);
    if (app.wiring.moveWire) {
      // 拖动已有线的一端到新引脚
      if (hit && !(hit.ch === app.wiring.ch && hit.pin.num === app.wiring.pin.num)) {
        const mw = app.wiring.moveWire;
        const fe = app.wiring.moveEnd === 'a'
          ? { chip: mw.b.chip, num: mw.b.num }
          : { chip: mw.a.chip, num: mw.a.num };
        if (!sim.wireExists(fe.chip, fe.num, hit.ch, hit.pin.num)) {
          pushUndo();
          sim.removeWire(mw.id);
          sim.addWire(fe.chip, fe.num, hit.ch, hit.pin.num);
          scheduleSave();
        }
      }
      // 松开在空白/原位 → 保持原线不变
    } else if (hit && !(hit.ch === app.wiring.ch && hit.pin.num === app.wiring.pin.num)) {
      completeWire(hit);
    }
    app.wiring = null;
    return;
  }

  if (app.drag) {
    if (app.drag.kind === 'press' && !app.drag.moved) {
      const ch = app.drag.ch;
      if (ch.type === 'SW') {
        pushUndoLite();
        ch.state.on = ch.state.on ? 0 : 1;
        sim.driveNow(ch, 1, ch.state.on);
      } else if (ch.type === 'BTN') {
        sim.driveNow(ch, 1, 0);
      } else if (ch.type === 'PS2') {
        setKbFocus(app.kbChip === ch ? null : ch);   // 单击切换打字聚焦
      } else if (ch.type === 'KB44' && app.drag.key) {
        const k = app.drag.key;                      // 松开 = 断开行列
        kb44Press(ch, k.r, k.c, false);
      }
    } else if (app.drag.kind === 'move' && app.drag.moved) {
      sim.touch();
      scheduleSave();
    }
    app.drag = null;
  }
});

/** 开关切换不改变结构, 不入撤销栈, 只触发自动保存 */
function pushUndoLite() { scheduleSave(); }

function completeWire(hit) {
  const a = app.wiring;
  app.wiring = null;
  if (!a) return;
  if (sim.wireExists(a.ch, a.pin.num, hit.ch, hit.pin.num)) { toast(t('这两点已连接')); return; }
  pushUndo();
  const nw = sim.addWire(a.ch, a.pin.num, hit.ch, hit.pin.num);
  if (nw) toast(tf('已连接 {a} ↔ {b}', { a: LIB[a.ch.type].type + '.' + a.pin.name, b: LIB[hit.ch.type].type + '.' + hit.pin.name }));
}

const ZOOM_LIM = { schematic: [0.15, 8], breadboard: [0.15, 8], pcb: [0.5, 20] };
canvas.addEventListener('wheel', e => {
  e.preventDefault();
  const r = canvas.getBoundingClientRect();
  const sx = e.clientX - r.left, sy = e.clientY - r.top;
  // 区分输入设备: 鼠标滚轮 = 行/页模式或大步进整数像素; 触控板 = 小步进连续像素
  const line = e.deltaMode === 1 || e.deltaMode === 2;
  const mouseWheel = !e.ctrlKey && (line || (Number.isInteger(e.deltaY) && Math.abs(e.deltaY) >= 50));
  const [zmin, zmax] = ZOOM_LIM[app.mode] || [0.15, 8];
  if (e.ctrlKey || mouseWheel) {
    // 捏合缩放 (触控板双指捏合 = ctrl+滚轮) / 鼠标滚轮: 以光标为中心缩放
    const wx = (sx - r.width / 2) / app.cam.zoom + app.cam.x;
    const wy = (sy - r.height / 2) / app.cam.zoom + app.cam.y;
    if (e.ctrlKey) {
      // 触控板捏合: 连续小步进; 缩小再加强一档 (系统送出的缩小步进偏小)
      const k = e.deltaY > 0 ? 0.009 : 0.005;
      app.cam.zoom = Math.min(zmax, Math.max(zmin, app.cam.zoom * Math.exp(-e.deltaY * k)));
    } else {
      const dy = line ? e.deltaY * 16 : e.deltaY;
      app.cam.zoom = Math.min(zmax, Math.max(zmin, app.cam.zoom * Math.exp(-dy * 0.0022)));
    }
    // 保持鼠标下的点不动
    app.cam.x = wx - (sx - r.width / 2) / app.cam.zoom;
    app.cam.y = wy - (sy - r.height / 2) / app.cam.zoom;
  } else {
    // 触控板双指滑动: 平移视图, 内容跟手 (与 macOS 自然滚动一致)
    app.cam.x += e.deltaX;
    app.cam.y += e.deltaY;
  }
  scheduleSave();   // 相机变化随自动保存持久化 (700ms 防抖)
}, { passive: false });
// Safari 触控板捏合会发 gesture 事件: 阻止页面缩放
['gesturestart', 'gesturechange', 'gestureend'].forEach(t =>
  document.addEventListener(t, e => e.preventDefault()));

/* 标签/频率编辑统一走右键菜单"编辑标签…", 不再支持双击 */

/* ================= 右键菜单 ================= */

function showCtxMenu(x, y, items) {
  ctxMenu.innerHTML = '';
  for (const it of items) {
    const el = document.createElement('div');
    el.className = 'mi';
    el.textContent = it.text;
    el.onclick = () => { hideCtxMenu(); it.fn(); };
    ctxMenu.appendChild(el);
  }
  ctxMenu.classList.add('open');
  const r = holder.getBoundingClientRect();
  ctxMenu.style.left = Math.min(x - r.left, r.width - 190) + 'px';
  ctxMenu.style.top = Math.min(y - r.top, r.height - items.length * 34 - 10) + 'px';
}
function hideCtxMenu() { ctxMenu.classList.remove('open'); }

canvas.addEventListener('contextmenu', e => {
  e.preventDefault();
  if (app.rightMoved || (app.drag && app.drag.right && app.drag.moved)) {
    app.rightMoved = false;   // 右键拖动平移后不弹菜单
    return;
  }
  if (app.mode === 'breadboard') return bbContextMenu(e);
  if (app.mode === 'pcb') return pcbContextMenu(e);
  const w = toWorld(e);
  const pinHit = pinAt(w);
  const ch = pinHit ? pinHit.ch : chipAt(w);
  if (ch) {
    const items = [];
    items.push({ text: t('旋转 90° (R)'), fn: () => rotateChip(ch) });
    if (ch.type === 'CLOCK') items.push({ text: t('编辑频率…'), fn: () => editLabelOrFreq(ch) });
    items.push({ text: t('编辑标签…'), fn: () => editLabel(ch) });
    if (ch.type === 'PS2') items.push({ text: app.kbChip === ch ? t('退出打字 (Esc)') : t('聚焦打字…'), fn: () => setKbFocus(app.kbChip === ch ? null : ch) });
    items.push(...ps2ScriptItems(ch));
    if (ch.type === 'KB44') items.push({ text: tf('行脚空闲电平: {v} (点击切换)', { v: t(Number(ch.props.pull) ? '上拉 1' : '下拉 0') }), fn: () => { ch.props.pull = Number(ch.props.pull) ? 0 : 1; sim.evalChip(ch); sim.flush(); sim.touch(); scheduleSave(); } });
    items.push(...memoryMenuItems(ch));
    items.push({ text: t('复制 (Ctrl+D)'), fn: () => duplicateSelection() });
    items.push({ text: t('删除 (Del)'), fn: () => deleteChip(ch) });
    showCtxMenu(e.clientX, e.clientY, items);
    selectOnly('chip', ch.id);
    return;
  }
  const wI = wireAt(w);
  if (wI) {
    showCtxMenu(e.clientX, e.clientY, [{ text: t('删除导线'), fn: () => deleteWire(wI) }]);
    selectOnly('wire', wI.id);
    return;
  }
  showCtxMenu(e.clientX, e.clientY, [
    { text: t('⤢ 适配视图'), fn: fitView },
    { text: t('❓ 帮助'), fn: () => showModal(true) },
  ]);
});

document.addEventListener('pointerdown', e => {
  if (!ctxMenu.contains(e.target)) hideCtxMenu();
});

function rotateChip(ch) {
  pushUndo();
  ch.rot = ((ch.rot || 0) + 90) % 360;
  sim.touch();
  scheduleSave();
}
function editLabel(ch) {
  Dialog.prompt({
    title: tf('编辑标签 — {t}', { t: ch.type }),
    label: t('元件标签 (留空清除):'),
    value: ch.props.label || '',
    placeholder: t('例如 CLK / ~RESET'),
  }).then(s => {
    if (s == null) return;
    ch.props.label = s.trim();
    sim.touch(); scheduleSave();
  });
}
function deleteChip(ch) {
  pushUndo();
  sim.removeChip(ch.id);
  pruneSelection();
  scheduleSave();
}
function deleteWire(wI) {
  pushUndo();
  sim.removeWire(wI.id);
  pruneSelection();
  scheduleSave();
}
function deleteSelection() {
  if (!app.selection.size) return;
  pushUndo();
  for (const s of Array.from(app.selection)) {
    if (s.kind === 'chip') sim.removeChip(s.id);
    else sim.removeWire(s.id);
  }
  clearSelection();
  scheduleSave();
}
function rotateSelection() {
  const chips = Array.from(app.selection).filter(s => s.kind === 'chip')
    .map(s => sim.chips.get(s.id)).filter(Boolean);
  if (!chips.length) return;
  pushUndo();
  for (const c of chips) c.rot = ((c.rot || 0) + 90) % 360;
  sim.touch(); scheduleSave();
}
function duplicateSelection() {
  const ids = Array.from(app.selection).filter(s => s.kind === 'chip').map(s => s.id);
  if (!ids.length) return;
  pushUndo();
  const map = new Map();
  const created = [];
  for (const id of ids) {
    const c = sim.chips.get(id);
    if (!c) continue;
    const nc = sim.addChip(c.type, c.x + 34, c.y + 34, c.rot,
      Object.assign({}, c.props), JSON.parse(JSON.stringify(c.state)));
    delete nc.state.on; // 副本开关回到默认? 保留状态更直观 — 恢复:
    nc.state.on = c.state.on;
    map.set(id, nc.id);
    created.push(nc.id);
  }
  for (const wI of sim.wires) {
    const aId = wI.a.chip.id, bId = wI.b.chip.id;
    if (map.has(aId) && map.has(bId)) {
      sim.addWire(sim.chips.get(map.get(aId)), wI.a.num, sim.chips.get(map.get(bId)), wI.b.num);
    }
  }
  app.selection = new Set(created.map(id => ({ kind: 'chip', id })));
  scheduleSave();
}

/* ================= 键盘 ================= */

/* ---------- PS/2 键盘打字聚焦 (Set 2 扫描码, 按物理键位 e.code 映射) ---------- */

/* Set 2 扫描码表 PS2_CODE / PS2_EXT 在 chips.js (协议层), 此处直接使用 */

/** 入队待发字节并触发发送 (队列上限 64, 溢出丢最旧) */
function ps2Queue(ch, bytes) {
  const q = ch.state.queue;
  if (q.length + bytes.length > 64) q.splice(0, q.length + bytes.length - 64);
  q.push(...bytes);
  sim.evalChip(ch);
}

function ps2Keydown(ch, e) {
  if (e.repeat) return;                       // 忽略操作系统自动重复
  const code = PS2_CODE[e.code] != null ? PS2_CODE[e.code] : PS2_EXT[e.code];
  if (code == null) return;
  if (PS2_EXT[e.code] != null) ps2Queue(ch, [0xE0, code]);
  else if (e.code === 'CapsLock') ps2Queue(ch, [code]);   // CapsLock 无 Break, 松开再发一次 Make
  else ps2Queue(ch, [code]);
}

function ps2Keyup(ch, e) {
  const code = PS2_CODE[e.code] != null ? PS2_CODE[e.code] : PS2_EXT[e.code];
  if (code == null) return;
  if (e.code === 'CapsLock') ps2Queue(ch, [code]);
  else if (PS2_EXT[e.code] != null) ps2Queue(ch, [0xE0, 0xF0, code]);
  else ps2Queue(ch, [0xF0, code]);            // Break 码 = F0 + Make
}

/** PS/2 测试脚本: type 文本 / sleep 毫秒 / key 键名, 右键运行 */
function ps2ScriptItems(ch) {
  if (ch.type !== 'PS2') return [];
  return [
    { text: t('编辑测试脚本…'), fn: () => editPs2Script(ch) },
    { text: ch.state.running ? t('停止脚本') : t('运行脚本'), fn: () => togglePs2Script(ch) },
  ];
}
function editPs2Script(ch) {
  const sample = [
    t('# 每行一条指令, # 与空行忽略:'),
    t('#   type 文本    输入文本 (支持大写/符号)'),
    t('#   sleep 500   等待 500 毫秒'),
    t('#   key Enter   按键 (Enter/Space/ArrowUp/F1…)'),
    'type hello',
    'sleep 500',
    'type 123',
    'key Enter',
  ].join('\n');
  Dialog.prompt({
    title: tf('PS/2 测试脚本 — {t}', { t: ch.props.label || ch.type + '#' + ch.id }),
    label: t('type 文本 | sleep 毫秒 | key 键名 (# 注释):'),
    value: ch.state.script || sample,
    multiline: true, rows: 12,
    okText: t('保存'),
  }).then(s => {
    if (s == null) return;
    ch.state.script = s;
    scheduleSave();
    toast(t('测试脚本已保存'));
  });
}
function togglePs2Script(ch) {
  if (ch.state.running) {
    ch.state.running = false;
    delete ch.state.run;
    draw();
    toast(t('脚本已停止'));
    return;
  }
  const acts = ps2ParseScript(ch.state.script || '');
  if (!acts.length) { toast(t('脚本为空: 右键 → 编辑测试脚本'), 'warn'); return; }
  ch.state.running = true;
  ch.state.run = { acts, i: 0, ci: 0 };
  sim.evalChip(ch);
  draw();
  toast(tf('脚本开始运行 ({n} 条动作)', { n: acts.length }));
}

window.addEventListener('ps2scriptdone', e => {
  const ch = app.kbChip && app.kbChip.id === e.detail.id ? app.kbChip : [...sim.chips.values()].find(c => c.id === e.detail.id);
  if (ch) ch.state.running = false;
  draw();
  toast(t('PS/2 脚本运行完成'));
});

/** PS/2 打字聚焦 (仅 PS2 元件); 聚焦期间所有按键被捕获为扫描码 */
function setKbFocus(ch) {
  const on = !!(ch && ch.type === 'PS2');
  app.kbChip = on ? ch : null;
  if (on) { app.wiring = null; app.bbWiring = null; toast(t('键盘聚焦: 直接打字发送扫描码, Esc 退出')); }
  draw();
}

window.addEventListener('keydown', e => {
  const t = e.target;
  if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT')) return;
  if (app.kbChip) {                           // 打字聚焦: 吞掉全部快捷键
    e.preventDefault();
    if (e.key === 'Escape') { setKbFocus(null); return; }
    ps2Keydown(app.kbChip, e);
    return;
  }
  const k = e.key;
  if (k === 'Escape') { app.wiring = null; app.bbWiring = null; clearSelection(); }
  else if (k === 'Delete' || k === 'Backspace') {
    e.preventDefault();
    if (app.wiring) { app.wiring = null; return; }       // 连线中: 先取消连线
    if (app.bbWiring) { app.bbWiring = null; return; }
    if (app.mode === 'schematic') deleteSelection();
    else if (app.mode === 'breadboard') bbDeleteSelection();
    else pcbDeleteSelection();
  }
  else if (k === 'r' || k === 'R') {
    if (app.mode === 'schematic') rotateSelection();
    else if (app.mode === 'breadboard') bbRotateSelection();
    else pcbRotateSelection();
  }
  else if (k === '1') switchMode('schematic');
  else if (k === '2') switchMode('breadboard');
  else if (k === '3') switchMode('pcb');
  else if (k === ' ') { e.preventDefault(); toggleRun(); }
  else if ((e.ctrlKey || e.metaKey) && (k === 'z' || k === 'Z') && !e.shiftKey) { e.preventDefault(); undo(); }
  else if ((e.ctrlKey || e.metaKey) && ((k === 'y' || k === 'Y') || ((k === 'z' || k === 'Z') && e.shiftKey))) { e.preventDefault(); redo(); }
  else if ((e.ctrlKey || e.metaKey) && (k === 'd' || k === 'D')) { e.preventDefault(); duplicateSelection(); }
});

window.addEventListener('keyup', e => {
  const t = e.target;
  if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT')) return;
  if (app.kbChip) { e.preventDefault(); ps2Keyup(app.kbChip, e); }
});

/* ================= 元件库侧栏 ================= */

const CAT_ORDER = ['输入/输出', '门电路', '组合逻辑', '触发器/锁存', '计数/移位', '存储器', '总线接口'];
function buildLib(filter) {
  const libEl = document.getElementById('lib');
  libEl.innerHTML = '';
  const f = (filter || '').trim().toLowerCase();
  for (const cat of CAT_ORDER) {
    const items = Object.values(LIB).filter(d => d.cat === cat &&
      (!f || d.type.toLowerCase().includes(f) || d.desc.toLowerCase().includes(f) || t(d.desc).toLowerCase().includes(f) || String(d.type).includes(f)));
    if (!items.length) continue;
    const h = document.createElement('div');
    h.className = 'lib-cat';
    h.textContent = t(cat);
    libEl.appendChild(h);
    for (const d of items) {
      const el = document.createElement('div');
      el.className = 'lib-item';
      el.innerHTML = `<b>${d.type}</b><span>${t(d.desc)}</span>`;
      el.title = tf('{d} — 点击或拖拽放置', { d: t(d.desc) });
      bindLibItem(el, d.type);
      libEl.appendChild(el);
    }
  }
}

function bindLibItem(el, type) {
  el.addEventListener('pointerdown', e => {
    if (e.button !== 0) return;
    e.preventDefault();
    app.ghost = { type, sx: e.clientX, sy: e.clientY, sx0: e.clientX, sy0: e.clientY, moved: false, overCv: false, hidden: true };
    // 指针捕获: 拖动事件直接送达本元素, 不依赖 window 冒泡 (更可靠, 各模式行为一致)
    try { el.setPointerCapture(e.pointerId); } catch (err) { }
    const move = ev => {
      if (!app.ghost) return;
      app.ghost.hidden = false;
      app.ghost.sx = ev.clientX; app.ghost.sy = ev.clientY;
      app.ghost.moved = true;
      const r = canvas.getBoundingClientRect();
      app.ghost.overCv = ev.clientX >= r.left && ev.clientX <= r.right && ev.clientY >= r.top && ev.clientY <= r.bottom;
    };
    // 原生拖放: 影像由合成器跟随鼠标, 不受事件稀疏影响 (首选拖拽通道)
    el.draggable = true;
    el.addEventListener('dragstart', ev => {
      if (ev.dataTransfer) {
        try {
          ev.dataTransfer.setData('text/plain', type);
          ev.dataTransfer.effectAllowed = 'copy';
          // 自定义拖拽影像 (与 ghost 预览一致)
          const img = document.createElement('div');
          img.textContent = type;
          img.style.cssText = 'position:fixed;left:-200px;top:-200px;padding:8px 14px;' +
            'background:#fff;border:1.5px solid #0288d1;border-radius:8px;' +
            'font:bold 13px Consolas,monospace;color:#1f2937;box-shadow:0 4px 14px rgba(30,45,70,.25);z-index:999;';
          document.body.appendChild(img);
          ev.dataTransfer.setDragImage(img, Math.round(img.offsetWidth / 2), Math.round(img.offsetHeight / 2));
          setTimeout(() => img.remove(), 0);
        } catch (err) { }
      }
      app.ghost = null;          // 取消指针通道的 ghost
      app.dnd = { type, x: ev.clientX, y: ev.clientY };
    });
    el.addEventListener('dragend', () => { app.dnd = null; });
    const finish = ev => {
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', finish);
      el.removeEventListener('pointercancel', finish);
      el.removeEventListener('lostpointercapture', finish);
      const g = app.ghost;
      app.ghost = null;
      if (!g) return;
      if (ev.type !== 'pointerup') return;   // 异常中断(丢失捕获): 只取消, 不放置
      if (g.moved && g.overCv) {
        const w = toWorld(ev);
        if (app.mode === 'breadboard') placeChipBB(type, w.x, w.y);
        else if (app.mode === 'pcb') placeChipPCB(type, w.x, w.y);
        else placeChip(type, snap(w.x), snap(w.y));
      } else if (!g.moved) {
        if (app.mode === 'breadboard') placeChipBB(type);
        else if (app.mode === 'pcb') placeChipPCB(type);
        else { const p = findFreeSpot(); placeChip(type, snap(p.x), snap(p.y)); }
      }
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', finish);
    el.addEventListener('pointercancel', finish);
    el.addEventListener('lostpointercapture', finish);
  });
}

/* 原生拖放: 画布接收 drop 放置元件 */
canvas.addEventListener('dragover', e => {
  if (!app.dnd) return;
  e.preventDefault();
  if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
  app.dnd.x = e.clientX; app.dnd.y = e.clientY;
});
canvas.addEventListener('drop', e => {
  if (!app.dnd) return;
  e.preventDefault();
  const type = app.dnd.type;
  const w = toWorld(e);
  app.dnd = null;
  if (app.mode === 'breadboard') placeChipBB(type, w.x, w.y);
  else if (app.mode === 'pcb') placeChipPCB(type, w.x, w.y);
  else placeChip(type, snap(w.x), snap(w.y));
});

/** 在视图中心附近找一个不与现有元件重叠的空位 */
function findFreeSpot() {
  const cx = app.cam.x, cy = app.cam.y;
  const free = (x, y) => {
    for (const ch of sim.chips.values()) {
      const h = chipHalf(ch);
      if (Math.abs(x - ch.x) < h.x + 95 && Math.abs(y - ch.y) < h.y + 55) return false;
    }
    return true;
  };
  for (let ring = 0; ring < 8; ring++) {
    const cands = [];
    if (ring === 0) cands.push([cx, cy]);
    for (let i = -ring; i <= ring; i++) {
      if (ring > 0) {
        cands.push([cx + i * 190, cy - ring * 150]);
        cands.push([cx + i * 190, cy + ring * 150]);
        cands.push([cx - ring * 190, cy + i * 150]);
        cands.push([cx + ring * 190, cy + i * 150]);
      }
    }
    for (const [x, y] of cands) if (free(x, y)) return { x, y };
  }
  return { x: cx, y: cy };
}

function placeChip(type, x, y) {
  pushUndo();
  const ch = sim.addChip(type, x, y);
  selectOnly('chip', ch.id);
  scheduleSave();
  toast(tf('已放置 {t} ({d})', { t: type, d: t(LIB[type].desc) }));
}

document.getElementById('search').addEventListener('input', e => buildLib(e.target.value));

/* ================= Windows 风格多级菜单栏 ================= */

function toggleRun() { sim.setRunning(!sim.running); syncRun(); }
function syncRun() {
  const st = document.getElementById('stState');
  st.textContent = sim.running ? t('● 运行中') : t('‖ 已暂停');
  st.className = sim.running ? 'ok' : 'paused';
  Menus.refresh();
}
function setSpeed(v) { app.speed = v; Menus.refresh(); }
function simStep() {
  const n = sim.stepClocks();
  if (!n) toast(t('没有时钟源 — 已处理待定事件'));
}
function fitDispatch() {
  if (app.mode === 'breadboard') fitBreadboard();
  else if (app.mode === 'pcb') fitPCB();
  else fitView();
}
function rotateDispatch() {
  if (app.mode === 'schematic') rotateSelection();
  else if (app.mode === 'breadboard') bbRotateSelection();
  else pcbRotateSelection();
}
function deleteDispatch() {
  if (app.mode === 'schematic') deleteSelection();
  else if (app.mode === 'breadboard') bbDeleteSelection();
  else pcbDeleteSelection();
}
async function fileNew() {
  if (sim.chips.size && !(await Dialog.confirm({
    title: t('新建画布'),
    message: t('清空当前电路? (可用 Ctrl+Z 撤销)'),
    okText: t('清空'), danger: true,
  }))) return;
  pushUndo();
  restoreSave({ chips: [], wires: [] });
  doSave(true);
  toast(t('已清空'));
  Menus.refresh();
}
function fileExportJSON() {
  downloadBlob(JSON.stringify(buildSave(), null, 2), '74vm-circuit.json');
}
function fileImportPick() { document.getElementById('fileImport').click(); }

/* ---------- 侧栏收起/展开 ---------- */
function setLibShown(v) {
  app.libShown = !!v;
  document.getElementById('sidebar').classList.toggle('collapsed', !app.libShown);
  document.getElementById('sideToggle').textContent = app.libShown ? '‹' : '›';
  try { localStorage.setItem('74vm:lib', app.libShown ? '1' : '0'); } catch (e) { }
  Menus.refresh();
}
function toggleLib() { setLibShown(!app.libShown); }
document.getElementById('sideToggle').onclick = toggleLib;

/* ---------- 面包板元件标识 ---------- */
function setBBLabels(v) {
  app.bbLabels = !!v;
  try { localStorage.setItem('74vm:labels', app.bbLabels ? '1' : '0'); } catch (e) { }
  Menus.refresh();
}

/* ---------- 面包板动作 ---------- */
function bbActAuto() { bbAutoAll(true); Menus.refresh(); }
function bbActPlace() {
  pushUndo(); BB.autoPlace(sim); applyBB(); scheduleSave();
  toast(t('已重新摆放元件')); Menus.refresh();
}
function bbActClear() {
  if (!app.bb.jumpers.length) return;
  pushUndo(); app.bb.jumpers = []; applyBB(); scheduleSave();
  toast(t('已清空全部跳线')); Menus.refresh();
}
function bbActAddBoard() {
  if (BB.getBoards() >= 6) { toast(t('最多 6 块板')); return; }
  pushUndo();
  BB.setBoards(BB.getBoards() + 1);
  fitBreadboard(); app.cams.breadboard.fitted = true; scheduleSave();
  toast(tf('已添加一块面包板 (共 {n} 块)', { n: BB.getBoards() })); Menus.refresh();
}
function bbActDelBoard() {
  if (BB.getBoards() <= 1) { toast(t('至少保留 1 块板')); return; }
  pushUndo();
  const n0 = Array.from(sim.chips.values()).filter(c => c.bb).length;
  BB.setBoards(BB.getBoards() - 1);
  bbSanitize(); applyBB(); fitBreadboard(); app.cams.breadboard.fitted = true; scheduleSave();
  const rm = n0 - Array.from(sim.chips.values()).filter(c => c.bb).length;
  toast(tf('已移除一块板 (剩 {n} 块)', { n: BB.getBoards() }) + (rm ? tf('，{n} 个元件移回托盘', { n: rm }) : ''));
  Menus.refresh();
}
async function bbActCols() {
  const ok = await Dialog.prompt({
    title: t('面包板列数'),
    label: t('列数 (20 ~ 240)。常见: 30 = 半尺寸, 60 = 全尺寸, 63 = 常见规格:'),
    value: String(BB.getCols()),
    validate: s => {
      const n = parseInt(s, 10);
      return (isNaN(n) || n < 20 || n > 240) ? t('请输入 20 ~ 240 之间的整数') : null;
    },
  });
  if (ok == null) return;
  const n = parseInt(ok, 10);
  if (isNaN(n) || n < 20 || n > 240) { toast(t('无效列数 (需 20~240)'), 'err'); return; }
  pushUndo();
  const n0 = Array.from(sim.chips.values()).filter(c => c.bb).length;
  BB.setCols(n); bbSanitize(); applyBB();
  fitBreadboard(); app.cams.breadboard.fitted = true; scheduleSave();
  const rm = n0 - Array.from(sim.chips.values()).filter(c => c.bb).length;
  toast(tf('面包板已设为 {n} 列', { n: BB.getCols() }) + (rm > 0 ? tf(' (⚠ {n} 个超范围元件移回托盘)', { n: rm }) : ''));
  Menus.refresh();
}
/* ---------- PCB 动作 ---------- */
function pcbActAuto() {
  pushUndo(); PCB.autoPlace(sim); scheduleSave();
  toast(t('已自动布局')); Menus.refresh();
}
async function pcbActExport() {
  const unplaced = Array.from(sim.chips.values()).filter(c => !c.pcb);
  if (unplaced.length && !(await Dialog.confirm({
    title: t('导出立创EDA PCB'),
    message: tf('{n} 个元件尚未布局, 导出将忽略它们. 继续?', { n: unplaced.length }),
    okText: t('导出'),
  }))) return;
  const r = EasyEDAExport.buildEasyEDA(sim, PCB);
  downloadBlob(r.json, '74vm-pcb-easyeda.json');
  toast(t('已导出立创EDA PCB — 在立创EDA(标准版) 文件→导入→EasyEDA 打开, 焊盘带网络可直接自动布线'));
}
function pcbActNetlist() {
  downloadBlob(JSON.stringify(EasyEDAExport.buildNetlist(sim, PCB), null, 2), '74vm-netlist.json');
  toast(t('已导出网表 JSON'));
}

/* ---------- 菜单栏 ---------- */
const Menus = {
  el: null, openIdx: -1,
  def() {
    const bb = () => app.mode === 'breadboard';
    const pcb = () => app.mode === 'pcb';
    return [
      { label: t('文件(F)'), items: [
        { label: t('新建画布'), act: fileNew },
        { sep: true },
        { label: t('导入 JSON…'), act: fileImportPick },
        { label: t('导出 JSON…'), act: fileExportJSON },
        { label: t('保存到浏览器'), act: () => { doSave(); Menus.refresh(); } },
        { sep: true },
        { label: t('示例电路'), sub: window.EXAMPLES.map(ex => ({
          label: t(ex.name), hint: t(ex.desc), act: () => { loadExample(ex); Menus.refresh(); },
        })) },
        { sep: true },
        { label: t('语言'), sub: [
          { label: '中文', radio: 'lang', val: 'zh', act: () => setLang('zh') },
          { label: 'English', radio: 'lang', val: 'en', act: () => setLang('en') },
        ]},
      ]},
      { label: t('编辑(E)'), items: [
        { label: t('撤销'), hint: 'Ctrl+Z', act: () => { undo(); Menus.refresh(); }, enabled: () => app.undoStack.length > 0 },
        { label: t('重做'), hint: 'Ctrl+Y', act: () => { redo(); Menus.refresh(); }, enabled: () => app.redoStack.length > 0 },
        { sep: true },
        { label: t('旋转选中'), hint: 'R', act: rotateDispatch },
        { label: t('复制选中'), hint: 'Ctrl+D', act: () => duplicateSelection() },
        { label: t('删除选中'), hint: 'Del', act: deleteDispatch },
      ]},
      { label: t('视图(V)'), items: [
        { label: t('适配视图'), act: fitDispatch },
        { label: t('元件库'), hint: t('侧栏'), radio: 'lib', act: toggleLib },
        { label: t('元件标识 (面包板)'), hint: t('关=悬停显示'), radio: 'labels', act: () => setBBLabels(!app.bbLabels) },
        { sep: true },
        { label: t('原理图模式'), hint: '1', radio: 'mode', val: 'schematic', act: () => switchMode('schematic') },
        { label: t('面包板模式'), hint: '2', radio: 'mode', val: 'breadboard', act: () => switchMode('breadboard') },
        { label: t('PCB 模式'), hint: '3', radio: 'mode', val: 'pcb', act: () => switchMode('pcb') },
      ]},
      { label: t('仿真(S)'), items: [
        { label: () => (sim.running ? t('暂停') : t('运行')), hint: t('空格'), act: toggleRun },
        { label: t('时钟步进'), hint: t('半周期'), act: simStep },
        { sep: true },
        { label: t('速度 ×1'), radio: 'speed', val: 1, act: () => setSpeed(1) },
        { label: t('速度 ×10'), radio: 'speed', val: 10, act: () => setSpeed(10) },
        { label: t('速度 ×100'), radio: 'speed', val: 100, act: () => setSpeed(100) },
        { label: t('速度 ×1000'), radio: 'speed', val: 1000, act: () => setSpeed(1000) },
      ]},
      { label: t('工具(T)'), items: [
        { label: t('面包板'), sub: [
          { label: t('✨ 自动布线 (从原理图)'), act: bbActAuto, enabled: bb },
          { label: t('重新摆放元件'), act: bbActPlace, enabled: bb },
          { label: t('清空全部跳线'), act: bbActClear, enabled: () => app.mode === 'breadboard' && app.bb.jumpers.length > 0 },
          { sep: true },
          { label: t('添加一块板子'), act: bbActAddBoard, enabled: () => app.mode === 'breadboard' && BB.getBoards() < 6 },
          { label: t('移除一块板子'), act: bbActDelBoard, enabled: () => app.mode === 'breadboard' && BB.getBoards() > 1 },
          { label: t('设置列数…'), act: bbActCols, enabled: bb },
        ]},
        { label: 'PCB', sub: [
          { label: t('自动布局'), act: pcbActAuto, enabled: pcb },
          { label: t('导出立创EDA PCB…'), act: pcbActExport, enabled: pcb },
          { label: t('导出网表 JSON…'), act: pcbActNetlist, enabled: pcb },
        ]},
      ]},
      { label: t('帮助(H)'), items: [
        { label: t('❓ 使用帮助'), act: () => showModal(true) },
      ]},
    ];
  },
  radioChecked(it) {
    if (it.radio === 'mode') return app.mode === it.val;
    if (it.radio === 'speed') return app.speed === it.val;
    if (it.radio === 'lib') return app.libShown;
    if (it.radio === 'labels') return app.bbLabels;
    if (it.radio === 'lang') return I18N.lang === it.val;
    return false;
  },
  build() {
    this.el = document.getElementById('menubar');
    this.el.innerHTML = '';
    this.def().forEach((m, i) => {
      const top = document.createElement('div');
      top.className = 'mb';
      top.textContent = m.label;
      const drop = document.createElement('div');
      drop.className = 'menu mb-drop';
      this.buildItems(drop, m.items);
      top.appendChild(drop);
      top.addEventListener('pointerdown', e => {
        if (e.target.closest('.menu')) return;   // 点击在下拉面板内: 不切换开合, 否则面板被隐藏导致 click 不派发
        e.stopPropagation();
        this.openMenu(this.openIdx === i ? -1 : i);
      });
      top.addEventListener('pointerenter', () => {
        if (this.openIdx >= 0 && this.openIdx !== i) this.openMenu(i);
      });
      this.el.appendChild(top);
    });
  },
  buildItems(menuEl, items) {
    for (const it of items) {
      if (it.sep) {
        const s = document.createElement('div');
        s.className = 'msep';
        menuEl.appendChild(s);
        continue;
      }
      const dis = it.enabled && !it.enabled();
      const el = document.createElement('div');
      el.className = 'mi' + (it.sub ? ' has-sub' : '') + (dis ? ' dis' : '');
      const mk = document.createElement('span');
      mk.className = 'mk';
      mk.textContent = it.radio ? (this.radioChecked(it) ? '●' : '') : '';
      el.appendChild(mk);
      const txt = document.createElement('span');
      txt.className = 'mtext';
      txt.textContent = typeof it.label === 'function' ? it.label() : it.label;
      el.appendChild(txt);
      if (it.hint) {
        const h = document.createElement('span');
        h.className = 'hint';
        h.textContent = it.hint;
        el.appendChild(h);
      }
      if (it.sub) {
        const sub = document.createElement('div');
        sub.className = 'menu sub-menu';
        this.buildItems(sub, it.sub);
        el.appendChild(sub);
      } else if (it.act) {
        el.addEventListener('click', () => {
          closeAllMenus();
          try { it.act(); } catch (err) { console.error(err); }
          this.refresh();
        });
      }
      menuEl.appendChild(el);
    }
  },
  openMenu(i) {
    this.closeAll();
    this.openIdx = i;
    if (i >= 0) {
      const tops = this.el.querySelectorAll(':scope > .mb');
      if (tops[i]) tops[i].classList.add('open');
    }
  },
  closeAll() {
    this.openIdx = -1;
    if (this.el) this.el.querySelectorAll('.mb.open').forEach(b => b.classList.remove('open'));
  },
  refresh() {
    if (!this.el) return;
    const open = this.openIdx;
    this.build();
    if (open >= 0) this.openMenu(open);
  },
};

/* ---------- 界面语言 ----------
 * 动态创建的文案 (菜单/对话框/toast/画布) 在各自渲染点经 t()/tf() 翻译;
 * 这里只负责静态 HTML (标题/搜索框/帮助) 与菜单栏重建。 */
function applyLang() {
  document.title = t('74VM · 74系列数字电路模拟器');
  document.documentElement.lang = I18N.lang === 'en' ? 'en' : 'zh-CN';
  const search = document.getElementById('search');
  if (search) search.placeholder = t('搜索元件');
  const sideToggle = document.getElementById('sideToggle');
  if (sideToggle) sideToggle.title = t('收起/展开元件库');
  const helpHead = document.querySelector('#helpModal .modal-head b');
  if (helpHead) helpHead.textContent = t('74VM 使用帮助');
  const btnHelpClose = document.getElementById('btnHelpClose');
  if (btnHelpClose) btnHelpClose.textContent = t('✕ 关闭');
  const helpBody = document.getElementById('helpBody');
  if (helpBody) {
    if (!helpBody.dataset.zh) helpBody.dataset.zh = helpBody.innerHTML;   // 首次缓存中文原文
    helpBody.innerHTML = I18N.lang === 'en' ? I18N.EN_HELP : helpBody.dataset.zh;
  }
  Menus.build();
  buildLib((document.getElementById('search') || {}).value || '');
  updateStatus();
  syncRun();
}
function setLang(l) {
  I18N.setLang(l);
  applyLang();
}
function closeAllMenus() {
  Menus.closeAll();
  document.querySelectorAll('.menu.open').forEach(m => m.classList.remove('open'));
}
document.addEventListener('pointerdown', e => {
  // 点击菜单栏/右键菜单以外区域时关闭所有菜单
  // (不能在按下时隐藏正被点击的菜单 — 否则真实浏览器的 click 不会派发)
  if (!e.target.closest('#menubar') && !e.target.closest('#ctxmenu'))
    closeAllMenus();
});
window.addEventListener('keydown', e => {
  if (e.key === 'Escape') Menus.closeAll();
});
Menus.build();
setLibShown(localStorage.getItem('74vm:lib') !== '0');   // 侧栏初始状态
try { app.bbLabels = localStorage.getItem('74vm:labels') !== '0'; } catch (e) { app.bbLabels = true; }   // 面包板标识默认显示

function loadExample(ex) {
  if (sim.chips.size) pushUndo();
  sim.load({ chips: ex.build().chips, wires: ex.build().wires });
  for (const ch of sim.chips.values()) { ch.x = snap(ch.x); ch.y = snap(ch.y); }   // 示例坐标吸附 28px 网格
  syncSchematicWires();
  // 重置面包板接线状态 (新电路需要重新摆放/接线)
  app.bb.jumpers = [];
  app.bb.placed = false;
  if (app.mode === 'breadboard') bbAutoAll(false);
  sim.setRunning(true);
  syncRun();
  if (app.mode === 'breadboard') fitBreadboard();
  else if (app.mode === 'pcb') fitPCB();
  else fitView();
  scheduleSave();
  toast(tf('已加载示例: {n}', { n: t(ex.name) }));
}

/* 文件导入 (fileImportPick 触发) */
document.getElementById('fileImport').addEventListener('change', e => {
  const f = e.target.files && e.target.files[0];
  if (!f) return;
  const rd = new FileReader();
  rd.onload = () => {
    try {
      const data = JSON.parse(rd.result);
      if (!data || !Array.isArray(data.chips)) throw new Error(t('格式不符'));
      pushUndo();
      restoreSave(data);
      fitView();
      scheduleSave();
      toast(tf('导入成功: {n} 个元件', { n: data.chips.length }));
    } catch (err) {
      toast(tf('导入失败: {m}', { m: err.message }), 'err');
    }
  };
  rd.readAsText(f);
  e.target.value = '';
});

/* 帮助 */
function modalVisible() { return !document.getElementById('helpModal').classList.contains('hidden'); }
function showModal(v) { document.getElementById('helpModal').classList.toggle('hidden', !v); }
document.getElementById('btnHelpClose').onclick = () => showModal(false);
document.getElementById('helpModal').addEventListener('pointerdown', e => {
  if (e.target.id === 'helpModal') showModal(false);
});

/* ================= 视图 ================= */

function fitView() {
  resizeCanvas();
  if (!sim.chips.size || !CW || !CH) { app.cam = { x: 400, y: 250, zoom: 1 }; return; }
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const ch of sim.chips.values()) {
    const half = chipHalf(ch);
    x0 = Math.min(x0, ch.x - half.x); x1 = Math.max(x1, ch.x + half.x);
    y0 = Math.min(y0, ch.y - half.y); y1 = Math.max(y1, ch.y + half.y);
  }
  const bw = x1 - x0 + 160, bh = y1 - y0 + 160;
  app.cam.zoom = Math.max(0.25, Math.min(1.5, Math.min(CW / bw, CH / bh)));
  app.cam.x = (x0 + x1) / 2;
  app.cam.y = (y0 + y1) / 2;
}

/* ================= 状态栏 / 主循环 ================= */

function updateStatus() {
  document.getElementById('stTime').textContent = 't = ' + (sim.simTime / 1000).toFixed(2) + ' ms';
  document.getElementById('stCount').textContent =
    tf('元件 {c} · 导线 {w} · 事件 {e}', { c: sim.chips.size, w: sim.wires.length, e: fmtNum(sim.eventCount) });
  document.getElementById('stZoom').textContent = tf('缩放 {n}%', { n: Math.round(app.cam.zoom * 100) });
  let wtxt = sim.overload ? t('⚠ 事件过载(电路可能振荡或规模过大)') : '';
  if (app.mode === 'breadboard') {
    let n = 0;
    for (const ch of sim.chips.values())
      if (ch.bb && ch.powered === false) n++;   // DIP 与有源虚拟元件 (CLOCK/PS2)
    if (n) wtxt += (wtxt ? '  ·  ' : '') + tf('⚡ {n} 颗芯片未接电源 (VCC/GND 列 → 电源轨)', { n });
  }
  const warn = document.getElementById('stWarn');
  warn.textContent = wtxt;
  sim.overload = sim.overload && sim.q.size > 1000; // 队列排空后自动清除
}

function fmtNum(n) {
  if (I18N.lang === 'en') return n >= 1000 ? (n / 1000).toFixed(1) + 'k' : String(n);
  return n >= 10000 ? (n / 10000).toFixed(1) + '万' : String(n);
}

/* 仿真推进与渲染解耦: 定时器推进仿真(后台仅减速不暂停), rAF 只负责绘制 */
let lastTick = performance.now();
setInterval(() => {
  const now = performance.now();
  const dt = Math.min(100, now - lastTick);
  lastTick = now;
  sim.advance(dt * 1000 * app.speed); // ms → µs
  if (sim.version !== app.lastVersion) {
    app.lastVersion = sim.version;
    scheduleSave();
  }
  app.statusAcc += dt;
  if (app.statusAcc > 150) { app.statusAcc = 0; updateStatus(); }
}, 25);

function frame() {
  draw();
  requestAnimationFrame(frame);
}

/* ================= 模式系统: 原理图 / 面包板 / PCB ================= */

function switchMode(m) {
  if (m === app.mode) return;
  const prev = app.mode;
  if (app.kbChip) app.kbChip = null;          // 切换模式退出打字聚焦
  if (prev === 'breadboard') {
    sim.setWiresRaw(app.schematicWires || []);
    // 离开面包板: 原理图无供电概念, 全部恢复上电
    let changed = false;
    for (const ch of sim.chips.values())
      if (ch.powered === false) { ch.powered = true; changed = true; }
    if (changed) sim.reevalAll();
  }
  app.mode = m;
  app.cam = app.cams[m];
  app.wiring = null; app.bbWiring = null; app.hover = null; clearSelection();
  hideTooltip();
  Menus.refresh();
  if (m === 'breadboard') {
    app.schematicWires = sim.wiresRaw();
    if (!app.bb.placed && sim.chips.size) bbAutoAll(false);
    else applyBB();
    if (!app.cams.breadboard.fitted) { fitBreadboard(); app.cams.breadboard.fitted = true; }
    toast(t('面包板模式 — 按住孔位拖动拉跳线, ✨自动布线可从原理图生成接线'));
  } else if (m === 'pcb') {
    let need = false;
    for (const ch of sim.chips.values()) if (!ch.pcb) need = true;
    if (need && sim.chips.size) { pushUndo(); PCB.autoPlace(sim); toast(t('已按原理图顺序自动布局封装')); }
    if (!app.cams.pcb.fitted) { fitPCB(); app.cams.pcb.fitted = true; }
    toast(t('PCB 模式 — 拖动/旋转封装, 📤 导出立创EDA 后可在其内自动布线'));
  }
  updateStatus();
  scheduleSave();   // 记住上次使用的模式
}

function fitBreadboard() {
  resizeCanvas();
  const w = BB.BOARD.w + 320, h = BB.totalH() + 80;
  app.cams.breadboard.zoom = Math.max(0.2, Math.min(1.6, Math.min(CW / w, CH / h)));
  app.cams.breadboard.x = BB.BOARD.w / 2 - 130;
  app.cams.breadboard.y = BB.totalH() / 2;
}
function fitPCB() {
  resizeCanvas();
  const w = PCB.BOARD.w + 240, h = PCB.BOARD.h + 40;
  app.cams.pcb.zoom = Math.max(1, Math.min(12, Math.min(CW / w, CH / h)));
  app.cams.pcb.x = PCB.BOARD.w / 2 + 60;
  app.cams.pcb.y = PCB.BOARD.h / 2;
}

function downloadBlob(text, filename) {
  const blob = new Blob([text], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

function hideTooltip() { tooltipEl.style.display = 'none'; }

/* 高对比自定义光标 (深色图形+白色光晕, 浅色/深色背景均清晰) */
const CURSORS = (() => {
  const mk = (svg, hx, hy, fb) =>
    'url("data:image/svg+xml;utf8,' + encodeURIComponent(svg) + '") ' + hx + ' ' + hy + ', ' + fb;
  const cross = mk(
    '<svg xmlns="http://www.w3.org/2000/svg" width="25" height="25">' +
    '<g stroke-linecap="round">' +
    '<path d="M12.5 2v6M12.5 17v6M2 12.5h6M17 12.5h6" stroke="#fff" stroke-width="5.5"/>' +
    '<path d="M12.5 2v6M12.5 17v6M2 12.5h6M17 12.5h6" stroke="#0277bd" stroke-width="2.4"/>' +
    '</g><circle cx="12.5" cy="12.5" r="1.8" fill="#d32f2f" stroke="#fff" stroke-width="1.2"/></svg>',
    12, 12, 'crosshair');
  // 圆圈 (抓取): 白色光晕圆环 + 中心圆点; 悬停=灰色, 拖动中=蓝色; 热点在圆心
  const ringSvg = (ring, dot) =>
    '<svg xmlns="http://www.w3.org/2000/svg" width="25" height="25">' +
    '<circle cx="12.5" cy="12.5" r="7.6" fill="none" stroke="#ffffff" stroke-width="6.4"/>' +
    '<circle cx="12.5" cy="12.5" r="7.6" fill="none" stroke="' + ring + '" stroke-width="2.8"/>' +
    '<circle cx="12.5" cy="12.5" r="2.7" fill="' + dot + '" stroke="#ffffff" stroke-width="1.1"/>' +
    '</svg>';
  const grab = mk(ringSvg('#607d8b', '#90a4ae'), 12, 12, 'grab');
  const grabbig = mk(ringSvg('#0277bd', '#0277bd'), 12, 12, 'grabbing');
  const pointer = mk(
    '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24">' +
    '<path d="M5 2l14 10.5-6.2.8 3.4 6.8-3 1.5-3.4-6.8L5 19.6z" ' +
    'fill="#1f2937" stroke="#fff" stroke-width="1.8" stroke-linejoin="round"/></svg>',
    4, 2, 'pointer');
  return { cross, grab, grabbig, pointer, def: 'default' };
})();
// 左侧栏元件项: 同样的高对比手掌光标 (悬停=张开, 按下=抓住)
(function () {
  const st = document.createElement('style');
  st.textContent = '.lib-item{cursor:' + CURSORS.grab + '} .lib-item:active{cursor:' + CURSORS.grabbig + '}';
  document.head.appendChild(st);
})();

/* ================= 面包板模式 ================= */

function applyBB() {
  const wires = BB.deriveWires(sim, app.bb.jumpers);
  sim.setWiresRaw(wires);
  app.bb.netInfo = BB.computeNets(sim, app.bb.jumpers);
  bbUpdatePower();
}

/** 供电检查: DIP 需 VCC/GND 电源脚列接通电源轨, 未上电芯片由引擎强制输出 X */
function bbUpdatePower() {
  if (app.mode !== 'breadboard') return;
  let changed = false;
  for (const ch of sim.chips.values()) {
    const on = BB.chipPowered(app.bb.netInfo, ch);
    if (ch.powered !== on) changed = true;
    ch.powered = on;
  }
  if (changed) sim.reevalAll();
  updateStatus();
}

async function bbAutoAll(interactive) {
  if (interactive && app.bb.jumpers.length &&
      !(await Dialog.confirm({
        title: t('重新自动布线'),
        message: tf('重新自动布线将覆盖现有 {n} 根跳线, 继续?', { n: app.bb.jumpers.length }),
        okText: t('覆盖重布'),
      }))) return;
  pushUndo();
  BB.autoPlace(sim);
  const r = BB.autoWire(sim, app.schematicWires || []);
  r.jumpers.forEach(j => { j.id = app.bb.nextId++; });
  app.bb.jumpers = r.jumpers;
  app.bb.placed = true;
  applyBB();
  scheduleSave();
  toast(tf('已自动摆放并接线: {n} 根跳线', { n: r.jumpers.length }) +
        (r.warn ? tf(' (⚠ {n} 处孔位紧张)', { n: r.warn }) : ''));
}

/** 面包板孔位 → 网络电平值 */
function bbNetValue(holeKey) {
  const info = app.bb.netInfo;
  if (!info) return null;
  const idx = info.holeNet.get(holeKey);
  if (idx == null) return null;
  const pins = info.netPins[idx];
  if (!pins || !pins.length) return null;
  const p = pins[0].chip.pinByNum[pins[0].pinNum];
  return p ? sim.pinDisplay(p) : null;
}

/** 孔位所在网络的电源极性 (0 无 / 1 + / 2 − / 3 冲突) */
function bbHolePol(holeKey) {
  return BB.holeNetPower(app.bb.netInfo, holeKey);
}

/** 电源极性 → 孔位/跳线配色 (无极性用 dflt) */
function polColor(pol, dflt) {
  return pol === 1 ? '#d9534f' : pol === 2 ? '#4a90d9' : pol === 3 ? COL.vx : dflt;
}

function bbHoleAt(w) {
  const th = 8;
  const colOf = x => Math.round((x - BB.colX(1)) / BB.PITCH) + 1;
  for (let b = 0; b < BB.getBoards(); b++) {
    const oy = BB.boardY(b);
    for (const r of BB.RAILS) {
      if (Math.abs(w.y - (oy + r.y)) > th) continue;
      const c = colOf(w.x);
      if (c >= 1 && c <= BB.getCols() && Math.abs(w.x - BB.colX(c)) <= th) return b + ':' + r.id + '-' + c;
    }
    for (const row in BB.ROW_Y) {
      if (Math.abs(w.y - (oy + BB.ROW_Y[row])) > th) continue;
      const c = colOf(w.x);
      if (c >= 1 && c <= BB.getCols() && Math.abs(w.x - BB.colX(c)) <= th) return b + ':' + row + c;
    }
  }
  return null;
}

function bbChipAt(w) {
  const arr = Array.from(sim.chips.values()).filter(c => c.bb);
  for (let i = arr.length - 1; i >= 0; i--) {
    const r = BB.chipRect(arr[i]);
    if (r && w.x >= r.x && w.x <= r.x + r.w && w.y >= r.y && w.y <= r.y + r.h) return arr[i];
  }
  return null;
}

function bbJumperAt(w) {
  const th = 7;
  for (const j of app.bb.jumpers) {
    const a = BB.holePos(j.a), b = BB.holePos(j.b);
    if (!a || !b) continue;
    const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
    let nx = -(b.y - a.y), ny = b.x - a.x;
    const len = Math.hypot(nx, ny) || 1;
    nx /= len; ny /= len;
    if (ny > 0) { nx = -nx; ny = -ny; }
    const lift = Math.min(60, 14 + len * 0.18);
    const cx = mx + nx * lift, cy = my + ny * lift;
    for (let t = 0.05; t <= 1.0001; t += 0.05) {
      const mt = 1 - t;
      const x = mt * mt * a.x + 2 * mt * t * cx + t * t * b.x;
      const y = mt * mt * a.y + 2 * mt * t * cy + t * t * b.y;
      if (Math.hypot(x - w.x, y - w.y) < th) return j;
    }
  }
  return null;
}

/** 未放置元件托盘 (面包板/PCB 共用逻辑, 布局区域不同) */
function trayRects(mode) {
  const list = Array.from(sim.chips.values()).filter(c => mode === 'breadboard' ? !c.bb : !c.pcb);
  const x0 = mode === 'breadboard' ? BB.BOARD.x - 250 : PCB.BOARD.w + 12;
  return list.map((ch, i) => ({ ch, x: x0, y: 30 + i * 44, w: 215, h: 36 }));
}
function trayItemAt(w, mode) {
  for (const t of trayRects(mode))
    if (w.x >= t.x && w.x <= t.x + t.w && w.y >= t.y && w.y <= t.y + t.h) return t;
  return null;
}

/** 放置新元件到面包板 (按落点选择板号) */
function bbPlaceNew(ch, wx, wy) {
  const def = LIB[ch.type];
  const board = wy != null ? bbBoardAt(wy) : 0;
  if (ch.type === 'VCC' || ch.type === 'GND') {
    const rail = ch.type === 'VCC' ? 'R1' : 'R2';
    const occ = BB.occupancy(sim);
    let col = Math.max(2, Math.min(BB.getCols(), Math.round((wx - BB.colX(1)) / BB.PITCH) + 1));
    for (let d = 0; d < BB.getCols(); d++) {
      const cands = [col + d, col - d];
      let placed = false;
      for (const c of cands) {
        if (c < 2 || c > BB.getCols()) continue;
        const o = occ.get(board + ':' + rail + '-' + c);
        if (!o || o.chip === ch) { ch.bb = { kind: 'rail', board, rail, col: c }; placed = true; break; }
      }
      if (placed) break;
    }
  } else if (!def.custom) {
    const span = BB.dipSpan(ch);
    let col = Math.max(1, Math.min(BB.getCols() - span + 1,
      Math.round((wx - BB.colX(1)) / BB.PITCH) + 1 - Math.floor((span - 1) / 2)));
    for (let d = 0; d < BB.getCols(); d++) {
      if (col + d <= BB.getCols() - span + 1 && BB.dipColsFree(sim, ch, board, col + d, span)) { col += d; break; }
      if (col - d >= 1 && BB.dipColsFree(sim, ch, board, col - d, span)) { col -= d; break; }
    }
    ch.bb = { kind: 'dip', board, col, flip: false };
  } else {
    const n = BB.legCount(ch);
    let col = Math.max(1, Math.min(BB.getCols() - n + 1, Math.round((wx - BB.colX(1)) / BB.PITCH) + 1));
    const occ = BB.occupancy(sim);
    for (; col + n - 1 <= BB.getCols(); col++) {
      let ok = true;
      for (let i = 0; i < n; i++) {
        const o = occ.get(board + ':a' + (col + i));
        if (o && o.chip !== ch) { ok = false; break; }
      }
      if (ok) break;
    }
    ch.bb = { kind: 'row', board, row: 'a', col: Math.min(col, BB.getCols() - n + 1) };
  }
  applyBB();
}

function placeChipBB(type, wx, wy) {
  pushUndo();
  const idx = sim.chips.size;
  const ch = sim.addChip(type, 300 + (idx % 6) * 40, 300 + Math.floor(idx / 6) * 60);
  bbPlaceNew(ch, wx != null ? wx : BB.colX(Math.floor(BB.getCols() / 2)), wy);
  app.bb.placed = true;
  selectOnly('chip', ch.id);
  scheduleSave();
  toast(tf('已放置到面包板: {t}', { t: type }));
}

/** y 坐标 → 最近板号 */
function bbBoardAt(y) {
  const n = BB.getBoards();
  return Math.max(0, Math.min(n - 1, Math.round(y / (BB.BOARD_H + BB.BOARD_GAP))));
}

/** 拖动中实时更新面包板位置 (无效位置保持原状) */
function bbSetPos(ch, w) {
  const orig = ch.bb ? JSON.stringify(ch.bb) : null;
  const def = LIB[ch.type];
  const board = bbBoardAt(w.y);
  if (!def.custom) {
    const span = BB.dipSpan(ch);
    let col = Math.round((w.x - BB.colX(1)) / BB.PITCH) + 1 - Math.floor((span - 1) / 2);
    col = Math.max(1, Math.min(BB.getCols() - span + 1, col));
    if (BB.dipColsFree(sim, ch, board, col, span))
      ch.bb = { kind: 'dip', board, col, flip: (ch.bb && ch.bb.flip) || false };
  } else if (ch.type === 'VCC' || ch.type === 'GND') {
    let best = null, bd = Infinity;
    for (const r of BB.RAILS) {
      const d = Math.abs(w.y - (BB.boardY(board) + r.y));
      if (d < bd) { bd = d; best = r; }
    }
    let col = Math.max(1, Math.min(BB.getCols(), Math.round((w.x - BB.colX(1)) / BB.PITCH) + 1));
    const occ = BB.occupancy(sim);
    if (occ.get(board + ':' + best.id + '-' + col) && occ.get(board + ':' + best.id + '-' + col).chip !== ch) {
      // 目标孔被占: 尝试邻列
      for (let d = 1; d < 4; d++) {
        for (const c2 of [col + d, col - d]) {
          if (c2 < 1 || c2 > BB.getCols()) continue;
          const o = occ.get(board + ':' + best.id + '-' + c2);
          if (!o || o.chip === ch) { col = c2; d = 99; break; }
        }
      }
    }
    ch.bb = { kind: 'rail', board, rail: best.id, col };
  } else {
    const n = BB.legCount(ch);
    const oy = BB.boardY(board);
    // 按 y 距离排序行, 目标行被占用时尝试邻近行 (±2 行内找全空闲的行)
    const rows = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j'];
    const byDist = rows.slice().sort((r1, r2) =>
      Math.abs(oy + BB.ROW_Y[r1] - w.y) - Math.abs(oy + BB.ROW_Y[r2] - w.y));
    const target = byDist[0];
    let col = Math.max(1, Math.min(BB.getCols() - n + 1, Math.round((w.x - BB.colX(1)) / BB.PITCH) + 1));
    const occ = BB.occupancy(sim);
    const rowFree = rw => {
      for (let i = 0; i < n; i++) {
        const o = occ.get(board + ':' + rw + (col + i));
        if (o && o.chip !== ch) return false;
      }
      return true;
    };
    for (const rw of byDist) {
      if (Math.abs(rows.indexOf(rw) - rows.indexOf(target)) > 2) break;   // 只尝试邻近行
      if (rowFree(rw)) { ch.bb = { kind: 'row', board, row: rw, col }; break; }
    }
    // 邻近行全占用 → 保持原位
  }
  if (JSON.stringify(ch.bb) !== orig) applyBB();
}

function bbPointerDown(e) {
  const w = toWorld(e);
  try { canvas.setPointerCapture(e.pointerId); } catch (err) { }
  if (e.button === 1) { app.drag = { kind: 'pan', last: w }; return; }
  if (e.button !== 0) return;
  const tray = trayItemAt(w, 'breadboard');
  if (tray) {
    app.drag = { kind: 'bbTray', ch: tray.ch, start: w, moved: false };
    selectOnly('chip', tray.ch.id);
    return;
  }
  const ch = bbChipAt(w);
  if (ch) {
    if (!isSelected('chip', ch.id)) selectOnly('chip', ch.id);
    if (ch.type === 'SW' || ch.type === 'BTN' || ch.type === 'PS2') {
      app.drag = { kind: 'bbPress', ch, start: w, moved: false };
      if (ch.type === 'BTN') sim.driveNow(ch, 1, 1);
    } else if (ch.type === 'KB44') {
      const cell = kb44CellAtBB(ch, w);
      if (cell) {                                  // 盒内按住键位 = 接通行列
        app.drag = { kind: 'bbPress', ch, key: cell, start: w, moved: false };
        pushUndoLite();
        kb44Press(ch, cell.r, cell.c, true);
      } else {
        if (app.kbChip) setKbFocus(null);
        app.drag = { kind: 'bbMove', ch, start: w, moved: false };
      }
    } else {
      if (app.kbChip) setKbFocus(null);
      app.drag = { kind: 'bbMove', ch, start: w, moved: false };
    }
    return;
  }
  const h = bbHoleAt(w);
  if (h) {
    // 该孔只接一根跳线 → 拖动该跳线此端; 否则新建跳线
    const attached = app.bb.jumpers.filter(j => j.a === h || j.b === h);
    if (attached.length === 1) {
      app.bbWiring = { hole: h, cursor: w, moveJumper: attached[0], moveEndIsA: attached[0].a === h };
    } else {
      app.bbWiring = { hole: h, cursor: w };
    }
    return;
  }
  const j = bbJumperAt(w);
  if (j) { selectOnly('jumper', j.id); return; }
  clearSelection();   // 左键点击空白: 仅取消选择 (平移用右键/中键)
  if (app.kbChip) setKbFocus(null);
}

function bbPointerMove(e) {
  const w = toWorld(e);
  if (app.bbWiring) {
    app.bbWiring.cursor = w;
    app.hover = bbHoleAt(w) ? { kind: 'bbHole' } : null;
    canvas.style.cursor = CURSORS.cross;
    hideTooltip();
    return;
  }
  if (app.drag) {
    if (app.drag.kind === 'pan') {
      app.cam.x -= (w.x - app.drag.last.x);
      app.cam.y -= (w.y - app.drag.last.y);
      canvas.style.cursor = CURSORS.grabbig;
      return;
    }
    const dist = Math.hypot(w.x - app.drag.start.x, w.y - app.drag.start.y) * app.cam.zoom;
    if ((app.drag.kind === 'bbMove' || app.drag.kind === 'bbPress' || app.drag.kind === 'bbTray') && dist > 5 && !app.drag.moved) {
      app.drag.moved = true;
      pushUndo();
    }
    if (app.drag.moved) {
      if (app.drag.kind === 'bbPress' && app.drag.ch.type === 'BTN') sim.driveNow(app.drag.ch, 1, 0);
      if (app.drag.kind === 'bbPress' && app.drag.ch.type === 'KB44' && app.drag.key) {
        const k = app.drag.key;                    // 拖动 = 取消按压, 转为移动
        kb44Press(app.drag.ch, k.r, k.c, false);
        app.drag.key = null;
      }
      bbSetPos(app.drag.ch, w);
      canvas.style.cursor = CURSORS.grabbig;
    }
    return;
  }
  // 悬停提示
  const ch = bbChipAt(w);
  if (ch) { app.hover = { kind: 'chip', id: ch.id }; canvas.style.cursor = (ch.type === 'SW' || ch.type === 'BTN' || ch.type === 'PS2' || ch.type === 'KB44') ? CURSORS.pointer : CURSORS.grab; hideTooltip(); return; }
  const h = bbHoleAt(w);
  if (h) {
    app.hover = { kind: 'bbHole', hole: h };
    canvas.style.cursor = CURSORS.pointer;
    const ci = h.indexOf(':');
    const rest = h.slice(ci + 1);
    tooltipEl.textContent = rest[0] === 'R'
      ? tf('板{n} 电源轨 {r} 列{c}', { n: +h.slice(0, ci) + 1, r: rest.replace('-', ''), c: rest.replace(/[^-]+-/, '') })
      : tf('板{n} 孔位 {h} (同列5孔连通)', { n: +h.slice(0, ci) + 1, h: rest });
    tooltipEl.style.display = 'block';
    const p = BB.holePos(h);
    tooltipEl.style.left = ((p.x - app.cam.x) * app.cam.zoom + CW / 2 + 12) + 'px';
    tooltipEl.style.top = ((p.y - app.cam.y) * app.cam.zoom + CH / 2 - 10) + 'px';
    return;
  }
  const j = bbJumperAt(w);
  if (j) { app.hover = { kind: 'jumper', id: j.id }; canvas.style.cursor = CURSORS.pointer; hideTooltip(); return; }
  const tray = trayItemAt(w, 'breadboard');
  if (tray) { app.hover = { kind: 'chip', id: tray.ch.id }; canvas.style.cursor = CURSORS.grab; hideTooltip(); return; }
  app.hover = null;
  hideTooltip();
  canvas.style.cursor = CURSORS.def;
}

function bbPointerUp(e) {
  const w = toWorld(e);
  // 跳线: 松开在目标孔位上完成/移动跳线端, 其他位置取消
  if (app.bbWiring) {
    const h = bbHoleAt(w);
    if (app.bbWiring.moveJumper) {
      const j = app.bbWiring.moveJumper;
      const other = app.bbWiring.moveEndIsA ? j.b : j.a;
      if (h && h !== app.bbWiring.hole && h !== other) {
        pushUndo();
        if (app.bbWiring.moveEndIsA) j.a = h; else j.b = h;
        applyBB(); scheduleSave();
      }
      // 松开在空白/原孔 → 保持原跳线
    } else if (h && h !== app.bbWiring.hole) {
      pushUndo();
      app.bb.jumpers.push({ id: app.bb.nextId++, a: app.bbWiring.hole, b: h });
      applyBB(); scheduleSave();
    }
    app.bbWiring = null;
    return;
  }
  if (app.drag) {
    const d = app.drag;
    if (d.kind === 'bbPress' && !d.moved) {
      const ch = d.ch;
      if (ch.type === 'SW') { ch.state.on = ch.state.on ? 0 : 1; sim.driveNow(ch, 1, ch.state.on); }
      else if (ch.type === 'BTN') sim.driveNow(ch, 1, 0);
      else if (ch.type === 'PS2') setKbFocus(app.kbChip === ch ? null : ch);
      else if (ch.type === 'KB44' && d.key) {
        kb44Press(ch, d.key.r, d.key.c, false);    // 松开 = 断开行列
      }
    } else if (d.moved) {
      sim.touch(); scheduleSave();
    }
    app.drag = null;
  }
}

function bbContextMenu(e) {
  const w = toWorld(e);
  const tray = trayItemAt(w, 'breadboard');
  if (tray) {
    selectOnly('chip', tray.ch.id);
    showCtxMenu(e.clientX, e.clientY, [{ text: t('删除'), fn: () => deleteChip(tray.ch) }]);
    return;
  }
  const ch = bbChipAt(w);
  if (ch) {
    selectOnly('chip', ch.id);
    const items = [];
    if (!LIB[ch.type].custom) items.push({ text: t('翻转 180° (R)'), fn: () => bbFlip(ch) });
    if (ch.type === 'CLOCK') {
      items.push({ text: t('编辑频率…'), fn: () => editLabelOrFreq(ch) });
      items.push({ text: t('编辑标签…'), fn: () => editLabel(ch) });
    } else {
      items.push({ text: t('编辑标签…'), fn: () => editLabelOrFreq(ch) });
    }
    if (ch.type === 'PS2') items.push({ text: app.kbChip === ch ? t('退出打字 (Esc)') : t('聚焦打字…'), fn: () => setKbFocus(app.kbChip === ch ? null : ch) });
    if (ch.type === 'KB44') items.push({ text: tf('行脚空闲电平: {v} (点击切换)', { v: t(Number(ch.props.pull) ? '上拉 1' : '下拉 0') }), fn: () => { ch.props.pull = Number(ch.props.pull) ? 0 : 1; sim.evalChip(ch); sim.flush(); sim.touch(); scheduleSave(); } });
    items.push(...memoryMenuItems(ch));
    items.push(...ps2ScriptItems(ch));
    items.push({ text: t('移出面包板 (Del)'), fn: () => bbUnplace(ch) });
    items.push({ text: t('删除'), fn: () => deleteChip(ch) });
    showCtxMenu(e.clientX, e.clientY, items);
    return;
  }
  const j = bbJumperAt(w);
  if (j) {
    selectOnly('jumper', j.id);
    showCtxMenu(e.clientX, e.clientY, [{ text: t('删除跳线'), fn: () => bbDeleteJumper(j) }]);
    return;
  }
  showCtxMenu(e.clientX, e.clientY, [
    { text: t('✨ 自动布线 (从原理图)'), fn: () => bbAutoAll(true) },
    { text: t('⤢ 适配视图'), fn: fitBreadboard },
  ]);
}

function bbFlip(ch) {
  pushUndo();
  if (ch.bb && ch.bb.kind === 'dip') ch.bb.flip = !ch.bb.flip;
  applyBB(); scheduleSave();
}
function bbUnplace(ch) {
  pushUndo();
  ch.bb = null;
  applyBB(); scheduleSave();
  toast(t('已移出面包板 (元件仍保留在电路中)'));
}
function bbDeleteJumper(j) {
  pushUndo();
  app.bb.jumpers = app.bb.jumpers.filter(x => x.id !== j.id);
  applyBB(); scheduleSave();
}
function bbDeleteSelection() {
  let n = 0;
  for (const s of Array.from(app.selection)) {
    if (s.kind === 'chip') {
      const ch = sim.chips.get(s.id);
      if (ch) { if (!ch.bb) { deleteChip(ch); } else bbUnplace(ch); n++; }
    } else if (s.kind === 'jumper') {
      const j = app.bb.jumpers.find(x => x.id === s.id);
      if (j) { bbDeleteJumper(j); n++; }
    }
  }
  if (!n) toast(t('没有选中项'));
}
function bbRotateSelection() {
  for (const s of app.selection) {
    if (s.kind === 'chip') {
      const ch = sim.chips.get(s.id);
      if (ch && ch.bb && ch.bb.kind === 'dip') bbFlip(ch);
    }
  }
}

/* ---------- 存储器 (74187/74S472/74189/6116…): 十六进制内容编辑 / 快照 / 导入导出 ---------- */

function memToHex(mem) {
  const out = [];
  for (let r = 0; r < mem.length; r += 16) {
    out.push(Array.from(mem.slice(r, r + 16), b => (b & 0xFF).toString(16).padStart(2, '0').toUpperCase()).join(' '));
  }
  return out.join('\n');
}
/** 解析十六进制字节流 (容忍 0x 前缀/逗号/换行), 无效返回 null; 不足 size 补 00, 超出截断 */
function parseHexMem(s, size, mask) {
  const toks = String(s).replace(/0[xX]/g, '').split(/[\s,]+/).filter(t => t);
  if (!toks.length) return null;
  const bytes = [];
  for (const t of toks) {
    if (!/^[0-9a-fA-F]{1,2}$/.test(t)) return null;
    bytes.push(parseInt(t, 16) & mask);
  }
  const mem = new Array(size).fill(0);
  for (let i = 0; i < Math.min(bytes.length, size); i++) mem[i] = bytes[i];
  return mem;
}
function memCfg(ch) { return LIB[ch.type] && LIB[ch.type].mem; }
function memChipName(ch) {
  return ch.props.label ? ch.props.label : ch.type + '#' + ch.id;
}
function editMem(ch) {
  const m = memCfg(ch);
  Dialog.prompt({
    title: tf('{t} 内容 — {n} ({s}×{w})', { t: ch.type, n: memChipName(ch), s: m.size, w: m.mask >= 0xFF ? 8 : 4 }),
    label: t('每字节 2 位十六进制, 空格分隔 (每行 16 字节). 可直接粘贴导入, 不足部分补 00:'),
    value: memToHex(ch.props.mem || []),
    multiline: true,
    okText: t('写入'),
    validate: s => parseHexMem(s, m.size, m.mask) == null ? t('格式无效: 只允许十六进制字节 (00 ~ FF)') : null,
  }).then(s => {
    if (s == null) return;
    pushUndo();
    ch.props.mem = parseHexMem(s, m.size, m.mask);
    sim.touch();
    sim.reevalAll();   // 内容变化不经过引脚事件, 需重评估全部元件
    scheduleSave();
    toast(tf('{t} 内容已写入', { t: ch.type }));
  });
}
function memSnapshot(ch) {
  const hex = memToHex(ch.props.mem || []);
  Dialog.prompt({
    title: tf('{t} 快照 — {n}', { t: ch.type, n: memChipName(ch) }),
    message: tf('当前 {n} 字节内容 (已尝试复制到剪贴板):', { n: ch.props.mem.length }),
    value: hex, multiline: true, okText: t('关闭'),
  });
  if (navigator.clipboard) {
    navigator.clipboard.writeText(hex).then(() => toast(t('快照已复制到剪贴板'))).catch(() => { });
  }
}
function exportMem(ch) {
  const base = ch.props.label ? ch.props.label.replace(/[\\/:*?"<>|]+/g, '_') : ch.type + ch.id;
  const fn = base + '.' + ch.type.toLowerCase() + '.hex';
  downloadBlob(memToHex(ch.props.mem || []), fn);
  toast(tf('已导出 {f}', { f: fn }));
}
/** LCD1602: 编辑显示文本 / 清屏 */
function lcdLinesText(ch) {
  const dd = ch.state.ddram || [];
  const l1 = dd.slice(0, 16).join('').replace(/\s+$/, '');
  const l2 = dd.slice(0x40, 0x50).join('').replace(/\s+$/, '');
  return l1 + '\n' + l2;
}
function editLcdText(ch) {
  Dialog.prompt({
    title: tf('1602 显示文本 — {n}', { n: memChipName(ch) }),
    label: t('共 2 行, 每行最多 16 个字符 (支持中文):'),
    value: lcdLinesText(ch),
    multiline: true, rows: 4,
    okText: t('显示'),
    validate: s => {
      const ls = s.split('\n');
      if (ls.length > 2) return t('最多 2 行');
      if (ls.some(l => [...l].length > 16)) return t('每行最多 16 个字符');
      return null;
    },
  }).then(s => {
    if (s == null) return;
    pushUndo();
    const dd = new Array(80).fill(' ');
    const ls = s.split('\n');
    [...(ls[0] || '')].slice(0, 16).forEach((c, i) => { dd[i] = c; });
    [...(ls[1] || '')].slice(0, 16).forEach((c, i) => { dd[0x40 + i] = c; });
    ch.state.ddram = dd;
    ch.state.cur = 0;
    scheduleSave();
    toast(t('显示文本已更新'));
  });
}
function clearLcd(ch) {
  ch.state.ddram = new Array(80).fill(' ');
  ch.state.cur = 0;
  scheduleSave();
  toast(t('已清屏'));
}
/** LCD12864: 编辑显示文本 / 清屏 / 清除图形 */
function editLcd12864Text(ch) {
  const dd = ch.state.ddram;
  const lines = [0, 1, 2, 3].map(r => dd.slice(r * 16, r * 16 + 16).join('').replace(/\s+$/, ''));
  Dialog.prompt({
    title: tf('12864 显示文本 — {n}', { n: memChipName(ch) }),
    label: t('共 4 行, 每行最多 16 个字符 (支持中文):'),
    value: lines.join('\n'),
    multiline: true, rows: 7,
    okText: t('显示'),
    validate: s => {
      const ls = s.split('\n');
      if (ls.length > 4) return t('最多 4 行');
      if (ls.some(l => [...l].length > 16)) return t('每行最多 16 个字符');
      return null;
    },
  }).then(s => {
    if (s == null) return;
    pushUndo();
    dd.fill(' ');
    s.split('\n').slice(0, 4).forEach((l, r) => { [...l].slice(0, 16).forEach((c, i) => { dd[r * 16 + i] = c; }); });
    scheduleSave();
    toast(t('显示文本已更新'));
  });
}
function clearLcd12864Gfx(ch) {
  ch.state.gdram.fill(0);
  scheduleSave();
  toast(t('图形层已清除'));
}
/** 导出/复制 LCD 可见文字 (1602: 2 行, 12864: 4 行) */
function lcdVisibleText(ch) {
  const rows = ch.type === 'LCD12864' ? 4 : 2;
  const dd = ch.state.ddram || [];
  const out = [];
  for (let r = 0; r < rows; r++) out.push(dd.slice(r * 16, r * 16 + 16).join('').replace(/\s+$/g, ''));
  return out.join(String.fromCharCode(10));
}
function copyLcdText(ch) {
  const text = lcdVisibleText(ch);
  const fallback = () => Dialog.prompt({
    title: '屏幕文字 — ' + memChipName(ch),
    label: '当前屏幕内容 (手动复制):',
    value: text, multiline: true, rows: 4, okText: '关闭',
  });
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(() => toast('屏幕文字已复制到剪贴板')).catch(fallback);
  } else fallback();
}
function exportLcdText(ch) {
  const base = ch.props.label ? ch.props.label.replace(/[\\/:*?'<>|]+/g, '_') : ch.type + ch.id;
  const fn = base + '.' + ch.type.toLowerCase() + '.txt';
  downloadBlob(lcdVisibleText(ch), fn);
  toast('已导出 ' + fn);
}

/** 右键菜单追加项: 存储器 (按 mem 配置识别) 与 LCD1602 */
function memoryMenuItems(ch) {
  if (ch.type === 'LCD12864') return [
    { text: t('复制屏幕文字'), fn: () => copyLcdText(ch) },
    { text: t('导出屏幕文字 (.txt)'), fn: () => exportLcdText(ch) },
    { text: t('编辑显示文本…'), fn: () => editLcd12864Text(ch) },
    { text: t('清屏'), fn: () => { pushUndo(); ch.state.ddram.fill(' '); ch.state.gdram.fill(0); sim.touch(); sim.reevalAll(); scheduleSave(); toast(t('已清屏')); } },
    { text: t('清除图形'), fn: () => clearLcd12864Gfx(ch) },
  ];
  if (ch.type === 'LCD1602') return [
    { text: t('复制屏幕文字'), fn: () => copyLcdText(ch) },
    { text: t('导出屏幕文字 (.txt)'), fn: () => exportLcdText(ch) },
    { text: t('编辑显示文本…'), fn: () => editLcdText(ch) },
    { text: t('清屏'), fn: () => clearLcd(ch) },
  ];
  const m = memCfg(ch);
  if (!m) return [];
  if (m.kind === 'rom') return [
    { text: t('编辑内容 (十六进制)…'), fn: () => editMem(ch) },
    { text: t('导出内容 (十六进制文件)'), fn: () => exportMem(ch) },
  ];
  return [
    { text: t('获取快照 (十六进制)…'), fn: () => memSnapshot(ch) },
    { text: t('导出快照 (十六进制文件)'), fn: () => exportMem(ch) },
  ];
}

function editLabelOrFreq(ch) {
  if (ch.type === 'CLOCK' || ch.type === 'NE555') {
    const is555 = ch.type === 'NE555';
    Dialog.prompt({
      title: t(is555 ? '振荡频率 — NE555 (由 R/C 决定)' : '时钟频率 — CLOCK'),
      label: t('频率 (Hz, 0.1 ~ 20000):'),
      value: String(ch.props.freq || 2),
      validate: s => {
        const f = parseFloat(s);
        return (isNaN(f) || f < 0.1 || f > 20000) ? t('请输入 0.1 ~ 20000 之间的数字') : null;
      },
    }).then(s => {
      if (s == null) return;
      const f = parseFloat(s);
      ch.props.freq = f;
      if (!is555) ch.state.nextT = sim.simTime + sim.clockHalf(ch);
      sim.touch(); scheduleSave();
      toast(tf(is555 ? 'NE555 振荡频率已设为 {n} Hz' : '时钟已设为 {n} Hz', { n: f }));
    });
  } else {
    editLabel(ch);
  }
}

/* 时钟频率显示格式: 0.1Hz / 2Hz / 1.5kHz / 20kHz */
function fmtFreq(f) {
  if (f >= 1000) {
    const k = Math.round(f / 1000 * 100) / 100;
    return k + 'kHz';
  }
  return f + 'Hz';
}

/* ---------- 面包板绘制 ---------- */

function drawBreadboard(z) {
  const B = BB;
  const cols = B.getCols();
  for (let b = 0; b < B.getBoards(); b++) {
    const oy = B.boardY(b);
    // 板体
    ctx.fillStyle = '#d9d3bd';
    rr(B.BOARD.x, oy + B.BOARD.y, B.BOARD.w, B.BOARD.h, 10);
    ctx.fill();
    ctx.strokeStyle = '#aaa488';
    ctx.lineWidth = 2;
    ctx.stroke();
    if (B.getBoards() > 1) {
      ctx.fillStyle = '#8b8570';
      ctx.font = 'bold 10px Consolas, monospace';
      ctx.textAlign = 'left'; ctx.textBaseline = 'top';
      ctx.fillText('BOARD ' + (b + 1), B.BOARD.x + 6, oy + B.BOARD.y + 3);
    }
    // 中央沟道 (加宽: DIP 机体上下加宽后仍嵌入槽位)
    ctx.fillStyle = '#c4bda2';
    rr(B.colX(1) - 10, oy + B.CHANNEL_Y - 14, B.colX(cols) - B.colX(1) + 20, 28, 8);
    ctx.fill();
    // 电源轨
    ctx.font = 'bold 11px Consolas, monospace';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    for (const r of B.RAILS) {
      ctx.strokeStyle = r.color;
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.moveTo(B.colX(1) - 8, oy + r.y);
      ctx.lineTo(B.colX(cols) + 8, oy + r.y);
      ctx.stroke();
      ctx.fillStyle = r.color;
      ctx.fillText(r.label, B.colX(1) - 20, oy + r.y);
    }
    // 行标
    ctx.font = '8px Consolas, monospace';
    ctx.fillStyle = '#8b8570';
    for (const row in B.ROW_Y) ctx.fillText(row, B.colX(1) - 20, oy + B.ROW_Y[row]);
    // 列号 (每5列)
    ctx.font = '7px Consolas, monospace';
    ctx.fillStyle = '#8b8570';
    for (let c = 5; c <= cols; c += 5) {
      ctx.fillText(String(c), B.colX(c), oy + B.ROW_Y.a - 12);
      ctx.fillText(String(c), B.colX(c), oy + B.ROW_Y.j + 12);
    }
    // 孔位 (有电平按电平着色; 无电平但属电源网络按极性着色: 红=+ 蓝=− 橙=+−冲突)
    for (const row of B.ROWS_TOP.concat(B.ROWS_BOT)) {
      for (let c = 1; c <= cols; c++) {
        const key = b + ':' + row + c;
        const p = B.holePos(key);
        const v = bbNetValue(key);
        const pol = bbHolePol(key);
        ctx.beginPath();
        ctx.arc(p.x, p.y, 3.2, 0, Math.PI * 2);
        ctx.fillStyle = v != null ? valColor(v) : polColor(pol, '#3a3f45');
        ctx.fill();
        if (v != null || pol) { ctx.strokeStyle = '#1a1d20'; ctx.lineWidth = 1; ctx.stroke(); }
      }
    }
    for (const r of B.RAILS) {
      for (let c = 1; c <= cols; c++) {
        const key = b + ':' + r.id + '-' + c;
        const p = B.holePos(key);
        const v = bbNetValue(key);
        const pol = bbHolePol(key);
        ctx.beginPath();
        ctx.arc(p.x, p.y, 3.4, 0, Math.PI * 2);
        ctx.fillStyle = v != null ? valColor(v) : polColor(pol, '#3a3f45');
        ctx.fill();
        if (v == null && !pol) { ctx.strokeStyle = r.color + '60'; ctx.lineWidth = 1; ctx.stroke(); }
      }
    }
  }
  // 元件 (先画, 跳线在其上)
  const chips = Array.from(sim.chips.values());
  for (const ch of chips) {
    if (!ch.bb) continue;
    drawBBChip(ch, z);
  }
  // 跳线 (绘制在元件之上)
  const movingJumper = app.bbWiring && app.bbWiring.moveJumper;
  for (const j of app.bb.jumpers) {
    if (j === movingJumper) continue;   // 拖动端点的跳线在预览中绘制
    const a = B.holePos(j.a), b = B.holePos(j.b);
    if (!a || !b) continue;
    const sel = isSelected('jumper', j.id);
    const hov = app.hover && app.hover.kind === 'jumper' && app.hover.id === j.id;
    const v = bbNetValue(j.a);
    const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
    let nx = -(b.y - a.y), ny = b.x - a.x;
    const len = Math.hypot(nx, ny) || 1;
    nx /= len; ny /= len;
    if (ny > 0) { nx = -nx; ny = -ny; }
    const lift = Math.min(60, 14 + len * 0.18);
    const cx = mx + nx * lift, cy = my + ny * lift;
    if (sel || hov) {
      ctx.strokeStyle = sel ? 'rgba(79,195,247,.5)' : 'rgba(255,255,255,.25)';
      ctx.lineWidth = 6;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.quadraticCurveTo(cx, cy, b.x, b.y);
      ctx.stroke();
    }
    ctx.strokeStyle = v != null ? valColor(v) : polColor(bbHolePol(j.a), '#9aa4b0');
    ctx.lineWidth = 2.6;
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.quadraticCurveTo(cx, cy, b.x, b.y);
    ctx.stroke();
    for (const p of [a, b]) {
      ctx.beginPath();
      ctx.arc(p.x, p.y, 2.6, 0, Math.PI * 2);
      ctx.fillStyle = '#e8eef7';
      ctx.fill();
    }
  }
  // 跳线预览 (移动端时从固定端画起)
  if (app.bbWiring) {
    const srcKey = app.bbWiring.moveJumper
      ? (app.bbWiring.moveEndIsA ? app.bbWiring.moveJumper.b : app.bbWiring.moveJumper.a)
      : app.bbWiring.hole;
    const a = B.holePos(srcKey);
    const cur = app.bbWiring.cursor || a;
    if (a) {
      ctx.strokeStyle = COL.sel;
      ctx.lineWidth = 1.8;
      ctx.setLineDash([6, 5]);
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.quadraticCurveTo((a.x + cur.x) / 2, Math.min(a.y, cur.y) - 40, cur.x, cur.y);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.arc(a.x, a.y, 7, 0, Math.PI * 2);
      ctx.strokeStyle = COL.sel;
      ctx.stroke();
    }
  }
  // 托盘
  drawTray('breadboard', z);
}

function drawBBChip(ch, z) {
  const B = BB;
  const def = LIB[ch.type];
  const rect = B.chipRect(ch);
  if (!rect) return;
  const sel = isSelected('chip', ch.id);
  const hov = app.hover && app.hover.kind === 'chip' && app.hover.id === ch.id;

  if (ch.bb.kind === 'dip') {
    // 机体盖住 e/f 两排, 引脚号印在机体内部 (贴近对应孔位一侧)
    ctx.fillStyle = '#2b3138';
    rr(rect.x, rect.y, rect.w, rect.h, 5);
    ctx.fill();
    ctx.strokeStyle = sel ? COL.sel : (hov ? '#7c8b9c' : '#454e59');
    ctx.lineWidth = sel ? 1.8 : 1.2;
    ctx.stroke();
    // 1脚缺口 (左端半圆)
    ctx.beginPath();
    ctx.arc(rect.x + 1, rect.y + rect.h / 2, 6, -Math.PI / 2, Math.PI / 2);
    ctx.fillStyle = '#d9d3bd';
    ctx.fill();
    ctx.fillStyle = '#e6eef8';
    ctx.font = 'bold 11px Consolas, monospace';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(def.type, rect.x + rect.w / 2, rect.y + 19);
    // 未供电徽标
    if (ch.powered === false) {
      ctx.fillStyle = '#e53935';
      rr(rect.x + rect.w - 34, rect.y + 4, 30, 12, 3);
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 8px "Segoe UI","Microsoft YaHei",sans-serif';
      ctx.fillText(t('未供电'), rect.x + rect.w - 19, rect.y + 10);
    }
    if (rect.w > 70) {
      ctx.fillStyle = '#8ba0b6';
      ctx.font = '7.5px "Segoe UI","Microsoft YaHei",sans-serif';
      ctx.fillText(t(def.desc), rect.x + rect.w / 2, rect.y + 33);
    }
    // 引脚号 (印入机体, 贴近各自孔位一侧)
    if (z >= 0.8) {
      ctx.font = '7px Consolas, monospace';
      ctx.fillStyle = '#9fb2c5';
      for (const p of ch.pins) {
        const h = B.pinHole(ch, p.num);
        if (!h) continue;
        const hp = B.holePos(h);
        if (!hp) continue;
        ctx.fillText(String(p.num), hp.x, hp.row === 'e' ? rect.y + 7 : rect.y + rect.h - 7);
      }
    }
  } else if (ch.bb.kind === 'row') {
    // IO 模块: 窄盒 (端部一个孔宽, 单脚元件近方形); 上半区盒在孔上方, 下半区盒在孔下方
    const lower = B.ROWS_BOT.includes(ch.bb.row);
    const legs = B.rowLegs(ch);
    const bh = legs.length === 1 ? B.ROW_IO_W : 26;
    const boxY = lower ? rect.y + 8 : rect.y;
    const legEnd = lower ? boxY : rect.y + bh;   // 腿靠盒一端
    ctx.fillStyle = '#242c36';
    rr(rect.x, boxY, rect.w, bh, 5);
    ctx.fill();
    ctx.strokeStyle = sel ? COL.sel : (hov ? '#7c8b9c' : '#454e59');
    ctx.lineWidth = sel ? 1.8 : 1.2;
    ctx.stroke();
    // 引脚腿 (有源虚拟元件两端的隐式电源腿按极性着色)
    ctx.lineWidth = 1.4;
    for (const l of legs) {
      const hp = B.holePos(l.hole);
      if (!hp) continue;
      ctx.strokeStyle = l.pol === 1 ? '#d9534f' : l.pol === 2 ? '#4a90d9' : '#8ba0b6';
      ctx.beginPath(); ctx.moveTo(hp.x, hp.y); ctx.lineTo(hp.x, legEnd); ctx.stroke();
    }
    drawIOGlyph(ch, rect.x + rect.w / 2, boxY + bh / 2);
    // 未供电徽标 (有源虚拟元件: CLOCK/PS2)
    let badge = false;
    if (ch.powered === false) {
      badge = true;
      const bx = rect.x + rect.w / 2, by = lower ? boxY + bh + 9 : boxY - 9;
      ctx.font = 'bold 8px "Segoe UI","Microsoft YaHei",sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.lineWidth = 3;
      ctx.strokeStyle = 'rgba(255,255,255,.9)';
      ctx.strokeText(t('⚡未供电'), bx, by);
      ctx.fillStyle = '#e53935';
      ctx.fillText(t('⚡未供电'), bx, by);
    }
    // 标识 (盒外侧, 带描边; 关闭时悬停显示)
    if (ch.props.label && ch.type !== 'SEG7' && (app.bbLabels || (app.hover && app.hover.kind === 'chip' && app.hover.id === ch.id))) {
      const lx = rect.x + rect.w / 2;
      const ly = lower ? boxY + bh + (badge ? 19 : 9) : boxY - (badge ? 19 : 9);
      ctx.font = 'bold 8px Consolas, monospace';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.lineWidth = 3;
      ctx.strokeStyle = 'rgba(255,255,255,.9)';
      ctx.strokeText(ch.props.label, lx, ly);
      ctx.fillStyle = COL.label;
      ctx.fillText(ch.props.label, lx, ly);
    }
    // 打字聚焦指示 (虚线外框)
    if (app.kbChip === ch) {
      ctx.setLineDash([4, 3]);
      ctx.strokeStyle = COL.sel; ctx.lineWidth = 1.6;
      rr(rect.x - 3, boxY - 3, rect.w + 6, bh + 6, 6);
      ctx.stroke();
      ctx.setLineDash([]);
    }
  } else {
    // 电源轨上的 VCC/GND (一个孔宽)
    const p = B.holePos((ch.bb.board || 0) + ':' + ch.bb.rail + '-' + ch.bb.col);
    const top = ch.bb.rail === 'R1' || ch.bb.rail === 'R2';
    const boxY = top ? rect.y : rect.y + 6;
    ctx.strokeStyle = '#8ba0b6';
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(p.x, top ? rect.y + 18 : rect.y + 6);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
    ctx.fillStyle = '#242c36';
    rr(rect.x, boxY, rect.w, 18, 4);
    ctx.fill();
    ctx.strokeStyle = sel ? COL.sel : (ch.type === 'VCC' ? '#ff8a80' : '#8ba0b6');
    ctx.lineWidth = sel ? 1.8 : 1.4;
    ctx.stroke();
    ctx.fillStyle = ch.type === 'VCC' ? '#ff8a80' : '#8ba0b6';
    ctx.font = 'bold 8px Consolas, monospace';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(ch.type, rect.x + rect.w / 2, boxY + 9);
  }
}

/** IO 元件小图形 (SW/BTN/CLOCK/LED/SEG7/PROBE), 在面包板模块盒内绘制 */
function drawIOGlyph(ch, cx, cy) {
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  switch (ch.type) {
    case 'SW': {
      const on = !!ch.state.on;
      rr(cx - 7.5, cy - 4, 15, 8, 4);
      ctx.fillStyle = on ? 'rgba(46,230,107,.3)' : '#171d24';
      ctx.fill();
      ctx.strokeStyle = on ? COL.v1 : '#46545f';
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(on ? cx + 3.5 : cx - 3.5, cy, 2.8, 0, Math.PI * 2);
      ctx.fillStyle = on ? COL.v1 : '#8a97a5';
      ctx.fill();
      break;
    }
    case 'BTN': {
      const on = ch.pins[0].driven === 1;
      ctx.beginPath(); ctx.arc(cx, cy, 6, 0, Math.PI * 2);
      ctx.strokeStyle = on ? COL.v1 : '#46545f'; ctx.lineWidth = 1.2; ctx.stroke();
      ctx.beginPath(); ctx.arc(cx, cy, 2.6, 0, Math.PI * 2);
      ctx.fillStyle = on ? COL.v1 : '#a8b4c0'; ctx.fill();
      break;
    }
    case 'CLOCK': {
      const ph = ch.state.phase ? 1 : 0;
      ctx.strokeStyle = ph ? COL.v1 : '#0288d1';
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(cx - 8, cy - 3); ctx.lineTo(cx - 5, cy - 3); ctx.lineTo(cx - 5, cy - 8);
      ctx.lineTo(cx - 1, cy - 8); ctx.lineTo(cx - 1, cy - 3); ctx.lineTo(cx + 3, cy - 3);
      ctx.lineTo(cx + 3, cy - 8); ctx.lineTo(cx + 7, cy - 8); ctx.lineTo(cx + 7, cy - 3);
      ctx.lineTo(cx + 9, cy - 3);
      ctx.stroke();
      ctx.fillStyle = '#a9c3dc';
      ctx.font = 'bold 7px Consolas, monospace';
      ctx.fillText(fmtFreq(ch.props.freq || 2), cx, cy + 4);
      break;
    }
    case 'LED': {
      const v = pinValue(ch.pins[0]);
      const on = v === 1;
      if (on) { ctx.shadowColor = '#ff3b3b'; ctx.shadowBlur = 12; }
      ctx.beginPath(); ctx.arc(cx, cy, 5.5, 0, Math.PI * 2);
      ctx.fillStyle = on ? '#ff4d4d' : '#3a2226';
      ctx.fill();
      ctx.shadowBlur = 0;
      break;
    }
    case 'SEG7': {
      // 迷你七段数码管 (读取 a~g 引脚电平)
      const vals = ch.pins.map(p => pinValue(p) === 1);
      const l = cx - 8, t = cy - 11, dw = 16, dh = 22;
      const segs = {
        a: [l + 2, t, l + dw - 2, t],
        b: [l + dw, t + 2, l + dw, t + dh / 2 - 2],
        c: [l + dw, t + dh / 2 + 2, l + dw, t + dh - 2],
        d: [l + 2, t + dh, l + dw - 2, t + dh],
        e: [l, t + dh / 2 + 2, l, t + dh - 2],
        f: [l, t + 2, l, t + dh / 2 - 2],
        g: [l + 2, t + dh / 2, l + dw - 2, t + dh / 2],
      };
      ctx.lineCap = 'round';
      ctx.lineWidth = 3;
      ['a', 'b', 'c', 'd', 'e', 'f', 'g'].forEach((nm, i) => {
        const [x1, y1, x2, y2] = segs[nm];
        ctx.strokeStyle = vals[i] ? '#ff4d4d' : '#3b2126';
        ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
      });
      break;
    }
    case 'PROBE': {
      const v = pinValue(ch.pins[0]);
      ctx.font = 'bold 10px Consolas, monospace';
      ctx.fillStyle = valColor(v);
      ctx.fillText(v === 'Z' ? 'Z' : String(v), cx, cy);
      break;
    }
    case 'LCD12864': {
      // 迷你图形屏: 蓝底 + 两层内容示意
      ctx.fillStyle = '#0d47a1';
      rr(cx - 12, cy - 10, 24, 20, 2); ctx.fill();
      ctx.font = '5px Consolas, monospace';
      ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
      ctx.fillStyle = '#9fc9f5';
      const dd = ch.state.ddram || [];
      for (let row = 0; row < 4; row++) {
        let t = '';
        for (let c = 0; c < 16; c++) t += dd[row * 16 + c] || ' ';
        ctx.fillText(t.slice(0, 14), cx - 11, cy - 6 + row * 4.4);
      }
      ctx.fillStyle = '#6ea8e8';
      const g = ch.state.gdram || [];
      for (let k = 0; k < 16; k++) {          // 顶/底边框点示意
        if (g[k] & 0x80) ctx.fillRect(cx - 11 + k * 1.5, cy - 9.5, 1.5, 1);
        if (g[1008 + k] & 0x80) ctx.fillRect(cx - 11 + k * 1.5, cy + 8.5, 1.5, 1);
      }
      break;
    }
    case 'PS2': {
      // 迷你键盘 (发送中描边变绿)
      const on = !!(ch._ps2 && ch._ps2.active);
      ctx.fillStyle = '#e8edf3';
      rr(cx - 8, cy - 5, 16, 10, 2); ctx.fill();
      ctx.strokeStyle = on ? COL.v1 : '#46545f'; ctx.lineWidth = 1; ctx.stroke();
      ctx.fillStyle = '#8a97a5';
      for (let r2 = 0; r2 < 3; r2++) for (let c = 0; c < 5; c++)
        ctx.fillRect(cx - 6.5 + c * 2.8, cy - 3.5 + r2 * 2.8, 2, 2);
      break;
    }
    case 'KB44': {
      // 迷你 4×4 键阵 (按住的键亮绿)
      const keys = ch.state.keys || {};
      for (let r2 = 0; r2 < 4; r2++) for (let c = 0; c < 4; c++) {
        const on = !!keys[r2 + ',' + c];
        ctx.fillStyle = on ? COL.v1 : (r2 + c) % 2 ? '#46545f' : '#3a454f';
        ctx.fillRect(cx - 7 + c * 4, cy - 7 + r2 * 4, 3, 3);
      }
      break;
    }
    default:
      ctx.fillStyle = '#43566a';
      ctx.font = '8px Consolas, monospace';
      ctx.fillText(ch.type, cx, cy);
  }
}

function drawTray(mode, z) {
  const items = trayRects(mode);
  if (!items.length) return;
  ctx.font = '10.5px "Segoe UI","Microsoft YaHei",sans-serif';
  ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
  for (const t of items) {
    const def = LIB[t.ch.type];
    const sel = isSelected('chip', t.ch.id);
    ctx.fillStyle = '#ffffff';
    rr(t.x, t.y, t.w, t.h, 6);
    ctx.fill();
    ctx.strokeStyle = sel ? COL.sel : '#c3cdd7';
    ctx.lineWidth = sel ? 1.6 : 1;
    ctx.stroke();
    ctx.fillStyle = '#1f2937';
    ctx.font = 'bold 11px Consolas, monospace';
    ctx.fillText(def.type, t.x + 10, t.y + t.h / 2);
    ctx.fillStyle = '#6b7a8c';
    ctx.font = '9.5px "Segoe UI","Microsoft YaHei",sans-serif';
    ctx.fillText(I18N.t(def.desc), t.x + 62, t.y + t.h / 2);
  }
  ctx.fillStyle = '#6b7a8c';
  ctx.font = '10px "Segoe UI","Microsoft YaHei",sans-serif';
  ctx.fillText(tf('未放置元件 (拖到{t}上)', { t: t(mode === 'breadboard' ? '面包板' : 'PCB') }), items[0].x, 12);
}

/* ================= PCB 模式 ================= */

function placeChipPCB(type, wx, wy) {
  pushUndo();
  const idx = sim.chips.size;
  const ch = sim.addChip(type, 300 + (idx % 6) * 40, 300 + Math.floor(idx / 6) * 60);
  ch.pcb = { x: Math.round((wx != null ? wx : 50) * 2) / 2, y: Math.round((wy != null ? wy : 40) * 2) / 2, rot: 0 };
  selectOnly('chip', ch.id);
  scheduleSave();
  toast(tf('已放置封装: {t}', { t: type }));
}

function pcbChipAt(w) {
  const arr = Array.from(sim.chips.values()).filter(c => c.pcb);
  for (let i = arr.length - 1; i >= 0; i--) {
    const r = PCB.chipRect(arr[i]);
    if (r && w.x >= r.x && w.x <= r.x + r.w && w.y >= r.y && w.y <= r.y + r.h) return arr[i];
  }
  return null;
}

const PCB_SNAP = 1.27;
function pcbPointerDown(e) {
  const w = toWorld(e);
  try { canvas.setPointerCapture(e.pointerId); } catch (err) { }
  if (e.button === 1) { app.drag = { kind: 'pan', last: w }; return; }
  if (e.button !== 0) return;
  const tray = trayItemAt(w, 'pcb');
  if (tray) {
    app.drag = { kind: 'pcbTray', ch: tray.ch, start: w, moved: false };
    selectOnly('chip', tray.ch.id);
    return;
  }
  const ch = pcbChipAt(w);
  if (ch) {
    if (!isSelected('chip', ch.id)) selectOnly('chip', ch.id);
    app.drag = { kind: 'pcbMove', ch, start: w, moved: false };
    return;
  }
  clearSelection();   // 左键点击空白: 仅取消选择 (平移用右键/中键)
}

function pcbPointerMove(e) {
  const w = toWorld(e);
  if (app.drag) {
    if (app.drag.kind === 'pan') {
      app.cam.x -= (w.x - app.drag.last.x);
      app.cam.y -= (w.y - app.drag.last.y);
      canvas.style.cursor = CURSORS.grabbig;
      return;
    }
    const dist = Math.hypot(w.x - app.drag.start.x, w.y - app.drag.start.y) * app.cam.zoom;
    if ((app.drag.kind === 'pcbMove' || app.drag.kind === 'pcbTray') && dist > 3 && !app.drag.moved) {
      app.drag.moved = true;
      pushUndo();
    }
    if (app.drag.moved) {
      const ch = app.drag.ch;
      const fp = PCB.footprint(ch.type);
      const x = Math.max(3, Math.min(PCB.BOARD.w - 3, w.x));
      const y = Math.max(3, Math.min(PCB.BOARD.h - 3, w.y));
      ch.pcb = {
        x: Math.round(x / PCB_SNAP) * PCB_SNAP,
        y: Math.round(y / PCB_SNAP) * PCB_SNAP,
        rot: (ch.pcb && ch.pcb.rot) || 0,
      };
      canvas.style.cursor = CURSORS.grabbig;
    }
    return;
  }
  const ch = pcbChipAt(w);
  if (ch) { app.hover = { kind: 'chip', id: ch.id }; canvas.style.cursor = CURSORS.grab; return; }
  const tray = trayItemAt(w, 'pcb');
  if (tray) { app.hover = { kind: 'chip', id: tray.ch.id }; canvas.style.cursor = CURSORS.grab; return; }
  app.hover = null;
  canvas.style.cursor = CURSORS.def;
}

function pcbPointerUp(e) {
  if (app.drag) {
    if (app.drag.moved) { sim.touch(); scheduleSave(); }
    app.drag = null;
  }
}

function pcbContextMenu(e) {
  const w = toWorld(e);
  const tray = trayItemAt(w, 'pcb');
  if (tray) {
    selectOnly('chip', tray.ch.id);
    showCtxMenu(e.clientX, e.clientY, [{ text: t('删除'), fn: () => deleteChip(tray.ch) }]);
    return;
  }
  const ch = pcbChipAt(w);
  if (ch) {
    selectOnly('chip', ch.id);
    showCtxMenu(e.clientX, e.clientY, [
      { text: t('旋转 90° (R)'), fn: () => pcbRotate(ch) },
      ...(ch.type === 'CLOCK' ? [{ text: t('编辑频率…'), fn: () => editLabelOrFreq(ch) }] : []),
      { text: t('编辑标签…'), fn: () => editLabel(ch) },
      ...memoryMenuItems(ch),
      { text: t('移出PCB (Del)'), fn: () => pcbUnplace(ch) },
      { text: t('删除'), fn: () => deleteChip(ch) },
    ]);
    return;
  }
  showCtxMenu(e.clientX, e.clientY, [
    { text: t('📐 自动布局'), fn: () => { pushUndo(); PCB.autoPlace(sim); scheduleSave(); toast(t('已自动布局')); } },
    { text: t('⤢ 适配视图'), fn: fitPCB },
  ]);
}

function pcbRotate(ch) {
  pushUndo();
  if (ch.pcb) ch.pcb.rot = ((ch.pcb.rot || 0) + 90) % 360;
  scheduleSave();
}
function pcbUnplace(ch) {
  pushUndo();
  ch.pcb = null;
  scheduleSave();
  toast('已移出 PCB (元件仍保留在电路中)');
}
function pcbDeleteSelection() {
  let n = 0;
  for (const s of Array.from(app.selection)) {
    if (s.kind !== 'chip') continue;
    const ch = sim.chips.get(s.id);
    if (ch) { if (!ch.pcb) deleteChip(ch); else pcbUnplace(ch); n++; }
  }
  if (!n) toast(t('没有选中项'));
}
function pcbRotateSelection() {
  for (const s of app.selection) {
    if (s.kind === 'chip') {
      const ch = sim.chips.get(s.id);
      if (ch && ch.pcb) pcbRotate(ch);
    }
  }
}


/* ---------- PCB 绘制 ---------- */

function drawPCB(z) {
  const B = PCB.BOARD;
  // 板子
  ctx.fillStyle = '#0f5c38';
  rr(0, 0, B.w, B.h, 3);
  ctx.fill();
  ctx.strokeStyle = '#d8e8dd';
  ctx.lineWidth = 0.25;
  ctx.stroke();
  // 网格
  if (z >= 4) {
    ctx.fillStyle = 'rgba(255,255,255,.16)';
    const s = 1.27;
    for (let x = s; x < B.w; x += s)
      for (let y = s; y < B.h; y += s)
        ctx.fillRect(x - 0.04, y - 0.04, 0.08, 0.08);
  }
  // 元件丝印/位号 (先画, 飞线在其上)
  for (const ch of sim.chips.values()) {
    if (ch.pcb) drawPCBChipPart(ch, false);
  }
  // 飞线 (绘制在封装之上)
  const rn = PCB.ratsnest(sim);
  for (const e of rn) {
    const pa = e.a.chip.pcb ? PCB.padPos(e.a.chip, e.a.pinNum) : null;
    const pb = e.b.chip.pcb ? PCB.padPos(e.b.chip, e.b.pinNum) : null;
    if (!pa || !pb) continue;
    const pinA = e.a.chip.pinByNum[e.a.pinNum];
    const v = pinA ? sim.pinDisplay(pinA) : null;
    ctx.strokeStyle = v == null ? 'rgba(255,171,64,.4)' :
      (v === 1 ? 'rgba(46,230,107,.75)' : v === 0 ? 'rgba(120,140,160,.5)' : 'rgba(255,171,64,.6)');
    ctx.lineWidth = 0.14;
    ctx.setLineDash([0.8, 0.6]);
    ctx.beginPath();
    ctx.moveTo(pa.x, pa.y);
    ctx.lineTo(pb.x, pb.y);
    ctx.stroke();
    ctx.setLineDash([]);
  }
  // 焊盘 (最上层)
  for (const ch of sim.chips.values()) {
    if (ch.pcb) drawPCBChipPart(ch, true);
  }
  drawTray('pcb', z);
}

/** PCB 元件分两遍绘制: pass=false 丝印外框+位号; pass=true 焊盘 */
function drawPCBChipPart(ch, padsPass) {
  const rect = PCB.chipRect(ch);
  const sel = isSelected('chip', ch.id);
  const hov = app.hover && app.hover.kind === 'chip' && app.hover.id === ch.id;
  if (!padsPass) {
    // 丝印外框
    ctx.strokeStyle = sel ? '#4fc3f7' : (hov ? '#ffffff' : 'rgba(255,255,255,.8)');
    ctx.lineWidth = sel ? 0.35 : 0.2;
    ctx.strokeRect(rect.x, rect.y, rect.w, rect.h);
    // 位号
    const isIC = !LIB[ch.type].custom;
    const refNum = ch.id;
    ctx.fillStyle = 'rgba(255,255,255,.85)';
    ctx.font = 'bold 2px Consolas, monospace';
    ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
    ctx.fillText((isIC ? 'U' : 'P') + refNum + ' ' + ch.type, rect.x + rect.w / 2, rect.y - 0.4);
    return;
  }
  // 焊盘
  let first = true;
  for (const p of ch.pins) {
    const pos = PCB.padPos(ch, p.num);
    if (!pos) continue;
    ctx.beginPath();
    if (first) {
      ctx.rect(pos.x - 0.85, pos.y - 0.85, 1.7, 1.7);
    } else {
      ctx.arc(pos.x, pos.y, 0.95, 0, Math.PI * 2);
    }
    ctx.fillStyle = '#d9b45c';
    ctx.fill();
    ctx.strokeStyle = '#8a6d33';
    ctx.lineWidth = 0.08;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(pos.x, pos.y, 0.42, 0, Math.PI * 2);
    ctx.fillStyle = '#1c2126';
    ctx.fill();
    first = false;
  }
}



window.addEventListener('error', e => toast(tf('脚本错误: {m}', { m: e.message }), 'err'));

// 调试/自动化句柄
window._74vm = { sim, app, fitView, LIB, draw, switchMode, applyBB,
  hit: { pinAt, chipAt, wireAt, pinWorld, wireEnds, bezierPts } };

window.addEventListener('beforeunload', () => doSave(true));

buildLib('');
applyLang();   // 应用持久化的界面语言 (标题/搜索框/帮助/菜单栏)
syncRun();

(function boot() {
  let data = null;
  try { data = JSON.parse(localStorage.getItem(LS_KEY)); } catch (e) { /* 忽略 */ }
  if (data && Array.isArray(data.chips) && data.chips.length) {
    restoreSave(data);
    if (!(data.view && data.view.cams)) fitView();   // 有保存的视图则不重新适配
    toast(t('已恢复上次的电路 (文件菜单可新建)'));
  } else {
    loadExample(window.EXAMPLES[0]);
    fitView();
    toast(t('欢迎使用 74VM — 点击左上角 ❓ 查看帮助'));
  }
  sim.setRunning(true);
  syncRun();
})();

requestAnimationFrame(frame);

})();