/* =========================================================================
 * 74VM VM-8 CPU 示例深度测试 — CPU 硬件 / 微码 / ROM 程序 / 三种模式
 * node test/test-cpu.js
 *
 * [一] 微码 ROM 单元测试: 每条指令每拍的控制信号
 * [二] 汇编器单元测试: 编码 / 标签 / 常量 / 越界
 * [三] ROM 程序静态测试: 操作码合法性 / 结构 / 跳转目标
 * [四] CPU 指令级测试: 用测试程序烧入 PROM 逐条验证数据通路
 * [五] 键盘捕获链路: PS/2 → 74164 → 键码锁存 → KBD 指令
 * [六] 实时时钟输入: 1Hz → 秒标志 → TCK/CLT
 * [七] 出厂时钟程序集成: LCD 走时 / 进位 / 按键调时 / 长跑稳定
 * [八] 面包板模式: 摆放/布线/供电/网表等价 + 派生网表功能复跑
 * [九] PCB 模式: 自动布局 + 立创EDA 导出
 * ========================================================================= */
'use strict';

const { Engine, Sim } = require('../js/engine.js');
const { LIB } = require('../js/chips.js');
require('../js/examples.js');
const { EXAMPLES, VM8 } = globalThis;
const { BB } = require('../js/breadboard.js');
const { PCB } = require('../js/pcb.js');
const EasyEDA = require('../js/easyeda.js');

const { V0, V1, VZ, VX } = Sim;
const EX = EXAMPLES.find(e => e.name.includes('VM-8'));

let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (extra !== undefined ? '  →  ' + JSON.stringify(extra) : '')); }
}

/* ---------------- 通用工具 ---------------- */

/** 装载示例 (可替换 PROM 程序) */
function loadCpu(program) {
  const b = EX.build();
  if (program) {
    const asm = VM8.assemble(program);
    b.chips.find(c => c.props.tag === 'vm8-program').props.mem = asm.mem;
  }
  const sim = new Engine(LIB);
  sim.load({ chips: b.chips, wires: b.wires });
  return sim;
}

const byType = (sim, t) => [...sim.chips.values()].filter(c => c.type === t);
const V = (sim, c, p) => sim.pinDisplay(c.pinByNum[p]);

/** 推进 n 个 CPU 周期 (4kHz → 250µs/周期), 加余量让门延迟落定 */
function cycles(sim, n) { sim.advance(n * 250 + 60); }

/** 按键并等待程序取走; CLF 清除窗口 (250µs) 恰逢键帧锁存时会丢键, 重按即可 */
function pressKey(sim, ps2, code, ram, addr, expect) {
  for (let i = 0; i < 4; i++) {
    ps2.state.queue.push(code);
    sim.reevalAll();
    sim.advance(15000);
    if (ram.props.mem[addr] === expect) return true;
  }
  return false;
}

/* ---------------- [一] 微码 ROM 单元测试 ---------------- */
console.log('\n[一] 微码 ROM 单元测试');
{
  const bits = (v, idx) => idx.map(i => (v >> i) & 1);
  // 每条指令的 T0/T1 必须是统一的取指微码
  let fetchOK = true;
  for (let op = 0; op < 16; op++) for (const bit3 of [0, 1]) {
    const a = (op << 4) | (bit3 << 3);
    const t0 = (VM8.MC[0][a] & 0x03) === 0x02;            // /CO=0(位0), MI=1(位1)
    const t1 = (VM8.MC[0][a + 1] & 0x9C) === 0x98;        // /RO=0(位2), II=1(位3), CE=1(位7), 位4恒1
    if (!t0 || !t1) { fetchOK = false; }
  }
  check('16 操作码 × 2 子位: T0=PC→MAR, T1=ROM→IR且PC++ 统一取指', fetchOK);

  const sig = (op, step, bit3) => {
    const a = (op << 4) | ((bit3 || 0) << 3) | step;
    return [VM8.MC[0][a], VM8.MC[1][a], VM8.MC[2][a]];
  };
  const on = (v, i, mask) => ((v[i] & mask) === 0);       // 低有效组: 0=有效
  const onH = (v, i, mask) => ((v[i] & mask) !== 0);      // 高有效组: 1=有效
  // LDI: T3 ROM→A
  check('LDI T3 = ROM→总线 + A 装载', (() => { const v = sig(1, 3); return on(v, 0, 0x04) && onH(v, 1, 0x01) && !onH(v, 1, 0x04); })());
  // LDA: T3 ROM→MAR, T4 RAM→A
  check('LDA T3 = ROM→MAR (取地址)', (() => { const v = sig(2, 3); return on(v, 0, 0x04) && onH(v, 0, 0x02); })());
  check('LDA T4 = RAM→总线 + A 装载', (() => { const v = sig(2, 4); return on(v, 0, 0x20) && onH(v, 1, 0x01); })());
  // STA: T4 A→RAM 且开写窗
  check('STA T4 = A→总线 + RAM 写 + /RI (写窗内 RAM 不驱动)', (() => {
    const v = sig(3, 4); return onH(v, 0, 0x40) && on(v, 1, 0x02) && on(v, 0, 0x20);
  })());
  // ADA: T4 RAM→B, T5 ALU→A
  check('ADA T4 = RAM→B; T5 = ALU→A (带标志)', (() => {
    const v4 = sig(5, 4), v5 = sig(5, 5);
    return on(v4, 0, 0x20) && onH(v4, 1, 0x04) && (v5[1] & 0x08) === 0 && onH(v5, 1, 0x01);
  })());
  // CPI: T4 ALU 比较 (EO+SUB, 无 AI)
  check('CPI T4 = ALU 比较 (EO+SUB, 不回写 A)', (() => {
    const v = sig(6, 4); return (v[1] & 0x08) === 0 && (v[2] & 0x04) !== 0 && (v[1] & 0x01) === 0;
  })());
  // OUT/CMD: T3 A→OUT, T4 选通; RS 极性
  check('OUT T3 = A→OUT+RS=1; T4 = E 选通+RS=1', (() => {
    const v3 = sig(8, 3), v4 = sig(8, 4);
    return onH(v3, 1, 0x10 | 0x80) && (v4[2] & 0x08) !== 0 && onH(v4, 1, 0x80);
  })());
  check('CMD 的 RS=0 (指令模式)', (() => {
    const v3 = sig(9, 3), v4 = sig(9, 4);
    return onH(v3, 1, 0x10) && !onH(v3, 1, 0x80) && (v4[2] & 0x08) !== 0 && !onH(v4, 1, 0x80);
  })());
  // 分支
  check('JMP T3 = ROM→总线+JP; JZ T3 带 JM; JNZ T3 带 JN', (() => {
    const va = sig(0xA, 3), vb = sig(0xB, 3), vc = sig(0xC, 3);
    return on(va, 0, 0x04) && on(va, 2, 0x10) && on(vb, 2, 0x20) && on(vc, 2, 0x40);
  })());
  // CLF/CLT 子位
  check('0xF0 (CLF) T3 清键标志; 0xF8 (CLT) T3 清秒标志', (() => {
    const vf = sig(0xF, 3, 0), vt = sig(0xF, 3, 1);
    return on(vf, 2, 0x02) && !on(vf, 2, 0x01) && on(vt, 2, 0x01) && !on(vt, 2, 0x02);
  })());
  // step ≥ 6 的行全部空闲 (定序器 6 拍循环, 这些地址不可达)
  let idleOK = true;
  for (let a = 0; a < 512; a++) if ((a & 7) >= 6) {
    if (VM8.MC[0][a] !== 0x3E || VM8.MC[1][a] !== 0x6E || VM8.MC[2][a] !== 0xF3) idleOK = false;
  }
  check('step≥6 的微码行全部空闲', idleOK);
  // RUN 位 (D7) 常为 1 (不停振)
  let runOK = true;
  for (let a = 0; a < 512; a++) if (!(VM8.MC[2][a] & 0x80)) runOK = false;
  check('RUN 位全部为 1 (时钟门控常开)', runOK);
}

