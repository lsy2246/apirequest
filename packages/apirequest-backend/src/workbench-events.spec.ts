import { EventEmitter } from 'node:events';
import { WorkbenchEventHub } from './workbench-events';

function response() {
  return Object.assign(new EventEmitter(), {
    writeHead: jest.fn(),
    flushHeaders: jest.fn(),
    write: jest.fn(() => true),
    end: jest.fn(),
    destroyed: false,
    writableEnded: false,
  });
}
describe('workbench events', () => {
  it('isolates owner streams, resynchronizes on connect and removes disconnected consumers', () => {
    const hub = new WorkbenchEventHub();
    const a = response(),
      b = response();
    hub.stream({} as any, a as any, 'a');
    hub.stream({} as any, b as any, 'b');
    expect(a.write.mock.calls[0][0]).toContain('"kind":"resync"');
    hub.publish('a', 'mock');
    expect(a.write).toHaveBeenCalledTimes(2);
    expect(b.write).toHaveBeenCalledTimes(1);
    a.emit('close');
    hub.publish('a', 'ai');
    expect(a.write).toHaveBeenCalledTimes(2);
    b.emit('close');
  });
  it('disconnects a slow consumer rather than accumulating an unbounded queue', () => {
    const hub = new WorkbenchEventHub(),
      a = response();
    hub.stream({} as any, a as any, 'a');
    a.write.mockReturnValue(false);
    hub.publish('a', 'mock');
    hub.publish('a', 'mock');
    expect(a.end).toHaveBeenCalledTimes(1);
    expect(a.write).toHaveBeenCalledTimes(2);
    a.emit('close');
  });
});
