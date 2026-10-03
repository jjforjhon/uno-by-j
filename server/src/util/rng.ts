import type { Rng } from "../engine/types";

/** Deterministic RNG (mulberry32) — tests and replayable debugging. */
export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return {
    next(): number {
      a += 0x6d2b79f5;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    },
  };
}

/** Production RNG backed by the CSPRNG. */
export function cryptoRng(): Rng {
  return {
    next(): number {
      const buf = new Uint32Array(1);
      crypto.getRandomValues(buf);
      return buf[0]! / 4294967296;
    },
  };
}