/* ---------------- [二] 汇编器单元测试 ---------------- */
console.log('\n[二] 汇编器单元测试');
{
  const r = VM8.assemble([
    'K = 0x10',
    'start: LDI K',      // 常量作操作数
    'CPI 5',             // 十进制
    'JZ start',
    'NOP', 'OUT', 'CMD', 'KBD', 'TCK', 'CLF', 'CLT',
    'j: JMP j',
  ]);
  check('LDI 常量操作数 = 0x10', r.mem[1] === 0x10);
  check('CPI 5 编码 = 0x60,0x05', r.mem[2] === 0x60 && r.mem[3] === 5);
  check('JZ start 回跳 = 0xB0,0x00', r.mem[4] === 0xB0 && r.mem[5] === 0);
  const oneByte = [r.mem[6], r.mem[7], r.mem[8], r.mem[9], r.mem[10], r.mem[11], r.mem[12]];
  check('单字节指令编码 NOP/OUT/CMD/KBD/TCK/CLF/CLT',
    oneByte.join(',') === '0,128,144,208,224,240,248', oneByte);
  check('CLF=0xF0 / CLT=0xF8 (子位 bit3)', r.mem[11] === 0xF0 && r.mem[12] === 0xF8);
  check('自跳转编码', r.mem[13] === 0xA0 && r.mem[14] === 13);
  let threw = false;
  try { VM8.assemble(['LDI 0x01', 'FOO 1'].join('\n')); } catch (e) { threw = /无法识别/.test(e.message); }
  check('无法识别的助记符报错', threw);
}

/* ---------------- [三] ROM 程序静态测试 ---------------- */
console.log('\n[三] ROM 程序静态测试');
{
  const prog = VM8.PROG;
  check('程序长度 ≤ 254 字节 (实际 ' + prog.size + ')', prog.size <= 254);
  check('程序非空且有内容', prog.size > 100);
  // 反汇编扫描: 每个操作码字节合法, 指令流闭合
  const LEN = { 0: 1, 1: 2, 2: 2, 3: 2, 4: 2, 5: 2, 6: 2, 7: 2, 8: 1, 9: 1, 0xA: 2, 0xB: 2, 0xC: 2, 0xD: 1, 0xE: 1, 0xF: 1 };
  let i = 0, ok = true;
  while (i < prog.size) {
    const op = prog.mem[i] >> 4;
    if (!LEN[op]) { ok = false; break; }
    if (op === 0xF && (prog.mem[i] & 0x7) !== 0) { ok = false; break; }   // SYS 子位只允许 0/8
    i += LEN[op];
  }
  check('全程序反汇编扫描无非法操作码', ok && i === prog.size);
  // 初始化序列: LDI 0x01 + CMD (清屏)
  check('开头为 LDI 0x01 + CMD (LCD 清屏)', prog.mem[0] === 0x10 && prog.mem[1] === 0x01 && prog.mem[2] === 0x90);
  // 时间单元初始化: LDI 0 + STA ×6
  const stas = [5, 7, 9, 11, 13, 15].map(a => prog.mem[a]);
  check('6 个时间单元清零指令', prog.mem[3] === 0x10 && stas.every(v => v === 0x30), stas);
  // MAIN 循环: TCK 开头, 空轮询 JMP MAIN 指回
  check('MAIN 以 TCK 开头', prog.mem[prog.labels.MAIN] === 0xE0);
  check('主循环空转 JZ MAIN 目标正确',
    prog.mem[prog.labels.MAIN + 3] === 0xB0 && prog.mem[prog.labels.MAIN + 4] === prog.labels.MAIN);
  // 键值分派: A=0x1C, C=0x21, break=0xF0
  const dispatch = prog.mem.slice(prog.labels.MAIN, prog.labels.MAIN + 26);
  check('键分派含 0xF0 (break 忽略) / 0x1C (A) / 0x21 (C)',
    dispatch.includes(0xF0) && dispatch.includes(0x1C) && dispatch.includes(0x21));
  // REFRESH: 光标 0x80 + 8 个字符 + JMP MAIN
  const R = prog.labels.REFRESH;
  check('REFRESH 以 LDI 0x80 + CMD 定位光标', prog.mem[R] === 0x10 && prog.mem[R + 1] === 0x80 && prog.mem[R + 2] === 0x90);
  check('REFRESH 末尾 JMP MAIN (无限循环)', prog.mem[R + 39] === 0xA0 && prog.mem[R + 40] === prog.labels.MAIN);
  check('两处冒号字符 0x3A', prog.mem[R + 13] === 0x10 && prog.mem[R + 14] === 0x3A && prog.mem[R + 26] === 0x10 && prog.mem[R + 27] === 0x3A);
  check('数字转 ASCII 偏移 48 (ADI)', [R + 5, R + 10, R + 18, R + 23, R + 31, R + 36].every(a => prog.mem[a] === 0x40 && prog.mem[a + 1] === 48));
}

