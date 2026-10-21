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
  sent: string[] = [];
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;

  constructor(readonly url: string) {
    FakeWebSocket.instances.push(this);
  }

  send(data: string) {
    this.sent.push(data);
  }

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

  message(value: Record<string, unknown>) {
    this.onmessage?.({ data: JSON.stringify(value) });
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

test("revoked credentials are cleared and pairing retries with a new room", async () => {
  globals.window = { location: { href: "https://chat.jyj.cx/settings" } };
  globals.WebSocket = FakeWebSocket;
  FakeWebSocket.instances = [];

  const client = new DeviceTransferClient() as unknown as {
    socket: FakeWebSocket | null;
    token: string | null;
    status: { configured: boolean; paired: boolean };
    connect(authenticate: boolean): Promise<void>;
    createPairing(): Promise<{ pairCode: string; expiresIn: number }>;
  };
  client.token = "revoked-token";
  client.status.configured = true;

  const authentication = client.connect(true);
  const staleSocket = FakeWebSocket.instances[0];
  staleSocket.open();
  staleSocket.message({
    type: "error",
    message: "设备配对已解除，请重新配对",
  });
  await assert.rejects(authentication, /设备配对已解除/);
  assert.equal(client.token, null);
  assert.equal(client.status.configured, false);
  assert.equal(client.socket, null);

  const pairing = client.createPairing();
  await new Promise<void>((resolve) => setImmediate(resolve));
  const freshSocket = FakeWebSocket.instances[1];
  freshSocket.open();
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(JSON.parse(freshSocket.sent[0]).type, "room.create");

  freshSocket.message({
    type: "room.created",
    token: "fresh-token",
    pairCode: "ABCDEFGH2345",
    expiresIn: 300,
  });
  assert.deepEqual(await pairing, {
    pairCode: "ABCDEFGH2345",
    expiresIn: 300,
  });
});
