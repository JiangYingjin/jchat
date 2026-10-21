import assert from "node:assert/strict";
import { after, test } from "node:test";
import { DeviceTransferClient } from "./device-transfer";

class FakeWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;
  static instances: FakeWebSocket[] = [];

  readyState = FakeWebSocket.CONNECTING;
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;

  constructor(readonly url: string) {
    FakeWebSocket.instances.push(this);
  }

  send(_data: string) {}

  close() {
    this.readyState = FakeWebSocket.CLOSING;
  }

  open() {
    this.readyState = FakeWebSocket.OPEN;
    this.onopen?.();
  }

  finishClose() {
    this.readyState = FakeWebSocket.CLOSED;
    this.onclose?.();
  }
}

const globals = globalThis as unknown as Record<string, unknown>;
const previousWindow = globals.window;
const previousWebSocket = globals.WebSocket;

after(() => {
  if (previousWindow) globals.window = previousWindow;
  else delete globals.window;
  if (previousWebSocket) globals.WebSocket = previousWebSocket;
  else delete globals.WebSocket;
});

test("late close from revoked socket does not disconnect the replacement socket", async () => {
  globals.window = { location: { href: "https://chat.jyj.cx/settings" } };
  globals.WebSocket = FakeWebSocket;
  FakeWebSocket.instances = [];

  const client = new DeviceTransferClient() as unknown as {
    socket: FakeWebSocket | null;
    connect(authenticate: boolean): Promise<void>;
    waitFor(
      type: string,
      predicate: (event: { type: string }) => boolean,
      timeoutMs: number,
    ): Promise<{ type: string }>;
    emit(event: { type: string }): void;
  };

  const firstConnection = client.connect(false);
  const revokedSocket = FakeWebSocket.instances[0];
  revokedSocket.open();
  await firstConnection;

  revokedSocket.close();
  const replacementConnection = client.connect(false);
  const replacementSocket = FakeWebSocket.instances[1];
  const pendingResponse = client.waitFor("room.created", () => true, 1000);

  revokedSocket.finishClose();
  assert.equal(client.socket, replacementSocket);

  replacementSocket.open();
  await replacementConnection;
  client.emit({ type: "room.created" });
  assert.equal((await pendingResponse).type, "room.created");
});