/* ---------------- [四] CPU 指令级测试 ---------------- */
console.log('\n[四] CPU 指令级测试 (测试程序烧入 PROM)');
function runProg(src, { ms = 15 } = {}) {
  const sim = loadCpu(src);
  cycles(sim, Math.ceil(ms * 4));          // ms → 周期 (250µs/周期)
  const ram = byType(sim, '6116')[0];
  return { sim, ram, mem: ram.props.mem, lcd: byType(sim, 'LCD1602')[0] };
}
{
  let r = runProg(['LDI 0x5A', 'STA 0x40', 'LDA 0x40', 'STA 0x41', 'here: JMP here']);
  check('LDI/STA/LDA: RAM 直写直读 = 0x5A', r.mem[0x40] === 0x5A && r.mem[0x41] === 0x5A, [r.mem[0x40], r.mem[0x41]]);

  r = runProg(['LDI 0x00', 'STA 0x40', 'LDI 0xFF', 'STA 0x41', 'LDI 0x80', 'STA 0x42', 'here: JMP here']);
  check('LDI 位型 0x00/0xFF/0x80', r.mem[0x40] === 0 && r.mem[0x41] === 0xFF && r.mem[0x42] === 0x80);

  r = runProg(['LDI 250', 'ADI 10', 'STA 0x40', 'here: JMP here']);
  check('ADI 8 位回绕: 250+10 = 4', r.mem[0x40] === 4, r.mem[0x40]);

  r = runProg(['LDI 5', 'ADI 3', 'STA 0x40', 'here: JMP here']);
  check('ADI 5+3 = 8', r.mem[0x40] === 8, r.mem[0x40]);

  r = runProg(['LDI 3', 'STA 0x20', 'LDI 4', 'ADA 0x20', 'STA 0x40', 'here: JMP here']);
  check('ADA 4+RAM[0x20](3) = 7', r.mem[0x40] === 7, r.mem[0x40]);

  r = runProg(['LDI 0xFF', 'STA 0x20', 'LDI 1', 'ADA 0x20', 'STA 0x40', 'here: JMP here']);
  check('ADA 回绕: 1+0xFF = 0', r.mem[0x40] === 0, r.mem[0x40]);

  r = runProg(['LDI 5', 'CPI 5', 'JZ ok', 'LDI 0x11', 'ok: STA 0x40', 'here: JMP here']);
  check('CPI 相等 → Z=1 → JZ 跳过 (A 保持 5)', r.mem[0x40] === 5, r.mem[0x40]);

  r = runProg(['LDI 5', 'CPI 3', 'JZ bad', 'LDI 0x22', 'here: JMP fin', 'bad: LDI 0x33', 'fin: STA 0x40', 'stop: JMP stop']);
  check('CPI 不等 → JZ 不跳', r.mem[0x40] === 0x22, r.mem[0x40]);

  r = runProg(['LDI 7', 'CMA 0x40', 'JZ bad', 'LDI 0x44', 'here: JMP fin', 'bad: LDI 0x55', 'fin: STA 0x41', 'stop: JMP stop']);
  check('CMA 对 0 初始 RAM 比较: 7≠0 → 不跳', r.mem[0x41] === 0x44, r.mem[0x41]);

  r = runProg(['LDI 9', 'STA 0x40', 'LDI 9', 'CMA 0x40', 'JZ ok', 'LDI 0x44', 'ok: STA 0x41', 'stop: JMP stop']);
  check('CMA 相等 → 跳过 (A 保持 9)', r.mem[0x41] === 9, r.mem[0x41]);

  r = runProg(['LDI 0', 'ADI 0', 'JZ ok', 'LDI 0x66', 'ok: STA 0x40', 'stop: JMP stop']);
  check('ADI 0 → 和为 0 → Z=1 → JZ 生效 (A=0)', r.mem[0x40] === 0, r.mem[0x40]);

  r = runProg(['JMP a', 'LDI 0x77', 'a: STA 0x40', 'here: JMP here']);
  check('JMP 跳过 LDI 0x77', r.mem[0x40] === 0, r.mem[0x40]);

  r = runProg(['LDI 0', 'ADI 0', 'JNZ bad', 'LDI 0x88', 'here: JMP fin', 'bad: LDI 0x99', 'fin: STA 0x40', 'stop: JMP stop']);
  check('JNZ Z=1 不跳', r.mem[0x40] === 0x88, r.mem[0x40]);

  r = runProg(['LDI 5', 'CPI 3', 'JNZ ok', 'LDI 0x77', 'here: JMP fin', 'ok: LDI 0x66', 'fin: STA 0x40', 'stop: JMP stop']);
  check('JNZ Z=0 跳转', r.mem[0x40] === 0x66, r.mem[0x40]);

  r = runProg(['NOP', 'NOP', 'LDI 0x77', 'STA 0x40', 'here: JMP here']);
  check('NOP 顺序执行', r.mem[0x40] === 0x77, r.mem[0x40]);

  r = runProg(['LDI 0x48', 'OUT', 'LDI 0x69', 'OUT', 'here: JMP here']);
  check('OUT 向 LCD 写字符 H,i', r.lcd.state.ddram[0] === 'H' && r.lcd.state.ddram[1] === 'i',
    r.lcd.state.ddram.slice(0, 2));

  r = runProg(['LDI 0x48', 'OUT', 'LDI 0x01', 'CMD', 'LDI 0x41', 'OUT', 'here: JMP here']);
  check('CMD 0x01 清屏后光标回 0 写 A', r.lcd.state.ddram[0] === 'A' && r.lcd.state.ddram[1] === ' ');

  r = runProg(['LDI 0x80', 'CMD', 'here: JMP here']);
  check('CMD 0x80 定位光标到行首', r.lcd.state.cur === 0, r.lcd.state.cur);

  // 循环计数: 100 次减 1
  r = runProg([
    'LDI 100', 'STA 0x30',
    'loop: LDA 0x30', 'CPI 0', 'JZ done',
    'LDA 0x30', 'ADI 255', 'STA 0x30',
    'JMP loop',
    'done: STA 0x31', 'stop: JMP stop',
  ], { ms: 1600 });
  check('100 次循环计数到 0', r.mem[0x30] === 0 && r.mem[0x31] === 0, [r.mem[0x30], r.mem[0x31]]);
}

