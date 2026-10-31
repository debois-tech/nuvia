import { BadRequestException, PayloadTooLargeException, UnsupportedMediaTypeException } from '@nestjs/common';
import type { Request } from 'express';

/**
 * Reads a raw request body (a file sent as application/octet-stream) into memory, at most `max` bytes.
 * Used for small files that have to be parsed whole. Big files should be streamed to disk instead.
 */
export async function readRawBody(req: Request, max: number): Promise<Buffer> {
  if (!/^application\/octet-stream\b/i.test(req.headers['content-type'] ?? '')) {
    req.resume();
    throw new UnsupportedMediaTypeException('Send the file as application/octet-stream');
  }
  const mb = Math.max(1, Math.round(max / 1024 / 1024));
  const declared = req.headers['content-length'];
  if (declared !== undefined && Number(declared) > max) {
    req.resume();
    throw new PayloadTooLargeException(`Files can be at most ${mb} MB`);
  }
  const chunks: Buffer[] = [];
  let size = 0;
  try {
    for await (const chunk of req) {
      size += (chunk as Buffer).length;
      if (size > max) throw new PayloadTooLargeException(`Files can be at most ${mb} MB`);
      chunks.push(chunk as Buffer);
    }
  } catch (err) {
    if (err instanceof PayloadTooLargeException) throw err;
    throw new BadRequestException('The upload was interrupted');
  }
  if (size === 0) throw new BadRequestException('The file is empty');
  return Buffer.concat(chunks);
}
