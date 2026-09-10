/* =========================================================================
 * 74VM 仿真引擎 — 事件驱动数字电路模拟核心
 *
 * 电平模型: 0 / 1 / 'Z'(高阻) / 'X'(未知: 悬空输入、数据未知、输出冲突)
 * 时间单位: 1 tick = 1 µs（门延迟 ~1-3 tick，时钟周期按 Hz 换算）
 *
 * 结构:
 *   - Chip  : 元件实例, 引脚带驱动值 driven (0/1/Z/X)
 *   - Net   : 由导线连接的引脚集合, 值 = 所有驱动引脚的合并
 *             (无驱动→Z, 有0有1→X, 有X→X)
 *   - 事件队列(最小堆, 按 (t, seq) 排序): 'pin' 驱动变更 / 'eval' 重新求值 / 'timer' 定时回调
 *   - 时钟源由 advance() 在主循环中按 nextT 逐沿触发
 * ========================================================================= */
(function (global) {
'use strict';

const V0 = 0, V1 = 1, VZ = 'Z', VX = 'X';
const Sim = { V0, V1, VZ, VX };

/** 网络驱动合并: [] → Z; {0,1} → X; 含 X → X; 否则唯一电平 */
function resolveDrivers(drivers) {
  if (!drivers.length) return VZ;
  let has0 = false, has1 = false, hasX = false;
  for (const d of drivers) {
    if (d === V0) has0 = true;
    else if (d === V1) has1 = true;
    else hasX = true;
  }
  if (has0 && has1) return VX;
  if (hasX) return VX;
  return has1 ? V1 : V0;
}

/* ---------------- 最小堆 (按 t, 再按 seq FIFO) ---------------- */
function cmpEv(a, b) { return a.t - b.t || a.seq - b.seq; }
class MinHeap {
  constructor() { this.a = []; }
  get size() { return this.a.length; }
  peek() { return this.a[0]; }
  clear() { this.a.length = 0; }
  push(e) {
    const a = this.a; a.push(e);
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (cmpEv(a[i], a[p]) < 0) { const t = a[i]; a[i] = a[p]; a[p] = t; i = p; }
      else break;
    }
  }
  pop() {
    const a = this.a, top = a[0], last = a.pop();
    if (a.length) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1;
        let m = i;
        if (l < a.length && cmpEv(a[l], a[m]) < 0) m = l;
        if (r < a.length && cmpEv(a[r], a[m]) < 0) m = r;
        if (m === i) break;
        const t = a[i]; a[i] = a[m]; a[m] = t; i = m;
      }
    }
    return top;
  }
}

/* ---------------- 门函数 (输入保证为 0/1) ---------------- */
const GATE_FNS = {
  and:  xs => xs.every(x => x === 1),
  or:   xs => xs.some(x => x === 1),
  nand: xs => !xs.every(x => x === 1),
  nor:  xs => !xs.some(x => x === 1),
  xor:  xs => xs[0] !== xs[1],
  xnor: xs => xs[0] === xs[1],
  not:  xs => xs[0] !== 1,
};

let NET_SEQ = 0;
class Net {
  constructor() { this.id = ++NET_SEQ; this.pins = []; this.value = VZ; }
}

let CHIP_SEQ = 1, WIRE_SEQ = 1;

class Engine {
  /** @param lib 元件库: { [type]: {desc, pins, gates|eval, ...} } */
  constructor(lib) {
    this.lib = lib;
    this.chips = new Map();      // id → chip
    this.wires = [];             // {id, a:{chip,num}, b:{chip,num}}
    this.nets = [];              // Net[]
    this.q = new MinHeap();
    this.seq = 0;
    this.simTime = 0;            // µs
    this.running = true;
    this.eventCount = 0;         // 累计事件数(观测振荡用)
    this.overload = false;       // 单帧事件超限(疑似振荡)
    this.version = 0;            // 结构版本号(UI 触发自动保存)
    this.FRAME_CAP = 120000;
    this.SETTLE_CAP = 200000;
  }

  def(type) {
    const d = this.lib[type];
    if (!d) throw new Error('未知元件类型: ' + type);
    return d;
  }

  /* ---------------- 结构编辑 ---------------- */