/* ---------------- [五] 键盘捕获链路 ---------------- */
console.log('\n[五] 键盘捕获链路 (PS/2 → 74164 → 键码寄存器 → KBD)');
{
  const sim = loadCpu([
    'loop: TCK', 'CPI 2', 'JZ got', 'CPI 3', 'JZ got', 'JMP loop',
    'got: KBD', 'STA 0x40', 'CLF', 'TCK', 'STA 0x41', 'JMP loop',
  ]);
  const ps2 = byType(sim, 'PS2')[0];
  const ram = byType(sim, '6116')[0];
  cycles(sim, 20);
  check("键入 'A': KBD 读到扫描码 0x1C", pressKey(sim, ps2, 0x1C, ram, 0x40, 0x1C), ram.props.mem[0x40]);
  check('CLF 后键标志清零 (TCK=0)', ram.props.mem[0x41] === 0, ram.props.mem[0x41]);
  // 第二颗键
  check("第二颗键 'C' 可再捕获", pressKey(sim, ps2, 0x21, ram, 0x40, 0x21), ram.props.mem[0x40]);
  // break 序列: F0 帧也会被捕获为字节
  check('break 前缀 0xF0 亦可捕获 (程序层过滤)', pressKey(sim, ps2, 0xF0, ram, 0x40, 0xF0), ram.props.mem[0x40]);
}

/* ---------------- [六] 实时时钟输入 ---------------- */
console.log('\n[六] 实时时钟输入 (1Hz → 秒标志 → TCK/CLT)');
{
  const sim = loadCpu([
    'loop: TCK', 'CPI 1', 'JZ tick', 'CPI 3', 'JZ tick', 'JMP loop',
    'tick: CLT', 'LDA 0x30', 'ADI 1', 'STA 0x30', 'JMP loop',
  ]);
  const ram = byType(sim, '6116')[0];
  cycles(sim, 20);
  ram.props.mem[0x30] = 0;                          // 计数器初值
  sim.advance(1300000);                             // 1.3 s → 恰好 1 个 tick
  check('1.3s: 秒标志被消费, 计数 +1', ram.props.mem[0x30] === 1, ram.props.mem[0x30]);
  sim.advance(1000000);
  check('2.3s: 再 +1', ram.props.mem[0x30] === 2, ram.props.mem[0x30]);
}

