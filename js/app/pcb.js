/* =========================================================================
 * 74VM PCB 模式 — 封装布局绘制与交互 (拖动/旋转/右键/导出支撑)
 * ========================================================================= */
(function () {
'use strict';
  /* 共享上下文 (core.js 挂载) */
  const {
    sim, app, LIB, canvas, ctx, holder, tooltipEl, ctxMenu,
    t, tf, PIN_GAP, DEFAULT_W, DPR, COL, CURSORS, ZOOM_LIM, KB44_CELL, KB44_GAP, KB44_GLYPH, LS_KEY,
    snap, rr, evenCells, chipSize, rotXY, pinLocal, pinWorld, pinNormal, chipHalf, chipPointLocal,
    kb44CellRect, kb44CellAt, kb44Press, kb44CellAtBB, valColor, pinValue, toWorld, resizeCanvas,
    isSelected, selectOnly, clearSelection, pruneSelection, toast, pushUndo, undo, redo,
    buildSave, restoreSave, syncSchematicWires, scheduleSave, doSave, deleteChip,
    showCtxMenu, hideCtxMenu, hideTooltip, cancelHoverDetail, hoverDetail, showModal, modalVisible, closeAllMenus,
    switchMode, toggleRun, syncRun, setSpeed, simStep, updateStatus, fmtNum, fmtFreq,
    fitDispatch, rotateDispatch, deleteDispatch, downloadBlob, trayRects, trayItemAt, draw,
  } = window.APP;
  const { editLabel, editLabelOrFreq, memoryMenuItems, showDesc } = APP.dlg;
  const { drawTray } = APP.bb;

function fitPCB() {
  resizeCanvas();
  const w = PCB.BOARD.w + 240, h = PCB.BOARD.h + 40;
  app.cams.pcb.zoom = Math.max(1, Math.min(12, Math.min(APP.CW / w, APP.CH / h)));
  app.cams.pcb.x = PCB.BOARD.w / 2 + 60;
  app.cams.pcb.y = PCB.BOARD.h / 2;
}

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
  if (ch) {
    app.hover = { kind: 'chip', id: ch.id };
    canvas.style.cursor = CURSORS.grab;
    hoverDetail(ch, e);   // 悬停停留后显示功能描述浮窗
    return;
  }
  const tray = trayItemAt(w, 'pcb');
  if (tray) {
    app.hover = { kind: 'chip', id: tray.ch.id };
    canvas.style.cursor = CURSORS.grab;
    hoverDetail(tray.ch, e);
    return;
  }
  app.hover = null;
  hideTooltip();
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
    showCtxMenu(e.clientX, e.clientY, [
      { text: t('查看描述'), fn: () => showDesc(tray.ch) },
      { text: t('删除'), fn: () => deleteChip(tray.ch) },
    ]);
    return;
  }
  const ch = pcbChipAt(w);
  if (ch) {
    selectOnly('chip', ch.id);
    showCtxMenu(e.clientX, e.clientY, [
      { text: t('旋转 90° (R)'), fn: () => pcbRotate(ch) },
      { text: t('查看描述'), fn: () => showDesc(ch) },
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

window.APP.pcb = {
  draw: drawPCB,
  pointerDown: pcbPointerDown, pointerMove: pcbPointerMove, pointerUp: pcbPointerUp,
  contextMenu: pcbContextMenu,
  fit: fitPCB, rotate: pcbRotate, unplace: pcbUnplace,
  deleteSelection: pcbDeleteSelection, rotateSelection: pcbRotateSelection,
  placeChipPCB,
};
})();