  makeChip(type, x, y, rot, props, state, id) {
    const d = this.def(type);
    const ch = {
      id: id != null ? id : CHIP_SEQ++,
      type, x, y, rot: rot || 0,
      props: Object.assign({}, d.defaults, props),
      state: state ? state : {},
      pins: [], pinByNum: {},
      _evalQueued: false,
      powered: true,             // 供电标志 (面包板模式按电源脚连通性更新)
    };
    d.pins.forEach((p, i) => {
      const pin = {
        num: p.num, name: p.name, dir: p.dir, side: p.side,
        driven: VZ, netObj: null, chip: ch, idx: i,
      };
      ch.pins.push(pin);
      ch.pinByNum[p.num] = pin;
    });
    if (ch.id >= CHIP_SEQ) CHIP_SEQ = ch.id + 1;
    return ch;
  }

  /** 放置元件 (上电求值) */
  addChip(type, x, y, rot, props, state, id) {
    const d = this.def(type);
    const ch = this.makeChip(type, x, y, rot, props, state, id);
    this.chips.set(ch.id, ch);
    if (d.init) d.init(ch, this);
    this.evalChip(ch);
    this.flush(this.SETTLE_CAP);
    this.version++;
    return ch;
  }

  removeChip(id) {
    const ch = this.chips.get(id);
    if (!ch) return;
    this.wires = this.wires.filter(w => w.a.chip !== ch && w.b.chip !== ch);
    this.chips.delete(id);
    this.rebuildNets();
    this.version++;
  }

  wireExists(chipA, numA, chipB, numB) {
    return this.wires.some(w =>
      (w.a.chip === chipA && w.a.num === numA && w.b.chip === chipB && w.b.num === numB) ||
      (w.b.chip === chipA && w.b.num === numA && w.a.chip === chipB && w.a.num === numB));
  }

  /** 连线 (a 引脚 ↔ b 引脚) */
  addWire(chipA, numA, chipB, numB) {
    if (!chipA || !chipB) return null;
    if (chipA === chipB && numA === numB) return null;
    if (!chipA.pinByNum[numA] || !chipB.pinByNum[numB]) return null;
    if (this.wireExists(chipA, numA, chipB, numB)) return null;
    const w = { id: WIRE_SEQ++, a: { chip: chipA, num: numA }, b: { chip: chipB, num: numB } };
    this.wires.push(w);
    this.rebuildNets();
    this.version++;
    return w;
  }

  removeWire(id) {
    const n = this.wires.length;
    this.wires = this.wires.filter(w => w.id !== id);
    if (this.wires.length !== n) { this.rebuildNets(); this.version++; }
  }

  /** 整体替换网表 (模式切换: 原理图网表 ↔ 面包板派生网表) */
  setWiresRaw(list) {
    this.wires = [];
    for (const w of list) {
      const ca = this.chips.get(w.a[0]), cb = this.chips.get(w.b[0]);
      if (!ca || !cb) continue;
      if (!ca.pinByNum[w.a[1]] || !cb.pinByNum[w.b[1]]) continue;
      this.wires.push({ id: WIRE_SEQ++, a: { chip: ca, num: w.a[1] }, b: { chip: cb, num: w.b[1] } });
    }
    this.rebuildNets();
  }

  /** 导出为纯数据网表 [{a:[chipId,pinNum], b:[...]}] */
  wiresRaw() {
    return this.wires.map(w => ({ a: [w.a.chip.id, w.a.num], b: [w.b.chip.id, w.b.num] }));
  }

  touch() { this.version++; }

  /** 引脚呈现值(渲染/测试用): 无网络输入→X, 其余取网络值或自身驱动 */
  pinDisplay(pin) {
    if (pin.netObj) return pin.netObj.value;
    if (pin.dir === 'in') return VX;
    return pin.driven;
  }

  /* ---------------- 网络 ---------------- */

