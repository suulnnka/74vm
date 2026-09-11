/* =========================================================================
 * 74VM 界面入口 (引导文件)
 * 功能实现拆分在 js/app/*.js, 经 window.APP 共享上下文协作:
 *   core.js 共享状态与工具 / schematic.js 原理图 / breadboard.js 面包板 /
 *   pcb.js PCB / library.js 元件库 / dialogs.js 对话框 / ps2.js 键盘 / menus.js 菜单
 * 本文件只负责: 画布与全局事件绑定 + 按模式分发 + 启动引导。
 * ========================================================================= */
(function () {
'use strict';

const {
  app, sim, LIB, canvas, t, tf, toast, scheduleSave, doSave, restoreSave,
  hideCtxMenu, hideTooltip, toWorld, clearSelection, switchMode, toggleRun, undo, redo,
  syncRun, applyLang, loadExample, ZOOM_LIM, LS_KEY, draw,
} = window.APP;
const { pointerDown: schemDown, pointerMove: schemMove, pointerUp: schemUp,
        contextMenu: schemMenu, placeChip, duplicateSelection, rotateSelection,
        deleteSelection, pinAt, chipAt, wireAt, pinWorld, wireEnds, bezierPts,
        fitView } = window.APP.schem;
const { pointerDown: bbDown, pointerMove: bbMove, pointerUp: bbUp, contextMenu: bbMenu,
        deleteSelection: bbDeleteSelection, rotateSelection: bbRotateSelection,
        placeChipBB, apply: applyBB } = window.APP.bb;
const { pointerDown: pcbDown, pointerMove: pcbMove, pointerUp: pcbUp, contextMenu: pcbMenu,
        deleteSelection: pcbDeleteSelection, rotateSelection: pcbRotateSelection,
        placeChipPCB } = window.APP.pcb;
const { setKbFocus, keydown: ps2Keydown, keyup: ps2Keyup } = window.APP.ps2;
const { build: buildLib, setShown: setLibShown, toggle: toggleLib } = window.APP.lib;

/* ================= 指针事件: 按模式分发 ================= */

canvas.addEventListener('pointerdown', e => {
  hideCtxMenu();
  hideTooltip();   // 按下即撤下功能描述/引脚浮窗
  if (e.button === 2) {   // 右键: 按住拖动 = 平移视图; 松开未拖动 = 弹出菜单
    const w = toWorld(e);
    try { canvas.setPointerCapture(e.pointerId); } catch (err) { }
    app.drag = { kind: 'pan', last: w, right: true, moved: false, sx: e.clientX, sy: e.clientY };
    return;
  }
  if (app.mode === 'breadboard') return bbDown(e);
  if (app.mode === 'pcb') return pcbDown(e);
  return schemDown(e);
});

canvas.addEventListener('pointermove', e => {
  if (app.drag && app.drag.right && !app.drag.moved &&
      Math.hypot(e.clientX - app.drag.sx, e.clientY - app.drag.sy) > 4) app.drag.moved = true;
  if (app.mode === 'breadboard') return bbMove(e);
  if (app.mode === 'pcb') return pcbMove(e);
  return schemMove(e);
});

canvas.addEventListener('pointerup', e => {
  if (e.button === 2) {   // 右键松开: 拖动过则吞掉随后的菜单事件
    app.rightMoved = !!(app.drag && app.drag.right && app.drag.moved);
    app.drag = null;
    return;
  }
  if (app.mode === 'breadboard') return bbUp(e);
  if (app.mode === 'pcb') return pcbUp(e);
  return schemUp(e);
});

canvas.addEventListener('contextmenu', e => {
  e.preventDefault();
  if (app.rightMoved || (app.drag && app.drag.right && app.drag.moved)) {
    app.rightMoved = false;   // 右键拖动平移后不弹菜单
    return;
  }
  if (app.mode === 'breadboard') return bbMenu(e);
  if (app.mode === 'pcb') return pcbMenu(e);
  return schemMenu(e);
});

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
['gesturestart', 'gesturechange', 'gestureend'].forEach(g =>
  document.addEventListener(g, e => e.preventDefault()));

/* ================= 键盘事件 ================= */

window.addEventListener('keydown', e => {
  const el = e.target;
  if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT')) return;
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
  const el = e.target;
  if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT')) return;
  if (app.kbChip) { e.preventDefault(); ps2Keyup(app.kbChip, e); }
});

/* ================= 原生拖放 (元件库 → 画布, 按模式放置) ================= */

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
  else placeChip(type, window.APP.snap(w.x), window.APP.snap(w.y));
});

/* ================= 全局监听 ================= */

document.getElementById('search').addEventListener('input', e => buildLib(e.target.value));
window.addEventListener('error', e => toast(tf('脚本错误: {m}', { m: e.message }), 'err'));
window.addEventListener('beforeunload', () => doSave(true));

/* ================= 启动引导 ================= */

Menus.build();
setLibShown(localStorage.getItem('74vm:lib') !== '0');   // 侧栏初始状态
try { app.bbLabels = localStorage.getItem('74vm:labels') !== '0'; } catch (e) { app.bbLabels = true; }   // 面包板标识默认显示
try { app.bbJumpers = localStorage.getItem('74vm:jumpers') !== '0'; } catch (e) { app.bbJumpers = true; }   // 面包板跳线默认显示
try { app.levelColor = localStorage.getItem('74vm:levcolor') !== '0'; } catch (e) { app.levelColor = true; }   // 电平着色默认开启

buildLib('');
applyLang();   // 应用持久化的界面语言 (标题/搜索框/帮助/菜单栏)
syncRun();

(function boot() {
  let data = null;
  try { data = JSON.parse(localStorage.getItem('74vm:autosave')); } catch (e) { /* 忽略 */ }
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

requestAnimationFrame(function frame() {
  draw();
  requestAnimationFrame(frame);
});

// 调试/自动化句柄
window._74vm = { sim, app, fitView, LIB, draw, switchMode, applyBB,
  hit: { pinAt, chipAt, wireAt, pinWorld, wireEnds, bezierPts } };
})();
