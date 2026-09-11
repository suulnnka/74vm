/* =========================================================================
 * 74VM 对话框 — 标签 / 时钟频率 / 存储器内容 / 液晶文本 (右键菜单动作)
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
/** VM-8 程序 ROM (示例中 tag=vm8-program 的 74S472): 载入内置程序并冷启动 */
function loadVm8Program(ch) {
  const progs = (window.VM8 && window.VM8.PROGS) || [];
  if (!progs.length) return;
  Dialog.pick({
    title: tf('载入 VM-8 程序 — {n}', { n: memChipName(ch) }),
    message: t('选择烧入程序 ROM 的程序, 写入后自动冷启动 (PC=0 从头执行):'),
    options: progs.map(p => ({ label: t(p.name), hint: t(p.desc) })),
  }).then(idx => {
    if (idx == null) return;
    const p = progs[idx];
    pushUndo();
    ch.props.mem = p.mem.slice();
    sim.touch();
    if (sim.powered) { sim.powerOff(); sim.powerOn(); }   // 冷启动: 易失状态复位, 程序从头跑
    else sim.reevalAll();
    scheduleSave();
    toast(tf('已烧入「{n}」并冷启动', { n: t(p.name) }));
  });
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
  if (m.kind === 'rom') {
    const items = [];
    if (ch.props.tag === 'vm8-program')
      items.push({ text: t('📥 载入 VM-8 程序…'), fn: () => loadVm8Program(ch) });
    items.push(
      { text: t('编辑内容 (十六进制)…'), fn: () => editMem(ch) },
      { text: t('导出内容 (十六进制文件)'), fn: () => exportMem(ch) });
    return items;
  }
  return [
    { text: t('获取快照 (十六进制)…'), fn: () => memSnapshot(ch) },
    { text: t('导出快照 (十六进制文件)'), fn: () => exportMem(ch) },
  ];
}

/** 查看元件描述: 简述 + 功能描述 (含引脚 IO 说明), 弹窗展示 */
function showDesc(ch) {
  const d = LIB[ch.type];
  Dialog.info({
    title: (ch.props && ch.props.label ? ch.props.label + ' — ' : '') + d.type,
    message: t(d.desc) + '\n\n' + (d.detail ? t(d.detail) : ''),
  });
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

window.APP.dlg = {
  editLabel, editLabelOrFreq, memoryMenuItems, showDesc,
  editMem, memSnapshot, exportMem, loadVm8Program,
  editLcdText, editLcd12864Text, clearLcd, clearLcd12864Gfx,
  copyLcdText, exportLcdText,
};
})();
