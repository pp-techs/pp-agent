/** Frames are one JSON value per line (newline-delimited JSON). */

/** Largest frame accepted; a line longer than this closes the connection. */
export const MAX_FRAME_BYTES = 64 * 1024 * 1024;

const NEWLINE = 0x0a;

/** A line that is too long or is not JSON. The connection cannot be trusted afterwards. */
export class FrameError extends Error {
  override readonly name = "FrameError";
}

/** `JSON.stringify` never emits a raw newline, so the trailing one is an unambiguous delimiter. */
export function encodeFrame(frame: unknown): string {
  return `${JSON.stringify(frame)}\n`;
}

/**
 * Turns the chunks of a stream into frames. A frame may be split across chunks and a chunk may
 * hold many frames. Lines are split on the raw byte, so multi-byte characters are never cut.
 */
export class FrameDecoder {
  /** Bytes of the line being received. */
  private partial: Buffer[] = [];
  private partialBytes = 0;

  constructor(private readonly maxBytes: number = MAX_FRAME_BYTES) {}

  /** Returns every frame the chunk completes; throws `FrameError` and discards state when invalid. */
  push(chunk: Buffer | string): unknown[] {
    const data = typeof chunk === "string" ? Buffer.from(chunk) : chunk;
    const frames: unknown[] = [];
    let start = 0;
    for (;;) {
      const end = data.indexOf(NEWLINE, start);
      if (end === -1) break;
      const value = this.parse(this.take(data.subarray(start, end)));
      if (value !== undefined) frames.push(value);
      start = end + 1;
    }
    if (start < data.length) {
      const rest = data.subarray(start);
      if (this.partialBytes + rest.length > this.maxBytes) {
        this.reset();
        throw new FrameError(`Frame larger than ${this.maxBytes} bytes.`);
      }
      this.partial.push(rest);
      this.partialBytes += rest.length;
    }
    return frames;
  }

  private take(tail: Buffer): Buffer {
    if (this.partialBytes + tail.length > this.maxBytes) {
      this.reset();
      throw new FrameError(`Frame larger than ${this.maxBytes} bytes.`);
    }
    if (this.partialBytes === 0) return tail;
    const line = Buffer.concat([...this.partial, tail], this.partialBytes + tail.length);
    this.reset();
    return line;
  }

  private parse(line: Buffer): unknown {
    // Blank lines carry no frame.
    if (line.length === 0 || (line.length === 1 && line[0] === 0x0d)) return undefined;
    try {
      return JSON.parse(line.toString("utf8"));
    } catch {
      throw new FrameError("A frame is not valid JSON.");
    }
  }

  private reset(): void {
    this.partial = [];
    this.partialBytes = 0;
  }
}
