import { once } from 'node:events';
import WebSocket from 'ws';

export type WsMessage = {
  v: number;
  type: string;
  requestId?: string;
  ts?: number;
  payload: Record<string, any>;
};

export class TestClient {
  readonly ws: WebSocket;
  readonly messages: WsMessage[] = [];
  private waiters: Array<() => boolean> = [];

  constructor(url: string) {
    this.ws = new WebSocket(url);
    this.ws.on('error', () => {});
    this.ws.on('message', (data) => {
      this.messages.push(JSON.parse(data.toString()) as WsMessage);
      this.waiters = this.waiters.filter((waiter) => !waiter());
    });
  }

  async ready(): Promise<void> {
    if (this.ws.readyState === this.ws.OPEN) return;
    await once(this.ws, 'open');
  }

  send(type: string, payload: unknown = {}, requestId?: string): void {
    this.ws.send(JSON.stringify({ v: 1, type, payload, ...(requestId ? { requestId } : {}) }));
  }

  waitFor(predicate: (message: WsMessage) => boolean, timeout = 3000): Promise<WsMessage> {
    const start = this.messages.length;
    const find = () => {
      for (let i = start; i < this.messages.length; i += 1) {
        const message = this.messages[i];
        if (message && predicate(message)) return message;
      }
      return undefined;
    };
    const existing = find();
    if (existing) return Promise.resolve(existing);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waiters = this.waiters.filter((waiter) => waiter !== onMessage);
        reject(new Error(`Timed out waiting for websocket message. Seen: ${this.messages.map((message) => message.type).join(', ')}`));
      }, timeout);
      const onMessage = () => {
        const message = find();
        if (!message) return false;
        clearTimeout(timer);
        resolve(message);
        return true;
      };
      this.waiters.push(onMessage);
    });
  }

  close(): void {
    if (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING) {
      this.ws.close();
    }
  }

  async closed(): Promise<number> {
    if (this.ws.readyState === WebSocket.CLOSED) return 1000;
    const [code] = (await once(this.ws, 'close')) as [number];
    return code;
  }
}
