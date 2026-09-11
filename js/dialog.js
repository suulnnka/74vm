/* ================= 窗口组件 (窗口管理器) =================
   替代系统原生 prompt/confirm。架构上支持未来多窗口并存:
   - 窗口栈 wins: 后开者在上层 (z-index 递增), 新窗口背景透明只罩住交互
   - Esc/Enter 只作用于获得焦点的最上层窗口
   - 标题栏可拖动移位; 点遮罩取消 (仅最上层窗口响应)
   单窗口可用性:
   - 打开即聚焦输入框并全选现有文本, 可直接输入覆盖
   - Enter = 确定, Esc = 取消 (焦点在任何弹窗控件上都生效)
   - 校验失败: 红框+内联错误, 不关闭, 重新聚焦全选
   - 弹窗内按键 stopPropagation, 不会触发画布快捷键 (空格暂停/R旋转等) */

const Dialog = (() => {
  const wins = [];   // 存活窗口栈, 末尾 = 最上层
  let zTop = 300;    // 与 .modal 基准 z-index 一致, 每窗递增
  const t = s => (window.I18N ? I18N.t(s) : s);   // 按钮等默认文案走多语言

  function open(opts) {
    const o = Object.assign({
      title: '', message: '', label: null, value: '', placeholder: '',
      okText: t('确定'), cancelText: t('取消'), danger: false, validate: null,
      multiline: false, rows: 0,   // true = 多行文本域 (Enter 换行, Ctrl+Enter 确定)
    }, opts);
    return new Promise(resolve => {
      let done = false;
      const finish = v => {
        if (done) return;
        done = true;
        const i = wins.indexOf(win);
        if (i >= 0) wins.splice(i, 1);
        overlay.remove();
        resolve(v);
      };

      const stacked = wins.length > 0;   // 之上已有窗口: 透明遮罩, 不再压暗
      const overlay = document.createElement('div');
      overlay.className = 'modal' + (stacked ? ' stacked' : '');
      overlay.style.zIndex = ++zTop;

      const box = document.createElement('div');
      box.className = 'modal-box dialog-box';

      const head = document.createElement('div');
      head.className = 'modal-head dlg-head';
      const title = document.createElement('b');
      title.textContent = o.title;
      const x = document.createElement('button');
      x.className = 'btn'; x.textContent = '✕'; x.title = t('取消 (Esc)');
      x.onclick = () => finish(null);
      head.appendChild(title); head.appendChild(x);

      const body = document.createElement('div');
      body.className = 'dlg-body';
      let input = null, errEl = null;
      if (o.message) {
        const m = document.createElement('div');
        m.className = 'dlg-msg';
        m.textContent = o.message;
        body.appendChild(m);
      }
      if (o.label != null || o.multiline) {
        if (o.label != null) {
          const lb = document.createElement('label');
          lb.className = 'dlg-label';
          lb.textContent = o.label;
          body.appendChild(lb);
        }
        if (o.multiline) {
          input = document.createElement('textarea');
          input.className = 'dlg-input dlg-area';
          input.rows = o.rows || 14;
        } else {
          input = document.createElement('input');
          input.className = 'dlg-input';
          input.type = 'text';
        }
        input.value = o.value;
        input.placeholder = o.placeholder;
        input.spellcheck = false;
        errEl = document.createElement('div');
        errEl.className = 'dlg-err';
        errEl.style.display = 'none';
        body.appendChild(input); body.appendChild(errEl);
      }

      const foot = document.createElement('div');
      foot.className = 'dlg-foot';
      const btnCancel = document.createElement('button');
      btnCancel.className = 'btn';
      btnCancel.textContent = o.cancelText;
      btnCancel.onclick = () => finish(null);
      const btnOk = document.createElement('button');
      btnOk.className = 'btn primary';
      btnOk.textContent = o.okText;
      if (o.danger) btnOk.classList.add('danger');
      if (!o.hideCancel) foot.appendChild(btnCancel);   // 纯信息弹窗 (info) 不显示取消钮
      foot.appendChild(btnOk);

      box.appendChild(head); box.appendChild(body); box.appendChild(foot);
      overlay.appendChild(box);

      const showError = msg => {
        errEl.textContent = msg;
        errEl.style.display = '';
        input.classList.add('invalid');
        input.focus(); input.select();
      };
      const ok = () => {
        if (!input) return finish(true);
        if (o.validate) {
          const err = o.validate(input.value);
          if (err) return showError(err);
        }
        finish(input.value);
      };

      overlay.addEventListener('pointerdown', e => { if (e.target === overlay) finish(null); });
      box.addEventListener('keydown', e => {
        e.stopPropagation();          // 弹窗内按键不触发画布快捷键
        if (e.key === 'Escape') { e.preventDefault(); finish(null); }
        else if (e.key === 'Enter') {
          if (o.multiline && !e.ctrlKey) return;   // 多行: Enter 换行, Ctrl+Enter 确定
          e.preventDefault(); ok();
        }
      });
      if (input) input.addEventListener('input', () => {
        input.classList.remove('invalid');
        errEl.style.display = 'none';
      });
      // 标题栏拖动移位 (✕ 按钮除外)
      head.addEventListener('pointerdown', e => {
        if (e.button !== 0 || e.target.closest('button')) return;
        e.preventDefault();
        const r = box.getBoundingClientRect();
        box.style.position = 'fixed';
        box.style.left = r.left + 'px';
        box.style.top = r.top + 'px';
        box.style.width = r.width + 'px';
        const dx = e.clientX - r.left, dy = e.clientY - r.top;
        const move = ev => {
          box.style.left = Math.max(0, ev.clientX - dx) + 'px';
          box.style.top = Math.max(0, ev.clientY - dy) + 'px';
        };
        const up = () => {
          window.removeEventListener('pointermove', move);
          window.removeEventListener('pointerup', up);
        };
        window.addEventListener('pointermove', move);
        window.addEventListener('pointerup', up);
      });

      const win = { close: finish };
      wins.push(win);
      btnOk.onclick = ok;
      document.body.appendChild(overlay);
      (input || btnOk).focus();
      if (input && input.value) {
        if (o.multiline) input.setSelectionRange(0, 0);   // 多行: 光标置顶 (Ctrl+A 全选复制)
        else input.select();
      }
    });
  }

  return {
    /* prompt({...}) → Promise<string|null>; validate(输入) 返回错误字符串或 null */
    prompt: opts => open(Object.assign({ label: '', validate: null }, opts)),
    /* confirm({...}) → Promise<boolean> */
    confirm: opts => open(Object.assign({ message: '' }, opts)),
    /* info({title, message}) → Promise<true>: 纯信息查看弹窗, 只有"关闭"按钮 */
    info: opts => open(Object.assign({ message: '', okText: t('关闭'), hideCancel: true }, opts)),
    /* 关闭全部窗口 (上层先关) */
    closeAll: () => { for (const w of [...wins].reverse()) w.close(null); },
    /* 当前并存窗口数 */
    get count() { return wins.length; },
  };
})();
