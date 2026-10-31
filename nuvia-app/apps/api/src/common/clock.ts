import { Injectable } from '@nestjs/common';

/** All time-dependent logic reads time through this so tests can control it. */
@Injectable()
export class Clock {
  now(): Date {
    return new Date();
  }
}
