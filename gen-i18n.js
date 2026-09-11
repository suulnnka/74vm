/* 一次性脚本: 依据 js/chips/*.js 的 LIB 实际 desc/detail 字符串,
 * 生成 i18n-en.js 的 "元件描述" 词典块 (键逐字一致), 并校验全覆盖。 */
'use strict';
const fs = require('fs');
require('./js/engine.js');
const { LIB } = require('./js/chips.js');

/* 每个元件的英文简述 (仅列出本次改过或新增的; 74 系列简述沿用原有词条) */
const DESC_EN = {
  SW: 'Switch',
  BTN: 'Push button',
  CLOCK: 'Clock source',
  NE555: 'NE555 timer',
  PROBE: 'Logic probe',
  VCC: 'Power +5V',
  GND: 'Ground GND',
  PS2: 'PS/2 keyboard',
  KB44: '4×4 matrix keypad',
  LCD1602: 'LCD1602 character LCD',
  LCD12864: 'LCD12864 graphics LCD',
};

/* 每个元件的英文功能描述 */
const DETAIL_EN = {
  '7400': 'Four independent 2-input NAND gates.\nPins: inputs 1A\u20134A and 1B\u20134B, outputs 1Y\u20134Y, Y = \u00ac(A\u2227B).',
  '7402': 'Four independent 2-input NOR gates.\nPins: inputs 1A\u20134A and 1B\u20134B, outputs 1Y\u20134Y, Y = \u00ac(A\u2228B).',
  '7404': 'Six independent inverters.\nPins: inputs 1A\u20136A, outputs 1Y\u20136Y, Y = \u00acA.',
  '7408': 'Four independent 2-input AND gates.\nPins: inputs 1A\u20134A and 1B\u20134B, outputs 1Y\u20134Y, Y = A\u2227B.',
  '7410': 'Three independent 3-input NAND gates.\nPins: inputs A/B/C per gate, output Y, Y = \u00ac(A\u2227B\u2227C).',
  '7411': 'Three independent 3-input AND gates.\nPins: inputs A/B/C per gate, output Y, Y = A\u2227B\u2227C.',
  '7420': 'Two independent 4-input NAND gates.\nPins: inputs A/B/C/D per gate, output Y, Y = \u00ac(A\u2227B\u2227C\u2227D).',
  '7421': 'Two independent 4-input AND gates.\nPins: inputs A/B/C/D per gate, output Y, Y = A\u2227B\u2227C\u2227D.',
  '7432': 'Four independent 2-input OR gates.\nPins: inputs 1A\u20134A and 1B\u20134B, outputs 1Y\u20134Y, Y = A\u2228B.',
  '7486': 'Four independent 2-input XOR gates.\nPins: inputs 1A\u20134A and 1B\u20134B, outputs 1Y\u20134Y, Y = 1 when the inputs differ.',
  '7448': 'Decodes 4-bit BCD into 7-segment code (active-high segment outputs, for common-cathode displays).\nPins: A\u2013D BCD inputs (D = MSB), a\u2013g segment outputs; ~LT lamp test, ~BI blanking, ~RBI zero suppression, all active-low.',
  '74138': 'Decodes a 3-bit address into 8 select lines (active-low outputs).\nPins: A/B/C address (C = MSB), Y0\u2013Y7 outputs, selected line = 0 others = 1; enabled when G1 = 1 and ~G2A = ~G2B = 0, otherwise all outputs = 1.',
  '74139': 'Two independent 2-to-4 line decoders (active-low outputs).\nPins per half: A/B address (B = MSB), Y0\u2013Y3 outputs, selected = 0; ~E enable (active-low, all outputs = 1 when disabled).',
  '74151': '8-to-1 multiplexer selecting one of eight data lines.\nPins: D0\u2013D7 data inputs, A/B/C address (C = MSB), Y and ~Y complementary outputs; ~ST strobe (active-low, Y = 0 when disabled).',
  '74153': 'Two 4-to-1 multiplexers sharing one address.\nPins: 1I0\u20131I3 / 2I0\u20132I3 data inputs, S1/S0 common address (S1 = MSB), 1Y/2Y outputs, 1~G/2~G per-half strobes (active-low, Y = 0 when disabled).',
  '74157': 'Four 2-to-1 multiplexers (non-inverting).\nPins per group: A/B data inputs, Y output; SEL = 0 picks A, SEL = 1 picks B; ~ST strobe (active-low, all outputs = 0 when disabled).',
  '74283': '4-bit binary full adder with carry in/out.\nPins: A1\u2013A4 and B1\u2013B4 addend inputs (4 = MSB), C0 carry-in; S1\u2013S4 sum outputs, C4 carry-out (for cascading).',
  '7485': 'Compares two 4-bit binary numbers.\nPins: A0\u2013A3 and B0\u2013B3 data inputs; Q>, Q=, Q< result outputs; IN>, IN=, IN< cascade inputs wired to the lower chip.',
  '7474': 'Two rising-edge D flip-flops.\nPins per half: D data, CK clock (latches D on the rising edge), Q and ~Q complementary outputs; ~PRE async set / ~CLR async clear, active-low (tie high when unused).',
  '7476': 'Two rising-edge JK flip-flops.\nPins per half: J/K inputs, CK clock (rising edge; J = K = 1 toggles), Q and ~Q complementary outputs; ~PRE/~CLR async set/clear (active-low).',
  '74175': 'Four rising-edge D flip-flops with common clock and clear.\nPins: D0\u2013D3 data inputs, CK common clock (rising edge), ~CLR common clear (active-low); each bit has complementary Q and ~Q outputs.',
  '74374': 'Eight rising-edge D flip-flops with 3-state outputs, for bus interfacing.\nPins: D1\u2013D8 data inputs, CK common clock (rising edge); ~OE output enable (active-low, Q = high-Z when disabled).',
  '74161': '4-bit synchronous binary counter with preset and cascade.\nPins: CK counts on the rising edge, A\u2013D preset data, ~LOAD synchronous load / ~CLR async clear (both active-low); ENP/ENT count enables, QA\u2013QD outputs, RCO carry-out (1 at count 15 with ENT = 1).',
  '74164': '8-bit serial-in parallel-out shift register.\nPins: A AND B form the serial input, CK shifts on the rising edge, ~CLR clear (active-low); Q0\u2013Q7 parallel outputs (Q0 newest).',
  '74595': '8-bit shift register + output latch (3-state), for I/O expansion and daisy-chaining.\nPins: DS serial input, SH_CP shift clock (rising edge), ST_CP latch clock (rising edge moves shift data to the outputs), ~OE output enable (active-low), ~MR reset (active-low); Q0\u2013Q7 parallel outputs, Q7\' for cascading.',
  '74245': '8-bit bidirectional bus transceiver.\nPins: A0\u2013A7 and B0\u2013B7 bidirectional data ports; DIR = 1: A\u2192B, DIR = 0: B\u2192A; ~OE enable (active-low, both sides high-Z when disabled).',
  '74187': '256\u00d74-bit read-only memory (ROM), factory content = address value; custom content can be burned.\nPins: A0\u2013A7 address inputs (256 locations), O1\u2013O4 data outputs (4-bit, always driven).',
  '74S472': '512\u00d78-bit programmable read-only memory (PROM).\nPins: A0\u2013A8 address inputs (512 locations), D0\u2013D7 data outputs; /CE chip select active-low, outputs high-Z when disabled.',
  '74189': '16\u00d74-bit random-access memory (RAM).\nPins: A0\u2013A3 address inputs (16 locations), D1\u2013D4 bidirectional 3-state data bus; /CS and /WE active-low: /WE = 0 writes, /WE = 1 reads.',
  '6116': '2048\u00d78-bit static RAM (SRAM).\nPins: A0\u2013A10 address inputs (2048 locations), D0\u2013D7 bidirectional 3-state data bus; /CS, /OE, /WE active-low: /WE = 0 writes, /WE = 1 and /OE = 0 reads.',
  '6264': '8192\u00d78-bit static RAM (SRAM).\nPins: real DIP-28 numbering, A0\u2013A12 address, D0\u2013D7 bidirectional 3-state bus; dual chip select: /CS1 active-low + CS2 active-high (floating = deselected, tie to VCC when unused); /WE = 0 writes, /WE = 1 and /OE = 0 reads; pin 14 GND, pin 28 VCC.',
  'AT28C64B': '8192\u00d78-bit electrically erasable ROM (EEPROM); contents persist in save files, hex-editable via right-click and electrically rewritable like SRAM.\nPins: real DIP-28 numbering, A0\u2013A12 address, D0\u2013D7 bidirectional 3-state bus; /CE, /OE, /WE active-low: /WE = 0 writes, /WE = 1 and /OE = 0 reads; pin 14 GND, pin 28 VCC (breadboard needs power-rail jumpers).',
  'AT28C256': '32768\u00d78-bit electrically erasable ROM (EEPROM), great for storing programs of homemade CPUs.\nPins: real DIP-28 numbering (compatible with 62256 SRAM), A0\u2013A14 address, D0\u2013D7 bidirectional 3-state bus; /CE, /OE, /WE active-low: /WE = 0 writes, /WE = 1 and /OE = 0 reads; pin 14 GND, pin 28 VCC.',
  SW: 'Manual switch that drives and holds 0 or 1.\nPin: Q is the level output; click the chip to toggle between 0 and 1.',
  BTN: 'Momentary push button for manual single pulses.\nPin: Q is the output; 1 while held, back to 0 on release.',
  CLOCK: 'Square-wave clock source, toggles its output periodically.\nPin: CLK is the clock output; frequency adjustable (right-click \u2192 edit frequency).',
  NE555: 'NE555 timer in astable mode, outputs a square wave at the set frequency.\nPins: 3 OUT oscillating output, 4 ~RST low stops and resets, 7 DISCH discharge pin (conducting while OUT is low), 2 TRIG / 6 THRES threshold inputs; frequency adjustable (right-click).',
  LED: 'LED indicator, shows the level by lighting up.\nPin: IN logic input, lights on high level.',
  SEG7: '7-segment display (common cathode), renders the applied segment pattern.\nPins: a\u2013g segment inputs, dp decimal point; a segment lights on input 1, pairs with the 7448 decoder.',
  PROBE: 'Logic probe, shows the logic state of the measured point in real time.\nPin: IN is the input under test, displayed as 1 / 0 / high-Z Z / unknown X.',
  VCC: 'Logic power, provides a constant high level.\nPin: 5V constantly outputs 1 (+5V).',
  GND: 'Logic ground, provides a constant low level.\nPin: GND constantly outputs 0.',
  PS2: 'PS/2 keyboard: click to focus, then type on a real keyboard to send standard scan codes.\nPins: 1 CLK clock output (~16.7kHz), 2 DATA serial data; sends Set 2 frames (start bit + 8 data bits LSB first + odd parity + stop), Make code on press, Break code on release, 0xE0 prefix for extended keys.',
  KB44: '4\u00d74 matrix keypad, 16 keys in a row/column scan layout for host keyboard scanning.\nPins: C1\u2013C4 column inputs (scan drive side), R1\u2013R4 row outputs (read side); a pressed key connects its row and column, rows have built-in pull-down/pull-up (right-click to flip polarity).',
  LCD1602: '1602 character LCD, 2 lines \u00d7 16 chars, HD44780-style interface, built-in GB2312 CJK font.\nPins: 1 RS (1 = data / 0 = command), 2 E (latch on rising edge), 3\u201310 D0\u2013D7 8-bit data bus; common commands 0x01 clear, 0x80|n set address.',
  LCD12864: '12864 graphics LCD, ST7920-style: text layer 4 lines \u00d7 16 chars (CJK font) + 128\u00d764 pixel graphic layer.\nPins: 1 RS (1 = data / 0 = command), 2 E (latch on rising edge), 3\u201310 D0\u2013D7 8-bit data bus; 0x30 basic instruction set for text, 0x34/0x36 extended set enables the graphic layer.',
};

