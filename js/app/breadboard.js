/* =========================================================================
 * 74VM 面包板模式 — 绘制 (板体/元件/跳线/托盘) 与交互 (摆放/移动/拉线/右键)
 * ========================================================================= */
(function () {
'use strict';
  /* 共享上下文 (core.js 挂载) */
  const {
    sim, app, LIB, canvas, ctx, holder, tooltipEl, ctxMenu,
    t, tf, PIN_GAP, DEFAULT_W, DPR, COL, CURSORS, ZOOM_LIM, KB44_CELL, KB44_GAP, KB44_GLYPH, LS_KEY,
    snap, rr, evenCells, chipSize, rotXY, pinLocal, pinWorld, pinNormal, chipHalf, chipPointLocal,
    kb44CellRect, kb44CellAt, kb44Press, kb44CellAtBB, valColor, connColor, pinValue, toWorld, resizeCanvas,
    isSelected, selectOnly, clearSelection, pruneSelection, toast, pushUndo, undo, redo,
    buildSave, restoreSave, syncSchematicWires, scheduleSave, doSave, deleteChip,
    showCtxMenu, hideCtxMenu, hideTooltip, cancelHoverDetail, hoverDetail, showModal, modalVisible, closeAllMenus,
    switchMode, toggleRun, syncRun, setSpeed, simStep, updateStatus, fmtNum, fmtFreq,
    fitDispatch, rotateDispatch, deleteDispatch, downloadBlob, trayRects, trayItemAt, draw,
  } = window.APP;
  const { editLabel, editLabelOrFreq, memoryMenuItems, showDesc } = APP.dlg;
  const { setKbFocus, scriptItems: ps2ScriptItems } = APP.ps2;
  const { pushUndoLite } = APP.schem;

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


function setBBLabels(v) {
  app.bbLabels = !!v;
  try { localStorage.setItem('74vm:labels', app.bbLabels ? '1' : '0'); } catch (e) { }
  Menus.refresh();
}

/** 跳线显示开关 (关=隐藏; 隐藏时跳线同样不可命中/拖动) */
function setBBJumpers(v) {
  app.bbJumpers = !!v;
  if (!app.bbJumpers) app.bbWiring = null;   // 隐藏时结束进行中的拉线
  try { localStorage.setItem('74vm:jumpers', app.bbJumpers ? '1' : '0'); } catch (e) { }
  Menus.refresh();
}


function fitBreadboard() {
  resizeCanvas();
  const w = BB.BOARD.w + 320, h = BB.totalH() + 80;
  app.cams.breadboard.zoom = Math.max(0.2, Math.min(1.6, Math.min(APP.CW / w, APP.CH / h)));
  app.cams.breadboard.x = BB.BOARD.w / 2 - 130;
  app.cams.breadboard.y = BB.totalH() / 2;
}

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
  if (!app.bbJumpers) return null;   // 隐藏时跳线不可交互
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
    // 该孔只接一根跳线 → 拖动该跳线此端; 否则新建跳线 (跳线隐藏时一律新建)
    const attached = app.bbJumpers ? app.bb.jumpers.filter(j => j.a === h || j.b === h) : [];
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
  if (ch) {
    app.hover = { kind: 'chip', id: ch.id };
    canvas.style.cursor = (ch.type === 'SW' || ch.type === 'BTN' || ch.type === 'PS2' || ch.type === 'KB44') ? CURSORS.pointer : CURSORS.grab;
    hideTooltip();
    hoverDetail(ch, e);   // 悬停停留后显示功能描述浮窗
    return;
  }
  const h = bbHoleAt(w);
  if (h) {
    app.hover = { kind: 'bbHole', hole: h };
    canvas.style.cursor = CURSORS.pointer;
    cancelHoverDetail();   // 孔位提示即刻显示, 撤下功能描述浮窗状态
    const ci = h.indexOf(':');
    const rest = h.slice(ci + 1);
    tooltipEl.textContent = rest[0] === 'R'
      ? tf('板{n} 电源轨 {r} 列{c}', { n: +h.slice(0, ci) + 1, r: rest.replace('-', ''), c: rest.replace(/[^-]+-/, '') })
      : tf('板{n} 孔位 {h} (同列5孔连通)', { n: +h.slice(0, ci) + 1, h: rest });
    tooltipEl.style.display = 'block';
    const p = BB.holePos(h);
    tooltipEl.style.left = ((p.x - app.cam.x) * app.cam.zoom + APP.CW / 2 + 12) + 'px';
    tooltipEl.style.top = ((p.y - app.cam.y) * app.cam.zoom + APP.CH / 2 - 10) + 'px';
    return;
  }
  const j = bbJumperAt(w);
  if (j) { app.hover = { kind: 'jumper', id: j.id }; canvas.style.cursor = CURSORS.pointer; hideTooltip(); return; }
  const tray = trayItemAt(w, 'breadboard');
  if (tray) {
    app.hover = { kind: 'chip', id: tray.ch.id };
    canvas.style.cursor = CURSORS.grab;
    hideTooltip();
    hoverDetail(tray.ch, e);   // 待放置元件同样可查看功能描述
    return;
  }
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
    showCtxMenu(e.clientX, e.clientY, [
      { text: t('查看描述'), fn: () => showDesc(tray.ch) },
      { text: t('删除'), fn: () => deleteChip(tray.ch) },
    ]);
    return;
  }
  const ch = bbChipAt(w);
  if (ch) {
    selectOnly('chip', ch.id);
    const items = [];
    if (!LIB[ch.type].custom) items.push({ text: t('翻转 180° (R)'), fn: () => bbFlip(ch) });
    items.push({ text: t('查看描述'), fn: () => showDesc(ch) });
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
    // 中央沟道 (窄条: 真实面包板比例, DIP 机体直接跨压在沟道上)
    ctx.fillStyle = '#c4bda2';
    rr(B.colX(1) - 10, oy + B.CHANNEL_Y - 9, B.colX(cols) - B.colX(1) + 20, 18, 6);
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
        ctx.fillStyle = v != null ? connColor(v) : polColor(pol, '#3a3f45');
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
        ctx.fillStyle = v != null ? connColor(v) : polColor(pol, '#3a3f45');
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
  // 跳线 (绘制在元件之上; 视图菜单可隐藏)
  const movingJumper = app.bbWiring && app.bbWiring.moveJumper;
  for (const j of app.bb.jumpers) {
    if (!app.bbJumpers) continue;       // 隐藏跳线
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
    ctx.strokeStyle = v != null ? connColor(v) : polColor(bbHolePol(j.a), '#9aa4b0');
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
    const bh = B.rowBoxH(ch);
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
    if (ch.type === 'LCD1602' || ch.type === 'LCD12864') drawBBLCD(ch, rect.x, boxY, rect.w, bh);
    else drawIOGlyph(ch, rect.x + rect.w / 2, boxY + bh / 2);
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

/** LCD 模块大屏 (面包板): 屏面填满加高的模块盒, 显示 DDRAM 文字
 *  (12864 再叠加 GDRAM 点阵), 渲染风格与原理图模式一致 */
function drawBBLCD(ch, x, y, w, h) {
  const m = 4;                                   // 屏面与模块盒的边距
  const px = x + m, py = y + m, pw = w - m * 2, ph = h - m * 2;
  ctx.fillStyle = '#0d47a1';
  rr(px, py, pw, ph, 3);
  ctx.fill();
  ctx.strokeStyle = '#093170';
  ctx.lineWidth = 1.5;
  ctx.stroke();
  const dd = ch.state.ddram || [];
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillStyle = '#e3f2fd';
  if (ch.type === 'LCD1602') {
    const cw = pw / 16, band = ph / 2;
    ctx.font = '10px Consolas, "Microsoft YaHei", monospace';
    for (let row = 0; row < 2; row++) {
      const base = row === 0 ? 0 : 0x40;
      for (let c = 0; c < 16; c++) {
        const t = dd[base + c];
        if (t && t !== ' ') ctx.fillText(t, px + cw * (c + 0.5), py + band * row + band / 2);
      }
    }
    // 光标 (下划线, 仅可见区)
    const cur = ch.state.cur || 0;
    if (cur < 16 || (cur >= 0x40 && cur < 0x50)) {
      const row = cur >= 0x40 ? 1 : 0;
      const ccol = cur >= 0x40 ? cur - 0x40 : cur;
      ctx.fillRect(px + cw * ccol + 1, py + band * row + band - 6, cw - 2, 2);
    }
  } else {
    // 12864: GDRAM 点阵 + DDRAM 文字叠加
    const g = ch.state.gdram || [];
    const dw = pw / 128, dh = ph / 64;
    ctx.fillStyle = '#6ea8e8';
    for (let yy = 0; yy < 64; yy++) {
      for (let bx = 0; bx < 16; bx++) {
        const byte = g[yy * 16 + bx];
        if (!byte) continue;
        for (let k = 0; k < 8; k++) {
          if (byte & (0x80 >> k)) ctx.fillRect(px + (bx * 8 + k) * dw, py + yy * dh, dw + 0.3, dh + 0.3);
        }
      }
    }
    const cw = pw / 16;
    ctx.font = '10px Consolas, "Microsoft YaHei", monospace';
    ctx.fillStyle = '#e3f2fd';
    for (let row = 0; row < 4; row++) {
      let s = '';
      for (let c = 0; c < 16; c++) s += dd[row * 16 + c] || ' ';
      if (s.trim()) ctx.fillText(s, px + pw / 2, py + (row + 0.5) * ph / 4);
    }
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

window.APP.bb = {
  draw: drawBreadboard,
  pointerDown: bbPointerDown, pointerMove: bbPointerMove, pointerUp: bbPointerUp,
  contextMenu: bbContextMenu,
  autoAll: bbAutoAll, apply: applyBB, sanitize: bbSanitize, fit: fitBreadboard,
  setLabels: setBBLabels, setJumpers: setBBJumpers, unplace: bbUnplace,
  deleteSelection: bbDeleteSelection, rotateSelection: bbRotateSelection,
  placeChipBB, drawTray,
};
})();
