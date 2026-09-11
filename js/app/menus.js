/* =========================================================================
 * 74VM 菜单栏 — 多级菜单定义/渲染 + 文件/面包板/PCB 动作 + 界面语言
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
    showCtxMenu, hideCtxMenu, hideTooltip, showModal, modalVisible, closeAllMenus, setLevelColor,
    switchMode, toggleRun, syncRun, setSpeed, simStep, updateStatus, fmtNum, fmtFreq,
    fitDispatch, rotateDispatch, deleteDispatch, downloadBlob, trayRects, trayItemAt, draw,
  } = window.APP;
  const { autoAll: bbAutoAll, apply: applyBB, sanitize: bbSanitize, fit: fitBreadboard, setLabels: setBBLabels, setJumpers: setBBJumpers } = APP.bb;
  const { fit: fitPCB } = APP.pcb;
  const { fitView, duplicateSelection } = APP.schem;
  const { build: buildLib, setShown: setLibShown, toggle: toggleLib } = APP.lib;

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
        { label: t('跳线 (面包板)'), hint: t('关=隐藏'), radio: 'jumpers', act: () => setBBJumpers(!app.bbJumpers) },
        { label: t('按电平着色'), hint: t('关=引脚/跳线单色'), radio: 'levelColor', act: () => setLevelColor(!app.levelColor) },
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
    if (it.radio === 'jumpers') return app.bbJumpers;
    if (it.radio === 'levelColor') return app.levelColor;
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
  const ghLink = document.getElementById('ghLink');
  if (ghLink) {
    ghLink.title = t('GitHub 项目主页');
    ghLink.setAttribute('aria-label', t('GitHub 项目主页'));
  }
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

function loadExample(ex) {
  if (sim.chips.size) pushUndo();
  sim.load({ chips: ex.build().chips, wires: ex.build().wires });
  for (const ch of sim.chips.values()) { ch.x = snap(ch.x); ch.y = snap(ch.y); }   // 示例坐标吸附 28px 网格
  syncSchematicWires();
  // 示例可声明面包板规模 bb: {cols, boards} (大电路需要更大的板)
  if (ex.bb) { BB.setCols(ex.bb.cols); BB.setBoards(ex.bb.boards); }
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


window.Menus = Menus;
window.APP.loadExample = loadExample;   // 供引导文件使用
window.APP.applyLang = applyLang;
})();
