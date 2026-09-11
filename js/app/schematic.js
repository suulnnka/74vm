/* =========================================================================
 * 74VM 原理图模式 — 画布绘制 (网格/元件/导线/引脚) 与指针交互 (连线/拖动/选择)
 * ========================================================================= */
(function () {
'use strict';
  /* 共享上下文 (core.js 挂载) */
  const {
    sim, app, LIB, canvas, ctx, holder, tooltipEl, ctxMenu, ghostCv, gctx, resizeGhostCv,
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

function drawGrid(z) {
  // 浅色网格线: 28px 次线 + 每4格主线
  const z2 = app.cam.zoom;
  let step = 28;
  while (step * z2 < 11) step *= 2;
  const major = step * 4;
  const x0 = app.cam.x - APP.CW / 2 / z2, x1 = app.cam.x + APP.CW / 2 / z2;
  const y0 = app.cam.y - APP.CH / 2 / z2, y1 = app.cam.y + APP.CH / 2 / z2;
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
    ctx.strokeStyle = connColor(v);
    ctx.lineWidth = app.levelColor && v === 1 ? 2.6 : 2;
    if (app.levelColor && v === 'Z') ctx.setLineDash([5, 4]);
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
    ctx.fillStyle = connColor(v);
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

/* 元件库拖拽鬼影: 画在全屏浮层 #ghostcv (显示优先级高于左侧栏等界面) 而非画布 —
 * 画布与侧栏并排, 鼠标还在侧栏上时局部坐标为负, 鬼影会被画布边缘裁掉, 看起来像被侧栏盖住 */
let ghostOverlayDirty = false;   // 浮层上有残影, 拖拽结束后清除一次
function drawGhost() {
  if (!app.ghost || app.ghost.hidden || !LIB[app.ghost.type]) {
    if (ghostOverlayDirty) {
      gctx.setTransform(1, 0, 0, 1, 0, 0);
      gctx.clearRect(0, 0, ghostCv.width, ghostCv.height);
      ghostOverlayDirty = false;
    }
    return;
  }
  const def = LIB[app.ghost.type];
  resizeGhostCv();
  gctx.setTransform(1, 0, 0, 1, 0, 0);
  gctx.clearRect(0, 0, ghostCv.width, ghostCv.height);
  ghostOverlayDirty = true;
  // 浮层铺满视口 → 局部坐标 = 客户端坐标; 光标位于预览盒正中央, 各盒以此为中心绘制
  const gx = app.ghost.sx, gy = app.ghost.sy;
  const g = gctx;
  g.setTransform(DPR, 0, 0, DPR, 0, 0);
  g.globalAlpha = 0.92;
  g.textBaseline = 'middle';

  if (app.mode === 'breadboard') {
    // 迷你面包板形态: DIP 黑条 / IO 模块
    if (!def.custom) {
      const w = 76, h = 22;
      g.fillStyle = '#2b3138';
      rr(gx - w / 2, gy - h / 2, w, h, 4, g); g.fill();
      g.strokeStyle = '#454e59'; g.lineWidth = 1; g.stroke();
      g.fillStyle = '#e6eef8';
      g.font = 'bold 10px Consolas, monospace';
      g.textAlign = 'center';
      g.fillText(def.type, gx, gy);
      g.fillStyle = '#6b7a8c';
      g.font = '9px "Segoe UI","Microsoft YaHei",sans-serif';
      g.fillText(t(def.desc), gx, gy + h / 2 + 9);
    } else {
      const w = 44, h = 20;
      g.fillStyle = '#242c36';
      rr(gx - w / 2, gy - h / 2, w, h, 4, g); g.fill();
      g.strokeStyle = '#454e59'; g.lineWidth = 1; g.stroke();
      g.fillStyle = '#e6eef8';
      g.font = 'bold 9px Consolas, monospace';
      g.textAlign = 'center';
      g.fillText(def.type, gx, gy);
    }
  } else if (app.mode === 'pcb') {
    // 迷你封装: 丝印框 + 双排焊盘
    const w = 40, h = 22;
    g.strokeStyle = '#43566a'; g.lineWidth = 1.2;
    g.strokeRect(gx - w / 2, gy - h / 2, w, h);
    g.fillStyle = '#c9a34e';
    for (let i = 0; i < 3; i++) {
      for (const px of [gx - w / 2 + 7, gx + w / 2 - 7]) {
        g.beginPath();
        g.arc(px, gy - h / 2 + 5 + i * 6, 2.2, 0, Math.PI * 2);
        g.fill();
      }
    }
    g.fillStyle = '#1f2937';
    g.font = 'bold 9px Consolas, monospace';
    g.textAlign = 'center';
    g.fillText(def.type, gx, gy - h / 2 - 7);
  } else {
    // 原理图形态: 白底元件盒
    const w = 104, h = 40;
    g.fillStyle = '#ffffff';
    rr(gx - w / 2, gy - h / 2, w, h, 6, g); g.fill();
    g.strokeStyle = COL.sel; g.lineWidth = 1.4; g.stroke();
    g.fillStyle = '#1f2937';
    g.font = 'bold 12px Consolas, monospace';
    g.textAlign = 'center';
    g.fillText(def.type, gx, gy - 7);
    g.fillStyle = '#6b7a8c';
    g.font = '9.5px "Segoe UI","Microsoft YaHei",sans-serif';
    g.fillText(t(def.desc), gx, gy + 8);
  }
  g.globalAlpha = 1;
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

function schemPointerDown(e) {
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
}

function schemPointerMove(e) {
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
    updateHover(w, e);
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

  updateHover(w, e);
}

function updateHover(w, e) {
  const pinHit = pinAt(w);
  if (pinHit) {
    cancelHoverDetail();   // 引脚提示即刻显示, 撤下功能描述浮窗状态
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
    const sx = (p.x - app.cam.x) * app.cam.zoom + APP.CW / 2;
    const sy = (p.y - app.cam.y) * app.cam.zoom + APP.CH / 2;
    tooltipEl.style.left = (sx + 14) + 'px';
    tooltipEl.style.top = (sy - 10) + 'px';
    canvas.style.cursor = CURSORS.pointer;
    return;
  }
  hoverDetail(null);   // 无引脚命中: 撤下浮窗 (含待显定时)
  const ch = chipAt(w);
  if (ch) {
    app.hover = { kind: 'chip', id: ch.id };
    hoverDetail(ch, e);   // 悬停停留后显示功能描述浮窗
    canvas.style.cursor = (ch.type === 'SW' || ch.type === 'BTN' || ch.type === 'PS2' || ch.type === 'KB44') ? CURSORS.pointer : CURSORS.grab;
    return;
  }
  const wI = wireAt(w);
  if (wI) { app.hover = { kind: 'wire', id: wI.id }; canvas.style.cursor = CURSORS.pointer; return; }
  app.hover = null;
  canvas.style.cursor = CURSORS.def;
}

function schemPointerUp(e) {
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
}

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

function schemContextMenu(e) {
  const w = toWorld(e);
  const pinHit = pinAt(w);
  const ch = pinHit ? pinHit.ch : chipAt(w);
  if (ch) {
    const items = [];
    items.push({ text: t('旋转 90° (R)'), fn: () => rotateChip(ch) });
    items.push({ text: t('查看描述'), fn: () => showDesc(ch) });
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
}

function rotateChip(ch) {
  pushUndo();
  ch.rot = ((ch.rot || 0) + 90) % 360;
  sim.touch();
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

function fitView() {
  resizeCanvas();
  if (!sim.chips.size || !APP.CW || !APP.CH) { app.cam = { x: 400, y: 250, zoom: 1 }; return; }
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const ch of sim.chips.values()) {
    const half = chipHalf(ch);
    x0 = Math.min(x0, ch.x - half.x); x1 = Math.max(x1, ch.x + half.x);
    y0 = Math.min(y0, ch.y - half.y); y1 = Math.max(y1, ch.y + half.y);
  }
  const bw = x1 - x0 + 160, bh = y1 - y0 + 160;
  app.cam.zoom = Math.max(0.25, Math.min(1.5, Math.min(APP.CW / bw, APP.CH / bh)));
  app.cam.x = (x0 + x1) / 2;
  app.cam.y = (y0 + y1) / 2;
}

/* 绘制入口 (core.draw 按模式分发) */
function drawScene(z) {
  drawGrid(z);
  drawChips(z);            // 元件体 (不含引脚)
  drawWires();             // 导线绘制在元件之上
  drawAllPins(z);          // 引脚最上层, 盖住线端
  drawWiringPreview();
}

window.APP.schem = {
  drawScene, drawGhost,
  pointerDown: schemPointerDown, pointerMove: schemPointerMove, pointerUp: schemPointerUp,
  contextMenu: schemContextMenu,
  pinAt, chipAt, wireAt, wireEnds, bezierPts, pinWorld,
  placeChip, findFreeSpot, fitView, rotateChip, deleteWire, pushUndoLite,
  deleteSelection, rotateSelection, duplicateSelection,
};
})();
