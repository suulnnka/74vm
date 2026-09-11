/* =========================================================================
 * 74VM 元件库 — 输入输出家族 (开关/时钟/键盘/液晶等)
 * 数据模块: 向 js/chips.js 提供的 CHIPS 上下文注册 def 定义。
 * 浏览器: 在 chips.js 之后以 <script> 加载; Node: 由 chips.js require 并注入上下文。
 * ========================================================================= */
(function (factory) {
'use strict';
if (typeof module !== 'undefined' && module.exports) module.exports = factory;
else factory(window.CHIPS);
})(function (C) {
const { VX, V0, V1, VZ } = C.Sim;
const { LIB, def, L, R } = C;
const global = C.global;   // 家族内的 global.xxx 导出 (如 ps2ParseScript)

/* ========================= 输入 / 输出元件 ========================= */
def('SW', '开关', '输入/输出', [R(1, 'Q', 'out')], {
  detail: '手动开关, 输出并保持 0 或 1。\n引脚: Q 为电平输出; 单击元件在 0/1 间切换。',
  custom: true, hideNums: true, size: { w: 56, h: 56 },
  init(ch) { const p = ch.pinByNum[1]; p.driven = ch.state.on ? 1 : 0; },
});

def('BTN', '按键', '输入/输出', [R(1, 'Q', 'out')], {
  detail: '瞬时按键, 供人工输入单脉冲。\n引脚: Q 为输出; 按住时输出 1, 松开恢复 0。',
  custom: true, hideNums: true, size: { w: 56, h: 56 },
  init(ch) { ch.pinByNum[1].driven = 0; },
});

def('CLOCK', '时钟源', '输入/输出', [R(1, 'CLK', 'out')], {
  detail: '方波时钟源, 周期性自动翻转输出。\n引脚: CLK 为时钟输出; 频率可调 (右键 → 编辑频率)。',
  custom: true, hideNums: true, size: { w: 56, h: 56 },
  osc: {},                                  // 无稳态源: 引擎按帧扫描推进 (见 engine.advance)
  defaults: { freq: 2 },
  init(ch) { ch.state.phase = ch.state.phase || 0; ch.pinByNum[1].driven = ch.state.phase ? 1 : 0; },
});

/* NE555 定时器 — 真实 DIP-8 封装 (1脚GND / 8脚VCC, 需供电), 无稳态振荡输出时钟。
 * 数字化抽象: OUT 按 freq 50% 占空比翻转 (~RST 低电平停振并复位),
 * DISCH 为真实放电管行为 (OUT 低电平期导通=0, 高电平期截止=Z);
 * TRIG/THRES 在无稳态下由外部 RC 驱动, 数字模型不单独建模。 */

function ne555OscTick(ch, eng) {
  ch.state.hi = (eng.readPin(ch, 4) === V0) ? 0 : (ch.state.hi ? 0 : 1);   // ~RST 低: 强制低
  eng.applyPin(ch.pinByNum[3], ch.state.hi ? V1 : V0);
  eng.applyPin(ch.pinByNum[7], ch.state.hi ? VZ : V0);
}

def('NE555', 'NE555 定时器', '输入/输出', [
  L(2, 'TRIG', 'in'), L(3, 'OUT', 'out'), L(4, '~RST', 'in'),
  R(7, 'DISCH', 'out'), R(6, 'THRES', 'in'),
], {
  detail: 'NE555 定时器 (无稳态接法), 按设定频率输出方波时钟。\n引脚: 3 OUT 为振荡输出, 4 ~RST 低电平停振并复位, 7 DISCH 为放电端 (输出低电平期间导通), 2 TRIG / 6 THRES 为阈值输入; 频率可调 (右键 → 编辑频率)。',
  pwr: { vcc: 8, gnd: 1 },                  // 真实电源脚位 (非 74 系列约定)
  osc: { tick: ne555OscTick },
  defaults: { freq: 2 },
  init(ch) { ch.state.hi = 0; ch.pinByNum[3].driven = V0; ch.pinByNum[7].driven = V0; },
  eval(ch, e) {
    if (ch.powered === false || e.readLo(4)) ch.state.hi = 0;   // ~RST 低: 立即复位
    e.drive(3, ch.state.hi ? V1 : V0, 0);                       // 重申相位 (结构变化后)
    e.drive(7, ch.state.hi ? VZ : V0, 0);
  },
});

def('LED', 'LED 指示灯', '输入/输出', [L(1, 'IN', 'in')], {
  detail: 'LED 指示灯, 用亮灭显示电平。\n引脚: IN 为逻辑输入, 高电平点亮。',
  custom: true, hideNums: true, size: { w: 56, h: 56 },
});

def('SEG7', '七段数码管·共阴', '输入/输出', [
  L(1, 'a', 'in'), L(2, 'b', 'in'), L(3, 'c', 'in'), L(4, 'd', 'in'),
  L(5, 'e', 'in'), L(6, 'f', 'in'), L(7, 'g', 'in'), L(8, 'dp', 'in'),
], {
  detail: '七段数码管 (共阴), 按段码显示字形。\n引脚: a~g 为七段输入, dp 为小数点; 段输入 1 点亮, 可配 7448 译码器。',
  custom: true, hideNums: true, size: { w: 168 },
});

def('PROBE', '逻辑探针', '输入/输出', [L(1, 'IN', 'in')], {
  detail: '逻辑探针, 实时显示被测点的逻辑状态。\n引脚: IN 为被测输入, 显示 1 / 0 / 高阻 Z / 未知 X。',
  custom: true, hideNums: true, size: { w: 56, h: 56 },
});

def('VCC', '电源 +5V', '输入/输出', [R(1, '5V', 'out')], {
  detail: '逻辑电源, 提供恒定高电平。\n引脚: 5V 恒输出 1 (+5V)。',
  custom: true, hideNums: true, size: { w: 56, h: 56 },
  init(ch) { ch.pinByNum[1].driven = 1; },
});

def('GND', '地 GND', '输入/输出', [R(1, 'GND', 'out')], {
  detail: '逻辑地, 提供恒定低电平。\n引脚: GND 恒输出 0。',
  custom: true, hideNums: true, size: { w: 56, h: 56 },
  init(ch) { ch.pinByNum[1].driven = 0; },
});

/* ---------------- PS/2 键盘 ----------------
 * 点击元件聚焦后用真实键盘打字, 按标准 PS/2 协议在 CLK/DATA 上串行发送:
 *   帧 = 起始位0 + 8数据位(LSB在前) + 奇校验位 + 停止位1, 共 11 个时钟脉冲
 *   键盘主动产生 ~16.7kHz 时钟 (半周期 30µs); DATA 在 CLK 高电平期间建立,
 *   CLK 低电平期间保持稳定 → 主机在 CLK 下降沿或上升沿采样均可
 * 扫描码为 PS/2 默认的 Set 2: 按下发 Make 码, 松开发 Break 码 (0xF0 + Make),
 * 扩展键 (方向键/右 Ctrl 等) 前缀 0xE0; CapsLock 按下/松开都发 Make (无 Break)
 * 键位按 e.code (物理键位) 映射, 与操作系统键盘布局无关 (映射表在 app.js)
 * 待发字节队列在 state.queue (随存档保存), 发送中的帧状态在 ch._ps2 (仅运行期) */

const PS2_HALF = 30;   // CLK 半周期 µs (~16.7kHz)

/* Set 2 扫描码表 (按物理键位 e.code) 与扩展键前缀表 */

const PS2_CODE = {
  KeyA: 0x1C, KeyB: 0x32, KeyC: 0x21, KeyD: 0x23, KeyE: 0x24, KeyF: 0x2B,
  KeyG: 0x34, KeyH: 0x33, KeyI: 0x43, KeyJ: 0x3B, KeyK: 0x42, KeyL: 0x4B,
  KeyM: 0x3A, KeyN: 0x31, KeyO: 0x44, KeyP: 0x4D, KeyQ: 0x15, KeyR: 0x2D,
  KeyS: 0x1B, KeyT: 0x2C, KeyU: 0x3C, KeyV: 0x2A, KeyW: 0x1D, KeyX: 0x22,
  KeyY: 0x35, KeyZ: 0x1A,
  Digit1: 0x16, Digit2: 0x1E, Digit3: 0x26, Digit4: 0x25, Digit5: 0x2E,
  Digit6: 0x36, Digit7: 0x3D, Digit8: 0x3E, Digit9: 0x46, Digit0: 0x45,
  Enter: 0x5A, Space: 0x29, Backspace: 0x66, Escape: 0x76, Tab: 0x0D,
  CapsLock: 0x58,
  F1: 0x05, F2: 0x06, F3: 0x04, F4: 0x0C, F5: 0x03, F6: 0x0B,
  F7: 0x83, F8: 0x0A, F9: 0x01, F10: 0x09, F11: 0x78, F12: 0x07,
  Minus: 0x55, Equal: 0x4E, BracketLeft: 0x54, BracketRight: 0x5B,
  Backslash: 0x5D, Semicolon: 0x4C, Quote: 0x52, Backquote: 0x0E,
  Comma: 0x41, Period: 0x49, Slash: 0x4A,
  ShiftLeft: 0x12, ShiftRight: 0x59, ControlLeft: 0x14, AltLeft: 0x11,
  Numpad0: 0x70, Numpad1: 0x69, Numpad2: 0x72, Numpad3: 0x7A,
  Numpad4: 0x6B, Numpad5: 0x73, Numpad6: 0x74, Numpad7: 0x6C,
  Numpad8: 0x75, Numpad9: 0x7D, NumpadMultiply: 0x7C, NumpadSubtract: 0x7B,
  NumpadAdd: 0x79, NumpadDecimal: 0x71,
};

const PS2_EXT = {
  ArrowUp: 0x75, ArrowDown: 0x72, ArrowLeft: 0x6B, ArrowRight: 0x74,
  ControlRight: 0x14, AltRight: 0x11, NumpadEnter: 0x5A, NumpadDivide: 0x4A,
  Home: 0x6C, End: 0x69, PageUp: 0x7D, PageDown: 0x7A,
  Insert: 0x70, Delete: 0x71, MetaLeft: 0x5B, MetaRight: 0x5C, ContextMenu: 0x5D,
};

/* 字符 → 扫描码序列 (美式布局; 大写/上位符号自动夹 Shift) */

const PS2_CHAR = (() => {
  const m = { ' ': [0x29, 0xF0, 0x29], '\n': [0x5A, 0xF0, 0x5A], '\t': [0x0D, 0xF0, 0x0D] };
  for (const ec in PS2_CODE) {
    if (/^Key[A-Z]$/.test(ec)) {
      const L = ec.slice(3);
      const k = PS2_CODE[ec];
      m[L.toLowerCase()] = [k, 0xF0, k];
      m[L] = [0x12, k, 0xF0, k, 0xF0, 0x12];
    } else if (/^Digit[0-9]$/.test(ec)) {
      m[ec[5]] = [PS2_CODE[ec], 0xF0, PS2_CODE[ec]];
    }
  }
  const shifted = { '!': 'Digit1', '@': 'Digit2', '#': 'Digit3', '$': 'Digit4',
    '%': 'Digit5', '^': 'Digit6', '&': 'Digit7', '*': 'Digit8', '(': 'Digit9',
    ')': 'Digit0', '~': 'Backquote', '_': 'Minus', '+': 'Equal',
    '{': 'BracketLeft', '}': 'BracketRight', '|': 'Backslash', ':': 'Semicolon',
    '"': 'Quote', '<': 'Comma', '>': 'Period', '?': 'Slash' };
  for (const c in shifted) { const k = PS2_CODE[shifted[c]]; m[c] = [0x12, k, 0xF0, k, 0xF0, 0x12]; }
  const plain = { '-': 'Minus', '=': 'Equal', '[': 'BracketLeft', ']': 'BracketRight',
    '\\': 'Backslash', ';': 'Semicolon', "'": 'Quote', ',': 'Comma',
    '.': 'Period', '/': 'Slash', '`': 'Backquote' };
  for (const c in plain) m[c] = [PS2_CODE[plain[c]], 0xF0, PS2_CODE[plain[c]]];
  return m;
})();

function ps2CharCodes(c) {
  if (PS2_CHAR[c]) return PS2_CHAR[c];
  if (c == null) return null;   // 调试: 越界访问时打印现场
  console.error('DBG ps2CharCodes got:', JSON.stringify(c));
  const up = c.toUpperCase();
  const code = PS2_CODE['Key' + up];
  return code != null ? [0x12, code, 0xF0, code, 0xF0, 0x12] : null;   // 其他大写字母兜底
}

/* 测试脚本: 每行一条 type 文本 / sleep 毫秒 / key 键名; # 与空行忽略 */

function ps2ParseScript(text) {
  const acts = [];
  for (const raw of String(text).split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#') || line.startsWith('//')) continue;
    const sl = line.match(/^sleep\s+(\d+)(ms|s)?$/i);
    if (sl) { acts.push({ type: 'sleep', us: +sl[1] * (sl[2] && sl[2].toLowerCase() === 's' ? 1000000 : 1000) }); continue; }
    const ky = line.match(/^key\s+([A-Za-z0-9]+)$/);
    if (ky) {
      let name = ky[1];
      name = name.charAt(0).toUpperCase() + name.slice(1);
      const code = PS2_CODE[name] != null ? PS2_CODE[name] : PS2_EXT[name];
      if (code != null) {
        const bytes = PS2_EXT[name] != null
          ? [0xE0, code, 0xE0, 0xF0, code]
          : [code, 0xF0, code];
        acts.push({ type: 'bytes', bytes });
      }
      continue;
    }
    const tp = line.match(/^type\s+([\s\S]*)$/);
    acts.push({ type: 'type', text: tp ? tp[1] : line });
  }
  return acts;
}

/** 脚本运行器: 引擎定时器驱动; 等发送排空 → 逐动作投喂字节 */

function ps2ScriptTick(ch, e) {
  if (!ch.state.running) { DBG('die: not running'); ch._sTick = false; return; }
  const run = ch.state.run;
  if (!run) { DBG('die: no run'); ch._sTick = false; return; }
  if ((ch._ps2 && ch._ps2.active) || ch.state.queue.length >= 56) {
    e.schedule(200, () => ps2ScriptTick(ch, e));            // 等帧/队列排空
    return;
  }
  if (run.i >= run.acts.length) {                            // 脚本完成
    ch.state.running = false;
    ch._sTick = false;
    delete ch.state.run;
    if (typeof window !== 'undefined')
      window.dispatchEvent(new CustomEvent('ps2scriptdone', { detail: { id: ch.id } }));
    return;
  }
  const a = run.acts[run.i];
  if (a.type === 'sleep') {
    run.i++;
    e.schedule(a.us, () => ps2ScriptTick(ch, e));
    return;
  }
  if (a.type === 'bytes') {
    ch.state.queue.push(...a.bytes);
    run.i++;
    ps2KickSend(ch, e);
    e.schedule(2000, () => ps2ScriptTick(ch, e));
    return;
  }
  if (run.ci >= a.text.length) {                             // 本行打完
    run.i++; run.ci = 0;
    e.schedule(500, () => ps2ScriptTick(ch, e));
    return;
  }
  if (run.ci >= a.text.length) { console.error('DBG ci overshoot in same tick', run.ci, a.text.length, a.text); }
  const codes = ps2CharCodes(a.text[run.ci]);
  run.ci++;
  if (codes) {
    if (ch.state.queue.length + codes.length > 64) {         // 队列将满: 等待
      e.schedule(200, () => ps2ScriptTick(ch, e));
      return;
    }
    ch.state.queue.push(...codes);
    ps2KickSend(ch, e);
  }
  e.schedule(4000, () => ps2ScriptTick(ch, e));              // 字符间 4ms
}

function ps2KickSend(ch, e) {
  if (!ch._ps2 || !ch._ps2.active) {         // 空闲: 重新启动发送状态机
    ch._ps2 = { active: true, phase: 0, bit: 0, bits: null, byte: 0 };
    ps2Tick(ch, e);
  }
}

/** 一字节的 11 个帧位: 0 + d0..d7 + 奇校验 + 1 */

function ps2FrameBits(byte) {
  const bits = [0];
  let ones = 0;
  for (let i = 0; i < 8; i++) { const b = (byte >> i) & 1; bits.push(b); ones += b; }
  bits.push(ones % 2 === 0 ? 1 : 0);   // 补 1 使 数据+校验 中 1 的个数为奇
  bits.push(1);
  return bits;
}

/** 发送状态机: 建 DATA(30µs) → CLK 低(30µs, 采样) → CLK 高(30µs) → 下一位 */

function ps2Tick(ch, e) {
  const t = ch._ps2;
  if (!t || !t.active) return;
  if (t.phase === 0) {                      // CLK 高电平期: 建立 DATA
    if (!t.bits || t.bit >= t.bits.length) {
      if (!ch.state.queue.length) {         // 队列空 → 回空闲
        t.active = false;
        e.drive(1, V1, 0); e.drive(2, V1, 0);
        return;
      }
      t.byte = ch.state.queue.shift();
      ch.state.lastByte = t.byte;
      t.bits = ps2FrameBits(t.byte);
      t.bit = 0;
    }
    e.drive(2, t.bits[t.bit], 0);
    t.phase = 1;
  } else if (t.phase === 1) {               // CLK 下降沿 (主机采样点)
    e.drive(1, V0, 0);
    t.phase = 2;
  } else {                                  // CLK 上升沿
    e.drive(1, V1, 0);
    t.bit++;
    t.phase = 0;
  }
  e.schedule(PS2_HALF, () => ps2Tick(ch, e));
}

def('PS2', 'PS/2 键盘', '输入/输出', [
  R(1, 'CLK', 'out'), R(2, 'DATA', 'out'),
], {
  detail: 'PS/2 键盘, 点击聚焦后用真实键盘打字, 按标准协议发送扫描码。\n引脚: 1 CLK 为时钟输出 (~16.7kHz), 2 DATA 为串行数据; 发送 Set 2 扫描码帧 (起始位 + 8 位数据 LSB 在前 + 奇校验 + 停止位), 按下发 Make 码、松开发 Break 码, 扩展键带 0xE0 前缀。',
  custom: true, hideNums: true, size: { w: 168, h: 112 },
  init(ch) {
    const s = ch.state;
    if (!Array.isArray(s.queue)) s.queue = [];
    s.running = false; delete s.run;         // 载入/上电: 脚本从头开始
    ch._ps2 = null;                          // 载入/上电: 丢弃发送中的帧
    ch.pinByNum[1].driven = V1;              // 空闲: CLK/DATA 均为高
    ch.pinByNum[2].driven = V1;
  },
  eval(ch, e) {
    const t = ch._ps2;
    if (ch.state.running && !ch._sTick) {    // 脚本运行器: 引擎定时器驱动
      ch._sTick = true;
      e.schedule(100, () => ps2ScriptTick(ch, e));   // _sTick 由链存活期持有
    }
    if (t && t.active) return;               // 发送中: 状态机经 timer 自驱动
    if (!ch.state.queue.length) return;
    ch._ps2 = { active: true, phase: 0, bit: 0, bits: null, byte: 0 };
    ps2Tick(ch, e);
  },
});

global.PS2_CODE = PS2_CODE;
global.PS2_EXT = PS2_EXT;
global.ps2ParseScript = ps2ParseScript;
global.ps2CharCodes = ps2CharCodes;

/* ---------------- 4×4 矩阵键盘 ----------------
 * 16 个按键按 4×4 排列, 8 个引脚 = 4 列 (C1..C4, 输入, 接主机扫描驱动)
 * + 4 行 (R1..R4, 输出, 接主机读取)。按键 (行r, 列c) 按下 = 行 r 与列 c 接通。
 * 行脚由元件驱动 (等效内置下拉/上拉电阻, 仿真无电阻元件):
 *   该行无按键按下 → 输出 props.pull 电平 (0=下拉·空闲0, 1=上拉·空闲1)
 *   按下的键所在列 = 1 → 行输出 1; 全为 0 → 0; 列未驱动(X) → 行输出 X
 * 支持 上拉+列低有效 (经典 74138/74145 扫描) 或 下拉+列高有效 两种极性。
 * state.keys = { "行,列": 1 } 记录按住中的键 (瞬时器件, 不随存档恢复) */

def('KB44', '4×4 矩阵键盘', '输入/输出', [
  L(1, 'C1', 'in'), L(2, 'C2', 'in'), L(3, 'C3', 'in'), L(4, 'C4', 'in'),
  R(5, 'R1', 'out'), R(6, 'R2', 'out'), R(7, 'R3', 'out'), R(8, 'R4', 'out'),
], {
  detail: '4×4 矩阵键盘, 16 键行列扫描, 供主机作键盘扫描接口。\n引脚: C1~C4 为列输入 (接扫描驱动), R1~R4 为行输出 (接读取); 按下的键使对应行列导通, 行脚内置下拉/上拉 (右键可切换极性)。',
  custom: true, hideNums: true, size: { w: 168, h: 168 },
  defaults: { pull: 0 },
  init(ch) {
    ch.state.keys = {};
    const idle = Number(ch.props.pull) ? V1 : V0;
    for (let i = 0; i < 4; i++) ch.pinByNum[5 + i].driven = idle;
  },
  eval(ch, e) {
    const idle = Number(ch.props.pull) ? V1 : V0;
    const keys = ch.state.keys || (ch.state.keys = {});
    for (let r = 0; r < 4; r++) {
      let has1 = false, hasX = false, pressed = false;
      for (let c = 0; c < 4; c++) {
        if (!keys[r + ',' + c]) continue;
        pressed = true;
        const cv = e.read(1 + c);
        if (cv === V1) has1 = true;
        else if (cv === VX) hasX = true;
      }
      e.drive(5 + r, has1 ? V1 : (hasX ? VX : (pressed ? V0 : idle)), 2);
    }
  },
});

/* ========================= 1602 字符型液晶 =========================
 * HD44780 风格接口: RS (1=数据/0=指令) + E (上升沿锁存) + 8 位数据总线,
 * RW 内部接地 (只写). 内置中文字库: 数据字节 >= 0x80 时与下一字节组成
 * GB2312 双字节编码, 合成一个汉字写入光标处; ASCII 字节单字节直写.
 * 常用指令: 0x01 清屏, 0x02/0x03 回 home, 0x80|n 设置地址
 * (第一行 0x00~0x27, 第二行 0x40~0x67). 地址悬空/未知按 0. */

let _gb2312 = null;

function lcdDataByte(e) {
  let v = 0;
  for (let i = 0; i < 8; i++) if (e.read(3 + i) === V1) v |= 1 << i;
  return v;
}

function lcdNext(a) { return a === 0x27 ? 0x40 : (a >= 0x67 ? 0 : a + 1); }

function lcdPush(ch, b) {
  const dd = ch.state.ddram;
  if (b < 0x80) {
    dd[ch.state.cur] = String.fromCharCode(b);
  } else if (ch.state.pending == null) {
    ch.state.pending = b;                        // 汉字首字节, 等待次字节
    return;
  } else {
    try {
      _gb2312 = _gb2312 || new TextDecoder('gb2312');
      dd[ch.state.cur] = _gb2312.decode(new Uint8Array([ch.state.pending, b]));
    } catch (err) { dd[ch.state.cur] = '?'; }
    ch.state.pending = null;
  }
  ch.state.cur = lcdNext(ch.state.cur);
}

function lcdExecCmd(ch, cmd) {
  const dd = ch.state.ddram;
  if (cmd === 0x01) {                            // 清屏
    for (let i = 0; i < 80; i++) dd[i] = ' ';
    ch.state.cur = 0; ch.state.pending = null;
  } else if (cmd === 0x02 || cmd === 0x03) {     // 回 home
    ch.state.cur = 0; ch.state.pending = null;
  } else if (cmd >= 0x80) {                      // 设置 DDRAM 地址
    const a = cmd & 0x7F;
    ch.state.cur = a < 80 ? a : 0;
    ch.state.pending = null;
  }
}

function lcdEnsureState(ch) {
  if (ch.state.ddram && ch.state.ddram.length === 80) return;
  const dd = new Array(80).fill(' ');
  const t1 = 'Hello, 74VM!', t2 = '中文液晶测试';
  [...t1].forEach((c, i) => { dd[i] = c; });
  [...t2].forEach((c, i) => { dd[0x40 + i] = c; });
  ch.state.ddram = dd;
  ch.state.cur = 0;
  ch.state.pending = null;
  ch.state.prevE = 0;
}

def('LCD1602', '1602 字符液晶', '输入/输出', [
  L(1, 'RS', 'in'), L(2, 'E', 'in'),
  R(3, 'D0', 'in'), R(4, 'D1', 'in'), R(5, 'D2', 'in'), R(6, 'D3', 'in'),
  R(7, 'D4', 'in'), R(8, 'D5', 'in'), R(9, 'D6', 'in'), R(10, 'D7', 'in'),
], {
  detail: '1602 字符型液晶, 2 行 × 16 字符, HD44780 风格接口, 内置 GB2312 中文字库。\n引脚: 1 RS (1=数据/0=指令), 2 E (上升沿锁存), 3~10 D0~D7 为 8 位数据总线; 常用指令 0x01 清屏、0x80|n 设置显示地址。',
  custom: true, hideNums: true, size: { w: 224, h: 112 },
  init(ch) { lcdEnsureState(ch); },
  onPowerOn(ch) {   // 上电: 屏面未初始化 (清空等待程序写入, 等效真实 HD44780 上电态)
    ch.state.ddram = new Array(80).fill(' ');
    ch.state.cur = 0; ch.state.pending = null; ch.state.prevE = 0;
  },
  eval(ch, e) {
    lcdEnsureState(ch);
    const en = e.read(2);
    const rising = en === V1 && ch.state.prevE !== V1;   // E 上升沿锁存
    ch.state.prevE = en;
    if (!rising) return;
    if (e.read(1) === V1) lcdPush(ch, lcdDataByte(e));   // RS=1 数据
    else lcdExecCmd(ch, lcdDataByte(e));                 // RS=0 指令
  },
});

function lcdPush12864(dd, b, ch) {
  if (b < 0x80) {
    dd[ch.state.cur] = String.fromCharCode(b);
  } else if (ch.state.pending == null) {
    ch.state.pending = b;
    return;
  } else {
    try {
      _gb2312 = _gb2312 || new TextDecoder('gb2312');
      dd[ch.state.cur] = _gb2312.decode(new Uint8Array([ch.state.pending, b]));
    } catch (err) { dd[ch.state.cur] = '?'; }
    ch.state.pending = null;
  }
  ch.state.cur = (ch.state.cur + 1) % 64;
}

/* ========================= 12864 图形液晶 (ST7920 风格) =========================
 * 同 1602 接口 (RS+E+8 位数据, RW 接地), 双层显示:
 *   文字层 DDRAM 4 行 × 16 半宽字符 (基本指令集 0x30, 地址 0x00~0x3F 线性),
 *   GB2312 双字节合成汉字 (占 1 格, 仿真简化);
 *   图形层 GDRAM 128×64 像素 (扩充指令集 0x34/0x36 开图形, 0x80|y 设行、
 *   0x80|x 设字节列, 每次 1 字节 = 8 像素, 列自动 +1);
 *   0x01 清空两层, 0x02 文字回 home. 渲染: 图形点阵 + 文字叠加. */

function lcd12864Ensure(ch) {
  if (!ch.state.ddram || ch.state.ddram.length !== 64) {
    const dd = new Array(64).fill(' ');
    const put = (row, str) => { [...str].slice(0, 16).forEach((c, i) => { dd[row * 16 + i] = c; }); };
    put(0, '12864 图形液晶');
    put(1, 'ST7920 中文库');
    ch.state.ddram = dd;
    ch.state.cur = 0;
  }
  if (!ch.state.gdram || ch.state.gdram.length !== 1024) {
    const g = new Array(1024).fill(0);
    for (let x = 0; x < 128; x++) { g[x >> 3] |= 0x80 >> (x & 7); g[63 * 16 + (x >> 3)] |= 0x80 >> (x & 7); }
    for (let y = 0; y < 64; y++) { g[y * 16] |= 0x80; g[y * 16 + 15] |= 0x01; }
    ch.state.gdram = g;   // 出厂演示: 屏幕四周一圈边框
  }
  if (ch.state.ext == null) {
    ch.state.ext = false; ch.state.gOn = false;
    ch.state.gStage = 0; ch.state.gy = 0; ch.state.gx = 0;
    ch.state.cur = 0; ch.state.prevE = 0;
  }
}

def('LCD12864', '12864 图形液晶', '输入/输出', [
  L(1, 'RS', 'in'), L(2, 'E', 'in'),
  R(3, 'D0', 'in'), R(4, 'D1', 'in'), R(5, 'D2', 'in'), R(6, 'D3', 'in'),
  R(7, 'D4', 'in'), R(8, 'D5', 'in'), R(9, 'D6', 'in'), R(10, 'D7', 'in'),
], {
  detail: '12864 图形液晶, ST7920 风格: 文字层 4 行 × 16 字 (中文字库) + 图形层 128×64 点阵。\n引脚: 1 RS (1=数据/0=指令), 2 E (上升沿锁存), 3~10 D0~D7 为 8 位数据总线; 0x30 基本指令集写文字, 0x34/0x36 扩充指令集并可开图形层。',
  custom: true, hideNums: true, size: { w: 280, h: 168 },
  init(ch) { lcd12864Ensure(ch); },
  onPowerOn(ch) {   // 上电: 文字/图形两层未初始化, 等待程序写入
    ch.state.ddram = new Array(64).fill(' ');
    ch.state.gdram = new Array(1024).fill(0);
    ch.state.cur = 0; ch.state.pending = null; ch.state.prevE = 0;
    ch.state.ext = false; ch.state.gOn = false;
    ch.state.gStage = 0; ch.state.gy = 0; ch.state.gx = 0;
  },
  eval(ch, e) {
    lcd12864Ensure(ch);
    const en = e.read(2);
    const rising = en === V1 && ch.state.prevE !== V1;
    ch.state.prevE = en;
    if (!rising) return;
    const b = lcdDataByte(e);
    const dd = ch.state.ddram;
    if (e.read(1) === V1) {                          // 数据写入
      if (ch.state.ext && ch.state.gOn) {            // 图形模式: 1 字节 = 8 像素
        ch.state.gdram[ch.state.gy * 16 + ch.state.gx] = b;
        ch.state.gx = (ch.state.gx + 1) % 16;
      } else {
        lcdPush12864(dd, b, ch);
      }
      return;
    }
    // 指令
    if (b === 0x01) {                                // 清屏: 文字 + 图形
      dd.fill(' ');
      ch.state.gdram.fill(0);
      ch.state.cur = 0; ch.state.gStage = 0; ch.state.pending = null;
    } else if (b === 0x02) {                         // 文字回 home
      ch.state.cur = 0;
    } else if (b === 0x30) {                         // 基本指令集
      ch.state.ext = false;
    } else if (b === 0x34 || b === 0x36) {           // 扩充指令集 (0x36 同时开图形)
      ch.state.ext = true;
      ch.state.gOn = b === 0x36;
    } else if (b >= 0x80) {                          // 设地址
      const a = b & 0x7F;
      if (ch.state.ext) {                            // 图形地址: 先行 Y 后字节列 X
        if (ch.state.gStage === 0) { ch.state.gy = a & 63; ch.state.gStage = 1; }
        else { ch.state.gx = a & 15; ch.state.gStage = 0; }
      } else {
        ch.state.cur = a < 64 ? a : 0;
      }
    }
  },
});
});
