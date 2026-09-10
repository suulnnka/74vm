/* =========================================================================
 * 74VM 内置示例电路
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
  desc: '两个与非门交叉反馈',
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

/* 2. D 触发器分频 (7474) */
EXAMPLES.push({
  name: 'D 触发器二分频 (7474)',
  desc: 'D 接 ~Q, 时钟上升沿翻转',
  build() {
    const b = B();
    const clk = b.add('CLOCK', 170, 200);
    const ff = b.add('7474', 450, 260);
    const led = b.add('LED', 740, 240, { props: { label: 'Q = CLK/2' } });
    b.wire(clk, 1, ff, 3);         // CK
    b.wire(ff, 6, ff, 2);          // 1~Q → 1D
    b.wire(ff, 5, led, 1);         // 1Q → LED
    return b;
  },
});

/* 3. 半加器 (7486 + 7408) */
EXAMPLES.push({
  name: '半加器 (7486+7408)',
  desc: 'S = A⊕B, C = A·B',
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

/* 4. 4 位二进制计数器 (74161) */
EXAMPLES.push({
  name: '4位计数器 (74161)',
  desc: '时钟计数, LED 显示 QA~QD',
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

/* 5. 3-8 译码器 (74138) */
EXAMPLES.push({
  name: '3-8 译码器 (74138)',
  desc: '开关选择地址, Y0~Y7 低有效',
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

/* 6. 数码管计数 (74161 + 7448 + 数码管) */
EXAMPLES.push({
  name: '数码管计数 (74161+7448)',
  desc: '0-9 循环计数显示',
  build() {
    const b = B();
    const clk = b.add('CLOCK', 150, 150, { props: { freq: 2 } });
    const vcc = b.add('VCC', 150, 560);
    const cnt = b.add('74161', 390, 330);
    const seg48 = b.add('7448', 660, 330);
    const disp = b.add('SEG7', 960, 330);
    b.wire(clk, 1, cnt, 2);
    b.wire(vcc, 1, cnt, 1);
    b.wire(vcc, 1, cnt, 9);
    b.wire(vcc, 1, cnt, 7);
    b.wire(vcc, 1, cnt, 10);
    b.wire(vcc, 1, seg48, 3);      // ~LT
    b.wire(vcc, 1, seg48, 4);      // ~BI
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

/* 7. 环形振荡器 (7404 三级反相环) */
EXAMPLES.push({
  name: '环形振荡器 (7404)',
  desc: '奇数个反相器首尾相接',
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

/* 8. 三态总线演示 (74245) */
EXAMPLES.push({
  name: '三态总线 (74245)',
  desc: 'DIR 控制方向, ~OE 使能',
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

global.EXAMPLES = EXAMPLES;
if (typeof module !== 'undefined' && module.exports) module.exports = { EXAMPLES };

})(typeof window !== 'undefined' ? window : globalThis);
