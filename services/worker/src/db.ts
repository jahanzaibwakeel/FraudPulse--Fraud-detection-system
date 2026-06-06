import pg from "pg";
import { config } from "./config.js";

export const pool = new pg.Pool({
  connectionString: config.databaseUrl,
  max: 8
});

export const query = <T extends pg.QueryResultRow = pg.QueryResultRow>(text: string, params: unknown[] = []) =>
  pool.query<T>(text, params);
