/**
 * O PDF.js usa recursos muito novos do JavaScript. Em navegadores um pouco mais antigos eles não existem e a
 * comparação de original × Word falhava com "Falha inesperada". Aqui entram versões equivalentes, só quando faltam,
 * na página e no worker do PDF.
 */
type Upsert<K, V> = {
  get(key: K): V | undefined;
  has(key: K): boolean;
  set(key: K, value: V): unknown;
};

function addUpsert(proto: object) {
  const target = proto as Record<string, unknown>;
  if (typeof target.getOrInsert !== 'function') {
    Object.defineProperty(proto, 'getOrInsert', {
      configurable: true,
      writable: true,
      value: function <K, V>(this: Upsert<K, V>, key: K, value: V) {
        if (!this.has(key)) this.set(key, value);
        return this.get(key) as V;
      },
    });
  }
  if (typeof target.getOrInsertComputed !== 'function') {
    Object.defineProperty(proto, 'getOrInsertComputed', {
      configurable: true,
      writable: true,
      value: function <K, V>(this: Upsert<K, V>, key: K, compute: (key: K) => V) {
        if (!this.has(key)) this.set(key, compute(key));
        return this.get(key) as V;
      },
    });
  }
}

addUpsert(Map.prototype);
addUpsert(WeakMap.prototype);

const PromiseStatic = Promise as unknown as Record<string, unknown>;
if (typeof PromiseStatic.withResolvers !== 'function') {
  PromiseStatic.withResolvers = function <T>() {
    let resolve!: (value: T | PromiseLike<T>) => void;
    let reject!: (reason?: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return { promise, resolve, reject };
  };
}
if (typeof PromiseStatic.try !== 'function') {
  PromiseStatic.try = function <T>(fn: (...args: unknown[]) => T, ...args: unknown[]) {
    return new Promise<T>((resolve) => resolve(fn(...args)));
  };
}

const MathStatic = Math as unknown as Record<string, unknown>;
if (typeof MathStatic.sumPrecise !== 'function') {
  // Soma compensada (Kahan–Neumaier): suficiente para as medidas de página do PDF.
  MathStatic.sumPrecise = function (values: Iterable<number>) {
    let sum = 0;
    let compensation = 0;
    for (const value of values) {
      const next = sum + value;
      compensation += Math.abs(sum) >= Math.abs(value) ? sum - next + value : value - next + sum;
      sum = next;
    }
    return sum + compensation;
  };
}

const Uint8Static = Uint8Array as unknown as Record<string, unknown>;
if (typeof Uint8Static.fromBase64 !== 'function') {
  Uint8Static.fromBase64 = function (text: string) {
    const binary = atob(text);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  };
}
const Uint8Proto = Uint8Array.prototype as unknown as Record<string, unknown>;
if (typeof Uint8Proto.toHex !== 'function') {
  Object.defineProperty(Uint8Array.prototype, 'toHex', {
    configurable: true,
    writable: true,
    value: function (this: Uint8Array) {
      let out = '';
      for (const byte of this) out += byte.toString(16).padStart(2, '0');
      return out;
    },
  });
}

export {};
