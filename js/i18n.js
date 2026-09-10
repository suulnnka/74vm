/* =========================================================================
 * 74VM 多语言支持 — 中文为源语言, t(中文) 返回当前语言文本
 *   I18N.t(s)          查表翻译 (未收录原样返回)
 *   I18N.tf(s, params) 先翻译再替换 {x} 占位符
 *   I18N.setLang(l)    切换并持久化 ('zh' | 'en'), 调用方负责刷新界面
 *   I18N.EN_HELP       英文版帮助正文 (index.html #helpBody 的 innerHTML)
 * ========================================================================= */
(function (global) {
'use strict';

const LS_KEY = '74vm_lang';
let lang = 'zh';
try { lang = localStorage.getItem(LS_KEY) === 'en' ? 'en' : 'zh'; } catch (e) { /* 隐私模式等 */ }

/* 中文 → English 词典 (键必须与源码中的中文字符串逐字一致) */
const EN = {
  /* ---- 对话框通用按钮 ---- */
  '确定': 'OK',
  '取消': 'Cancel',
  '取消 (Esc)': 'Cancel (Esc)',
  '保存': 'Save',
  '写入': 'Write',
  '关闭': 'Close',
  '导出': 'Export',
  '显示': 'Show',
  '清空': 'Clear',
  '覆盖重布': 'Overwrite',

  /* ---- 元件描述 (chips.js, 渲染时翻译) ---- */
  '开关·单击切换': 'Switch·click to toggle',
  '按键·按住=1': 'Push button·hold=1',
  '时钟源·右键改频率': 'Clock·right-click to set frequency',
  'NE555 定时器·时钟(右键改频率)': 'NE555 timer·clock (right-click to set frequency)',
  'LED 指示灯': 'LED indicator',
  '七段数码管·共阴': '7-segment display·common cathode',
  '逻辑探针·显示电平': 'Logic probe·shows level',
  '电源 +5V·恒1': 'Power +5V·constant 1',
  '地 GND·恒0': 'Ground GND·constant 0',
  'PS/2键盘·点击后打字': 'PS/2 keyboard·click, then type',
  '4×4矩阵键盘·按住按键': '4×4 matrix keypad·hold keys',
  '1602 液晶·内置中文字库': 'LCD1602·built-in CJK font',
  '12864 图形液晶·中文字库': 'LCD12864 graphics·CJK font',
  '四2输入与非门': 'Quad 2-input NAND',
  '四2输入或非门': 'Quad 2-input NOR',
  '六反相器': 'Hex inverter',
  '四2输入与门': 'Quad 2-input AND',
  '三3输入与非门': 'Triple 3-input NAND',
  '三3输入与门': 'Triple 3-input AND',
  '双4输入与非门': 'Dual 4-input NAND',
  '双4输入与门': 'Dual 4-input AND',
  '四2输入或门': 'Quad 2-input OR',
  '四2输入异或门': 'Quad 2-input XOR',
  'BCD→七段译码器': 'BCD→7-segment decoder',
  '4位比较器': '4-bit comparator',
  '3线-8线译码器': '3-to-8 line decoder',
  '双2线-4线译码器': 'Dual 2-to-4 line decoder',
  '8选1数据选择器': '8-to-1 multiplexer',
  '双4选1数据选择器': 'Dual 4-to-1 multiplexer',
  '四2选1数据选择器': 'Quad 2-to-1 multiplexer',
  '4位全加器': '4-bit full adder',
  '双D触发器': 'Dual D flip-flop',
  '双JK触发器': 'Dual JK flip-flop',
  '四D触发器': 'Quad D flip-flop',
  '八D触发器·三态': 'Octal D flip-flop·3-state',
  '4位二进制计数器': '4-bit binary counter',
  '8位移位寄存器': '8-bit shift register',
  '8位移位锁存器': '8-bit shift/latch register',
  '八路总线收发器': 'Octal bus transceiver',

  /* ---- 元件分类 ---- */
  '输入/输出': 'I/O',
  '门电路': 'Gates',
  '组合逻辑': 'Combinational',
  '触发器/锁存': 'Flip-flops/Latch',
  '计数/移位': 'Counter/Shift',
  '存储器': 'Memory',
  '总线接口': 'Bus',

  /* ---- 示例电路 (名称/描述与 examples.js 逐字一致) ---- */
  'SR 锁存器 (7400)': 'SR latch (7400)',
  '与非门交叉反馈; 开关输出 0 触发置位/复位, 同时为 0 是禁止态': 'NAND cross-feedback; switch outputs 0 to set/reset, both 0 = inhibited',
  'D 触发器二分频 (7474)': 'D flip-flop ÷2 (7474)',
  'D 接 ~Q, 时钟上升沿翻转, Q 频率 = CLK 一半': 'D tied to ~Q; toggles on each clock rising edge, Q = CLK/2',
  '半加器 (7486+7408)': 'Half adder (7486+7408)',
  'S = A⊕B, C = A·B, 拨 A/B 开关看四位真值表': 'S = A⊕B, C = A·B — toggle A/B switches to walk the truth table',
  '4位全加器 (74283)': '4-bit full adder (74283)',
  '拨 A4~A1 / B4~B1 开关, LED 显示和 S4~S1 与进位 C4': 'Toggle A4~A1 / B4~B1 switches; LEDs show the sum S4~S1 and carry C4',
  '3-8 译码器 (74138)': '3-to-8 decoder (74138)',
  '开关选择地址 CBA, 对应 Y 输出低电平 (LED 熄灭)': 'Switches set address CBA; the selected Y goes low (LED off)',
  '8选1数据选择器 (74151)': '8-to-1 multiplexer (74151)',
  '地址 CBA 选中一路数据: D0~D3=1, D4~D7=0, Y 与 ~Y 互补': 'Address CBA picks one data input: D0~D3=1, D4~D7=0; Y and ~Y are complementary',
  'JK触发器翻转 (7476)': 'JK flip-flop toggle (7476)',
  'J=K=1, 每个时钟上升沿翻转, Q 同样二分频': 'With J=K=1, Q toggles on every clock rising edge — divide by 2',
  '4位计数器 (74161)': '4-bit counter (74161)',
  '时钟计数 0~15 循环, LED 显示 QA~QD 二进制': 'Counts the clock 0–15 repeatedly; LEDs show QA~QD in binary',
  '数码管计数 (74161+7448)': '7-seg counter (74161+7448)',
  '计数器 → BCD 译码 → 七段数码管, 0-9 循环显示': 'Counter → BCD decoder → 7-segment display, cycling 0-9',
  '8位移位锁存 (74595)': '8-bit shift/latch (74595)',
  '拨数据开关按时钟移入, 按锁存键才更新输出 LED': 'Shift data in from the switch on clock; output LEDs update only on latch',
  '环形振荡器 (7404)': 'Ring oscillator (7404)',
  '奇数个反相器首尾相接, 以门延迟自激振荡': 'Odd number of inverters in a loop; self-oscillates on gate delays',
  '三态总线 (74245)': 'Tri-state bus (74245)',
  'DIR 控制方向, ~OE 使能; 断开 ~OE 输出高阻 LED 熄灭': 'DIR sets direction, ~OE enables; with ~OE open the outputs go high-Z and the LED turns off',
  'NE555 时钟闪烁灯': 'NE555 blinker',
  '无稳态振荡: TRIG/THRES/DISCH 相连, OUT 输出方波 (右键改频率)': 'Astable oscillation: TRIG/THRES/DISCH tied together, OUT is a square wave (right-click to set frequency)',
  'PS/2 扫描码接收 (74164)': 'PS/2 scancode receiver (74164)',
  '点击键盘打字, CLK/Data 帧位移入 74164, LED 观察扫描码波形': 'Type on the focused keyboard; frame bits shift into the 74164 — watch scancodes on the LEDs',
  '矩阵键盘扫描 (74138)': 'Keypad scanning (74138)',
  '拨 A/B 逐列扫描 (列高有效), 按住键格该列选中时行 LED 亮': 'Scan columns one by one with A/B (active-high); hold a key cell and its row LED lights when that column is selected',
  '1602 液晶打字机': 'LCD1602 typewriter',
  '拨 RS/D7~D0 组成命令或字符, 按一下 E 写入 (如清屏/打字)': 'Set RS/D7~D0 for a command or character, pulse E to write (clear screen / type)',

  /* ---- 画布内文字 ---- */
  '开关': 'Switch',
  '按住': 'Hold',
  '探针': 'Probe',
  '▶ 脚本运行中': '▶ script running',
  '输入中… Esc 退出': 'typing… Esc to exit',
  '点击后打字': 'click, then type',
  '上拉': 'pull-up',
  '下拉': 'pull-down',
  '上拉 1': 'pull-up 1',
  '下拉 0': 'pull-down 0',
  '按住按键接通行列': 'hold a key to join row & column',
  '未供电': 'No pwr',
  '⚡未供电': '⚡No pwr',
  '引脚': 'pin',
  '输入': 'input',
  '输出': 'output',
  '双向': 'I/O',
  '面包板': 'breadboard',
  '未放置元件 (拖到{t}上)': 'Unplaced chips (drag onto the {t})',
  '板{n} 电源轨 {r} 列{c}': 'Board {n} power rail {r} column {c}',
  '板{n} 孔位 {h} (同列5孔连通)': 'Board {n} hole {h} (5-hole column connected)',
  '{type} · 引脚{num} {name} ({dir})': '{type} · pin{num} {name} ({dir})',
  '{d} — 点击或拖拽放置': '{d} — click or drag to place',

  /* ---- 撤销/保存/连线 ---- */
  '没有可撤销的操作': 'Nothing to undo',
  '没有可重做的操作': 'Nothing to redo',
  '已保存到浏览器': 'Saved to browser',
  '保存失败: {m}': 'Save failed: {m}',
  '这两点已连接': 'These two points are already connected',
  '已连接 {a} ↔ {b}': 'Connected {a} ↔ {b}',

  /* ---- 右键菜单 ---- */
  '旋转 90° (R)': 'Rotate 90° (R)',
  '翻转 180° (R)': 'Flip 180° (R)',
  '编辑频率…': 'Edit frequency…',
  '编辑标签…': 'Edit label…',
  '退出打字 (Esc)': 'Exit typing (Esc)',
  '聚焦打字…': 'Focus to type…',
  '行脚空闲电平: {v} (点击切换)': 'Row idle level: {v} (click to toggle)',
  '复制 (Ctrl+D)': 'Duplicate (Ctrl+D)',
  '删除 (Del)': 'Delete (Del)',
  '删除': 'Delete',
  '删除导线': 'Delete wire',
  '删除跳线': 'Delete jumper',
  '移出面包板 (Del)': 'Remove from breadboard (Del)',
  '移出PCB (Del)': 'Remove from PCB (Del)',
  '⤢ 适配视图': '⤢ Fit view',
  '❓ 帮助': '❓ Help',
  '✨ 自动布线 (从原理图)': '✨ Auto-route (from schematic)',
  '📐 自动布局': '📐 Auto-place',
  '编辑测试脚本…': 'Edit test script…',
  '停止脚本': 'Stop script',
  '运行脚本': 'Run script',
  '编辑显示文本…': 'Edit display text…',
  '清屏': 'Clear screen',
  '清除图形': 'Clear graphics',
  '编辑内容 (十六进制)…': 'Edit contents (hex)…',
  '导出内容 (十六进制文件)': 'Export contents (hex file)',
  '获取快照 (十六进制)…': 'Take snapshot (hex)…',
  '导出快照 (十六进制文件)': 'Export snapshot (hex file)',

  /* ---- 对话框 ---- */
  '编辑标签 — {t}': 'Edit label — {t}',
  '元件标签 (留空清除):': 'Chip label (leave empty to clear):',
  '例如 CLK / ~RESET': 'e.g. CLK / ~RESET',
  'PS/2 测试脚本 — {t}': 'PS/2 test script — {t}',
  'type 文本 | sleep 毫秒 | key 键名 (# 注释):': 'type text | sleep ms | key name (# comment):',
  '# 每行一条指令, # 与空行忽略:': '# one instruction per line; # and blank lines ignored:',
  '#   type 文本    输入文本 (支持大写/符号)': '#   type text    type text (upper-case/symbols ok)',
  '#   sleep 500   等待 500 毫秒': '#   sleep 500   wait 500 ms',
  '#   key Enter   按键 (Enter/Space/ArrowUp/F1…)': '#   key Enter   press a key (Enter/Space/ArrowUp/F1…)',
  '新建画布': 'New canvas',
  '清空当前电路? (可用 Ctrl+Z 撤销)': 'Clear the current circuit? (Ctrl+Z to undo)',
  '面包板列数': 'Breadboard columns',
  '列数 (20 ~ 240)。常见: 30 = 半尺寸, 60 = 全尺寸, 63 = 常见规格:': 'Columns (20 – 240). Common: 30 = half-size, 60 = full-size, 63 = usual type:',
  '请输入 20 ~ 240 之间的整数': 'Enter an integer between 20 and 240',
  '请输入 0.1 ~ 20000 之间的数字': 'Enter a number between 0.1 and 20000',
  '导出立创EDA PCB': 'Export LCEDA PCB',
  '{n} 个元件尚未布局, 导出将忽略它们. 继续?': '{n} chips are not placed yet and will be skipped in the export. Continue?',
  '重新自动布线': 'Re-run auto-route',
  '重新自动布线将覆盖现有 {n} 根跳线, 继续?': 'Auto-route will overwrite the existing {n} jumpers. Continue?',
  '{t} 内容 — {n} ({s}×{w})': '{t} contents — {n} ({s}×{w})',
  '每字节 2 位十六进制, 空格分隔 (每行 16 字节). 可直接粘贴导入, 不足部分补 00:': 'Two hex digits per byte, space-separated (16 bytes per line). Paste to import; missing bytes filled with 00:',
  '格式无效: 只允许十六进制字节 (00 ~ FF)': 'Invalid: only hex bytes allowed (00 – FF)',
  '{t} 快照 — {n}': '{t} snapshot — {n}',
  '当前 {n} 字节内容 (已尝试复制到剪贴板):': 'Current contents, {n} bytes (a copy was put on the clipboard):',
  '1602 显示文本 — {n}': '1602 display text — {n}',
  '12864 显示文本 — {n}': '12864 display text — {n}',
  '共 2 行, 每行最多 16 个字符 (支持中文):': '2 lines, up to 16 characters each (CJK supported):',
  '共 4 行, 每行最多 16 个字符 (支持中文):': '4 lines, up to 16 characters each (CJK supported):',
  '最多 2 行': 'At most 2 lines',
  '最多 4 行': 'At most 4 lines',
  '每行最多 16 个字符': 'At most 16 characters per line',
  '振荡频率 — NE555 (由 R/C 决定)': 'Oscillation frequency — NE555 (set by the R/C network)',
  '时钟频率 — CLOCK': 'Clock frequency — CLOCK',
  '频率 (Hz, 0.1 ~ 20000):': 'Frequency (Hz, 0.1 – 20000):',

  /* ---- 提示 / 状态栏 ---- */
  '测试脚本已保存': 'Test script saved',
  '脚本已停止': 'Script stopped',
  '脚本为空: 右键 → 编辑测试脚本': 'Script is empty: right-click → Edit test script',
  '脚本开始运行 ({n} 条动作)': 'Script started ({n} actions)',
  'PS/2 脚本运行完成': 'PS/2 script finished',
  '键盘聚焦: 直接打字发送扫描码, Esc 退出': 'Keyboard focused: type to send scancodes, Esc to exit',
  '脚本错误: {m}': 'Script error: {m}',
  '● 运行中': '● Running',
  '‖ 已暂停': '‖ Paused',
  '元件 {c} · 导线 {w} · 事件 {e}': 'Chips {c} · Wires {w} · Events {e}',
  '缩放 {n}%': 'Zoom {n}%',
  '⚠ 事件过载(电路可能振荡或规模过大)': '⚠ Event overload (circuit may be oscillating or too large)',
  '⚡ {n} 颗芯片未接电源 (VCC/GND 列 → 电源轨)': '⚡ {n} chip(s) unpowered (VCC/GND columns → power rails)',
  '已放置 {t} ({d})': 'Placed {t} ({d})',
  '已放置到面包板: {t}': 'Placed on breadboard: {t}',
  '已放置封装: {t}': 'Package placed: {t}',
  '没有时钟源 — 已处理待定事件': 'No clock source — pending events flushed',
  '已清空': 'Cleared',
  '已重新摆放元件': 'Chips re-placed',
  '已清空全部跳线': 'All jumpers cleared',
  '最多 6 块板': 'At most 6 boards',
  '已添加一块面包板 (共 {n} 块)': 'Breadboard added ({n} in total)',
  '至少保留 1 块板': 'At least 1 board is required',
  '已移除一块板 (剩 {n} 块)': 'Board removed ({n} left)',
  '，{n} 个元件移回托盘': ', {n} chips moved back to the tray',
  '无效列数 (需 20~240)': 'Invalid column count (need 20–240)',
  '面包板已设为 {n} 列': 'Breadboard set to {n} columns',
  ' (⚠ {n} 个超范围元件移回托盘)': ' (⚠ {n} out-of-range chips moved to the tray)',
  '已自动布局': 'Auto-placed',
  '已导出立创EDA PCB — 在立创EDA(标准版) 文件→导入→EasyEDA 打开, 焊盘带网络可直接自动布线': 'LCEDA PCB exported — open it in LCEDA (Standard) via File→Import→EasyEDA; pads carry net names, so its auto-router can run directly',
  '已导出网表 JSON': 'Netlist JSON exported',
  '已加载示例: {n}': 'Example loaded: {n}',
  '格式不符': 'Unrecognized format',
  '导入成功: {n} 个元件': 'Imported: {n} chips',
  '导入失败: {m}': 'Import failed: {m}',
  '面包板模式 — 按住孔位拖动拉跳线, ✨自动布线可从原理图生成接线': 'Breadboard — drag between holes to wire jumpers; ✨Auto-route generates them from the schematic',
  '已按原理图顺序自动布局封装': 'Packages auto-placed in schematic order',
  'PCB 模式 — 拖动/旋转封装, 📤 导出立创EDA 后可在其内自动布线': 'PCB — drag/rotate packages; 📤 export to LCEDA and auto-route there',
  '已自动摆放并接线: {n} 根跳线': 'Auto-placed and wired: {n} jumpers',
  ' (⚠ {n} 处孔位紧张)': ' (⚠ {n} crowded hole spots)',
  '已移出面包板 (元件仍保留在电路中)': 'Removed from breadboard (chip stays in the circuit)',
  '已移出 PCB (元件仍保留在电路中)': 'Removed from PCB (chip stays in the circuit)',
  '没有选中项': 'Nothing selected',
  '{t} 内容已写入': '{t} contents written',
  '快照已复制到剪贴板': 'Snapshot copied to clipboard',
  '已导出 {f}': 'Exported {f}',
  '显示文本已更新': 'Display text updated',
  '已清屏': 'Screen cleared',
  '图形层已清除': 'Graphics layer cleared',
  'NE555 振荡频率已设为 {n} Hz': 'NE555 oscillation frequency set to {n} Hz',
  '时钟已设为 {n} Hz': 'Clock set to {n} Hz',
  '已恢复上次的电路 (文件菜单可新建)': 'Restored the last circuit (File → New to start over)',
  '欢迎使用 74VM — 点击左上角 ❓ 查看帮助': 'Welcome to 74VM — click ❓ (top-left) for help',

  /* ---- 菜单栏 ---- */
  '文件(F)': 'File(F)',
  '编辑(E)': 'Edit(E)',
  '视图(V)': 'View(V)',
  '仿真(S)': 'Simulate(S)',
  '工具(T)': 'Tools(T)',
  '帮助(H)': 'Help(H)',
  '导入 JSON…': 'Import JSON…',
  '导出 JSON…': 'Export JSON…',
  '保存到浏览器': 'Save to browser',
  '示例电路': 'Example circuits',
  '撤销': 'Undo',
  '重做': 'Redo',
  '旋转选中': 'Rotate selection',
  '复制选中': 'Duplicate selection',
  '删除选中': 'Delete selection',
  '适配视图': 'Fit view',
  '元件库': 'Library',
  '侧栏': 'sidebar',
  '元件标识 (面包板)': 'Chip labels (breadboard)',
  '关=悬停显示': 'off = show on hover',
  '原理图模式': 'Schematic',
  '面包板模式': 'Breadboard',
  'PCB 模式': 'PCB',
  '暂停': 'Pause',
  '运行': 'Run',
  '空格': 'Space',
  '时钟步进': 'Clock step',
  '半周期': 'half-period',
  '速度 ×1': 'Speed ×1',
  '速度 ×10': 'Speed ×10',
  '速度 ×100': 'Speed ×100',
  '速度 ×1000': 'Speed ×1000',
  '重新摆放元件': 'Re-place chips',
  '清空全部跳线': 'Clear all jumpers',
  '添加一块板子': 'Add a board',
  '移除一块板子': 'Remove a board',
  '设置列数…': 'Set columns…',
  '自动布局': 'Auto-place',
  '导出立创EDA PCB…': 'Export LCEDA PCB…',
  '导出网表 JSON…': 'Export netlist JSON…',
  '❓ 使用帮助': '❓ User guide',
  '语言': 'Language',

  /* ---- 静态界面 (index.html) ---- */
  '74VM · 74系列数字电路模拟器': '74VM · 74-series Digital Circuit Simulator',
  '搜索元件': 'Search chips',
  '收起/展开元件库': 'Collapse/expand library',
  '74VM 使用帮助': '74VM User Guide',
  '✕ 关闭': '✕ Close',
};

/* 英文版帮助正文 (与 index.html #helpBody 结构一致) */
const EN_HELP = `
      <h4>Three modes (switch in the top bar, or press 1 / 2 / 3)</h4>
      <ul>
        <li><b>📐 Schematic</b>: the default mode. Drag chips, drag from pin to pin to wire, live simulation.</li>
        <li><b>🍞 Breadboard</b>: a real breadboard view (60 columns × rows a-j + power rails; each column is 5 connected holes). On first entry chips are <b>auto-placed and all jumpers are generated from the schematic netlist</b>; you can also use ✨Auto-route / 📐Re-place / 🧹Clear wiring. Hold a hole and drop it on another to draw a jumper; dragging a hole with exactly one jumper = move that jumper end; drop VCC/GND onto a power rail to power the whole rail; DIPs straddle the center gap like real chips (power pins left unconnected), press R to flip 180°. The circuit keeps simulating live in breadboard mode.</li>
        <li><b>🟩 PCB</b>: DIP package layout + ratsnest preview (from the schematic netlist). After dragging/rotating (R) packages, <b>📤 Export LCEDA PCB</b> produces a PCB source file that LCEDA (Standard) opens directly — pads already carry net names, so its auto-router can run right away; 📋 Export netlist emits a generic netlist JSON (for a future built-in router).</li>
      </ul>
      <h4>Basics</h4>
      <ul>
        <li><b>Placing chips</b>: <b>drag</b> from the library on the left onto the canvas, or simply <b>click</b> a chip name to drop it in the middle of the view.</li>
        <li><b>Wiring</b>: <b>hold a pin and release on the target pin</b> to connect. Releasing on empty space cancels. A pin can hold multiple wires (like a junction). <b>Dragging a pin with exactly one wire = move that wire end</b> (re-wire); hold <kbd>Ctrl</kbd> while dragging to force a new wire instead.</li>
        <li><b>Move / view</b>: <b>left-drag a chip</b> to move it; <b>right-drag (or middle-drag)</b> pans, wheel zooms, trackpad <b>two-finger scroll pans, pinch zooms</b> (macOS-like). <b>Fit view</b> shows everything.</li>
        <li><b>Rotate</b>: select and press <kbd>R</kbd>, or use the context menu. <b>Delete</b>: <kbd>Del</kbd> / context menu.</li>
        <li><b>Switch / button</b>: click to toggle / hold to conduct. <b>Labels / clock frequency</b>: right-click a chip → <b>Edit label…</b>.</li>
        <li><b>PS/2 keyboard</b>: <b>click the chip to focus, then just type</b>. Keys are sent serially over CLK/DATA per the standard PS/2 protocol (Set 2 scancodes): Make code on press, Break code (0xF0 + code) on release, 0xE0 prefix for extended keys (arrows etc.); frame = start bit + 8 data bits (LSB first) + odd parity + stop bit, with a ~16.7kHz clock generated by the device; data is stable on the falling edge. <kbd>Esc</kbd> or clicking empty space exits typing; pair with 74164 / 7474 etc. to build scancode decoder circuits.</li>
        <li><b>4×4 matrix keypad</b>: 4 columns (C1..C4) + 4 rows (R1..R4). <b>Holding a key cell</b> connects its row and column (dragging a cell moves the chip). Row pins have built-in pull-downs (idle 0); right-click to switch to <b>pull-up</b> (idle 1, for column-active-low scans such as 74138/74145); if the pressed key's column is undriven, that row reads X.</li>
        <li><b>LCD1602</b>: RS + E + 8-bit data (HD44780 style, RW grounded). E rising edge latches; instruction 0x01 clears, 0x02 homes, 0x80|n sets the address (two lines start at 0x00/0x40); data supports ASCII and two-byte GB2312 Chinese. Right-click to edit the display text (rendered monospaced) / clear the screen.</li>
        <li><b>LCD12864 graphics</b>: ST7920 style — a 4-row×16-char text layer plus a 128×64 pixel graphics layer you can overlay. Extended instruction 0x36 enables graphics; 0x80|y sets the row, 0x80|x the byte column, then each written byte is 8 pixels with auto-advance; right-click to edit text / clear screen / clear graphics.</li>
        <li><b>Memory</b>: <b>74187</b> ROM 256×4, <b>74S472</b> PROM 512×8 (right-click → edit / export, hex paste supported); <b>74189</b> RAM 16×4, <b>6116</b> SRAM 2K×8 (right-click → snapshot / export). /CE, /CS, /WE, /OE are active-low; floating addresses read as 0.</li>
      </ul>
      <h4>Levels & colors</h4>
      <ul>
        <li><span class="sw v1"></span> Green = high (1); <span class="sw v0"></span> gray-blue = low (0).</li>
        <li><span class="sw vx"></span> Orange = unknown (X): floating input, unknown data, or conflicting outputs.</li>
        <li><span class="sw vz"></span> Dashed gray = high-impedance (Z): tri-state output disabled, net undriven.</li>
        <li>Unconnected inputs are treated as X; active-low pins whose name starts with <code>~</code> (e.g. ~CLR, ~OE, ~G2A) read X as "inactive" (like a weak pull-up).</li>
        <li>On wiring / power-up the engine gives X-output gates a one-shot "power-on perturbation", so pure feedback loops (ring oscillators, latches) can self-start.</li>
      </ul>
      <h4>Run controls</h4>
      <ul>
        <li><b>⏸ / ▶</b> pause or resume the clock; while paused, manual switch toggles still propagate.</li>
        <li><b>⏭ Step</b>: toggles every clock source by half a period per press — handy for single-stepping counters / flip-flops.</li>
        <li><b>Speed</b>: simulation-time multiplier. The status bar shows simulated time and the total event count (a runaway count means the circuit is oscillating).</li>
      </ul>
      <h4>Shortcuts</h4>
      <ul class="keys">
        <li><kbd>Space</kbd> run/pause</li>
        <li><kbd>R</kbd> rotate selection</li>
        <li><kbd>Del</kbd> delete selection</li>
        <li><kbd>Esc</kbd> cancel wiring / clear selection</li>
        <li><kbd>Ctrl+Z</kbd>/<kbd>Ctrl+Y</kbd> undo/redo</li>
        <li><kbd>Ctrl+D</kbd> duplicate</li>
      </ul>
      <h4>Saving</h4>
      <ul>
        <li>Changes are <b>auto-saved</b> to the browser's localStorage; use File → Export / Import JSON to back up or share.</li>
      </ul>
`;

function t(s) {
  if (lang === 'zh') return s;
  const r = EN[s];
  return r === undefined ? s : r;
}
function tf(s, params) {
  let r = t(s);
  if (params) for (const k in params) r = r.split('{' + k + '}').join(params[k]);
  return r;
}
function setLang(l) {
  lang = l === 'en' ? 'en' : 'zh';
  try { localStorage.setItem(LS_KEY, lang); } catch (e) { /* 忽略 */ }
}

global.I18N = {
  t, tf, setLang, EN, EN_HELP,
  get lang() { return lang; },
};

})(typeof window !== 'undefined' ? window : globalThis);
