import type { Server } from "socket.io";

/**
 * @file base.sdk.ts
 * @module BaseSDK
 * @responsibility Foundational class for all CRM SDK modules, providing shared tenant context and real-time event dispatching.
 */
export abstract class BaseSDK {
  constructor(
    protected readonly clientCode: string,
    protected readonly io?: Server,
  ) {}

  /**
   * Internal helper to broadcast real-time updates to connected clients.
   *
   * **WORKING PROCESS:**
   * 1. Checks if a valid `Socket.io` instance was passed during initialization.
   * 2. If a `room` is specified, targets that specific Socket room (e.g., 'tenant:ECOD').
   * 3. Emits the event with the provided payload.
   *
   * @param {string} event - Unique event identifier (e.g., 'lead:updated').
   * @param {any} data - Event payload.
   * @param {string} [room] - Optional target room.
   * @protected
   */
  protected emit(event: string, data: any, room?: string): void {
    const target = room ? this.io?.to(room) : this.io;
    target?.emit(event, data);
  }
}
