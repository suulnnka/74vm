/* =========================================================================
 * 74VM 元件库侧栏 — 分类列表 / 搜索过滤 / 点击与拖拽放置
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
    showCtxMenu, hideCtxMenu, hideTooltip, showModal, modalVisible, closeAllMenus,
    switchMode, toggleRun, syncRun, setSpeed, simStep, updateStatus, fmtNum, fmtFreq,
    fitDispatch, rotateDispatch, deleteDispatch, downloadBlob, trayRects, trayItemAt, draw,
  } = window.APP;
  const { placeChip, findFreeSpot } = APP.schem;
  const { placeChipBB } = APP.bb;
  const { placeChipPCB } = APP.pcb;

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

function setLibShown(v) {
  app.libShown = !!v;
  document.getElementById('sidebar').classList.toggle('collapsed', !app.libShown);
  document.getElementById('sideToggle').textContent = app.libShown ? '‹' : '›';
  try { localStorage.setItem('74vm:lib', app.libShown ? '1' : '0'); } catch (e) { }
  Menus.refresh();
}
function toggleLib() { setLibShown(!app.libShown); }
document.getElementById('sideToggle').onclick = toggleLib;

window.APP.lib = { build: buildLib, setShown: setLibShown, toggle: toggleLib };
})();
