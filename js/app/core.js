/* =========================================================================
 * 74VM 界面核心 — 共享状态 / 画布基础设施 / 选择与撤销 / 持久化 / 模式系统
 * 拆分自原 app.js; 各功能模块 (js/app/*.js) 通过 window.APP 共享上下文。
 * ========================================================================= */
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
  APP.CW = CW; APP.CH = CH;   // 供各模式模块读取 (拖拽/悬浮换算)
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

  if (app.mode === 'breadboard') APP.bb.draw(z);
  else if (app.mode === 'pcb') APP.pcb.draw(z);
  else APP.schem.drawScene(z);   // 网格 + 元件 + 导线 + 引脚 + 连线预览
  APP.schem.drawGhost();         // 元件库拖拽幽灵 (跨模式)
}
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
  APP.bb.sanitize();
  if (app.mode === 'breadboard') APP.bb.apply();
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
const ZOOM_LIM = { schematic: [0.15, 8], breadboard: [0.15, 8], pcb: [0.5, 20] };
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
function deleteChip(ch) {
  pushUndo();
  sim.removeChip(ch.id);
  pruneSelection();
  scheduleSave();
}
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
  if (app.mode === 'breadboard') APP.bb.fit();
  else if (app.mode === 'pcb') APP.pcb.fit();
  else APP.schem.fitView();
}
function rotateDispatch() {
  if (app.mode === 'schematic') APP.schem.rotateSelection();
  else if (app.mode === 'breadboard') APP.bb.rotateSelection();
  else APP.pcb.rotateSelection();
}
function deleteDispatch() {
  if (app.mode === 'schematic') APP.schem.deleteSelection();
  else if (app.mode === 'breadboard') APP.bb.deleteSelection();
  else APP.pcb.deleteSelection();
}
function closeAllMenus() {
  Menus.closeAll();
  document.querySelectorAll('.menu.open').forEach(m => m.classList.remove('open'));
}
function modalVisible() { return !document.getElementById('helpModal').classList.contains('hidden'); }
function showModal(v) { document.getElementById('helpModal').classList.toggle('hidden', !v); }
document.getElementById('btnHelpClose').onclick = () => showModal(false);
document.getElementById('helpModal').addEventListener('pointerdown', e => {
  if (e.target.id === 'helpModal') showModal(false);
});

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
    if (!app.bb.placed && sim.chips.size) APP.bb.autoAll(false);
    else APP.bb.apply();
    if (!app.cams.breadboard.fitted) { APP.bb.fit(); app.cams.breadboard.fitted = true; }
    toast(t('面包板模式 — 按住孔位拖动拉跳线, ✨自动布线可从原理图生成接线'));
  } else if (m === 'pcb') {
    let need = false;
    for (const ch of sim.chips.values()) if (!ch.pcb) need = true;
    if (need && sim.chips.size) { pushUndo(); PCB.autoPlace(sim); toast(t('已按原理图顺序自动布局封装')); }
    if (!app.cams.pcb.fitted) { APP.pcb.fit(); app.cams.pcb.fitted = true; }
    toast(t('PCB 模式 — 拖动/旋转封装, 📤 导出立创EDA 后可在其内自动布线'));
  }
  updateStatus();
  scheduleSave();   // 记住上次使用的模式
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

function fmtFreq(f) {
  if (f >= 1000) {
    const k = Math.round(f / 1000 * 100) / 100;
    return k + 'kHz';
  }
  return f + 'Hz';
}

/* ================= 共享上下文 =================
 * app.js 拆分后的各功能模块 (js/app/*.js) 经 window.APP 共享状态与工具;
 * 模块内以解构方式取用 (函数引用不可变, 对象属性运行时读取)。 */
window.APP = {
  sim, app, LIB, canvas, ctx, holder, tooltipEl, ctxMenu,
  t, tf, PIN_GAP, DEFAULT_W, DPR, COL, CURSORS, ZOOM_LIM, KB44_CELL, KB44_GAP, KB44_GLYPH, LS_KEY,
  snap, rr, evenCells, chipSize, rotXY, pinLocal, pinWorld, pinNormal, chipHalf, chipPointLocal,
  kb44CellRect, kb44CellAt, kb44Press, kb44CellAtBB, valColor, pinValue, toWorld, resizeCanvas,
  isSelected, selectOnly, clearSelection, pruneSelection, toast, pushUndo, undo, redo,
  buildSave, restoreSave, syncSchematicWires, scheduleSave, doSave, deleteChip,
  showCtxMenu, hideCtxMenu, hideTooltip, showModal, modalVisible, closeAllMenus,
  switchMode, toggleRun, syncRun, setSpeed, simStep, updateStatus, fmtNum, fmtFreq,
  fitDispatch, rotateDispatch, deleteDispatch, downloadBlob, trayRects, trayItemAt, draw,
  CW: 0, CH: 0,          // 画布 CSS 尺寸 (resizeCanvas 维护)
};
})();
