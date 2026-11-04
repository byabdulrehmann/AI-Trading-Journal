/**
 * Fixed-point decimal arithmetic on BigInt, so money never picks up binary float error
 * (0.1 + 0.2). Values enter from their shortest decimal form and leave rounded once.
 */
export type Dec = bigint;

const DIGITS = 14;
const SCALE = 10n ** BigInt(DIGITS);

export const ZERO: Dec = 0n;

export function dec(value: number | string): Dec {
  let s = String(value).trim();
  const exp = /^(-?)(\d+)(?:\.(\d+))?e([+-]\d+)$/i.exec(s);
  if (exp) {
    const [, sign, whole, frac = "", power] = exp;
    const digits = whole + frac;
    const point = whole.length + Number(power);
    s = sign + (point <= 0 ? `0.${"0".repeat(-point)}${digits}` : point >= digits.length ? `${digits}${"0".repeat(point - digits.length)}` : `${digits.slice(0, point)}.${digits.slice(point)}`);
  }
  const m = /^(-?)(\d*)(?:\.(\d*))?$/.exec(s);
  if (!m || (!m[2] && !m[3])) throw new Error(`Not a decimal number: ${value}`);
  const frac = (m[3] ?? "").padEnd(DIGITS + 1, "0");
  const raw = BigInt(`${m[2] || "0"}${frac.slice(0, DIGITS)}`) + (frac[DIGITS] >= "5" ? 1n : 0n);
  return m[1] ? -raw : raw;
}

export const add = (a: Dec, b: Dec): Dec => a + b;
export const sub = (a: Dec, b: Dec): Dec => a - b;
export const abs = (a: Dec): Dec => (a < 0n ? -a : a);
export const sum = (values: Dec[]): Dec => values.reduce((total, v) => total + v, ZERO);

function divRound(n: bigint, d: bigint): bigint {
  const negative = n < 0n !== d < 0n;
  const [an, ad] = [n < 0n ? -n : n, d < 0n ? -d : d];
  const q = (an + ad / 2n) / ad; // half away from zero
  return negative ? -q : q;
}

export const mul = (a: Dec, b: Dec): Dec => divRound(a * b, SCALE);

export function div(a: Dec, b: Dec): Dec {
  if (b === 0n) throw new Error("Division by zero");
  return divRound(a * SCALE, b);
}

/** Leaves the fixed-point world: rounds half away from zero to `dp` places. */
export function toNumber(a: Dec, dp = 2): number {
  const unit = 10n ** BigInt(DIGITS - dp);
  return Number(divRound(a, unit)) / 10 ** dp;
}