/* ---------------- [七] 出厂时钟程序集成测试 ---------------- */
console.log('\n[七] 出厂时钟程序集成测试');
{
  const sim = loadCpu();
  const lcd = byType(sim, 'LCD1602')[0];
  const ram = byType(sim, '6116')[0];
  const ps2 = byType(sim, 'PS2')[0];
  const txt = () => lcd.state.ddram.slice(0, 8).join('');
  sim.advance(80000);                               // 初始化 + 首次刷新 ≈ 45ms (4kHz, 6 拍/指令)
  check('上电即显示 00:00:00', txt() === '00:00:00', txt());
  sim.advance(1000000);
  check('1.0s → 00:00:01', txt() === '00:00:01', txt());
  sim.advance(2000000);
  check('3.0s → 00:00:03', txt() === '00:00:03', txt());
  // 秒十位进位: 走到 10s
  sim.advance(8000000);
  check('11s → 00:00:11 (秒十位进位)', txt() === '00:00:11', txt());
  // 键 C: 秒清零 (轮询 ≤4.5ms + 分发 + 刷新 28ms → 至少 80ms; CLF 窗口撞帧时重按)
  let prev = txt();
  for (let i = 0; i < 4; i++) {
    ps2.state.queue.push(0x21);
    sim.reevalAll();
    sim.advance(80000);
    if (txt() !== prev) break;
    prev = txt();
  }
  check("键 C (0x21) 秒清零", txt().slice(6, 8) === '00', txt());
  // 键 A: 时 +1 (HH:MM:SS → 冒号在下标 2/5)
  prev = txt();
  for (let i = 0; i < 4; i++) {
    ps2.state.queue.push(0x1C);
    sim.reevalAll();
    sim.advance(80000);
    if (txt() !== prev) break;
    prev = txt();
  }
  check("键 A (0x1C) 时 +1 → 01:xx", txt().slice(0, 2) === '01' && txt()[2] === ':' && txt()[5] === ':', txt());
  // break 码丢弃: F0 前缀单独到达不应改变小时
  const before = txt();
  ps2.state.queue.push(0xF0);
  sim.reevalAll();
  sim.advance(80000);
  check('break 码被丢弃 (小时不变)', txt().slice(0, 2) === before.slice(0, 2), [before, txt()]);
  // 小时 23→00 回绕: 直接改 RAM 后按 A
  ram.props.mem[0x14] = 3; ram.props.mem[0x15] = 2;  // 23:00
  sim.reevalAll();
  sim.advance(80000);                                // 刷新 23 后再按
  prev = txt();
  for (let i = 0; i < 4; i++) {
    ps2.state.queue.push(0x1C);
    sim.reevalAll();
    sim.advance(80000);
    if (txt() !== prev) break;
    prev = txt();
  }
  check('23 时 +1 回绕到 00', txt().slice(0, 2) === '00', txt());
  // 分钟/小时进位: 秒/分直接注入 59, 用 1Hz 硬走触发 秒→分→时 进位链
  ram.props.mem[0x10] = 9; ram.props.mem[0x11] = 5;  // :59 秒
  ram.props.mem[0x12] = 9; ram.props.mem[0x13] = 5;  // 59 分
  sim.reevalAll();
  sim.advance(1300000);                              // 1 tick (±1s 相位余量)
  check(':59:59 → 进位 01:00:00', /^01:00:0[01]$/.test(txt()), txt());
  // 长跑: 再走 25 s 无失步 (事件量有界)
  const ev0 = sim.eventCount;
  sim.advance(25000000);
  check('再走 25 秒后时间连续', /^0[0-2]:[0-5][0-9]:[0-5][0-9]$/.test(txt()), txt());
  check('长跑事件量有界 (<6000 万)', sim.eventCount - ev0 < 60000000, sim.eventCount - ev0);
}

/* ---------------- [八] 面包板模式 ----------------
 * 注: [十] 电源控制 / [十一] 电源开关 / [十二] 程序库 见文件末尾 */
console.log('\n[八] 面包板模式 (摆放 ' + EX.bb.cols + ' 列 × ' + EX.bb.boards + ' 板)');
{
  BB.setCols(EX.bb.cols); BB.setBoards(EX.bb.boards);
  const sim = loadCpu();
  BB.autoPlace(sim);
  const missing = [];
  for (const c of sim.chips.values()) {
    if (!c.bb) missing.push(c.type);
    else for (const p of c.pins) if (!BB.pinHole(c, p.num)) missing.push(c.type + ':p' + p.num);
  }
  check('自动摆放不溢出, 全部引脚孔位有效 (' + sim.chips.size + ' 元件)', missing.length === 0, missing.slice(0, 6));
  const r = BB.autoWire(sim, sim.wiresRaw());
  const badJ = r.jumpers.filter(j => !BB.holePos(j.a) || !BB.holePos(j.b));
  check('自动布线 ' + r.jumpers.length + ' 根跳线孔位全部有效', badJ.length === 0, badJ.length);
  // 物理规则: 每孔至多一根跳线, 芯片占用孔 (含供电轨上的 VCC/GND) 不插线
  {
    const occH = BB.occupancy(sim);
    const onChip = [], load = new Map();
    for (const j of r.jumpers) for (const h of [j.a, j.b]) {
      if (occH.get(h)) onChip.push(h);
      load.set(h, (load.get(h) || 0) + 1);
    }
    const stacked = [...load.entries()].filter(([, n]) => n > 1).map(([h]) => h);
    check('跳线端全部落在空闲孔 (不插芯片占用孔)', onChip.length === 0, onChip.slice(0, 6));
    check('每孔至多一根跳线 (无堆叠)', stacked.length === 0, stacked.slice(0, 6));
  }
  const part = (wires) => {
    const par = new Map();
    const find = k => { let x = k; while (par.get(x) !== x) x = par.get(x); return x; };
    const ens = k => { if (!par.has(k)) par.set(k, k); };
    for (const w of wires) {
      ens(w.a[0] + ':' + w.a[1]); ens(w.b[0] + ':' + w.b[1]);
      const ra = find(w.a[0] + ':' + w.a[1]), rb = find(w.b[0] + ':' + w.b[1]);
      if (ra !== rb) par.set(ra, rb);
    }
    const g = new Map();
    for (const k of par.keys()) {
      const root = find(k);
      if (!g.has(root)) g.set(root, []);
      g.get(root).push(k);
    }
    return [...g.values()].map(x => x.sort()).sort();
  };
  check('派生网表与原理图等价',
    JSON.stringify(part(sim.wiresRaw())) === JSON.stringify(part(BB.deriveWires(sim, r.jumpers))));
  const info = BB.computeNets(sim, r.jumpers);
  const unpowered = [...sim.chips.values()].filter(c => BB.isActiveCustom(c.type) || !LIB[c.type].custom)
    .filter(c => !BB.chipPowered(info, c)).map(c => c.type);
  check('全部 DIP/有源元件判上电', unpowered.length === 0, unpowered);
  // 派生网表功能复跑: 时钟照走
  sim.setWiresRaw(BB.deriveWires(sim, r.jumpers));
  for (const c of sim.chips.values()) c.powered = BB.chipPowered(info, c);
  const lcd = byType(sim, 'LCD1602')[0];
  cycles(sim, 30);
  sim.advance(1300000);
  check('面包板派生网表: CPU 照常走时 00:00:01', lcd.state.ddram.slice(0, 8).join('') === '00:00:01',
    lcd.state.ddram.slice(0, 8).join(''));
  BB.setCols(60); BB.setBoards(1);
}

