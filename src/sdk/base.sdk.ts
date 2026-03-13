import type { Server } from "socket.io";

/**
 * BaseSDK
 *
 * Foundation for all SDK classes.
 * Ensures consistent handling of clientCode and optional Socket.io instance.
 */
export abstract class BaseSDK {
  constructor(
    protected readonly clientCode: string,
    protected readonly io?: Server,
  ) {}

  /**
   * Helper to emit socket events if IO is available.
   */
  protected emit(event: string, data: any, room?: string): void {
    const target = room ? this.io?.to(room) : this.io;
    target?.emit(event, data);
  }
}
