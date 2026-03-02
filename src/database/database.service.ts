import { Injectable, OnModuleDestroy } from "@nestjs/common";
import { Pool, QueryResult, QueryResultRow } from "pg";

@Injectable()
export class DatabaseService implements OnModuleDestroy {
  private pool: Pool;

  constructor() {
    this.pool = new Pool({
      host: process.env.PG_HOST ?? "localhost",
      port: parseInt(process.env.PG_PORT ?? "5432", 10),
      user: process.env.PG_USER ?? process.env.USER ?? "jaydip",
      password: process.env.PG_PASSWORD ?? "postgre",
      database: process.env.PG_DATABASE ?? "test",
    });
  }

  async query<T extends QueryResultRow = QueryResultRow>(
    text: string,
    params?: unknown[],
  ): Promise<QueryResult<T>> {
    return this.pool.query<T>(text, params);
  }

  async onModuleDestroy(): Promise<void> {
    await this.pool.end();
  }
}
