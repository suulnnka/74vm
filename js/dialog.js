/* ================= 自定义弹窗组件 =================
   替代系统原生 prompt/confirm。可用性:
   - 打开即聚焦输入框并全选现有文本, 可直接输入覆盖
   - Enter = 确定, Esc = 取消 (焦点在任何弹窗控件上都生效)
   - 点击遮罩/✕ = 取消; 点击弹窗内部不会误关
   - 校验失败: 红框+内联错误, 不关闭, 重新聚焦全选
   - 弹窗内按键 stopPropagation, 不会触发画布快捷键 (空格暂停/R旋转等) */

const Dialog = (() => {
  let cur = null;   // 当前弹窗 { close }

  function open(opts) {
    if (cur) cur.close(null);   // 重复打开时先取消上一个
    const o = Object.assign({
      title: '', message: '', label: null, value: '', placeholder: '',
      okText: '确定', cancelText: '取消', danger: false, validate: null,
    }, opts);
    return new Promise(resolve => {
      let done = false;
      const finish = v => {
        if (done) return;
        done = true;
        overlay.remove();
        cur = null;
        resolve(v);
      };

      const overlay = document.createElement('div');
      overlay.className = 'modal';

      const box = document.createElement('div');
      box.className = 'modal-box dialog-box';

      const head = document.createElement('div');
      head.className = 'modal-head';
      const title = document.createElement('b');
      title.textContent = o.title;
      const x = document.createElement('button');
      x.className = 'btn'; x.textContent = '✕'; x.title = '取消 (Esc)';
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
      if (o.label != null) {
        const lb = document.createElement('label');
        lb.className = 'dlg-label';
        lb.textContent = o.label;
        input = document.createElement('input');
        input.className = 'dlg-input';
        input.type = 'text';
        input.value = o.value;
        input.placeholder = o.placeholder;
        input.spellcheck = false;
        errEl = document.createElement('div');
        errEl.className = 'dlg-err';
        errEl.style.display = 'none';
        body.appendChild(lb); body.appendChild(input); body.appendChild(errEl);
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
      foot.appendChild(btnCancel); foot.appendChild(btnOk);

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
        else if (e.key === 'Enter') { e.preventDefault(); ok(); }
      });
      if (input) input.addEventListener('input', () => {
        input.classList.remove('invalid');
        errEl.style.display = 'none';
      });

      btnOk.onclick = ok;
      document.body.appendChild(overlay);
      cur = { close: finish };
      (input || btnOk).focus();
      if (input && input.value) input.select();
    });
  }

  return {
    /* prompt({...}) → Promise<string|null>; validate(输入) 返回错误字符串或 null */
    prompt: opts => open(Object.assign({ label: '', validate: null }, opts)),
    /* confirm({...}) → Promise<boolean> */
    confirm: opts => open(Object.assign({ message: '' }, opts)),
  };
})();
