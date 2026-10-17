import { Pool, type PoolClient } from 'pg';

export type Queryable = Pick<PoolClient, 'query'>;

export const createPool = (connectionString: string, max = 10) => new Pool({ connectionString, max });

export async function withTransaction<T>(pool: Pool, work: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}
