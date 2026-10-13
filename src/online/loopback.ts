import type { Channel, Link } from './link';

/**
 * Two ends of a link in the same page, for tests: each message arrives at the other end
 * as a structured clone (as over the network: nothing shared), when `flush` is called.
 * Closing one end reaches the other after anything already sent, as on a real link.
 */
export function loopback(): { a: Link; b: Link; flush: () => number } {
  type Item = { to: LoopLink; message: unknown } | { to: LoopLink; close: true };
  const queue: Item[] = [];
  const a: LoopLink = new LoopLink((item) => queue.push({ ...item, to: b }));
  const b: LoopLink = new LoopLink((item) => queue.push({ ...item, to: a }));
  const flush = () => {
    let n = 0;
    while (queue.length > 0) {
      const item = queue.shift()!;
      if ('close' in item) item.to.remoteClosed();
      else if (!item.to.closed) item.to.onMessage(item.message);
      n++;
    }
    return n;
  };
  return { a, b, flush };
}

class LoopLink implements Link {
  onMessage: (message: unknown) => void = () => {};
  onClose: (reason: string) => void = () => {};
  closed = false;

  constructor(private readonly post: (item: { message: unknown } | { close: true }) => void) {}

  send(message: object, _channel?: Channel): void {
    if (!this.closed) this.post({ message: structuredClone(message) });
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.post({ close: true });
  }

  /** The other end hung up. */
  remoteClosed(): void {
    if (this.closed) return;
    this.closed = true;
    this.onClose('Your opponent left the game.');
  }
}
