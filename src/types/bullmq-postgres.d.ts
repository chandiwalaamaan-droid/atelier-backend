declare module "bullmq/postgres" {
  export function createPostgresBackend(...args: any[]): any;
  export class PostgresConnection extends require("events").EventEmitter {
    constructor(connection: any);
    waitUntilReady(): Promise<void>;
    close(): Promise<void>;
  }
  export type PostgresConnectionOptions = any;
}