  /** 由导线重建全部网络 (并查集), 再触发受影响元件并结算 */
  rebuildNets() {
    // 快照旧呈现值
    const old = new Map();
    for (const ch of this.chips.values())
      for (const p of ch.pins) old.set(p, this.pinDisplay(p));

    for (const ch of this.chips.values())
      for (const p of ch.pins) p.netObj = null;

    // 并查集
    const parent = new Map();
    for (const ch of this.chips.values())
      for (const p of ch.pins) parent.set(p, p);
    const find = p => { let r = p; while (parent.get(r) !== r) r = parent.get(r); return r; };
    for (const w of this.wires) {
      const pa = w.a.chip.pinByNum[w.a.num], pb = w.b.chip.pinByNum[w.b.num];
      if (!pa || !pb) continue;
      const ra = find(pa), rb = find(pb);
      if (ra !== rb) parent.set(ra, rb);
    }
    // 收集导线两端的引脚分组
    const wired = new Set();
    for (const w of this.wires) {
      const pa = w.a.chip.pinByNum[w.a.num], pb = w.b.chip.pinByNum[w.b.num];
      if (pa) wired.add(pa);
      if (pb) wired.add(pb);
    }
    const groups = new Map();
    for (const p of wired) {
      const r = find(p);
      if (!groups.has(r)) groups.set(r, []);
      groups.get(r).push(p);
    }
    this.nets = [];
    for (const pins of groups.values()) {
      const n = new Net();
      n.pins = pins;
      for (const p of pins) p.netObj = n;
      this.nets.push(n);
    }
    for (const n of this.nets)
      n.value = resolveDrivers(n.pins.filter(p => p.driven !== VZ).map(p => p.driven));

    // 触发呈现值变化的输入侧元件
    const dirty = new Set();
    for (const ch of this.chips.values()) {
      const d = this.lib[ch.type];
      if (!(d.gates || d.eval)) continue;
      for (const p of ch.pins) {
        if (p.dir === 'out' && p.side) continue; // 输出脚变化由自身 eval 产生
        if (this.pinDisplay(p) !== old.get(p)) { dirty.add(ch); break; }
      }
    }
    for (const ch of dirty) this.evalChip(ch);
    this.flush(this.SETTLE_CAP);

    // 上电扰动: 输出为 X 的门电路强制为 0 再结算, 使纯反馈环路自启动
    this.kick();
  }

  /** 上电扰动(仅作用于 driven===X 的门输出) */
  /** 外部状态变更 (如 ROM 内容改写) 后: 重评估全部元件并结算 */
  reevalAll() {
    this.version++;
    for (const ch of this.chips.values()) {
      const d = this.lib[ch.type];
      if (d.gates || d.eval) this.evalChip(ch);
    }
    this.flush(this.SETTLE_CAP);
    this.kick();
  }

  kick() {
    const before = new Map();
    for (const n of this.nets) before.set(n, n.value);
    let kicked = false;
    for (const ch of this.chips.values()) {
      if (ch.powered === false) continue;   // 未上电芯片的 X 输出不被扰动
      const d = this.lib[ch.type];
      if (!d.gates) continue;
      for (const g of d.gates) {
        const p = ch.pinByNum[g.o];
        if (p.driven === VX) { p.driven = V0; kicked = true; }
      }
    }
    if (!kicked) return;
    for (const n of this.nets)
      n.value = resolveDrivers(n.pins.filter(p => p.driven !== VZ).map(p => p.driven));
    const dirty = new Set();
    for (const n of this.nets) {
      if (before.get(n) !== n.value) {
        for (const p of n.pins) {
          const d = this.lib[p.chip.type];
          if (d.gates || d.eval) dirty.add(p.chip);
        }
      }
    }
    for (const ch of dirty) this.evalChip(ch);
    this.flush(this.SETTLE_CAP);
  }

  /* ---------------- 求值 ---------------- */

  /** 元件求值 API (传给 def.eval) */
  api(ch) {
    const eng = this;
    return {
      state: ch.state,
      time: this.simTime,
      read(n) { return eng.readPin(ch, n); },
      readLo(n) { return eng.readPin(ch, n) === V0; },  // 低有效: 仅确定低电平才算动作
      readHi(n) { return eng.readPin(ch, n) === V1; },  // 高有效: 仅确定高电平才算动作
      drive(n, v, delay) { eng.drivePin(ch, n, v, delay); },
      notv(v) { return (v === VX || v === VZ) ? VX : (v ? V0 : V1); },
      /** 定时回调: us 微秒后执行 fn (与网络变化无关, 供主动型元件自驱动) */
      schedule(us, fn) { eng.scheduleTimer(us, fn); },
    };
  }

