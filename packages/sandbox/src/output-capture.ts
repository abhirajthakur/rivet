export class BoundedOutputCapture {
  private readonly stdoutChunks: Buffer[] = [];
  private readonly stderrChunks: Buffer[] = [];
  private capturedBytes = 0;
  private totalBytes = 0;
  private isTruncated = false;

  constructor(private readonly maxBytes: number) {}

  append(stream: 'stdout' | 'stderr', chunk: Buffer): void {
    this.totalBytes += chunk.byteLength;
    const remaining = Math.max(0, this.maxBytes - this.capturedBytes);
    const captured = chunk.subarray(0, remaining);
    if (captured.byteLength > 0) {
      (stream === 'stdout' ? this.stdoutChunks : this.stderrChunks).push(captured);
      this.capturedBytes += captured.byteLength;
    }
    if (captured.byteLength < chunk.byteLength) this.isTruncated = true;
  }

  get stdout(): string {
    return Buffer.concat(this.stdoutChunks).toString('utf8');
  }

  get stderr(): string {
    return Buffer.concat(this.stderrChunks).toString('utf8');
  }

  get truncated(): boolean {
    return this.isTruncated || this.totalBytes > this.capturedBytes;
  }
}
