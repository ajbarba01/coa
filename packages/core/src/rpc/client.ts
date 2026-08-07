import { connect } from 'node:net';
import type { RpcNotification, RpcParams, RpcResponse } from '@coa/shared';
import { encodeLine, FrameDecoder } from './codec.js';

/**
 * The daemon RPC client: connect to the OS pipe/socket the daemon serves and
 * issue JSON-RPC requests/notifications. It frames outgoing messages, auto-numbers
 * request ids, and matches each response back to its pending promise by id, so
 * concurrent in-flight requests resolve correctly. Server→client notifications
 * (the daemon's push-notification stream) are delivered to the optional `onNotification` callback.
 * This is the connection the console and any other client opens.
 *
 * `request` resolves with the JSON-RPC response (success OR a coded error — a
 * server-side error is data, not a thrown exception); a transport failure rejects
 * the pending requests so callers never hang.
 */

export interface RpcClient {
  /** Send a request and resolve its response (success or error envelope). */
  request: (method: string, params?: RpcParams) => Promise<RpcResponse>;
  /** Fire a notification (no id, no response). */
  notify: (method: string, params?: RpcParams) => void;
  /** Close the connection, rejecting any in-flight requests. */
  close: () => Promise<void>;
}

export function connectClient(
  path: string,
  onNotification?: (note: RpcNotification) => void,
  /** Fired once the connection drops (daemon exit/crash), after any in-flight requests fail. */
  onClose?: () => void,
): Promise<RpcClient> {
  return new Promise((resolve, reject) => {
    const socket = connect(path);
    socket.setEncoding('utf8');
    const decoder = new FrameDecoder();
    const pending = new Map<number, (response: RpcResponse) => void>();
    let nextId = 1;

    socket.on('data', (chunk: string) => {
      for (const line of decoder.push(chunk)) {
        const message = JSON.parse(line) as RpcResponse | RpcNotification;
        if ('id' in message && typeof message.id === 'number') {
          pending.get(message.id)?.(message);
          pending.delete(message.id);
        } else if (!('id' in message)) {
          onNotification?.(message);
        }
      }
    });

    const fail = (err: Error): void => {
      for (const settle of pending.values()) {
        settle({ jsonrpc: '2.0', id: 0, error: { code: -32000, message: err.message } });
      }
      pending.clear();
    };
    socket.on('error', (err) => {
      reject(err);
      fail(err);
    });
    socket.on('close', () => onClose?.());

    socket.on('connect', () =>
      resolve({
        request: (method, params) =>
          new Promise((res) => {
            const id = nextId++;
            pending.set(id, res);
            socket.write(
              encodeLine({
                jsonrpc: '2.0',
                id,
                method,
                ...(params !== undefined ? { params } : {}),
              }),
            );
          }),
        notify: (method, params) => {
          socket.write(
            encodeLine({ jsonrpc: '2.0', method, ...(params !== undefined ? { params } : {}) }),
          );
        },
        close: () =>
          new Promise<void>((res) => {
            socket.end(() => res());
          }),
      }),
    );
  });
}