/* ---------------- [九] PCB 模式 ---------------- */
console.log('\n[九] PCB 模式');
{
  const sim = loadCpu();
  PCB.autoPlace(sim);
  check('PCB 自动布局完成 (' + sim.chips.size + ' 封装)', [...sim.chips.values()].every(c => c.pcb));
  const r = EasyEDA.buildEasyEDA(sim, PCB);
  const doc = JSON.parse(r.json);
  const pads = doc.shape.filter(s2 => s2.startsWith('PAD~'));
  const totalPins = [...sim.chips.values()].reduce((s, c) => s + c.pins.length, 0);
  check('立创EDA 导出: 焊盘数 = 引脚总数', pads.length === totalPins, [pads.length, totalPins]);
  check('导出网络名含 VCC', r.netNames.includes('VCC'), r.netNames.slice(0, 8));
  const nl = EasyEDA.buildNetlist(sim, PCB);
  check('通用网表导出结构完整', nl.format === '74vm-netlist' && nl.components.length === sim.chips.size);
}

/* ---------------- [十] 电源控制 (仿真菜单 开机/关机/重启) ----------------
 * 关机 = 全局断电: 输出 X/高阻, 时钟停振; 开机 = 冷启动:
 * 触发器/计数器复位, RAM 清零 (易失), ROM 保持 (非易失), 液晶清屏 */
console.log('\n[十] 电源控制 (引擎级 powerOff / powerOn)');
{
  const sim = loadCpu();
  const lcd = byType(sim, 'LCD1602')[0];
  const ram = byType(sim, '6116')[0];
  const rom = sim.chips.values().find(c => c.props.tag === 'vm8-program');
  const txt = () => lcd.state.ddram.slice(0, 8).join('');
  cycles(sim, 30);
  sim.advance(2300000);
  check('运行 2.3s 后走时', /^00:00:0[12]$/.test(txt()), txt());
  ram.props.mem[0x40] = 0x5A;                        // RAM 留下数据
  sim.powerOff();
  check('关机: powered=false', sim.powered === false);
  const clk0 = V(sim, byType(sim, 'CLOCK')[0], 1);
  sim.advance(600);
  check('关机: 主时钟停振 (电平冻结不翻转)', V(sim, byType(sim, 'CLOCK')[0], 1) === clk0);
  const t0 = txt();
  sim.advance(2000000);
  check('关机: 2s 后液晶冻结', txt() === t0, [t0, txt()]);
  sim.powerOn();
  check('开机: powered=true', sim.powered === true);
  check('开机: RAM 清零 (易失)', ram.props.mem[0x40] === 0 && ram.props.mem[0x10] === 0, ram.props.mem[0x40]);
  check('开机: 程序 ROM 保持 (非易失)', rom.props.mem[0] === 0x10 && rom.props.mem[2] === 0x90, rom.props.mem.slice(0, 3));
  sim.advance(80000);                                // 初始化 + 首次刷新 ≈ 45ms
  check('开机: 程序重新初始化 → 00:00:00', txt() === '00:00:00', txt());
  sim.advance(1300000);
  check('开机: 继续走时', /^00:00:0[012]$/.test(txt()), txt());
  // 时钟步进在关机时应为空操作
  sim.powerOff();
  check('关机: 时钟步进空操作', sim.stepClocks() === 0);
  sim.powerOn();
}

/* ---------------- [十一] VM-8 电源开关 (电路级 冷启动) ----------------
 * SW 门控主时钟与 1Hz、保持 PC/定序器复位、屏蔽按键捕获:
 * 关 = 整机静止 (液晶冻结); 开 = 复位释放, 程序从 0000H 重新执行 */
console.log('\n[十一] VM-8 电源开关 (电路级)');
{
  const sim = loadCpu();
  const pwr = [...sim.chips.values()].find(c => c.type === 'SW' && c.props.label === '电源开关');
  const lcd = byType(sim, 'LCD1602')[0];
  const ps2 = byType(sim, 'PS2')[0];
  const keyf = byType(sim, '7474')[1];
  const txt = () => lcd.state.ddram.slice(0, 8).join('');
  check('电源开关存在且初始为开', !!pwr && pwr.state.on === 1);
  sim.advance(2300000);
  check('开机走时 2.3s', /^00:00:0[12]$/.test(txt()), txt());
  pwr.state.on = 0; sim.driveNow(pwr, 1, 0);         // 关机
  sim.advance(3000000);
  const frozen = txt();
  sim.advance(2000000);
  check('开关关: 液晶冻结 (时钟停振)', txt() === frozen, [frozen, txt()]);
  // 关机中按键: LATCH 被电源信号门控, 键标志不置位
  ps2.state.queue.push(0x1C);
  sim.reevalAll();
  sim.advance(15000);
  check('开关关: 按键不被捕获 (键标志=0)', sim.pinDisplay(keyf.pinByNum[5]) === 0, sim.pinDisplay(keyf.pinByNum[5]));
  pwr.state.on = 1; sim.driveNow(pwr, 1, 1);         // 开机 → 冷启动
  sim.advance(80000);                                // 初始化 + 首次刷新 ≈ 45ms
  check('开关开: 程序从 0000H 重跑 → 00:00:00', txt() === '00:00:00', txt());
  sim.advance(1300000);
  check('开关开: 继续走时', /^00:00:0[012]$/.test(txt()), txt());
}