/* 组装词典条目 (JSON.stringify 生成的字符串字面量即合法 JS) */
const descLines = [], detailLines = [];
for (const d of Object.values(LIB)) {
  if (DESC_EN[d.type]) descLines.push('  ' + JSON.stringify(d.desc) + ': ' + JSON.stringify(DESC_EN[d.type]) + ',');
  if (DETAIL_EN[d.type]) detailLines.push('  ' + JSON.stringify(d.detail) + ': ' + JSON.stringify(DETAIL_EN[d.type]) + ',');
}
descLines.push("  '查看描述': 'View description',");

const block =
  '  /* ---- 元件简述 (desc, 侧栏/画布/放置提示显示) ---- */\n' +
  descLines.join('\n') +
  '\n\n  /* ---- 元件功能描述 (detail, 悬停浮窗与右键"查看描述"显示) ---- */\n' +
  detailLines.join('\n') +
  '\n\n';

const p = 'js/i18n-en.js';
let s = fs.readFileSync(p, 'utf8');
const start = s.indexOf('  /* ---- 元件描述');
const end = s.indexOf('  /* ---- 元件分类 ---- */');
if (start < 0 || end < 0 || end < start) { console.error('未找到词典区块标记'); process.exit(1); }
s = s.slice(0, start) + block + s.slice(end);
fs.writeFileSync(p, s);
console.log('已写入: 简述', descLines.length, '条, 功能描述', detailLines.length, '条');
