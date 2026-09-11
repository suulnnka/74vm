/* =========================================================================
 * 74VM PS/2 键盘 — 打字聚焦 / 扫描码发送 (Set 2) / 测试脚本
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

window.APP.ps2 = {
  queue: ps2Queue, keydown: ps2Keydown, keyup: ps2Keyup,
  scriptItems: ps2ScriptItems, toggleScript: togglePs2Script, setKbFocus,
};
})();