  /** 元件读取输入: 无网络/高阻 → X; io 引脚取"外部视角"(排除自身驱动) */
  readPin(ch, n) {
    const p = ch.pinByNum[n];
    if (!p) return VX;
    if (p.dir === 'io' && p.netObj) {
      return resolveDrivers(
        p.netObj.pins.filter(q => q !== p && q.driven !== VZ).map(q => q.driven));
    }
    if (p.netObj) return p.netObj.value === VZ ? VX : p.netObj.value;
    if (p.dir === 'in') return VX;
    return VX; // 输出脚无网络时当作悬空输入读取
  }

  /** 延迟驱动输出 (值未变化时忽略) */
  drivePin(ch, n, v, delay) {
    const p = ch.pinByNum[n];
    if (!p || p.driven === v) return;
    this.q.push({ t: this.simTime + (delay == null ? 2 : delay), seq: ++this.seq, kind: 'pin', ch, p, v });
  }

  /** 定时回调事件 */
  scheduleTimer(us, fn) {
    this.q.push({ t: this.simTime + (us || 0), seq: ++this.seq, kind: 'timer', fn });
  }

  /** 元件求值: 门表或自定义 eval */
  evalChip(ch) {
    const d = this.lib[ch.type];
    if (!d) return;
    ch._evalQueued = false;
    if (!d.gates && !d.eval) return;
    if (ch.powered === false) {
      // 未上电: 输出脚强制 X (io 脚不驱动, 保持高阻不拖总线)
      for (const p of ch.pins) if (p.dir === 'out') this.drivePin(ch, p.num, VX);
      return;
    }
    const E = this.api(ch);
    try {
      if (d.gates) {
        const delay = d.delay == null ? 1 : d.delay;
        for (const g of d.gates) {
          const ins = g.i.map(n => E.read(n));
          let v;
          if (ins.indexOf(VX) >= 0) v = VX;
          else v = GATE_FNS[g.f](ins) ? V1 : V0;
          E.drive(g.o, v, delay);
        }
      } else {
        d.eval(ch, E);
      }
    } catch (err) {
      console.error('元件求值错误 ' + ch.type + ':', err);
    }
  }

  /** 应用一次驱动变更 → 更新网络 → 调度受影响元件 */
  applyPin(pin, v) {
    pin.driven = v;
    const net = pin.netObj;
    if (!net) return;
    const nv = resolveDrivers(net.pins.filter(p => p.driven !== VZ).map(p => p.driven));
    if (nv === net.value) return;
    net.value = nv;
    for (const p2 of net.pins) {
      const c2 = p2.chip, d2 = this.lib[c2.type];
      if (!(d2.gates || d2.eval)) continue;
      if (!c2._evalQueued) {
        c2._evalQueued = true;
        this.q.push({ t: this.simTime, seq: ++this.seq, kind: 'eval', ch: c2 });
      }
    }
  }

  /** 立即驱动(开关/按键/时钟)并结算 */
  driveNow(ch, pinNum, v) {
    const p = ch.pinByNum[pinNum];
    if (!p) return;
    if (p.driven !== v) this.applyPin(p, v);
    this.flush(this.SETTLE_CAP);
  }

  /** 处理事件队列至 maxT (或队列空), 返回处理数量 */
  processQueue(maxT = Infinity, cap = Infinity) {
    let n = 0;
    while (this.q.size) {
      const e = this.q.peek();
      if (e.t > maxT) break;
      this.q.pop();
      if (e.t > this.simTime) this.simTime = e.t;
      this.eventCount++;
      if (e.kind === 'pin') this.applyPin(e.p, e.v);
      else if (e.kind === 'timer') { try { e.fn(); } catch (err) { console.error('定时器回调错误:', err); } }
      else this.evalChip(e.ch);
      if (++n >= cap) { this.overload = true; break; }
    }
    return n;
  }

  flush(cap) { return this.processQueue(Infinity, cap == null ? this.SETTLE_CAP : cap); }

  /* ---------------- 时钟与推进 ---------------- */

