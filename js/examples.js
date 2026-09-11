/* =========================================================================
 * 74VM 内置示例电路
 *
 * 全部示例保证在三种模式下可用:
 *   原理图模式 — 网表直接仿真;
 *   面包板模式 — 元件总数/占位列数按 60 列单板规划, 自动摆放不溢出,
 *                DIP 与有源元件 (CLOCK/PS2/NE555) 的供电由自动布线生成;
 *   PCB 模式   — 自动布局全部落在板内。
 * 控制引脚尽量显式接线 (~CLR→VCC、~ST→GND 等), 悬空仅用于确实无影响的脚。
 * (test/test-examples.js 对每个示例做三种模式的自动化验证)
 * ========================================================================= */
(function (global) {
'use strict';

/** 构建器: add(type,x,y,{rot,props,state}) → id; wire(aId,a引脚,bId,b引脚) */
function B() {
  const chips = [], wires = [];
  const add = (type, x, y, opt) => {
    const c = Object.assign({ id: chips.length + 1, type, x, y, rot: 0, props: {}, state: {} }, opt || {});
    chips.push(c);
    return c.id;
  };
  const wire = (a, an, b, bn) => wires.push({ a: [a, an], b: [b, bn] });
  return { chips, wires, add, wire };
}

/* =========================================================================
 * VM-8 — 74 系列微码 8 位 CPU (时钟计算机示例的构建核心)
 *
 * 架构 (41 个元件):
 *   总线 8 位; PC=2×74161(+74245 总线缓冲); MAR/IR/A/B/OUT=74374;
 *   程序 ROM=74S472 256B; RAM=6116; ALU=74283×2+7486×2(+74245 缓冲, 加/减);
 *   定序器=74161 (6 节拍/指令, 下降沿计数); 控制 ROM=74S472×3
 *   (地址 = {节拍3位, IR.bit3, 操作码4位}); Z 标志=7474 (或树+触发器);
 *   电源开关 SW: 门控主时钟与 1Hz, 并保持 PC/定序器复位 (关机=整机静止)
 * 外设: LCD1602 (OUT 寄存器直驱数据, RS/E 由微码产生);
 *   PS/2 → 74164 移位 + 74161 位计数 (第 9 位对齐) + 74374 键码锁存;
 *   1Hz 时钟 → 7474 秒沿标志; 74245 汇成输入口 (bit0=秒, bit1=新键)。
 * 时序: 寄存器在 CLK 上升沿写入 (行使能经与门), 定序器在下降沿推进,
 *   控制行在半周期内稳定 → 每行恰好提交一次; RAM /WE=NaN(RW·CLK) 限写窗。
 * ISA (高 4 位操作码, 2 字节指令带 8 位操作数):
 *   0 NOP 1 LDI 2 LDA 3 STA 4 ADI 5 ADA 6 CPI 7 CMA
 *   8 OUT 9 CMD A JMP B JZ C JNZ D KBD E TCK F CLF/CLT(0xF0/0xF8)
 * ========================================================================= */

/* ---- 微码: 信号语义 → 3 片 74S472 的内容 ----
 * 位极性按消费端定义:
 *   低有效(0=有效, 直驱 /OE·/CE·~CLR 或进入低有效分支网): CO RO RI AO EO KO TI TF KF JP JM JN
 *   高有效(1=有效, 经与门/ENP/E/RS/SUB): MI II RW CE AI BI OI RS SUB E RUN(D7 停机位, 常为 1) */
const VM8_MC = (() => {
  const F0 = ['CO', 'MI'], F1 = ['RO', 'II', 'CE'];
  const T2B = ['CO', 'MI', 'CE'], T21 = ['CO', 'MI'];
  const rows = [];
  rows[0x0] = [F0, F1, T21, [], [], []];
  rows[0x1] = [F0, F1, T2B, ['RO', 'AI'], [], []];
  rows[0x2] = [F0, F1, T2B, ['RO', 'MI'], ['RI', 'AI'], []];
  rows[0x3] = [F0, F1, T2B, ['RO', 'MI'], ['AO', 'RW', 'RI'], []];
  rows[0x4] = [F0, F1, T2B, ['RO', 'BI'], ['EO', 'AI'], []];
  rows[0x5] = [F0, F1, T2B, ['RO', 'MI'], ['RI', 'BI'], ['EO', 'AI']];
  rows[0x6] = [F0, F1, T2B, ['RO', 'BI'], ['EO', 'SUB'], []];
  rows[0x7] = [F0, F1, T2B, ['RO', 'MI'], ['RI', 'BI'], ['EO', 'SUB']];
  rows[0x8] = [F0, F1, T21, ['AO', 'OI', 'RS'], ['E', 'RS'], []];
  rows[0x9] = [F0, F1, T21, ['AO', 'OI'], ['E'], []];
  rows[0xA] = [F0, F1, T2B, ['RO', 'JP'], [], []];
  rows[0xB] = [F0, F1, T2B, ['RO', 'JM'], [], []];
  rows[0xC] = [F0, F1, T2B, ['RO', 'JN'], [], []];
  rows[0xD] = [F0, F1, T21, ['KO', 'AI'], [], []];
  rows[0xE] = [F0, F1, T21, ['TI', 'AI'], [], []];
  rows[0xF] = [F0, F1, T21, ['KF'], [], []];          // 0xF0=CLF; 0xF8=CLT 变体
  const MAP = [
    [0, { CO: 0x01, MI: 0x02, RO: 0x04, II: 0x08, RI: 0x20, RW: 0x40, CE: 0x80 }],
    [1, { AI: 0x01, AO: 0x02, BI: 0x04, EO: 0x08, OI: 0x10, KO: 0x20, TI: 0x40, RS: 0x80 }],
    [2, { TF: 0x01, KF: 0x02, SUB: 0x04, E: 0x08, JP: 0x10, JM: 0x20, JN: 0x40, RUN: 0x80 }],
  ];
  /* 空闲行: 低有效位=1, 高有效位=0 (全不有效); 定序器回绕瞬态经过 step 6 时不误触发 */
  const IDLE = [0x3E, 0x6E, 0xF3];
  const c = [new Array(512).fill(IDLE[0]), new Array(512).fill(IDLE[1]), new Array(512).fill(IDLE[2])];
  for (let addr = 0; addr < 512; addr++) {
    const op = (addr >> 4) & 0xF, bit3 = (addr >> 3) & 1, step = addr & 7;
    if (step > 5) continue;
    c[0][addr] = IDLE[0]; c[1][addr] = IDLE[1]; c[2][addr] = IDLE[2];
    let set;
    if (op === 0xF && bit3) set = (step >= 3 ? ['TF'] : rows[0xF][step]);
    else set = rows[op][step];
    set = set.concat('RUN');
    for (const [i, map] of MAP) {
      let v = c[i][addr];
      for (const s in map) {
        const on = set.indexOf(s) >= 0;
        if (s === 'RUN') v = on ? (v | map[s]) : (v & ~map[s]);      // RUN 高有效
        else if (['MI', 'II', 'RW', 'CE', 'AI', 'BI', 'OI', 'RS', 'SUB', 'E'].indexOf(s) >= 0)
          v = on ? (v | map[s]) : (v & ~map[s]);                     // 高有效组
        else v = on ? (v & ~map[s]) : (v | map[s]);                  // 低有效组
      }
      c[i][addr] = v;
    }
  }
  return c;
})();

/* ---- 迷你汇编器: 两遍扫描, 标签 + 0x/十进制立即数 ---- */
const VM8_OPS = {
  NOP: { op: 0x0, len: 1 }, LDI: { op: 0x1, len: 2 }, LDA: { op: 0x2, len: 2 },
  STA: { op: 0x3, len: 2 }, ADI: { op: 0x4, len: 2 }, ADA: { op: 0x5, len: 2 },
  CPI: { op: 0x6, len: 2 }, CMA: { op: 0x7, len: 2 }, OUT: { op: 0x8, len: 1 },
  CMD: { op: 0x9, len: 1 }, JMP: { op: 0xA, len: 2 }, JZ: { op: 0xB, len: 2 },
  JNZ: { op: 0xC, len: 2 }, KBD: { op: 0xD, len: 1 }, TCK: { op: 0xE, len: 1 },
  CLF: { op: 0xF, len: 1, imm: 0x0 }, CLT: { op: 0xF, len: 1, imm: 0x8 },
};
function vm8Assemble(src) {
  const srcText = Array.isArray(src) ? src.join('\n') : String(src);
  const lines = srcText.split('\n');
  const items = [], consts = {};
  for (const raw of lines) {
    const line = raw.replace(/;.*$/, '').trim();
    if (!line) continue;
    const cm = line.match(/^([A-Za-z_][\w.]*)\s*=\s*(\S+)\s*$/);
    if (cm) { consts[cm[1]] = cm[2]; continue; }
    let rest = line;
    const lm = rest.match(/^([A-Za-z_][\w.]*):\s*/);
    if (lm) { items.push({ label: lm[1] }); rest = rest.slice(lm[0].length); }
    if (!rest) continue;
    const m = rest.match(/^(\w+)\s*(.*)$/);
    if (!m || !VM8_OPS[m[1].toUpperCase()]) throw new Error('VM-8 汇编: 无法识别: ' + line);
    items.push({ mn: m[1].toUpperCase(), arg: m[2].trim() });
  }
  const pass = (resolve) => {
    const mem = new Array(512).fill(0x00);             // 出厂区: NOP
    let pc = 0;
    for (const it of items) {
      if (it.label) { if (!resolve) it.addr = pc; continue; }
      const d = VM8_OPS[it.mn];
      if (pc + d.len > 254) throw new Error('VM-8 程序超出 254 字节: ' + pc);
      if (resolve) {
        mem[pc] = (d.op << 4) | (d.imm != null ? d.imm : 0);
        if (d.len === 2) {
          let v = it.argVal;
          if (v == null) throw new Error('VM-8 汇编: 缺操作数: ' + it.mn);
          if (typeof v === 'string') {
            if (!(v in resolve.labels)) throw new Error('VM-8 汇编: 未知标签: ' + v);
            v = resolve.labels[v];
          }
          if (!(v >= 0 && v <= 255)) throw new Error('VM-8 汇编: 操作数越界: ' + v);
          mem[pc + 1] = v;
        }
      } else if (d.len === 2 && !/^(0x[0-9a-f]+|\d+)$/i.test(it.arg || '')) {
        it.argVal = it.arg;                            // 标签操作数, 二次解析
      } else if (d.len === 2) {
        it.argVal = parseInt(it.arg, 0);
      }
      pc += d.len;
    }
    return { mem, size: pc };
  };
  pass(null);
  const labels = {};
  for (const k in consts) {
    let v = consts[k];
    v = /^(0x[0-9a-f]+|\d+)$/i.test(v) ? parseInt(v, 0) : consts[v] != null ? consts[v] : labels[v];
    if (!(v >= 0)) throw new Error('VM-8 汇编: 常量未定义: ' + k + '=' + consts[k]);
    labels[k] = v;
  }
  for (const it of items) if (it.label) labels[it.label] = it.addr;
  const r = pass({ labels });
  return { mem: r.mem, size: r.size, labels };
}

/* ---- 时钟程序: 1602 显示 HH:MM:SS; 键 A(0x1C)=时+1, C(0x21)=秒清零 ----
 * RAM: 0x10 秒个 0x11 秒十 0x12 分个 0x13 分十 0x14 时个 0x15 时十 (BCD) */
const VM8_PROG = vm8Assemble([
  'SEC1  = 0x10        ; RAM: 秒个位 (BCD)',
  'SEC10 = 0x11',
  'MIN1  = 0x12',
  'MIN10 = 0x13',
  'HR1   = 0x14',
  'HR10  = 0x15',
  '        LDI 0x01        ; 清屏',
  '        CMD',
  '        LDI 0',
  '        STA SEC1',
  '        STA SEC10',
  '        STA MIN1',
  '        STA MIN10',
  '        STA HR1',
  '        STA HR10',
  '        JMP REFRESH',
  'MAIN:   TCK             ; A = 事件: bit0 秒 tick, bit1 新键',
  '        CPI 0',
  '        JZ MAIN',
  '        CPI 1',
  '        JZ DOTICK',
  '        KBD             ; 有键: 先取键码并清键标志',
  '        CLF',
  '        CPI 0xF0        ; break 前缀: 丢弃',
  '        JZ MAIN',
  '        CPI 0x1C        ; A 键 → 时 +1',
  '        JZ KHOUR',
  '        CPI 0x21        ; C 键 → 秒清零',
  '        JZ KSEC',
  '        JMP MAIN',
  'KSEC:   LDI 0',
  '        STA SEC1',
  '        STA SEC10',
  '        JMP REFRESH',
  '; --- 时 +1 (BCD 个位/十位, 24 小时回绕) ---',
  'KHOUR:  LDA HR1',
  '        ADI 1',
  '        CPI 10',
  '        JZ KH1',
  '        STA HR1',
  '        JMP KHRNG',
  'KH1:    LDI 0',
  '        STA HR1',
  '        LDA HR10',
  '        ADI 1',
  '        STA HR10',
  'KHRNG:  LDA HR10',
  '        CPI 2',
  '        JZ KHR2',
  '        JMP REFRESH',
  'KHR2:   LDA HR1',
  '        CPI 4',
  '        JZ KHWR',
  '        JMP REFRESH',
  'KHWR:   LDI 0',
  '        STA HR10',
  '        STA HR1',
  '        JMP REFRESH',
  '; --- 秒 tick: BCD 进位链 秒→分→时 ---',
  'DOTICK: CLT',
  '        LDA SEC1',
  '        ADI 1',
  '        CPI 10',
  '        JZ TS1',
  '        STA SEC1',
  '        JMP REFRESH',
  'TS1:    LDI 0',
  '        STA SEC1',
  '        LDA SEC10',
  '        ADI 1',
  '        CPI 6',
  '        JZ TS10',
  '        STA SEC10',
  '        JMP REFRESH',
  'TS10:   LDI 0',
  '        STA SEC10',
  '        LDA MIN1',
  '        ADI 1',
  '        CPI 10',
  '        JZ TM1',
  '        STA MIN1',
  '        JMP REFRESH',
  'TM1:    LDI 0',
  '        STA MIN1',
  '        LDA MIN10',
  '        ADI 1',
  '        CPI 6',
  '        JZ TM10',
  '        STA MIN10',
  '        JMP REFRESH',
  'TM10:   LDI 0',
  '        STA MIN10',
  '        LDA HR1',
  '        ADI 1',
  '        CPI 10',
  '        JZ TH1',
  '        STA HR1',
  '        JMP REFRESH',
  'TH1:    LDI 0',
  '        STA HR1',
  '        LDA HR10',
  '        ADI 1',
  '        STA HR10',
  'THR:    LDA HR10',
  '        CPI 2',
  '        JZ THR2',
  '        JMP REFRESH',
  'THR2:   LDA HR1',
  '        CPI 4',
  '        JZ THWR',
  '        JMP REFRESH',
  'THWR:   LDI 0',
  '        STA HR10',
  '        STA HR1',
  '; --- 刷新 1602 第 1 行: HH:MM:SS ---',
  'REFRESH:',
  '        LDI 0x80',
  '        CMD',
  '        LDA HR10',
  '        ADI 48',
  '        OUT',
  '        LDA HR1',
  '        ADI 48',
  '        OUT',
  '        LDI 0x3A',
  '        OUT',
  '        LDA MIN10',
  '        ADI 48',
  '        OUT',
  '        LDA MIN1',
  '        ADI 48',
  '        OUT',
  '        LDI 0x3A',
  '        OUT',
  '        LDA SEC10',
  '        ADI 48',
  '        OUT',
  '        LDA SEC1',
  '        ADI 48',
  '        OUT',
  '        JMP MAIN',
]);

/* ---- VM-8 内置程序库 ----
 * 可在电路中右键程序 ROM (74S472, 标签 vm8-program) → 载入 VM-8 程序, 烧入后自动冷启动。
 * 教学线索: 从计数器 → 迎宾 → 打字机 → 秒表 → 出厂时钟, 难度递进;
 * 全部程序只使用 ISA 的 17 条指令, RAM 变量统一从 0x10 起 (0x00~0x0F 保留给 0 页用法)。 */
const VM8_PROGS = [
  {
    id: 'counter', name: '计数器 (00~59 循环)',
    desc: '最小程序: 轮询 1Hz 秒脉冲, 1602 显示 00~59 循环 (70 字节)',
    src: [
      '; 计数器: 第 1 行显示 00~59 循环, 1Hz 实时时钟驱动 (入门: 轮询 + BCD 进位 + 显示)',
      'SEC1  = 0x10        ; RAM: 秒个位 (BCD)',
      'SEC10 = 0x11        ; RAM: 秒十位',
      '        LDI 0x01    ; LCD 指令 0x01 = 清屏',
      '        CMD',
      '        LDI 0',
      '        STA SEC1',
      '        STA SEC10',
      '        JMP SHOW    ; 上电先显示 00, 再进轮询',
      'LOOP:   TCK         ; A = 输入口: bit0=秒脉冲, bit1=新按键',
      '        CPI 1       ; 只踩到秒脉冲?',
      '        JZ TICK',
      '        CPI 3       ; 秒脉冲与新键同拍: 先走秒',
      '        JZ TICK',
      '        JMP LOOP',
      'TICK:   CLT         ; 清秒标志 (电平标志, 读完必须清)',
      '        LDA SEC1',
      '        ADI 1',
      '        CPI 10',
      '        JZ C1',
      '        STA SEC1',
      '        JMP SHOW',
      'C1:     LDI 0',
      '        STA SEC1',
      '        LDA SEC10',
      '        ADI 1',
      '        CPI 6',
      '        JZ C10',
      '        STA SEC10',
      '        JMP SHOW',
      'C10:    LDI 0',
      '        STA SEC10   ; 59 → 00',
      'SHOW:   LDI 0x80    ; LCD 指令 0x80|0 = 光标回 (0,0)',
      '        CMD',
      '        LDA SEC10',
      '        ADI 48      ; BCD 数字 → ASCII',
      '        OUT',
      '        LDA SEC1',
      '        ADI 48',
      '        OUT',
      '        JMP LOOP',
    ],
  },
  {
    id: 'hello', name: '迎宾动画 (按任意键重播)',
    desc: '开机逐字打出「你好 74VM-8!」(GB2312 中文), 按任意键重播 (57 字节)',
    src: [
      '; 迎宾: 逐字打出「你好 74VM-8!」, 按任意键重播 (松开键的 break 码被忽略)',
      'START:  LDI 0x01    ; 清屏',
      '        CMD',
      '        LDI 0xC4    ; 「你」 GB2312 首字节 (液晶自动配对双字节)',
      '        OUT',
      '        LDI 0xE3    ; 「你」 次字节',
      '        OUT',
      '        LDI 0xBA    ; 「好」 首字节',
      '        OUT',
      '        LDI 0xC3    ; 「好」 次字节',
      '        OUT',
      '        LDI 0x20    ; 空格',
      '        OUT',
      '        LDI 0x37    ; 7',
      '        OUT',
      '        LDI 0x34    ; 4',
      '        OUT',
      '        LDI 0x56    ; V',
      '        OUT',
      '        LDI 0x4D    ; M',
      '        OUT',
      '        LDI 0x2D    ; -',
      '        OUT',
      '        LDI 0x38    ; 8',
      '        OUT',
      '        LDI 0x21    ; !',
      '        OUT',
      'WAIT:   TCK',
      '        CPI 0       ; 无事件: 继续等',
      '        JZ WAIT',
      '        CPI 1       ; 只有秒脉冲: 忽略',
      '        JZ WAIT',
      '        CLT         ; 秒+键同拍时顺带清秒标志',
      '        KBD         ; 读走键码并清键标志',
      '        CLF',
      '        CPI 0xF0    ; break (松开): 忽略',
      '        JZ WAIT',
      '        JMP START   ; 任意按键 → 重播',
    ],
  },
  {
    id: 'typewriter', name: '打字机 (数字/空格/回车/Esc)',
    desc: 'PS/2 数字键 0~9 打到 1602, 空格=空格, Enter=换行, Esc=清屏 (139 字节)',
    src: [
      '; 打字机: 数字键 0~9 回显到 1602, 空格=空格, Enter=换到第 2 行, Esc=清屏',
      '; (完整键盘映射需要 256 项查表 — VM-8 没有变址寻址, 这正是教学留白, 见 docs/vm8-guide.md)',
      '        LDI 0x01',
      '        CMD',
      'MAIN:   TCK',
      '        CPI 2       ; 新按键?',
      '        JZ KEY',
      '        CPI 3',
      '        JZ KEY',
      '        JMP MAIN',
      'KEY:    KBD         ; A = 扫描码',
      '        CLF',
      '        CPI 0xF0    ; break 前缀: 丢弃',
      '        JZ MAIN',
      '        CPI 0x76    ; Esc → 清屏',
      '        JZ CLEAR',
      '        CPI 0x5A    ; Enter → 换行',
      '        JZ NEWLN',
      '        CPI 0x29    ; 空格',
      '        JZ SPACE',
      '        CPI 0x45    ; 0',
      '        JZ D0',
      '        CPI 0x46    ; 9',
      '        JZ D9',
      '        CPI 0x16    ; 1',
      '        JZ D1',
      '        CPI 0x1E    ; 2',
      '        JZ D2',
      '        CPI 0x26    ; 3',
      '        JZ D3',
      '        CPI 0x25    ; 4',
      '        JZ D4',
      '        CPI 0x2E    ; 5',
      '        JZ D5',
      '        CPI 0x36    ; 6',
      '        JZ D6',
      '        CPI 0x3D    ; 7',
      '        JZ D7',
      '        CPI 0x3E    ; 8',
      '        JZ D8',
      '        JMP MAIN    ; 其他键不认 (映射表思想的局限)',
      'CLEAR:  LDI 0x01',
      '        CMD',
      '        JMP MAIN',
      'NEWLN:  LDI 0xC0    ; 0x80|0x40 = 第 2 行行首',
      '        CMD',
      '        JMP MAIN',
      'SPACE:  LDI 0x20',
      '        OUT',
      '        JMP MAIN',
      'D0:     LDI 48',
      '        OUT',
      '        JMP MAIN',
      'D1:     LDI 49',
      '        OUT',
      '        JMP MAIN',
      'D2:     LDI 50',
      '        OUT',
      '        JMP MAIN',
      'D3:     LDI 51',
      '        OUT',
      '        JMP MAIN',
      'D4:     LDI 52',
      '        OUT',
      '        JMP MAIN',
      'D5:     LDI 53',
      '        OUT',
      '        JMP MAIN',
      'D6:     LDI 54',
      '        OUT',
      '        JMP MAIN',
      'D7:     LDI 55',
      '        OUT',
      '        JMP MAIN',
      'D8:     LDI 56',
      '        OUT',
      '        JMP MAIN',
      'D9:     LDI 57',
      '        OUT',
      '        JMP MAIN',
    ],
  },
  {
    id: 'stopwatch', name: '秒表 (空格启停 / C 清零)',
    desc: 'MM:SS 计时: 空格=启动/暂停, C=清零; 1Hz 驱动, 展示状态机 (181 字节)',
    src: [
      '; 秒表: 显示 MM:SS; 空格 = 启动/暂停, C = 清零; 1Hz 实时时钟驱动',
      'RUN   = 0x10        ; 1=计时中, 0=暂停',
      'SEC1  = 0x11',
      'SEC10 = 0x12',
      'MIN1  = 0x13',
      'MIN10 = 0x14',
      '        LDI 0x01',
      '        CMD',
      '        LDI 1       ; 上电即开始计时',
      '        STA RUN',
      '        LDI 0',
      '        STA SEC1',
      '        STA SEC10',
      '        STA MIN1',
      '        STA MIN10',
      '        JMP SHOW',
      'MAIN:   TCK',
      '        CPI 1',
      '        JZ TICK',
      '        CPI 3',
      '        JZ TICK',
      '        CPI 2',
      '        JZ KEY',
      '        JMP MAIN',
      'TICK:   CLT',
      '        LDA RUN',
      '        CPI 1       ; 暂停中则不计秒',
      '        JZ ADDSEC',
      '        JMP MAIN',
      'ADDSEC: LDA SEC1',
      '        ADI 1',
      '        CPI 10',
      '        JZ TS1',
      '        STA SEC1',
      '        JMP SHOW',
      'TS1:    LDI 0',
      '        STA SEC1',
      '        LDA SEC10',
      '        ADI 1',
      '        CPI 6',
      '        JZ TS10',
      '        STA SEC10',
      '        JMP SHOW',
      'TS10:   LDI 0',
      '        STA SEC10',
      '        LDA MIN1',
      '        ADI 1',
      '        CPI 10',
      '        JZ TM1',
      '        STA MIN1',
      '        JMP SHOW',
      'TM1:    LDI 0',
      '        STA MIN1',
      '        LDA MIN10',
      '        ADI 1',
      '        CPI 10',
      '        JZ TM10',
      '        STA MIN10',
      '        JMP SHOW',
      'TM10:   LDI 0',
      '        STA MIN10   ; 99:59 → 00:00',
      '        JMP SHOW',
      'KEY:    KBD',
      '        CLF',
      '        CPI 0xF0',
      '        JZ MAIN',
      '        CPI 0x29    ; 空格: 启动/暂停切换',
      '        JZ TGL',
      '        CPI 0x21    ; C: 清零 (不清 RUN)',
      '        JZ RST',
      '        JMP MAIN',
      'TGL:    LDA RUN',
      '        CPI 1',
      '        JZ PAUSE',
      '        LDI 1',
      '        STA RUN',
      '        JMP MAIN',
      'PAUSE:  LDI 0',
      '        STA RUN',
      '        JMP MAIN',
      'RST:    LDI 0',
      '        STA SEC1',
      '        STA SEC10',
      '        STA MIN1',
      '        STA MIN10',
      'SHOW:   LDI 0x80',
      '        CMD',
      '        LDA MIN10',
      '        ADI 48',
      '        OUT',
      '        LDA MIN1',
      '        ADI 48',
      '        OUT',
      '        LDI 0x3A    ; ":"',
      '        OUT',
      '        LDA SEC10',
      '        ADI 48',
      '        OUT',
      '        LDA SEC1',
      '        ADI 48',
      '        OUT',
      '        JMP MAIN',
    ],
  },
  {
    id: 'clock', name: '出厂时钟程序 (HH:MM:SS)',
    desc: '示例默认程序: 走时时钟, 键 A=时+1, C=秒清零 (248 字节)',
    mem: VM8_PROG.mem.slice(),
    size: VM8_PROG.size,
    labels: VM8_PROG.labels,
  },
];

const EXAMPLES = [];
global.VM8 = { MC: VM8_MC, PROG: VM8_PROG, PROGS: VM8_PROGS, assemble: vm8Assemble, OPS: VM8_OPS };
/* 程序库源码惰性汇编 (clock 程序直接引用已汇编结果); Node 测试同样可用 */
for (const p of VM8_PROGS) if (!p.mem) {
  const r = vm8Assemble(p.src);
  p.mem = r.mem; p.size = r.size; p.labels = r.labels;
}

/* 1. SR 锁存器 (7400 与非门交叉耦合) */
EXAMPLES.push({
  name: 'SR 锁存器 (7400)',
  desc: '与非门交叉反馈; 开关输出 0 触发置位/复位, 同时为 0 是禁止态',
  build() {
    const b = B();
    const swS = b.add('SW', 190, 150, { props: { label: '~S 置位' } });
    const swR = b.add('SW', 190, 300, { props: { label: '~R 复位' } });
    const nand = b.add('7400', 460, 240);
    const ledQ = b.add('LED', 760, 170, { props: { label: 'Q' } });
    const ledNQ = b.add('LED', 760, 320, { props: { label: '~Q' } });
    b.wire(swS, 1, nand, 1);       // ~S → 1A
    b.wire(swR, 1, nand, 5);       // ~R → 2B
    b.wire(nand, 3, nand, 4);      // 1Y → 2A (反馈)
    b.wire(nand, 6, nand, 2);      // 2Y → 1B (反馈)
    b.wire(nand, 3, ledQ, 1);
    b.wire(nand, 6, ledNQ, 1);
    return b;
  },
});

/* 2. D 触发器二分频 (7474) */
EXAMPLES.push({
  name: 'D 触发器二分频 (7474)',
  desc: 'D 接 ~Q, 时钟上升沿翻转, Q 频率 = CLK 一半',
  build() {
    const b = B();
    const clk = b.add('CLOCK', 170, 200);
    const vcc = b.add('VCC', 170, 380);
    const ff = b.add('7474', 450, 260);
    const led = b.add('LED', 740, 240, { props: { label: 'Q = CLK/2' } });
    b.wire(clk, 1, ff, 3);         // CK
    b.wire(ff, 6, ff, 2);          // 1~Q → 1D
    b.wire(vcc, 1, ff, 1);         // 1~CLR
    b.wire(vcc, 1, ff, 4);         // 1~PRE
    b.wire(ff, 5, led, 1);         // 1Q → LED
    return b;
  },
});

/* 3. 半加器 (7486 + 7408) */
EXAMPLES.push({
  name: '半加器 (7486+7408)',
  desc: 'S = A⊕B, C = A·B, 拨 A/B 开关看四位真值表',
  build() {
    const b = B();
    const swA = b.add('SW', 170, 150, { props: { label: 'A' } });
    const swB = b.add('SW', 170, 330, { props: { label: 'B' } });
    const xor = b.add('7486', 450, 190);
    const and = b.add('7408', 450, 430);
    const ledS = b.add('LED', 760, 170, { props: { label: 'S 和' } });
    const ledC = b.add('LED', 760, 450, { props: { label: 'C 进位' } });
    b.wire(swA, 1, xor, 1);
    b.wire(swA, 1, and, 1);
    b.wire(swB, 1, xor, 2);
    b.wire(swB, 1, and, 2);
    b.wire(xor, 3, ledS, 1);
    b.wire(and, 3, ledC, 1);
    return b;
  },
});

/* 4. 4 位全加器 (74283) — A+B 带进位输入/输出 (位名按手册: A4/B4/S4 为最高位) */
EXAMPLES.push({
  name: '4位全加器 (74283)',
  desc: '拨 A4~A1 / B4~B1 开关, LED 显示和 S4~S1 与进位 C4',
  build() {
    const b = B();
    const swA = ['A4', 'A3', 'A2', 'A1'].map((lb, i) =>
      b.add('SW', 160, 110 + i * 80, { props: { label: lb } }));
    const swB = ['B4', 'B3', 'B2', 'B1'].map((lb, i) =>
      b.add('SW', 160, 460 + i * 80, { props: { label: lb } }));
    const gnd = b.add('GND', 160, 800);
    const adder = b.add('74283', 470, 440);
    const ledC = b.add('LED', 800, 110, { props: { label: 'C4 进位' } });
    const ledS = ['S4', 'S3', 'S2', 'S1'].map((lb, i) =>
      b.add('LED', 800, 210 + i * 80, { props: { label: lb } }));
    b.wire(gnd, 1, adder, 7);      // C0 进位输入接地
    [12, 14, 3, 5].forEach((pin, i) => b.wire(swA[i], 1, adder, pin));   // A4..A1
    [11, 15, 2, 6].forEach((pin, i) => b.wire(swB[i], 1, adder, pin));   // B4..B1
    b.wire(adder, 9, ledC, 1);     // C4
    [10, 13, 1, 4].forEach((pin, i) => b.wire(adder, pin, ledS[i], 1));  // S4..S1
    return b;
  },
});

/* 5. 3-8 译码器 (74138) */
EXAMPLES.push({
  name: '3-8 译码器 (74138)',
  desc: '开关选择地址 CBA, 对应 Y 输出低电平 (LED 熄灭)',
  build() {
    const b = B();
    const swA = b.add('SW', 160, 130, { props: { label: 'A' } });
    const swB = b.add('SW', 160, 240, { props: { label: 'B' } });
    const swC = b.add('SW', 160, 350, { props: { label: 'C' } });
    const vcc = b.add('VCC', 160, 500);
    const gnd = b.add('GND', 160, 590);
    const dec = b.add('74138', 440, 330);
    const outs = [[15, 'Y0'], [14, 'Y1'], [13, 'Y2'], [12, 'Y3'], [11, 'Y4'], [10, 'Y5'], [9, 'Y6'], [7, 'Y7']];
    const leds = outs.map(([, nm], i) => b.add('LED', 760, 90 + i * 68, { props: { label: nm } }));
    b.wire(swA, 1, dec, 1);
    b.wire(swB, 1, dec, 2);
    b.wire(swC, 1, dec, 3);
    b.wire(gnd, 1, dec, 4);        // ~G2A
    b.wire(gnd, 1, dec, 5);        // ~G2B
    b.wire(vcc, 1, dec, 6);        // G1
    outs.forEach(([pin], i) => b.wire(dec, pin, leds[i], 1));
    return b;
  },
});

/* 6. 8 选 1 数据选择器 (74151) — D0~D3 接 1, D4~D7 接 0 */
EXAMPLES.push({
  name: '8选1数据选择器 (74151)',
  desc: '地址 CBA 选中一路数据: D0~D3=1, D4~D7=0, Y 与 ~Y 互补',
  build() {
    const b = B();
    const swA = b.add('SW', 160, 130, { props: { label: 'A' } });
    const swB = b.add('SW', 160, 240, { props: { label: 'B' } });
    const swC = b.add('SW', 160, 350, { props: { label: 'C' } });
    const vcc = b.add('VCC', 160, 500);
    const gnd = b.add('GND', 160, 590);
    const mux = b.add('74151', 450, 330);
    const ledY = b.add('LED', 760, 250, { props: { label: 'Y' } });
    const ledNY = b.add('LED', 760, 400, { props: { label: '~Y' } });
    b.wire(gnd, 1, mux, 7);        // ~ST 选通
    b.wire(swA, 1, mux, 11);
    b.wire(swB, 1, mux, 10);
    b.wire(swC, 1, mux, 9);
    [4, 3, 2, 1].forEach(pin => b.wire(vcc, 1, mux, pin));    // D0~D3 = 1
    [15, 14, 13, 12].forEach(pin => b.wire(gnd, 1, mux, pin)); // D4~D7 = 0
    b.wire(mux, 6, ledY, 1);
    b.wire(mux, 5, ledNY, 1);
    return b;
  },
});

/* 7. JK 触发器翻转 (7476) — J=K=1 时钟翻转 */
EXAMPLES.push({
  name: 'JK触发器翻转 (7476)',
  desc: 'J=K=1, 每个时钟上升沿翻转, Q 同样二分频',
  build() {
    const b = B();
    const clk = b.add('CLOCK', 170, 200, { props: { freq: 2 } });
    const vcc = b.add('VCC', 170, 380);
    const jk = b.add('7476', 450, 260);
    const ledQ = b.add('LED', 760, 190, { props: { label: 'Q = CLK/2' } });
    const ledNQ = b.add('LED', 760, 330, { props: { label: '~Q' } });
    b.wire(clk, 1, jk, 1);         // 1CK
    b.wire(vcc, 1, jk, 4);         // 1J
    b.wire(vcc, 1, jk, 5);         // 1K
    b.wire(vcc, 1, jk, 2);         // 1~PRE
    b.wire(vcc, 1, jk, 3);         // 1~CLR
    b.wire(jk, 6, ledQ, 1);        // 1Q
    b.wire(jk, 7, ledNQ, 1);       // 1~Q
    return b;
  },
});

/* 8. 4 位二进制计数器 (74161) */
EXAMPLES.push({
  name: '4位计数器 (74161)',
  desc: '时钟计数 0~15 循环, LED 显示 QA~QD 二进制',
  build() {
    const b = B();
    const clk = b.add('CLOCK', 160, 150, { props: { freq: 2 } });
    const vcc = b.add('VCC', 160, 460);
    const cnt = b.add('74161', 420, 300);
    const leds = [14, 13, 12, 11].map((pin, i) =>
      b.add('LED', 740, 170 + i * 78, { props: { label: ['QA', 'QB', 'QC', 'QD'][i] } }));
    b.wire(clk, 1, cnt, 2);        // CK
    b.wire(vcc, 1, cnt, 1);        // ~CLR
    b.wire(vcc, 1, cnt, 9);        // ~LOAD
    b.wire(vcc, 1, cnt, 7);        // ENP
    b.wire(vcc, 1, cnt, 10);       // ENT
    [14, 13, 12, 11].forEach((pin, i) => b.wire(cnt, pin, leds[i], 1));
    return b;
  },
});

/* 9. 数码管计数 (74161 + 7448 + 数码管) */
EXAMPLES.push({
  name: '数码管计数 (74161+7448)',
  desc: '计数器 → BCD 译码 → 七段数码管, 0-9 循环显示',
  build() {
    const b = B();
    const clk = b.add('CLOCK', 150, 150, { props: { freq: 2 } });
    const vcc = b.add('VCC', 150, 560);
    const cnt = b.add('74161', 390, 330);
    const seg48 = b.add('7448', 660, 330);
    const disp = b.add('SEG7', 960, 330);
    b.wire(clk, 1, cnt, 2);
    b.wire(vcc, 1, cnt, 1);        // ~CLR
    b.wire(vcc, 1, cnt, 9);        // ~LOAD
    b.wire(vcc, 1, cnt, 7);        // ENP
    b.wire(vcc, 1, cnt, 10);       // ENT
    b.wire(vcc, 1, seg48, 3);      // ~LT
    b.wire(vcc, 1, seg48, 4);      // ~BI
    b.wire(vcc, 1, seg48, 5);      // ~RBI
    b.wire(cnt, 14, seg48, 7);     // QA → A
    b.wire(cnt, 13, seg48, 1);     // QB → B
    b.wire(cnt, 12, seg48, 2);     // QC → C
    b.wire(cnt, 11, seg48, 6);     // QD → D
    b.wire(seg48, 13, disp, 1);    // a
    b.wire(seg48, 12, disp, 2);    // b
    b.wire(seg48, 11, disp, 3);    // c
    b.wire(seg48, 10, disp, 4);    // d
    b.wire(seg48, 9, disp, 5);     // e
    b.wire(seg48, 15, disp, 6);    // f
    b.wire(seg48, 14, disp, 7);    // g
    return b;
  },
});

/* 10. 8 位移位锁存 (74595) — 时钟移入, 按键锁存到输出 */
EXAMPLES.push({
  name: '8位移位锁存 (74595)',
  desc: '拨数据开关按时钟移入, 按锁存键才更新输出 LED',
  build() {
    const b = B();
    const clk = b.add('CLOCK', 150, 130, { props: { freq: 2 } });
    const swD = b.add('SW', 150, 260, { props: { label: '串行数据' } });
    const btn = b.add('BTN', 150, 380, { props: { label: '锁存 ST_CP' } });
    const vcc = b.add('VCC', 150, 500);
    const gnd = b.add('GND', 150, 590);
    const reg = b.add('74595', 460, 320);
    const leds = [15, 1, 2, 3, 4, 5, 6, 7].map((pin, i) =>
      b.add('LED', 780, 80 + i * 62, { props: { label: 'Q' + i } }));
    b.wire(clk, 1, reg, 11);       // SH_CP 移位时钟
    b.wire(swD, 1, reg, 14);       // DS 串行数据
    b.wire(btn, 1, reg, 12);       // ST_CP 锁存时钟
    b.wire(vcc, 1, reg, 10);       // ~MR 复位
    b.wire(gnd, 1, reg, 13);       // ~OE 使能输出
    [15, 1, 2, 3, 4, 5, 6, 7].forEach((pin, i) => b.wire(reg, pin, leds[i], 1));
    return b;
  },
});

/* 11. 环形振荡器 (7404 三级反相环) */
EXAMPLES.push({
  name: '环形振荡器 (7404)',
  desc: '奇数个反相器首尾相接, 以门延迟自激振荡',
  build() {
    const b = B();
    const inv = b.add('7404', 430, 250);
    const led = b.add('LED', 730, 190, { props: { label: '输出(高速闪烁)' } });
    b.wire(inv, 2, inv, 3);        // 1Y → 2A
    b.wire(inv, 4, inv, 5);        // 2Y → 3A
    b.wire(inv, 6, inv, 1);        // 3Y → 1A (闭环)
    b.wire(inv, 6, led, 1);
    return b;
  },
});

/* 12. 三态总线 (74245) */
EXAMPLES.push({
  name: '三态总线 (74245)',
  desc: 'DIR 控制方向, ~OE 使能; 断开 ~OE 输出高阻 LED 熄灭',
  build() {
    const b = B();
    const swDir = b.add('SW', 170, 150, { props: { label: 'DIR' }, state: { on: 1 } });
    const swOE = b.add('SW', 170, 270, { props: { label: '~OE 使能' } });
    const vcc = b.add('VCC', 170, 470);
    const tr = b.add('74245', 460, 350);
    const leds = [0, 1, 2, 3].map(i =>
      b.add('LED', 780, 170 + i * 70, { props: { label: 'B' + i } }));
    b.wire(swDir, 1, tr, 1);       // DIR
    b.wire(swOE, 1, tr, 11);       // ~OE
    b.wire(vcc, 1, tr, 2);         // A0 = 1
    b.wire(vcc, 1, tr, 3);         // A1 = 1
    b.wire(vcc, 1, tr, 4);         // A2 = 1
    b.wire(vcc, 1, tr, 5);         // A3 = 1
    [19, 18, 17, 16].forEach((pin, i) => b.wire(tr, pin, leds[i], 1));
    return b;
  },
});

/* 13. NE555 无稳态时钟 (闪烁灯) */
EXAMPLES.push({
  name: 'NE555 时钟闪烁灯',
  desc: '无稳态振荡: TRIG/THRES/DISCH 相连, OUT 输出方波 (右键改频率)',
  build() {
    const b = B();
    const vcc = b.add('VCC', 170, 180);
    const t555 = b.add('NE555', 440, 260);
    const led = b.add('LED', 740, 260, { props: { label: 'OUT 闪烁' } });
    b.wire(vcc, 1, t555, 4);       // ~RST → 1 振荡
    b.wire(t555, 2, t555, 6);      // TRIG ↔ THRES
    b.wire(t555, 6, t555, 7);      // THRES ↔ DISCH (RC 节点)
    b.wire(t555, 3, led, 1);       // OUT → LED
    return b;
  },
});

/* 14. PS/2 键盘扫描码接收 (PS2 + 74164) */
EXAMPLES.push({
  name: 'PS/2 扫描码接收 (74164)',
  desc: '点击键盘打字, CLK/Data 帧位移入 74164, LED 观察扫描码波形',
  build() {
    const b = B();
    const kb = b.add('PS2', 150, 220);
    const vcc = b.add('VCC', 150, 470);
    const reg = b.add('74164', 480, 240);
    const leds = [3, 4, 5, 6, 9, 10, 11, 12].map((pin, i) =>
      b.add('LED', 790, 80 + i * 62, { props: { label: 'Q' + i } }));
    b.wire(kb, 1, reg, 8);         // PS2 CLK → 移位时钟
    b.wire(kb, 2, reg, 1);         // PS2 DATA → A
    b.wire(kb, 2, reg, 2);         // DATA → B (A·B 相与)
    b.wire(vcc, 1, reg, 13);       // ~CLR
    [3, 4, 5, 6, 9, 10, 11, 12].forEach((pin, i) => b.wire(reg, pin, leds[i], 1));
    return b;
  },
});

/* 15. 4×4 矩阵键盘扫描 (74138 + 7404) */
EXAMPLES.push({
  name: '矩阵键盘扫描 (74138)',
  desc: '拨 A/B 逐列扫描 (列高有效), 按住键格该列选中时行 LED 亮',
  build() {
    const b = B();
    const swA = b.add('SW', 150, 140, { props: { label: '扫描 A' } });
    const swB = b.add('SW', 150, 250, { props: { label: '扫描 B' } });
    const vcc = b.add('VCC', 150, 380);
    const gnd = b.add('GND', 150, 470);
    const dec = b.add('74138', 400, 250);
    const inv = b.add('7404', 640, 250);
    const kb = b.add('KB44', 880, 250);
    const leds = [5, 6, 7, 8].map((pin, i) =>
      b.add('LED', 1150, 120 + i * 76, { props: { label: 'R' + (i + 1) } }));
    b.wire(swA, 1, dec, 1);        // A
    b.wire(swB, 1, dec, 2);        // B
    b.wire(gnd, 1, dec, 3);        // C = 0 → 只用 Y0~Y3
    b.wire(gnd, 1, dec, 4);        // ~G2A
    b.wire(gnd, 1, dec, 5);        // ~G2B
    b.wire(vcc, 1, dec, 6);        // G1
    b.wire(dec, 15, inv, 1);       // Y0 → 1A
    b.wire(dec, 14, inv, 3);       // Y1 → 2A
    b.wire(dec, 13, inv, 5);       // Y2 → 3A
    b.wire(dec, 12, inv, 9);       // Y3 → 4A
    b.wire(inv, 2, kb, 1);         // 1Y → C1
    b.wire(inv, 4, kb, 2);         // 2Y → C2
    b.wire(inv, 6, kb, 3);         // 3Y → C3
    b.wire(inv, 8, kb, 4);         // 4Y → C4
    b.wire(kb, 5, leds[0], 1);     // R1
    b.wire(kb, 6, leds[1], 1);     // R2
    b.wire(kb, 7, leds[2], 1);     // R3
    b.wire(kb, 8, leds[3], 1);     // R4
    return b;
  },
});

/* 16. 1602 液晶手动打字 (LCD1602 + 开关 + 按键) */
EXAMPLES.push({
  name: '1602 液晶打字机',
  desc: '拨 RS/D7~D0 组成命令或字符, 按一下 E 写入 (如清屏/打字)',
  build() {
    const b = B();
    const swRS = b.add('SW', 150, 130, { props: { label: 'RS' }, state: { on: 1 } });
    const btnE = b.add('BTN', 150, 250, { props: { label: 'E 写入' } });
    const swD = ['D7', 'D6', 'D5', 'D4', 'D3', 'D2', 'D1', 'D0'].map((lb, i) =>
      b.add('SW', 320, 110 + i * 72, { props: { label: lb } }));
    const lcd = b.add('LCD1602', 660, 300);
    b.wire(swRS, 1, lcd, 1);       // RS
    b.wire(btnE, 1, lcd, 2);       // E 上升沿锁存
    // D7..D0 开关 → D7..D0 引脚 (10 - i)
    swD.forEach((sw, i) => b.wire(sw, 1, lcd, 10 - i));
    return b;
  },
});

/* 17. VM-8 微码 8 位 CPU 时钟计算机 */
EXAMPLES.push({
  name: 'VM-8 CPU 时钟计算机 (1602+PS/2)',
  desc: 'ROM 程序驱动 1602 显示 HH:MM:SS; 键 A=时+1, C=秒清零; 1Hz 实时时钟输入; 电源开关=整机冷启动 (右键程序 ROM 可载入其他内置程序); (按键恰逢 CLF 清除窗口可能丢失, 重按即可)',
  bb: { cols: 185, boards: 3 },
  build() {
    const b = B();
    const id = {};
    const A = (key, type, x, y, opt) => { id[key] = b.add(type, x, y, opt); return id[key]; };
    const N = (...eps) => { for (let i = 1; i < eps.length; i++) b.wire(eps[0][0], eps[0][1], eps[i][0], eps[i][1]); };

    /* ---- 元件 ---- */
    A('ckSys', 'CLOCK', 100, 40, { props: { freq: 4000, label: '主时钟 4kHz' } });
    A('ckTick', 'CLOCK', 100, 200, { props: { freq: 1, label: '实时时钟 1Hz' } });
    A('and1', '7408', 320, 40);    A('and2', '7408', 540, 40);
    A('and3', '7408', 760, 40);    A('and4', '7408', 980, 40);
    A('and5', '7408', 1420, 40);   // 键盘捕获解码选通 (防计数迁移毛刺)
    A('nand', '7400', 1200, 40);
    A('inv1', '7404', 320, 200);   A('inv2', '7404', 540, 200);
    A('zor1', '7432', 760, 200);   A('zor2', '7432', 980, 200);
    A('cor3', '7432', 1200, 200);
    A('flags', '7474', 100, 360);  A('keyf', '7474', 320, 360);
    A('port', '74245', 540, 360);  A('ps2', 'PS2', 770, 360);
    A('ksh', '74164', 1000, 360);  A('kcnt', '74161', 1240, 360);
    A('kreg', '74374', 1460, 360);
    A('pclo', '74161', 100, 560);  A('pchi', '74161', 330, 560);
    A('pcbuf', '74245', 560, 560); A('mar', '74374', 790, 560);
    A('rom', '74S472', 1020, 560, { props: { tag: 'vm8-program', mem: VM8.PROG.mem.slice() } });
    A('ram', '6116', 1450, 560);
    A('stp', '74161', 100, 780);   A('ir', '74374', 330, 780);
    A('mc0', '74S472', 560, 780, { props: { mem: VM8.MC[0].slice() } });
    A('mc1', '74S472', 990, 780, { props: { mem: VM8.MC[1].slice() } });
    A('mc2', '74S472', 1420, 780, { props: { mem: VM8.MC[2].slice() } });
    // A/B 寄存器用 74175 (Q 常驱动 → ALU 恒可见); A 上总线另经 74245 缓冲
    A('regalo', '74175', 100, 1000); A('regahi', '74175', 240, 1000);
    A('rblo', '74175', 380, 1000);   A('rbhi', '74175', 520, 1000);
    A('abuf', '74245', 660, 1000);
    A('xorl', '7486', 810, 1000);  A('xorh', '7486', 950, 1000);
    A('alul', '74283', 1090, 1000); A('aluh', '74283', 1230, 1000);
    A('alubuf', '74245', 1370, 1000);
    A('outR', '74374', 100, 1220); A('lcd', 'LCD1602', 340, 1220);
    A('pwr', 'SW', 500, 1260, { props: { label: '电源开关' }, state: { on: 1 } });
    A('vcc', 'VCC', 640, 1260);    A('gnd', 'GND', 730, 1260);

    /* ---- 8 位总线 ---- */
    const Q175 = [3, 6, 10, 13];
    const bus = [[], [], [], [], [], [], [], []];
    for (let j = 0; j < 8; j++) {
      bus[j].push(
        [id.pcbuf, 19 - j], [id.rom, 11 + j], [id.ram, 13 + j],
        [id.ir, 2 + j],
        [id.abuf, 19 - j],
        [id.alubuf, 19 - j], [id.kreg, 12 + j], [id.port, 2 + j],
        [id.mar, 2 + j], [id.outR, 2 + j],
        j < 4 ? [id.pclo, 3 + j] : [id.pchi, j - 1]);
    }
    // A/B 寄存器 74175 的 D 脚按位挂总线 (引脚离散)
    const D175 = [15, 5, 11, 14];
    for (let j = 0; j < 4; j++) {
      bus[j].push([id.regalo, D175[j]], [id.rblo, D175[j]]);
      bus[j + 4].push([id.regahi, D175[j]], [id.rbhi, D175[j]]);
    }
    bus.forEach(eps => N(...eps));

    /* ---- 地址总线: MAR → ROM/RAM ---- */
    for (let j = 0; j < 8; j++) N([id.mar, 19 - j], [id.rom, 1 + j], [id.ram, 1 + j]);

    /* ---- PC 输出 → 总线缓冲 ---- */
    for (let j = 0; j < 4; j++) {
      N([id.pclo, 14 - j], [id.pcbuf, 2 + j]);
      N([id.pchi, 14 - j], [id.pcbuf, 6 + j]);
    }

    /* ---- A 缓冲 (74175 Q → 74245 → 总线, /AO 使能) ---- */
    for (let j = 0; j < 4; j++) {
      N([id.regalo, Q175[j]], [id.abuf, 2 + j]);
      N([id.regahi, Q175[j]], [id.abuf, 6 + j]);
    }
    N([id.vcc, 1], [id.abuf, 1]);                  // DIR=A→B

    /* ---- ALU: B^SUB → 74283; A 直入; 和 → 缓冲 + 零检测 ---- */
    const XP = [[1, 2, 3], [4, 5, 6], [9, 10, 8], [12, 13, 11]];
    const AB = [6, 2, 15, 11], AA = [5, 3, 14, 12], SS = [4, 1, 13, 10];
    for (let j = 0; j < 4; j++) {
      N([id.rblo, Q175[j]], [id.xorl, XP[j][0]]); N([id.mc2, 13], [id.xorl, XP[j][1]]);
      N([id.xorl, XP[j][2]], [id.alul, AB[j]]);
      N([id.regalo, Q175[j]], [id.alul, AA[j]]);
      N([id.rbhi, Q175[j]], [id.xorh, XP[j][0]]); N([id.mc2, 13], [id.xorh, XP[j][1]]);
      N([id.xorh, XP[j][2]], [id.aluh, AB[j]]);
      N([id.regahi, Q175[j]], [id.aluh, AA[j]]);
    }
    N([id.alul, 9], [id.aluh, 7]);                 // 低 4 位进位 → 高位 C0
    N([id.mc2, 13], [id.alul, 7]);                 // SUB → C0 (+1 补码减法)
    const SUM = j => [j < 4 ? id.alul : id.aluh, SS[j % 4]];
    for (let j = 0; j < 8; j++) N(SUM(j), [id.alubuf, 2 + j]);
    N(SUM(0), [id.zor1, 1]); N(SUM(1), [id.zor1, 2]);
    N(SUM(2), [id.zor1, 4]); N(SUM(3), [id.zor1, 5]);
    N(SUM(4), [id.zor1, 9]); N(SUM(5), [id.zor1, 10]);
    N(SUM(6), [id.zor1, 12]); N(SUM(7), [id.zor1, 13]);
    N([id.zor1, 3], [id.zor2, 1]); N([id.zor1, 6], [id.zor2, 2]);
    N([id.zor1, 8], [id.zor2, 4]); N([id.zor1, 11], [id.zor2, 5]);
    N([id.zor2, 3], [id.zor2, 9]); N([id.zor2, 6], [id.zor2, 10]);
    N([id.zor2, 8], [id.inv2, 1]);                 // Z = NOR8(和)
    N([id.inv2, 2], [id.flags, 2]);                // Z → 标志 1D

    /* ---- 分支条件: 控制位低有效, /PL = JP·(JM+~Z)·(JN+Z) ---- */
    N([id.flags, 5], [id.inv2, 3]);                // Z → ~Z
    N([id.mc2, 16], [id.cor3, 1]);                 // JM
    N([id.inv2, 4], [id.cor3, 2]);                 // ~Z
    N([id.mc2, 17], [id.cor3, 4]);                 // JN
    N([id.flags, 5], [id.cor3, 5]);                // Z
    N([id.mc2, 15], [id.and2, 4]);                 // JP
    N([id.cor3, 3], [id.and2, 5]);                 // (JM+~Z)
    N([id.and2, 6], [id.and2, 12]);                // (JM+~Z)
    N([id.cor3, 6], [id.and2, 13]);                // (JN+Z)
    N([id.and2, 11], [id.pclo, 9]);                // /PL
    N([id.and2, 11], [id.pchi, 9]);

    /* ---- 寄存器写入与门: CK = CLK·使能 ---- */
    N([id.ckSys, 1], [id.and1, 1]); N([id.mc0, 12], [id.and1, 2]); N([id.and1, 3], [id.mar, 11]);
    N([id.ckSys, 1], [id.and1, 4]); N([id.mc0, 14], [id.and1, 5]); N([id.and1, 6], [id.ir, 11]);
    N([id.ckSys, 1], [id.and1, 9]); N([id.mc1, 11], [id.and1, 10]);
    N([id.and1, 8], [id.regalo, 1], [id.regahi, 1]);   // AI → A 寄存器时钟
    N([id.ckSys, 1], [id.and1, 12]); N([id.mc1, 13], [id.and1, 13]);
    N([id.and1, 11], [id.rblo, 1], [id.rbhi, 1]);      // BI → B 寄存器时钟
    N([id.ckSys, 1], [id.and2, 1]); N([id.mc1, 15], [id.and2, 2]); N([id.and2, 3], [id.outR, 11]);
    N([id.ckSys, 1], [id.and2, 9]);
    N([id.mc1, 14], [id.inv2, 9]);                 // EO 低有效 → 反相供标志时钟门
    N([id.inv2, 8], [id.and2, 10]);
    N([id.and2, 8], [id.flags, 3]);                // Z 标志 CK = CLK·EO

    /* ---- 主时钟门控 / LCD 选通 / RAM 写窗 ----
     * 电源开关: 关 = 主时钟停振 + PC/定序器保持复位 + 按键/秒脉冲不捕获 (整机静止);
     * 开 = 复位释放, 程序从 0000H 重新执行 (等效一次冷启动) */
    N([id.mc2, 18], [id.and4, 13]);                // D7=RUN 微码停机位 (1=运行)
    N([id.pwr, 1], [id.and4, 12]);                 // 电源开关与 RUN 相与
    N([id.and4, 11], [id.and4, 2]);
    N([id.ckSys, 1], [id.and4, 1]);                // sysclk = CLK·PWR·RUN: 关机或停机时停振
    N([id.and4, 3], [id.inv1, 11]);
    N([id.inv1, 10], [id.stp, 2]);                 // 定序器下降沿推进
    N([id.and4, 3], [id.pclo, 2]);                 // PC 在上升沿计数/装数
    N([id.and4, 3], [id.pchi, 2]);
    N([id.mc2, 14], [id.and4, 4]);                 // E (T4 行有效)
    N([id.and4, 3], [id.and4, 5]);
    N([id.and4, 6], [id.lcd, 2]);                  // E = 微码E·sysclk: 上升沿在 OUT 装载之后, 单脉冲
    N([id.mc0, 17], [id.nand, 2]);                 // RW
    N([id.ckSys, 1], [id.nand, 1]);
    N([id.nand, 3], [id.ram, 12]);                 // /WE = NAND(RW, CLK)

    /* ---- 键盘捕获: 位计数第 9 拍锁存键码并复位 ---- */
    N([id.ps2, 1], [id.inv1, 13]);
    N([id.inv1, 12], [id.kcnt, 2]);                // 反相 → 位计数与移位同源(免上电虚位)
    N([id.inv1, 12], [id.ksh, 8]);                 // 74164 同在下降沿采样
    N([id.ps2, 2], [id.ksh, 1]); N([id.ps2, 2], [id.ksh, 2]);
    const KQ = [3, 4, 5, 6, 9, 10, 11, 12];        // Q0..Q7 = d7..d0
    for (let j = 0; j < 8; j++) N([id.ksh, KQ[j]], [id.kreg, 2 + j]);
    // 位对齐: PS2 CLK 下降沿采样, 第 9 个下降沿移入 d7 → 计数=9 (QD·~QC·~QB·QA)
    // LATCH=count9 锁存键码; CLEAR=count11 (QD·~QC·QB·QA, stop 拍) 清零计数器+移位器
    // 关键: 两解码均用 CLK(=ps2.1) 选通 — 脉冲只在位中心 (CLK 上升) 产生, 此时
    // 计数解码已稳定 30µs; 而 9→10 迁移毛刺发生时 CLK 已变低, 被彻底挡住
    N([id.kcnt, 12], [id.inv1, 1]);                // QC → ~QC
    N([id.kcnt, 13], [id.inv1, 3]);                // QB → ~QB
    N([id.kcnt, 11], [id.and3, 1]);                // QD
    N([id.inv1, 2], [id.and3, 2]);                 // ~QC
    N([id.and3, 3], [id.and3, 4]);                 // T1 = QD·~QC (count 8..11)
    N([id.kcnt, 14], [id.and3, 5]);                // +QA → 公共项 = count 9/11
    N([id.and3, 6], [id.and3, 9]);
    N([id.inv1, 4], [id.and3, 10]);                // +~QB → LATCH 解码 = count 9
    N([id.ps2, 1], [id.and5, 1]);                  // CLK 选通 (位中心)
    N([id.and3, 8], [id.and5, 2]);                 // LATCH = count9·CLK (位中心 9, d0..d7 已稳定)
    N([id.and5, 3], [id.and5, 12]);
    N([id.pwr, 1], [id.and5, 13]);                 // LATCH·PWR: 关机时不捕获按键
    N([id.and5, 11], [id.kreg, 11]);               // LATCH: 键码锁存
    N([id.and5, 11], [id.keyf, 3]);                // 置位键标志 (D=VCC)
    N([id.and3, 6], [id.and4, 9]);                 // 公共项
    N([id.kcnt, 13], [id.and4, 10]);               // +QB → CLEAR 解码 = count 9/11
    N([id.ps2, 1], [id.and5, 4]);                  // CLK 选通
    N([id.and4, 8], [id.and5, 5]);                 // CLEAR = count11·CLK (stop 位中心, 挡 9→10 迁移毛刺)
    N([id.and5, 6], [id.inv1, 5]);
    N([id.inv1, 6], [id.kcnt, 1]);                 // CLEAR: 计数器清零
    N([id.inv1, 6], [id.ksh, 13]);                 // 移位寄存器 ~CLR 一起清 (锁存已先行)
    N([id.stp, 12], [id.and3, 12]);                // 定序器 QC·QB (6=110) → 回绕
    N([id.stp, 13], [id.and3, 13]);
    N([id.and3, 11], [id.inv1, 9]);
    N([id.pwr, 1], [id.and5, 9]);
    N([id.inv1, 8], [id.and5, 10]);                // 定序器 ~CLR = 回绕解码·PWR: 关机保持复位
    N([id.and5, 8], [id.stp, 1]);

    /* ---- 控制 ROM 地址: {定序器3位, IR 低, IR 高} ---- */
    for (const k of ['mc0', 'mc1', 'mc2']) {
      N([id.stp, 14], [id[k], 1]);
      N([id.stp, 13], [id[k], 2]);
      N([id.stp, 12], [id[k], 3]);
      N([id.ir, 16], [id[k], 4]);
      N([id.ir, 15], [id[k], 5]);
      N([id.ir, 14], [id[k], 6]);
      N([id.ir, 13], [id[k], 7]);
      N([id.ir, 12], [id[k], 8]);
    }

    /* ---- 控制信号分配 ---- */
    N([id.mc0, 11], [id.pcbuf, 11]);               // /CO
    N([id.mc0, 13], [id.rom, 10]);                 // /RO
    N([id.mc0, 16], [id.ram, 22]);                 // /RI
    N([id.mc0, 18], [id.pclo, 7]);                 // CE
    N([id.mc0, 18], [id.pchi, 7]);
    N([id.mc1, 12], [id.abuf, 11]);                // /AO
    N([id.mc1, 14], [id.alubuf, 11]);              // /EO
    N([id.mc1, 16], [id.kreg, 1]);                 // /KO
    N([id.mc1, 17], [id.port, 11]);                // /TI
    N([id.mc1, 18], [id.lcd, 1]);                  // RS
    N([id.mc2, 11], [id.flags, 13]);               // /TF
    N([id.mc2, 12], [id.keyf, 1]);                 // /KF

    /* ---- 输入口 / LCD 数据 ---- */
    N([id.ckTick, 1], [id.nand, 12]);
    N([id.pwr, 1], [id.nand, 13]);
    N([id.nand, 11], [id.inv2, 13]);               // 秒标志 CK = 1Hz·PWR: 关机时实时时钟停走
    N([id.inv2, 12], [id.flags, 11]);              // (D=VCC 置位)
    N([id.flags, 8], [id.port, 19]);               // 秒标志 → bit0
    N([id.keyf, 5], [id.port, 18]);                // 键标志 → bit1
    for (let j = 0; j < 8; j++) N([id.outR, 19 - j], [id.lcd, 3 + j]);

    /* ---- 逻辑 1 / 0 汇流点 ---- */
    N([id.pwr, 1], [id.pclo, 1], [id.pchi, 1]);    // PC ~CLR ← 电源开关: 关机保持清零, 开机从 0 起跑
    N([id.vcc, 1], [id.pclo, 10]);
    N([id.pclo, 15], [id.pchi, 10]);               // 级联: 低级 RCO → 高级 ENT
    N([id.vcc, 1], [id.stp, 7], [id.stp, 9], [id.stp, 10]);
    N([id.vcc, 1], [id.kcnt, 7], [id.kcnt, 9], [id.kcnt, 10]);
    N([id.vcc, 1], [id.regalo, 2], [id.regahi, 2], [id.rblo, 2], [id.rbhi, 2]);   // 74175 ~CLR
    N([id.vcc, 1], [id.pcbuf, 1], [id.alubuf, 1]);
    N([id.vcc, 1], [id.flags, 1], [id.flags, 4], [id.flags, 10], [id.flags, 12]);
    N([id.vcc, 1], [id.keyf, 2], [id.keyf, 4], [id.keyf, 10], [id.keyf, 13]);
    N([id.gnd, 1], [id.stp, 3], [id.stp, 4], [id.stp, 5], [id.stp, 6]);
    N([id.gnd, 1], [id.kcnt, 3], [id.kcnt, 4], [id.kcnt, 5], [id.kcnt, 6]);
    N([id.gnd, 1], [id.rom, 9], [id.mc0, 9], [id.mc1, 9], [id.mc2, 9]);
    N([id.gnd, 1], [id.mc0, 10], [id.mc1, 10], [id.mc2, 10]);   // 控制 ROM 常选通
    N([id.gnd, 1], [id.ram, 9], [id.ram, 10], [id.ram, 11], [id.ram, 21]);
    N([id.gnd, 1], [id.mar, 1], [id.outR, 1], [id.port, 1]);
    N([id.gnd, 1], [id.ir, 1]);    // IR 常驱动 (仅喂控制 ROM 地址, 不上总线)
    N([id.gnd, 1], [id.port, 12], [id.port, 13], [id.port, 14], [id.port, 15], [id.port, 16], [id.port, 17]);
    N([id.gnd, 1], [id.keyf, 11], [id.keyf, 12]);
    return b;
  },
});

global.EXAMPLES = EXAMPLES;
if (typeof module !== 'undefined' && module.exports) module.exports = { EXAMPLES };

})(typeof window !== 'undefined' ? window : globalThis);
