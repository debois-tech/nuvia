import { Injectable } from '@nestjs/common';
import { randomInt } from 'node:crypto';

/** Unpredictable by design: challenge timing must not be guessable by a script. Replaceable in tests. */
@Injectable()
export class RandomSource {
  /** True with the given probability (0..1). */
  chance(p: number): boolean {
    if (p <= 0) return false;
    if (p >= 1) return true;
    return randomInt(0, 1_000_000) < p * 1_000_000;
  }
  code(): string {
    return String(randomInt(1000, 10000));
  }
}