/* ---------------- [十二] 内置程序库 (右键程序 ROM → 载入 VM-8 程序) ---------------- */
console.log('\n[十二] 内置程序库 (' + VM8.PROGS.length + ' 个程序)');
{
  // 静态: 大小 / 反汇编扫描 / clock 与出厂一致
  const LEN = { 0: 1, 1: 2, 2: 2, 3: 2, 4: 2, 5: 2, 6: 2, 7: 2, 8: 1, 9: 1, 0xA: 2, 0xB: 2, 0xC: 2, 0xD: 1, 0xE: 1, 0xF: 1 };
  for (const p of VM8.PROGS) {
    check(p.id + ': 大小 ' + p.size + ' ≤ 254 且非空', p.size >= 1 && p.size <= 254, p.size);
    let i = 0, ok = true;
    while (i < p.size) {
      const op = p.mem[i] >> 4;
      if (!LEN[op] || (op === 0xF && (p.mem[i] & 0x7) !== 0)) { ok = false; break; }
      i += LEN[op];
    }
    check(p.id + ': 反汇编扫描合法闭合', ok && i === p.size);
  }
  check('clock 程序与出厂 ROM 一致',
    VM8.PROGS[VM8.PROGS.length - 1].mem.join(',') === VM8.PROG.mem.join(','));

  function loadCpuMem(mem) {
    const b = EX.build();
    b.chips.find(c => c.props.tag === 'vm8-program').props.mem = mem.slice();
    const sim2 = new Engine(LIB);
    sim2.load({ chips: b.chips, wires: b.wires });
    return sim2;
  }
  const lcdText = (sim2, row) => {
    const dd = byType(sim2, 'LCD1602')[0].state.ddram;
    const off = row === 2 ? 0x40 : 0;
    return dd.slice(off, off + 16).join('').replace(/\s+$/, '');
  };

  // counter: 1Hz 走秒循环
  {
    const p = VM8.PROGS.find(x => x.id === 'counter');
    const sim2 = loadCpuMem(p.mem);
    sim2.advance(80000);
    check('counter: 上电显示 00', lcdText(sim2) === '00', lcdText(sim2));
    sim2.advance(1300000);
    check('counter: 1.3s → 01', lcdText(sim2) === '01', lcdText(sim2));
    sim2.advance(9000000);
    check('counter: 10.3s → 10 (秒十位进位)', lcdText(sim2) === '10', lcdText(sim2));
  }
  // hello: 中文逐字打出 + 按键重播
  {
    const p = VM8.PROGS.find(x => x.id === 'hello');
    const sim2 = loadCpuMem(p.mem);
    sim2.advance(200000);
    check('hello: 显示「你好 74VM-8!」', lcdText(sim2) === '你好 74VM-8!', lcdText(sim2));
    const ps2 = byType(sim2, 'PS2')[0];
    ps2.state.queue.push(0x2D);                      // R 的 make 码
    sim2.reevalAll();
    sim2.advance(100000);                            // 捕获 + 清屏重播
    check('hello: 按任意键重播', lcdText(sim2) === '你好 74VM-8!', lcdText(sim2));
  }
  // typewriter: 数字回显 / 空格 / Enter 换行 / 未映射忽略 / Esc 清屏
  {
    const p = VM8.PROGS.find(x => x.id === 'typewriter');
    const sim2 = loadCpuMem(p.mem);
    const ps2 = byType(sim2, 'PS2')[0];
    // 程序处理一键最长 ~45ms (比较链), 100ms 间隔避免 CLF 清除窗口竞态
    const type = code => { ps2.state.queue.push(code); sim2.reevalAll(); sim2.advance(100000); };
    sim2.advance(50000);
    type(0x16); type(0x1E); type(0x26);              // 1 2 3
    check('typewriter: 打出 123', lcdText(sim2) === '123', lcdText(sim2));
    type(0x29);                                      // 空格
    type(0x3D); type(0x3E); type(0x46); type(0x45);  // 7890
    check('typewriter: 空格与 7890', lcdText(sim2) === '123 7890', lcdText(sim2));
    type(0x5A); type(0x25);                          // Enter → 第 2 行, 再打 4
    check('typewriter: Enter 后打到第 2 行', lcdText(sim2, 2) === '4', lcdText(sim2, 2));
    type(0x2D);                                      // R 未映射 → 忽略
    check('typewriter: 未映射键忽略', lcdText(sim2, 2) === '4', lcdText(sim2, 2));
    type(0x76);                                      // Esc → 清屏
    check('typewriter: Esc 清屏', lcdText(sim2) === '' && lcdText(sim2, 2) === '',
      [lcdText(sim2), lcdText(sim2, 2)]);
  }
  // stopwatch: 空格启停 / C 清零 (1Hz tick 相位 0.5s 对齐 → 用相位无关断言)
  {
    const p = VM8.PROGS.find(x => x.id === 'stopwatch');
    const sim2 = loadCpuMem(p.mem);
    const ps2 = byType(sim2, 'PS2')[0];
    const ram = byType(sim2, '6116')[0];
    const txt2 = () => lcdText(sim2).slice(0, 5);
    const key = code => { ps2.state.queue.push(code); sim2.reevalAll(); sim2.advance(60000); };
    const sec = () => ram.props.mem[0x12] * 10 + ram.props.mem[0x11];
    sim2.advance(50000);
    check('stopwatch: 上电显示 00:00', txt2() === '00:00', txt2());
    sim2.advance(2300000);
    check('stopwatch: 2.3s → 00:02', txt2() === '00:02', txt2());
    key(0x29);                                       // 空格 → 暂停
    const s0 = sec();
    sim2.advance(2050000);                           // 任何 2s 窗口必含 ≥2 个 tick
    check('stopwatch: 暂停后秒数不变', sec() === s0 && txt2() === '00:02', [s0, sec(), txt2()]);
    key(0x29);                                       // 空格 → 继续
    sim2.advance(2050000);
    check('stopwatch: 恢复后 +2~3 秒', sec() - s0 >= 2 && sec() - s0 <= 3, [s0, sec()]);
    key(0x21);                                       // C → 清零 (仍计时)
    check('stopwatch: C 清零', sec() === 0 && txt2() === '00:00', [sec(), txt2()]);
    sim2.advance(2050000);
    check('stopwatch: 清零后继续计时', sec() >= 2 && sec() <= 3, sec());
  }
  // 回绕与状态机边界: 59→00 / 99:59→00:00 / 暂停中清零 / 时十位进位 (RAM 注入后走 1 tick)
  {
    const p = VM8.PROGS.find(x => x.id === 'counter');
    const sim2 = loadCpuMem(p.mem);
    const ram = byType(sim2, '6116')[0];
    sim2.advance(80000);
    ram.props.mem[0x10] = 9; ram.props.mem[0x11] = 5;      // :59
    sim2.reevalAll();
    sim2.advance(1300000);
    check('counter: 59 → 00 回绕', lcdText(sim2) === '00', lcdText(sim2));
  }
  {
    const p = VM8.PROGS.find(x => x.id === 'stopwatch');
    const sim2 = loadCpuMem(p.mem);
    const ram = byType(sim2, '6116')[0];
    sim2.advance(80000);
    ram.props.mem[0x11] = 9; ram.props.mem[0x12] = 5;      // :59
    ram.props.mem[0x13] = 9; ram.props.mem[0x14] = 9;      // 99:
    sim2.reevalAll();
    sim2.advance(1300000);
    check('stopwatch: 99:59 → 00:00 回绕', lcdText(sim2).startsWith('00:00'), lcdText(sim2));
  }
  {
    const p = VM8.PROGS.find(x => x.id === 'stopwatch');
    const sim2 = loadCpuMem(p.mem);
    const ps2 = byType(sim2, 'PS2')[0];
    const ram = byType(sim2, '6116')[0];
    const sec2 = () => ram.props.mem[0x12] * 10 + ram.props.mem[0x11];
    const key2 = code => { ps2.state.queue.push(code); sim2.reevalAll(); sim2.advance(60000); };
    sim2.advance(2300000);                                 // 先走 2 秒
    key2(0x29);                                            // 空格 → 暂停
    for (let i = 0; i < 4 && sec2() !== 0; i++) key2(0x21); // C 清零 (撞 CLF 窗口丢键时重按)
    sim2.advance(100000);                                  // 等待 RST+SHOW 全链路刷新 (~70ms)
    check('stopwatch: 暂停中 C 清零 → 00:00', sec2() === 0 && lcdText(sim2).startsWith('00:00'),
      [sec2(), lcdText(sim2)]);
    sim2.advance(2050000);
    check('stopwatch: 清零后仍暂停 (RUN 未被 C 破坏)', sec2() === 0, sec2());
  }
  {
    const sim2 = loadCpu();                                // 出厂时钟 (默认 ROM)
    const ram = byType(sim2, '6116')[0];
    sim2.advance(80000);
    ram.props.mem[0x10] = 9; ram.props.mem[0x11] = 5;      // :59
    ram.props.mem[0x12] = 9; ram.props.mem[0x13] = 5;      // 59:
    ram.props.mem[0x14] = 9; ram.props.mem[0x15] = 1;      // 19:59:59
    sim2.reevalAll();
    sim2.advance(1300000);
    check('clock: 19:59:59 → 20:00:00 (时十位进位)', lcdText(sim2).startsWith('20:00:00'), lcdText(sim2));
  }
  // 载入即冷启动: 烧入 counter 后 (菜单动作等价) 走时显示计数
  {
    const sim2 = loadCpu(VM8.PROGS.find(x => x.id === 'counter').src);
    sim2.advance(1300000);
    check('loadCpu(程序源码) 等价路径: 1.3s → 01', lcdText(sim2) === '01', lcdText(sim2));
  }
  // 教学文档的十六进制与程序库保持同步 (docs/vm8-guide.md 第 9 节, 供粘贴进 ROM)
  {
    const fs = require('fs');
    const path = require('path');
    const md = fs.readFileSync(path.join(__dirname, '..', 'docs', 'vm8-guide.md'), 'utf8');
    const blocks = [...md.matchAll(/```hex\n([\s\S]*?)```/g)]
      .map(m => m[1].trim().split(/\s+/).filter(Boolean).map(s => parseInt(s, 16)));
    check('vm8-guide.md 含 5 段程序十六进制', blocks.length === VM8.PROGS.length, blocks.length);
    VM8.PROGS.forEach((p, i) => {
      const hex = blocks[i] || [];
      check('vm8-guide.md hex ↔ ' + p.id + ' 逐字节一致',
        hex.length === p.size && p.mem.slice(0, p.size).every((v, j) => hex[j] === v),
        [hex.length, p.size]);
    });
  }
}

console.log('\n结果: ' + pass + ' 通过, ' + fail + ' 失败');
process.exit(fail ? 1 : 0);
