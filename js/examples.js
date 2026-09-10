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

const EXAMPLES = [];

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

global.EXAMPLES = EXAMPLES;
if (typeof module !== 'undefined' && module.exports) module.exports = { EXAMPLES };

})(typeof window !== 'undefined' ? window : globalThis);
