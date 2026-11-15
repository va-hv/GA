import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { Pool } from 'pg';

export type Sql = <R = Record<string, unknown>>(text: string, params?: unknown[]) => Promise<R[]>;

/**
 * The only way the API talks to the database. Each call is one transaction that starts by handing the caller's
 * session token to the database (`gatehouse.token`). The database works out who that is and what they may see and
 * do; the API never names an organisation itself.
 */
@Injectable()
export class Db implements OnModuleDestroy {
  private readonly pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 15, idleTimeoutMillis: 30_000 });

  async as<T>(token: string | null, work: (sql: Sql) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`SELECT set_config('gatehouse.token', $1, true)`, [token ?? '']);
      const sql: Sql = async (text, params) => (await client.query(text, params as unknown[])).rows;
      const result = await work(sql);
      await client.query('COMMIT');
      return result;
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
  }

  async ping(): Promise<boolean> {
    const r = await this.pool.query('SELECT 1 AS ok');
    return r.rows[0]?.ok === 1;
  }

  onModuleDestroy() {
    return this.pool.end();
  }
}
