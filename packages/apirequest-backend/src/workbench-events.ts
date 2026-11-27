import { randomUUID } from 'node:crypto';
import type { Request, Response } from 'express';

type Event = {
  schemaVersion: 1;
  source: string;
  epoch: string;
  seq: number;
  topic: string;
  kind: 'invalidate' | 'resync';
  scopeId?: string;
};

// Single-process local workspace. Reconnect always resynchronizes authoritative data.
export class WorkbenchEventHub {
  private readonly epoch = randomUUID();
  private seq = 0;
  private readonly clients = new Map<Response, string>();

  private event(topic: string, kind: Event['kind'], scopeId?: string): Event {
    return {
      schemaVersion: 1,
      source: 'backend',
      epoch: this.epoch,
      seq: this.seq,
      topic,
      kind,
      ...(scopeId ? { scopeId } : {}),
    };
  }

  publish(owner: string, topic: string, scopeId?: string) {
    ++this.seq;
    const data = this.event(topic, 'invalidate', scopeId);
    for (const [response, uid] of this.clients) {
      if (uid === owner) this.send(response, data);
    }
  }

  private send(response: Response, event: Event) {
    if (response.destroyed || response.writableEnded) {
      this.clients.delete(response);
      return;
    }
    // A slow consumer reconnects and takes a snapshot instead of accumulating events.
    if (
      !response.write(
        `id: ${event.epoch}:${event.seq}\ndata: ${JSON.stringify(event)}\n\n`,
      )
    ) {
      this.clients.delete(response);
      response.end();
    }
  }

  stream(_request: Request, response: Response, owner: string, limit = 16) {
    if (
      [...this.clients.values()].filter((uid) => uid === owner).length >= limit
    ) {
      response.status(503).json({ error: 'too_many_streams', limit });
      return;
    }
    response.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-store, no-transform',
      'X-Accel-Buffering': 'no',
      'X-Content-Type-Options': 'nosniff',
    });
    response.flushHeaders();
    this.clients.set(response, owner);
    this.send(response, this.event('*', 'resync'));
    const heartbeat = setInterval(() => {
      if (!response.write(': heartbeat\n\n')) response.end();
    }, 15000);
    heartbeat.unref();
    // Reauthorize long-running connections, including expired/revoked owner sessions.
    const lease = setTimeout(() => response.end(), 5 * 60000);
    lease.unref();
    response.once('close', () => {
      clearInterval(heartbeat);
      clearTimeout(lease);
      this.clients.delete(response);
    });
  }
}

export const workbenchEvents = new WorkbenchEventHub();
