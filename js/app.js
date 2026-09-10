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
  dnd: null,   // 原生拖放状态 {type, x, y}
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
    if (def.custom) drawIO(ch, def, z);
    else drawDIP(ch, def, z);
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
  const half = chipHalf(ch);
  const hov = app.hover && app.hover.kind === 'chip' && app.hover.id === ch.id;
  ctx.fillStyle = COL.body;
  rr(ch.x - half.x, ch.y - half.y, half.x * 2, half.y * 2, 6);
  ctx.fill();
  ctx.strokeStyle = isSelected('chip', ch.id) ? COL.sel : (hov ? '#5f7386' : COL.bodyBorder);
  ctx.lineWidth = isSelected('chip', ch.id) ? 1.6 : 1;
  ctx.stroke();

  ctx.fillStyle = COL.head;
  ctx.font = 'bold 13px Consolas, monospace';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(def.type, ch.x, ch.y - 8);
  ctx.fillStyle = COL.sub;
  ctx.font = '10px "Segoe UI","Microsoft YaHei",sans-serif';
  ctx.fillText(def.desc, ch.x, ch.y + 9);
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
  const { w, h } = chipSize(def);
  ctx.save();
  ctx.translate(ch.x, ch.y);
  if (ch.rot) ctx.rotate(ch.rot * Math.PI / 180);
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
      ctx.fillText('开关', 0, half.y - 9);
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
      ctx.fillText('按住', 0, half.y - 9);
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
      ctx.fillText((ch.props.freq || 2) + ' Hz', 0, half.y - 9);
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
      ctx.fillText('探针', 0, half.y - 9);
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
  ctx.restore();
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
      ctx.fillText(def.desc, gx, gy + h / 2 + 9);
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
    ctx.fillText(def.desc, gx, gy + 8);
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
  app.undoStack.push(JSON.stringify(buildSave()));
  if (app.undoStack.length > 60) app.undoStack.shift();
  app.redoStack.length = 0;
  syncSchematicWires();
  scheduleSave();
}
function undo() {
  if (!app.undoStack.length) { toast('没有可撤销的操作'); return; }
  app.redoStack.push(JSON.stringify(buildSave()));
  restoreSave(JSON.parse(app.undoStack.pop()));
  scheduleSave();
}
function redo() {
  if (!app.redoStack.length) { toast('没有可重做的操作'); return; }
  app.undoStack.push(JSON.stringify(buildSave()));
  restoreSave(JSON.parse(app.redoStack.pop()));
  scheduleSave();
}

/* ================= 保存快照 (原理图网表 + 面包板/PCB 布局) ================= */

function buildSave() {
  return {
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
}

function restoreSave(data) {
  if (!data || !Array.isArray(data.chips)) return;
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
      if (bb.col + Math.max(1, ch.pins.length) - 1 > cols) ch.bb = null;
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
    if (!silent) toast('已保存到浏览器');
  } catch (e) { if (!silent) toast('保存失败: ' + e.message, 'err'); }
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
    if (ch.type === 'SW' || ch.type === 'BTN') {
      app.drag = { kind: 'press', ch, start: w, moved: false,
        offs: chips.map(c => ({ c, dx: c.x - w.x, dy: c.y - w.y })) };
      if (ch.type === 'BTN') sim.driveNow(ch, 1, 1); // 按下
    } else {
      app.drag = { kind: 'move', start: w, moved: false,
        offs: chips.map(c => ({ c, dx: c.x - w.x, dy: c.y - w.y })) };
    }
    return;
  }

  const wI = wireAt(w);
  if (wI) { selectOnly('wire', wI.id); return; }

  clearSelection();   // 左键点击空白: 仅取消选择 (平移用右键/中键拖动)
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
    const dirTxt = pinHit.pin.dir === 'in' ? '输入' : pinHit.pin.dir === 'out' ? '输出' : '双向';
    tooltipEl.textContent = `${def.type} · 引脚${def.hideNums ? '' : ' ' + pinHit.pin.num} ${pinHit.pin.name} (${dirTxt})`;
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
    canvas.style.cursor = (ch.type === 'SW' || ch.type === 'BTN') ? CURSORS.pointer : CURSORS.grab;
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
  if (sim.wireExists(a.ch, a.pin.num, hit.ch, hit.pin.num)) { toast('这两点已连接'); return; }
  pushUndo();
  const nw = sim.addWire(a.ch, a.pin.num, hit.ch, hit.pin.num);
  if (nw) toast('已连接 ' + LIB[a.ch.type].type + '.' + a.pin.name + ' ↔ ' + LIB[hit.ch.type].type + '.' + hit.pin.name);
}

