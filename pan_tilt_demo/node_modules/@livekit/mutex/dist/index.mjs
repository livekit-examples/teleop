var e = Object.defineProperty;
var h = (i, s, t) => s in i ? e(i, s, { enumerable: !0, configurable: !0, writable: !0, value: t }) : i[s] = t;
var o = (i, s, t) => h(i, typeof s != "symbol" ? s + "" : s, t);
class _ {
  constructor() {
    o(this, "_locking");
    o(this, "_locks");
    this._locking = Promise.resolve(), this._locks = 0;
  }
  isLocked() {
    return this._locks > 0;
  }
  lock() {
    this._locks += 1;
    let s;
    const t = new Promise(
      (l) => s = () => {
        this._locks -= 1, l();
      }
    ), c = this._locking.then(() => s);
    return this._locking = this._locking.then(() => t), c;
  }
}
class n {
  constructor(s) {
    o(this, "_queue");
    o(this, "_limit");
    o(this, "_locks");
    this._queue = [], this._limit = s, this._locks = 0;
  }
  isLocked() {
    return this._locks >= this._limit;
  }
  async lock() {
    return this.isLocked() ? new Promise((s) => {
      this._queue.push(() => {
        this._locks++, s(this._unlock.bind(this));
      });
    }) : (this._locks++, this._unlock.bind(this));
  }
  _unlock() {
    if (this._locks--, this._queue.length && !this.isLocked()) {
      const s = this._queue.shift();
      s == null || s();
    }
  }
}
export {
  n as MultiMutex,
  _ as Mutex
};
//# sourceMappingURL=index.mjs.map