  /** 时钟半周期(µs) */
  clockHalf(ch) {
    const f = Number(ch.props && ch.props.freq) || 1;
    return Math.max(1, Math.round(500000 / f));
  }

  fireClock(ch) {
    const s = ch.state;
    s.phase = s.phase ? 0 : 1;
    s.nextT = this.simTime + this.clockHalf(ch);
    const p = ch.pinByNum[1];
    if (p) this.applyPin(p, s.phase);
  }

  /** 主循环推进: dtUs 微秒真实增量(乘以速度倍率后的仿真增量) */
  advance(dtUs) {
    if (!this.running) { this.flush(this.FRAME_CAP); return; }
    const target = this.simTime + dtUs;
    for (let guard = 0; guard < 2000000; guard++) {
      this.processQueue(target, this.FRAME_CAP);
      // 找最早到期的时钟 (未供电的时钟不振荡)
      let c = null, best = Infinity;
      for (const ch of this.chips.values()) {
        if (ch.type !== 'CLOCK' || ch.powered === false) continue;
        if (ch.state.nextT == null)
          ch.state.nextT = this.simTime + this.clockHalf(ch);
        if (ch.state.nextT < best) { best = ch.state.nextT; c = ch; }
      }
      if (!c || best > target) break;
      if (best > this.simTime) this.simTime = best;
      this.fireClock(c);
    }
    this.processQueue(target, this.FRAME_CAP);
  }

  /** 步进: 翻转所有时钟半周期并结算, 返回触发的时钟数 */
  stepClocks() {
    let fired = 0;
    for (const ch of this.chips.values()) {
      if (ch.type !== 'CLOCK' || ch.powered === false) continue;
      this.fireClock(ch);
      fired++;
    }
    this.flush(this.SETTLE_CAP);
    return fired;
  }

  setRunning(b) { this.running = !!b; }

  /* ---------------- 序列化 ---------------- */

  serialize() {
    return {
      v: 1,
      time: Math.round(this.simTime),
      chips: Array.from(this.chips.values()).map(c => {
        const o = {
          id: c.id, type: c.type, x: Math.round(c.x), y: Math.round(c.y),
          rot: c.rot || 0, props: c.props, state: JSON.parse(JSON.stringify(c.state)),
        };
        if (c.bb) o.bb = c.bb;
        if (c.pcb) o.pcb = c.pcb;
        return o;
      }),
      wires: this.wires.map(w => ({ a: [w.a.chip.id, w.a.num], b: [w.b.chip.id, w.b.num] })),
    };
  }

  reset() {
    this.chips.clear();
    this.wires = [];
    this.nets = [];
    this.q.clear();
    this.simTime = 0;
    this.eventCount = 0;
    this.overload = false;
  }

  load(data) {
    this.reset();
    const list = (data && data.chips) || [];
    for (const c of list) {
      if (!this.lib[c.type]) continue;
      const ch = this.makeChip(c.type, c.x || 0, c.y || 0, c.rot || 0, c.props || {},
        c.state ? JSON.parse(JSON.stringify(c.state)) : {}, c.id);
      // 清除"首次驱动"标志: 让加载后的首次求值重新驱动输出(否则输出保持高阻)
      for (const k of Object.keys(ch.state)) if (/^ini/.test(k)) delete ch.state[k];
      ch.bb = c.bb || null;
      ch.pcb = c.pcb || null;
      this.chips.set(ch.id, ch);
      const d = this.lib[c.type];
      if (d.init) d.init(ch, this);
    }
    for (const w of (data && data.wires) || []) {
      const ca = this.chips.get(w.a[0]), cb = this.chips.get(w.b[0]);
      if (!ca || !cb) continue;
      if (!ca.pinByNum[w.a[1]] || !cb.pinByNum[w.b[1]]) continue;
      this.wires.push({ id: WIRE_SEQ++, a: { chip: ca, num: w.a[1] }, b: { chip: cb, num: w.b[1] } });
    }
    if (typeof data.time === 'number') this.simTime = data.time;
    this.rebuildNets();
    this.version++;
  }
}

const EngineModule = { Engine, Sim, resolveDrivers };
global.EngineModule = EngineModule;
if (typeof module !== 'undefined' && module.exports) module.exports = EngineModule;

})(typeof window !== 'undefined' ? window : globalThis);