canvas.addEventListener('wheel', e => {
  e.preventDefault();
  const r = canvas.getBoundingClientRect();
  const sx = e.clientX - r.left, sy = e.clientY - r.top;
  const wx = (sx - r.width / 2) / app.cam.zoom + app.cam.x;
  const wy = (sy - r.height / 2) / app.cam.zoom + app.cam.y;
  const f = e.deltaY < 0 ? 1.12 : 1 / 1.12;
  app.cam.zoom = Math.min(2.5, Math.max(0.25, app.cam.zoom * f));
  // 保持鼠标下的点不动
  app.cam.x = wx - (sx - r.width / 2) / app.cam.zoom;
  app.cam.y = wy - (sy - r.height / 2) / app.cam.zoom;
}, { passive: false });

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
    if (!LIB[ch.type].fixedRot) items.push({ text: '旋转 90° (R)', fn: () => rotateChip(ch) });
    items.push({ text: ch.type === 'CLOCK' ? '编辑频率…' : '编辑标签…', fn: () => editLabelOrFreq(ch) });
    items.push({ text: '复制 (Ctrl+D)', fn: () => duplicateSelection() });
    items.push({ text: '删除 (Del)', fn: () => deleteChip(ch) });
    showCtxMenu(e.clientX, e.clientY, items);
    selectOnly('chip', ch.id);
    return;
  }
  const wI = wireAt(w);
  if (wI) {
    showCtxMenu(e.clientX, e.clientY, [{ text: '删除导线', fn: () => deleteWire(wI) }]);
    selectOnly('wire', wI.id);
    return;
  }
  showCtxMenu(e.clientX, e.clientY, [
    { text: '⤢ 适配视图', fn: fitView },
    { text: '❓ 帮助', fn: () => showModal(true) },
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
    title: '编辑标签 — ' + ch.type,
    label: '元件标签 (留空清除):',
    value: ch.props.label || '',
    placeholder: '例如 CLK / ~RESET',
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
    .map(s => sim.chips.get(s.id)).filter(c => c && !LIB[c.type].fixedRot);
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

window.addEventListener('keydown', e => {
  const t = e.target;
  if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT')) return;
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

/* ================= 元件库侧栏 ================= */

const CAT_ORDER = ['输入/输出', '门电路', '组合逻辑', '触发器/锁存', '计数/移位', '总线接口'];
function buildLib(filter) {
  const libEl = document.getElementById('lib');
  libEl.innerHTML = '';
  const f = (filter || '').trim().toLowerCase();
  for (const cat of CAT_ORDER) {
    const items = Object.values(LIB).filter(d => d.cat === cat &&
      (!f || d.type.toLowerCase().includes(f) || d.desc.toLowerCase().includes(f) || String(d.type).includes(f)));
    if (!items.length) continue;
    const h = document.createElement('div');
    h.className = 'lib-cat';
    h.textContent = cat;
    libEl.appendChild(h);
    for (const d of items) {
      const el = document.createElement('div');
      el.className = 'lib-item';
      el.innerHTML = `<b>${d.type}</b><span>${d.desc}</span>`;
      el.title = d.desc + ' — 点击或拖拽放置';
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
  toast('已放置 ' + type + ' (' + LIB[type].desc + ')');
}

document.getElementById('search').addEventListener('input', e => buildLib(e.target.value));

/* ================= Windows 风格多级菜单栏 ================= */

function toggleRun() { sim.setRunning(!sim.running); syncRun(); }
function syncRun() {
  const st = document.getElementById('stState');
  st.textContent = sim.running ? '● 运行中' : '‖ 已暂停';
  st.className = sim.running ? 'ok' : 'paused';
  Menus.refresh();
}
function setSpeed(v) { app.speed = v; Menus.refresh(); }
function simStep() {
  const n = sim.stepClocks();
  if (!n) toast('没有时钟源 — 已处理待定事件');
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
    title: '新建画布',
    message: '清空当前电路? (可用 Ctrl+Z 撤销)',
    okText: '清空', danger: true,
  }))) return;
  pushUndo();
  restoreSave({ chips: [], wires: [] });
  doSave(true);
  toast('已清空');
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

/* ---------- 面包板动作 ---------- */
function bbActAuto() { bbAutoAll(true); Menus.refresh(); }
function bbActPlace() {
  pushUndo(); BB.autoPlace(sim); applyBB(); scheduleSave();
  toast('已重新摆放元件'); Menus.refresh();
}
function bbActClear() {
  if (!app.bb.jumpers.length) return;
  pushUndo(); app.bb.jumpers = []; applyBB(); scheduleSave();
  toast('已清空全部跳线'); Menus.refresh();
}
function bbActAddBoard() {
  if (BB.getBoards() >= 6) { toast('最多 6 块板'); return; }
  pushUndo();
  BB.setBoards(BB.getBoards() + 1);
  fitBreadboard(); app.cams.breadboard.fitted = true; scheduleSave();
  toast('已添加一块面包板 (共 ' + BB.getBoards() + ' 块)'); Menus.refresh();
}
function bbActDelBoard() {
  if (BB.getBoards() <= 1) { toast('至少保留 1 块板'); return; }
  pushUndo();
  const n0 = Array.from(sim.chips.values()).filter(c => c.bb).length;
  BB.setBoards(BB.getBoards() - 1);
  bbSanitize(); applyBB(); fitBreadboard(); app.cams.breadboard.fitted = true; scheduleSave();
  const rm = n0 - Array.from(sim.chips.values()).filter(c => c.bb).length;
  toast('已移除一块板 (剩 ' + BB.getBoards() + ' 块)' + (rm ? '，' + rm + ' 个元件移回托盘' : ''));
  Menus.refresh();
}
async function bbActCols() {
  const ok = await Dialog.prompt({
    title: '面包板列数',
    label: '列数 (20 ~ 240)。常见: 30 = 半尺寸, 60 = 全尺寸, 63 = 常见规格:',
    value: String(BB.getCols()),
    validate: s => {
      const n = parseInt(s, 10);
      return (isNaN(n) || n < 20 || n > 240) ? '请输入 20 ~ 240 之间的整数' : null;
    },
  });
  if (ok == null) return;
  const n = parseInt(ok, 10);
  if (isNaN(n) || n < 20 || n > 240) { toast('无效列数 (需 20~240)', 'err'); return; }
  pushUndo();
  const n0 = Array.from(sim.chips.values()).filter(c => c.bb).length;
  BB.setCols(n); bbSanitize(); applyBB();
  fitBreadboard(); app.cams.breadboard.fitted = true; scheduleSave();
  const rm = n0 - Array.from(sim.chips.values()).filter(c => c.bb).length;
  toast('面包板已设为 ' + BB.getCols() + ' 列' + (rm > 0 ? ' (⚠ ' + rm + ' 个超范围元件移回托盘)' : ''));
  Menus.refresh();
}
/* ---------- PCB 动作 ---------- */
function pcbActAuto() {
  pushUndo(); PCB.autoPlace(sim); scheduleSave();
  toast('已自动布局'); Menus.refresh();
}
async function pcbActExport() {
  const unplaced = Array.from(sim.chips.values()).filter(c => !c.pcb);
  if (unplaced.length && !(await Dialog.confirm({
    title: '导出立创EDA PCB',
    message: unplaced.length + ' 个元件尚未布局, 导出将忽略它们. 继续?',
    okText: '导出',
  }))) return;
  const r = EasyEDAExport.buildEasyEDA(sim, PCB);
  downloadBlob(r.json, '74vm-pcb-easyeda.json');
  toast('已导出立创EDA PCB — 在立创EDA(标准版) 文件→导入→EasyEDA 打开, 焊盘带网络可直接自动布线');
}
function pcbActNetlist() {
  downloadBlob(JSON.stringify(EasyEDAExport.buildNetlist(sim, PCB), null, 2), '74vm-netlist.json');
  toast('已导出网表 JSON');
}

/* ---------- 菜单栏 ---------- */
const Menus = {
  el: null, openIdx: -1,
  def() {
    const bb = () => app.mode === 'breadboard';
    const pcb = () => app.mode === 'pcb';
    return [
      { label: '文件(F)', items: [
        { label: '新建画布', act: fileNew },
        { sep: true },
        { label: '导入 JSON…', act: fileImportPick },
        { label: '导出 JSON…', act: fileExportJSON },
        { label: '保存到浏览器', act: () => { doSave(); Menus.refresh(); } },
        { sep: true },
        { label: '示例电路', sub: window.EXAMPLES.map(ex => ({
          label: ex.name, hint: ex.desc, act: () => { loadExample(ex); Menus.refresh(); },
        })) },
      ]},
      { label: '编辑(E)', items: [
        { label: '撤销', hint: 'Ctrl+Z', act: () => { undo(); Menus.refresh(); }, enabled: () => app.undoStack.length > 0 },
        { label: '重做', hint: 'Ctrl+Y', act: () => { redo(); Menus.refresh(); }, enabled: () => app.redoStack.length > 0 },
        { sep: true },
        { label: '旋转选中', hint: 'R', act: rotateDispatch },
        { label: '复制选中', hint: 'Ctrl+D', act: () => duplicateSelection() },
        { label: '删除选中', hint: 'Del', act: deleteDispatch },
      ]},
      { label: '视图(V)', items: [
        { label: '适配视图', act: fitDispatch },
        { label: '元件库', hint: '侧栏', radio: 'lib', act: toggleLib },
        { sep: true },
        { label: '原理图模式', hint: '1', radio: 'mode', val: 'schematic', act: () => switchMode('schematic') },
        { label: '面包板模式', hint: '2', radio: 'mode', val: 'breadboard', act: () => switchMode('breadboard') },
        { label: 'PCB 模式', hint: '3', radio: 'mode', val: 'pcb', act: () => switchMode('pcb') },
      ]},
      { label: '仿真(S)', items: [
        { label: () => (sim.running ? '暂停' : '运行'), hint: '空格', act: toggleRun },
        { label: '时钟步进', hint: '半周期', act: simStep },
        { sep: true },
        { label: '速度 ×1', radio: 'speed', val: 1, act: () => setSpeed(1) },
        { label: '速度 ×10', radio: 'speed', val: 10, act: () => setSpeed(10) },
        { label: '速度 ×100', radio: 'speed', val: 100, act: () => setSpeed(100) },
        { label: '速度 ×1000', radio: 'speed', val: 1000, act: () => setSpeed(1000) },
      ]},
      { label: '工具(T)', items: [
        { label: '面包板', sub: [
          { label: '✨ 自动布线 (从原理图)', act: bbActAuto, enabled: bb },
          { label: '重新摆放元件', act: bbActPlace, enabled: bb },
          { label: '清空全部跳线', act: bbActClear, enabled: () => app.mode === 'breadboard' && app.bb.jumpers.length > 0 },
          { sep: true },
          { label: '添加一块板子', act: bbActAddBoard, enabled: () => app.mode === 'breadboard' && BB.getBoards() < 6 },
          { label: '移除一块板子', act: bbActDelBoard, enabled: () => app.mode === 'breadboard' && BB.getBoards() > 1 },
          { label: '设置列数…', act: bbActCols, enabled: bb },
        ]},
        { label: 'PCB', sub: [
          { label: '自动布局', act: pcbActAuto, enabled: pcb },
          { label: '导出立创EDA PCB…', act: pcbActExport, enabled: pcb },
          { label: '导出网表 JSON…', act: pcbActNetlist, enabled: pcb },
        ]},
      ]},
      { label: '帮助(H)', items: [
        { label: '❓ 使用帮助', act: () => showModal(true) },
      ]},
    ];
  },
  radioChecked(it) {
    if (it.radio === 'mode') return app.mode === it.val;
    if (it.radio === 'speed') return app.speed === it.val;
    if (it.radio === 'lib') return app.libShown;
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
  toast('已加载示例: ' + ex.name);
}

/* 文件导入 (fileImportPick 触发) */
document.getElementById('fileImport').addEventListener('change', e => {
  const f = e.target.files && e.target.files[0];
  if (!f) return;
  const rd = new FileReader();
  rd.onload = () => {
    try {
      const data = JSON.parse(rd.result);
      if (!data || !Array.isArray(data.chips)) throw new Error('格式不符');
      pushUndo();
      restoreSave(data);
      fitView();
      scheduleSave();
      toast('导入成功: ' + data.chips.length + ' 个元件');
    } catch (err) {
      toast('导入失败: ' + err.message, 'err');
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
    '元件 ' + sim.chips.size + ' · 导线 ' + sim.wires.length + ' · 事件 ' + fmtNum(sim.eventCount);
  document.getElementById('stZoom').textContent = '缩放 ' + Math.round(app.cam.zoom * 100) + '%';
  const warn = document.getElementById('stWarn');
  warn.textContent = sim.overload ? '⚠ 事件过载(电路可能振荡或规模过大)' : '';
  sim.overload = sim.overload && sim.q.size > 1000; // 队列排空后自动清除
}

function fmtNum(n) {
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
  if (prev === 'breadboard') sim.setWiresRaw(app.schematicWires || []);
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
    toast('面包板模式 — 按住孔位拖动拉跳线, ✨自动布线可从原理图生成接线');
  } else if (m === 'pcb') {
    let need = false;
    for (const ch of sim.chips.values()) if (!ch.pcb) need = true;
    if (need && sim.chips.size) { pushUndo(); PCB.autoPlace(sim); toast('已按原理图顺序自动布局封装'); }
    if (!app.cams.pcb.fitted) { fitPCB(); app.cams.pcb.fitted = true; }
    toast('PCB 模式 — 拖动/旋转封装, 📤 导出立创EDA 后可在其内自动布线');
  }
  updateStatus();
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
}

async function bbAutoAll(interactive) {
  if (interactive && app.bb.jumpers.length &&
      !(await Dialog.confirm({
        title: '重新自动布线',
        message: '重新自动布线将覆盖现有 ' + app.bb.jumpers.length + ' 根跳线, 继续?',
        okText: '覆盖重布',
      }))) return;
  pushUndo();
  BB.autoPlace(sim);
  const r = BB.autoWire(sim, app.schematicWires || []);
  r.jumpers.forEach(j => { j.id = app.bb.nextId++; });
  app.bb.jumpers = r.jumpers;
  app.bb.placed = true;
  applyBB();
  scheduleSave();
  toast('已自动摆放并接线: ' + r.jumpers.length + ' 根跳线' +
        (r.warn ? ' (⚠ ' + r.warn + ' 处孔位紧张)' : ''));
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
    const n = Math.max(1, ch.pins.length);
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
  toast('已放置到面包板: ' + type);
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
    const n = Math.max(1, ch.pins.length);
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
    if (ch.type === 'SW' || ch.type === 'BTN') {
      app.drag = { kind: 'bbPress', ch, start: w, moved: false };
      if (ch.type === 'BTN') sim.driveNow(ch, 1, 1);
    } else {
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
      bbSetPos(app.drag.ch, w);
      canvas.style.cursor = CURSORS.grabbig;
    }
    return;
  }
  // 悬停提示
  const ch = bbChipAt(w);
  if (ch) { app.hover = { kind: 'chip', id: ch.id }; canvas.style.cursor = (ch.type === 'SW' || ch.type === 'BTN') ? CURSORS.pointer : CURSORS.grab; hideTooltip(); return; }
  const h = bbHoleAt(w);
  if (h) {
    app.hover = { kind: 'bbHole', hole: h };
    canvas.style.cursor = CURSORS.pointer;
    const ci = h.indexOf(':');
    const rest = h.slice(ci + 1);
    tooltipEl.textContent = rest[0] === 'R'
      ? ('板' + (+h.slice(0, ci) + 1) + ' 电源轨 ' + rest.replace('-', ' 列'))
      : ('板' + (+h.slice(0, ci) + 1) + ' 孔位 ' + rest + ' (同列5孔连通)');
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
    } else if (d.moved) {
      sim.touch(); scheduleSave();
    }
    app.drag = null;
  }
}

function bbContextMenu(e) {
  const w = toWorld(e);
  const ch = bbChipAt(w);
  if (ch) {
    selectOnly('chip', ch.id);
    const items = [];
    if (!LIB[ch.type].custom) items.push({ text: '翻转 180° (R)', fn: () => bbFlip(ch) });
    items.push({ text: '编辑标签…', fn: () => editLabelOrFreq(ch) });
    items.push({ text: '移出面包板 (Del)', fn: () => bbUnplace(ch) });
    items.push({ text: '彻底删除元件', fn: () => deleteChip(ch) });
    showCtxMenu(e.clientX, e.clientY, items);
    return;
  }
  const j = bbJumperAt(w);
  if (j) {
    selectOnly('jumper', j.id);
    showCtxMenu(e.clientX, e.clientY, [{ text: '删除跳线', fn: () => bbDeleteJumper(j) }]);
    return;
  }
  showCtxMenu(e.clientX, e.clientY, [
    { text: '✨ 自动布线 (从原理图)', fn: () => bbAutoAll(true) },
    { text: '⤢ 适配视图', fn: fitBreadboard },
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
  toast('已移出面包板 (元件仍保留在电路中)');
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
  if (!n) toast('没有选中项');
}
function bbRotateSelection() {
  for (const s of app.selection) {
    if (s.kind === 'chip') {
      const ch = sim.chips.get(s.id);
      if (ch && ch.bb && ch.bb.kind === 'dip') bbFlip(ch);
    }
  }
}

function editLabelOrFreq(ch) {
  if (ch.type === 'CLOCK') {
    Dialog.prompt({
      title: '时钟频率 — CLOCK',
      label: '时钟频率 (Hz, 0.1 ~ 20000):',
      value: String(ch.props.freq || 2),
      validate: s => {
        const f = parseFloat(s);
        return (isNaN(f) || f < 0.1 || f > 20000) ? '请输入 0.1 ~ 20000 之间的数字' : null;
      },
    }).then(s => {
      if (s == null) return;
      const f = parseFloat(s);
      ch.props.freq = f;
      ch.state.nextT = sim.simTime + sim.clockHalf(ch);
      sim.touch(); scheduleSave();
      toast('时钟已设为 ' + f + ' Hz');
    });
  } else {
    editLabel(ch);
  }
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
    // 中央沟道
    ctx.fillStyle = '#c4bda2';
    rr(B.colX(1) - 10, oy + B.CHANNEL_Y - 7, B.colX(cols) - B.colX(1) + 20, 14, 4);
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
    // 孔位
    for (const row of B.ROWS_TOP.concat(B.ROWS_BOT)) {
      for (let c = 1; c <= cols; c++) {
        const key = b + ':' + row + c;
        const p = B.holePos(key);
        const v = bbNetValue(key);
        ctx.beginPath();
        ctx.arc(p.x, p.y, 3.2, 0, Math.PI * 2);
        ctx.fillStyle = v == null ? '#3a3f45' : valColor(v);
        ctx.fill();
        if (v != null) { ctx.strokeStyle = '#1a1d20'; ctx.lineWidth = 1; ctx.stroke(); }
      }
    }
    for (const r of B.RAILS) {
      for (let c = 1; c <= cols; c++) {
        const key = b + ':' + r.id + '-' + c;
        const p = B.holePos(key);
        const v = bbNetValue(key);
        ctx.beginPath();
        ctx.arc(p.x, p.y, 3.4, 0, Math.PI * 2);
        ctx.fillStyle = v == null ? '#3a3f45' : valColor(v);
        ctx.fill();
        if (v == null) { ctx.strokeStyle = r.color + '60'; ctx.lineWidth = 1; ctx.stroke(); }
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
    ctx.strokeStyle = v == null ? '#9aa4b0' : valColor(v);
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
    ctx.fillStyle = '#2b3138';
    rr(rect.x, rect.y, rect.w, rect.h, 5);
    ctx.fill();
    ctx.strokeStyle = sel ? COL.sel : (hov ? '#7c8b9c' : '#454e59');
    ctx.lineWidth = sel ? 1.8 : 1.2;
    ctx.stroke();
    // 1脚缺口 (左端半圆)
    ctx.beginPath();
    ctx.arc(rect.x + 1, B.CHANNEL_Y, 6, -Math.PI / 2, Math.PI / 2);
    ctx.fillStyle = '#d9d3bd';
    ctx.fill();
    ctx.fillStyle = '#e6eef8';
    ctx.font = 'bold 12px Consolas, monospace';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(def.type, rect.x + rect.w / 2, B.CHANNEL_Y - 8);
    ctx.fillStyle = '#8ba0b6';
    ctx.font = '8.5px "Segoe UI","Microsoft YaHei",sans-serif';
    ctx.fillText(def.desc, rect.x + rect.w / 2, B.CHANNEL_Y + 8);
    // 引脚号
    if (z >= 0.8) {
      ctx.font = '6.5px Consolas, monospace';
      ctx.fillStyle = '#6d7885';
      for (const p of ch.pins) {
        const h = B.pinHole(ch, p.num);
        if (!h) continue;
        const hp = B.holePos(h);
        if (!hp) continue;
        ctx.fillText(String(p.num), hp.x, hp.row === 'e' ? hp.y - 8 : hp.y + 8);
      }
    }
  } else if (ch.bb.kind === 'row') {
    // IO 模块: 上半区盒在孔上方; 下半区(f-j)盒在孔下方, 腿朝上连孔
    const lower = B.ROWS_BOT.includes(ch.bb.row);
    const boxY = lower ? rect.y + 18 : rect.y;
    const legEnd = lower ? boxY : rect.y + 26;   // 腿靠盒一端
    ctx.fillStyle = '#242c36';
    rr(rect.x, boxY, rect.w, 26, 5);
    ctx.fill();
    ctx.strokeStyle = sel ? COL.sel : (hov ? '#7c8b9c' : '#454e59');
    ctx.lineWidth = sel ? 1.8 : 1.2;
    ctx.stroke();
    // 引脚腿
    ctx.strokeStyle = '#8ba0b6';
    ctx.lineWidth = 1.4;
    for (const p of ch.pins) {
      const h = B.pinHole(ch, p.num);
      const hp = B.holePos(h);
      if (hp) { ctx.beginPath(); ctx.moveTo(hp.x, hp.y); ctx.lineTo(hp.x, legEnd); ctx.stroke(); }
    }
    drawIOGlyph(ch, rect.x + rect.w / 2, boxY + 13);
  } else {
    // 电源轨上的 VCC/GND
    const p = B.holePos((ch.bb.board || 0) + ':' + ch.bb.rail + '-' + ch.bb.col);
    const top = ch.bb.rail === 'R1' || ch.bb.rail === 'R2';
    const boxY = top ? rect.y + 2 : rect.y + 10;
    ctx.strokeStyle = '#8ba0b6';
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(p.x, top ? boxY + 18 : rect.y + 2);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
    ctx.fillStyle = '#242c36';
    rr(rect.x, boxY, rect.w, 18, 4);
    ctx.fill();
    ctx.strokeStyle = sel ? COL.sel : (ch.type === 'VCC' ? '#ff8a80' : '#8ba0b6');
    ctx.lineWidth = sel ? 1.8 : 1.4;
    ctx.stroke();
    ctx.fillStyle = ch.type === 'VCC' ? '#ff8a80' : '#8ba0b6';
    ctx.font = 'bold 9px Consolas, monospace';
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
      rr(cx - 13, cy - 5, 26, 10, 5);
      ctx.fillStyle = on ? 'rgba(46,230,107,.3)' : '#171d24';
      ctx.fill();
      ctx.strokeStyle = on ? COL.v1 : '#46545f';
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(on ? cx + 7 : cx - 7, cy, 4, 0, Math.PI * 2);
      ctx.fillStyle = on ? COL.v1 : '#8a97a5';
      ctx.fill();
      break;
    }
    case 'BTN': {
      const on = ch.pins[0].driven === 1;
      ctx.beginPath(); ctx.arc(cx, cy, 8, 0, Math.PI * 2);
      ctx.strokeStyle = on ? COL.v1 : '#46545f'; ctx.lineWidth = 1.4; ctx.stroke();
      ctx.beginPath(); ctx.arc(cx, cy, 3.5, 0, Math.PI * 2);
      ctx.fillStyle = on ? COL.v1 : '#a8b4c0'; ctx.fill();
      break;
    }
    case 'CLOCK': {
      const ph = ch.state.phase ? 1 : 0;
      ctx.strokeStyle = ph ? COL.v1 : '#0288d1';
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.moveTo(cx - 14, cy - 4); ctx.lineTo(cx - 9, cy - 4); ctx.lineTo(cx - 9, cy - 8);
      ctx.lineTo(cx - 2, cy - 8); ctx.lineTo(cx - 2, cy - 4); ctx.lineTo(cx + 5, cy - 4);
      ctx.lineTo(cx + 5, cy - 8); ctx.lineTo(cx + 12, cy - 8); ctx.lineTo(cx + 12, cy - 4);
      ctx.lineTo(cx + 15, cy - 4);
      ctx.stroke();
      ctx.fillStyle = '#43566a';
      ctx.font = '6.5px Consolas, monospace';
      ctx.fillText((ch.props.freq || 2) + 'Hz', cx, cy + 6);
      break;
    }
    case 'LED': {
      const v = pinValue(ch.pins[0]);
      const on = v === 1;
      if (on) { ctx.shadowColor = '#ff3b3b'; ctx.shadowBlur = 12; }
      ctx.beginPath(); ctx.arc(cx, cy, 7, 0, Math.PI * 2);
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
      ctx.font = 'bold 11px Consolas, monospace';
      ctx.fillStyle = valColor(v);
      ctx.fillText(v === 'Z' ? 'Z' : String(v), cx, cy);
      break;
    }
    default:
      ctx.fillStyle = '#43566a';
      ctx.font = '9px Consolas, monospace';
      ctx.fillText(ch.type, cx, cy);
  }
  if (ch.props.label && ch.type !== 'SEG7') {
    ctx.font = '7.5px Consolas, monospace';
    ctx.fillStyle = COL.label;
    ctx.fillText(ch.props.label, cx, cy + 15);
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
    ctx.fillText(def.desc, t.x + 62, t.y + t.h / 2);
  }
  ctx.fillStyle = '#6b7a8c';
  ctx.font = '10px "Segoe UI","Microsoft YaHei",sans-serif';
  ctx.fillText('未放置元件 (拖到' + (mode === 'breadboard' ? '面包板' : 'PCB') + '上)', items[0].x, 12);
}

/* ================= PCB 模式 ================= */

function placeChipPCB(type, wx, wy) {
  pushUndo();
  const idx = sim.chips.size;
  const ch = sim.addChip(type, 300 + (idx % 6) * 40, 300 + Math.floor(idx / 6) * 60);
  ch.pcb = { x: Math.round((wx != null ? wx : 50) * 2) / 2, y: Math.round((wy != null ? wy : 40) * 2) / 2, rot: 0 };
  selectOnly('chip', ch.id);
  scheduleSave();
  toast('已放置封装: ' + type);
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
  const ch = pcbChipAt(w);
  if (ch) {
    selectOnly('chip', ch.id);
    showCtxMenu(e.clientX, e.clientY, [
      { text: '旋转 90° (R)', fn: () => pcbRotate(ch) },
      { text: '编辑标签…', fn: () => editLabelOrFreq(ch) },
      { text: '移出PCB (Del)', fn: () => pcbUnplace(ch) },
      { text: '彻底删除元件', fn: () => deleteChip(ch) },
    ]);
    return;
  }
  showCtxMenu(e.clientX, e.clientY, [
    { text: '📐 自动布局', fn: () => { pushUndo(); PCB.autoPlace(sim); scheduleSave(); toast('已自动布局'); } },
    { text: '⤢ 适配视图', fn: fitPCB },
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
  if (!n) toast('没有选中项');
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



window.addEventListener('error', e => toast('脚本错误: ' + e.message, 'err'));

// 调试/自动化句柄
window._74vm = { sim, app, fitView, LIB, draw, switchMode, applyBB,
  hit: { pinAt, chipAt, wireAt, pinWorld, wireEnds, bezierPts } };

window.addEventListener('beforeunload', () => doSave(true));

buildLib('');
syncRun();

(function boot() {
  let data = null;
  try { data = JSON.parse(localStorage.getItem(LS_KEY)); } catch (e) { /* 忽略 */ }
  if (data && Array.isArray(data.chips) && data.chips.length) {
    restoreSave(data);
    fitView();
    toast('已恢复上次的电路 (文件菜单可新建)');
  } else {
    loadExample(window.EXAMPLES[0]);
    fitView();
    toast('欢迎使用 74VM — 点击左上角 ❓ 查看帮助');
  }
  sim.setRunning(true);
  syncRun();
})();

requestAnimationFrame(frame);

})();