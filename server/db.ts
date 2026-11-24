import 'dotenv/config';
import dotenv from 'dotenv';
import { AsyncLocalStorage } from 'async_hooks';
import pg from 'pg';
import bcrypt from 'bcryptjs';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import type Database from 'better-sqlite3';

// Ensure PostgreSQL BIGINT (OID 20, e.g. COUNT/SUM) and NUMERIC (OID 1700) parse as JS numbers
pg.types.setTypeParser(20, (val: string) => Number(val));
pg.types.setTypeParser(1700, (val: string) => parseFloat(val));

function parseValidPostgresUrl(raw?: string | null): string {
  const trimmed = String(raw || '').trim();
  if (!trimmed || !/^postgres(ql)?:\/\//i.test(trimmed)) return '';
  if (/[<>[\]]/.test(trimmed)) return '';
  try {
    const parsed = new URL(trimmed);
    const host = (parsed.hostname || '').toLowerCase();
    if (!host || host === 'base' || host === 'host') return '';
    if (host !== 'localhost' && host !== '127.0.0.1' && host !== '::1' && !host.includes('.')) {
      return '';
    }
    return trimmed;
  } catch {
    return '';
  }
}

function readDotenvPostgresUrl(): string {
  try {
    const envPath = path.resolve(process.cwd(), '.env');
    if (!fs.existsSync(envPath)) return '';
    const parsed = dotenv.parse(fs.readFileSync(envPath, 'utf8'));
    return parseValidPostgresUrl(parsed.DATABASE_URL);
  } catch {
    return '';
  }
}

let activePostgresUrl = parseValidPostgresUrl(process.env.DATABASE_URL) || readDotenvPostgresUrl();
export let isPostgres = Boolean(activePostgresUrl);

export interface PreparedStatement {
  get: (...params: any[]) => Promise<any>;
  all: (...params: any[]) => Promise<any[]>;
  run: (...params: any[]) => Promise<{ changes: number }>;
}

export interface AsyncDbClient {
  prepare: (sql: string) => PreparedStatement;
  exec: (sql: string) => Promise<void>;
  transaction: <T>(fn: () => Promise<T>) => () => Promise<T>;
  close: () => Promise<void>;
}

function translateSqlForPg(rawSql: string): string {
  let out = '';
  let paramIndex = 1;
  let inSingle = false;
  let inDouble = false;
  let inLineComment = false;
  let inBlockComment = false;

  for (let i = 0; i < rawSql.length; i++) {
    const ch = rawSql[i];
    const next = rawSql[i + 1];

    if (inLineComment) {
      out += ch;
      if (ch === '\n') inLineComment = false;
      continue;
    }
    if (inBlockComment) {
      out += ch;
      if (ch === '*' && next === '/') {
        out += next;
        i++;
        inBlockComment = false;
      }
      continue;
    }
    if (inSingle) {
      out += ch;
      if (ch === "'" && next === "'") {
        out += next;
        i++;
      } else if (ch === "'") {
        inSingle = false;
      }
      continue;
    }
    if (inDouble) {
      out += ch;
      if (ch === '"' && next === '"') {
        out += next;
        i++;
      } else if (ch === '"') {
        inDouble = false;
      }
      continue;
    }

    if (ch === '-' && next === '-') {
      inLineComment = true;
      out += ch;
      continue;
    }
    if (ch === '/' && next === '*') {
      inBlockComment = true;
      out += ch;
      continue;
    }
    if (ch === "'") {
      inSingle = true;
      out += ch;
      continue;
    }
    if (ch === '"') {
      inDouble = true;
      out += ch;
      continue;
    }

    if (ch === '?') {
      out += `$${paramIndex++}`;
    } else {
      out += ch;
    }
  }

  if (/^\s*INSERT\s+OR\s+IGNORE\s+INTO\b/i.test(out)) {
    const trimmed = out.trimEnd();
    const hasSemi = trimmed.endsWith(';');
    const core = (hasSemi ? trimmed.slice(0, -1) : trimmed).replace(
      /^\s*INSERT\s+OR\s+IGNORE\s+INTO\b/i,
      'INSERT INTO'
    );
    out = `${core} ON CONFLICT DO NOTHING${hasSemi ? ';' : ''}`;
  }

  return out;
}

function createPostgresDb(connectionUrl: string): AsyncDbClient {
  const isLocal = /localhost|127\.0\.0\.1/.test(connectionUrl);
  let normalizedUrl = connectionUrl;
  if (!isLocal) {
    try {
      const parsed = new URL(connectionUrl);
      parsed.searchParams.delete('sslmode');
      normalizedUrl = parsed.toString();
    } catch {
      // keep raw string
    }
  }
  const pool = new pg.Pool({
    connectionString: normalizedUrl,
    ssl: isLocal ? false : { rejectUnauthorized: false },
    max: 15,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
  });

  pool.on('error', (err) => {
    console.warn('[db] Postgres idle pool error:', err?.message || err);
  });

  const txStorage = new AsyncLocalStorage<{ client: pg.PoolClient; savepointDepth: number }>();

  const queryActive = async (sql: string, params: any[] = []) => {
    const pgSql = translateSqlForPg(sql);
    const ctx = txStorage.getStore();
    if (ctx) {
      return ctx.client.query(pgSql, params);
    }
    return pool.query(pgSql, params);
  };

  return {
    prepare(sql: string): PreparedStatement {
      return {
        async get(...params: any[]) {
          const res = await queryActive(sql, params);
          return res.rows[0];
        },
        async all(...params: any[]) {
          const res = await queryActive(sql, params);
          return res.rows;
        },
        async run(...params: any[]) {
          const res = await queryActive(sql, params);
          return { changes: res.rowCount ?? 0 };
        },
      };
    },
    async exec(sql: string): Promise<void> {
      const ctx = txStorage.getStore();
      if (ctx) {
        await ctx.client.query(sql);
      } else {
        await pool.query(sql);
      }
    },
    transaction<T>(fn: () => Promise<T>): () => Promise<T> {
      return async () => {
        const existing = txStorage.getStore();
        if (existing) {
          const nextDepth = existing.savepointDepth + 1;
          const spName = `sp_${nextDepth}`;
          await existing.client.query(`SAVEPOINT ${spName}`);
          try {
            const res = await txStorage.run({ client: existing.client, savepointDepth: nextDepth }, fn);
            await existing.client.query(`RELEASE SAVEPOINT ${spName}`);
            return res;
          } catch (err) {
            await existing.client.query(`ROLLBACK TO SAVEPOINT ${spName}`);
            throw err;
          }
        }

        const client = await pool.connect();
        try {
          await client.query('BEGIN');
          const res = await txStorage.run({ client, savepointDepth: 0 }, fn);
          await client.query('COMMIT');
          return res;
        } catch (err) {
          try {
            await client.query('ROLLBACK');
          } catch {
            // ignore rollback errors on broken connection
          }
          throw err;
        } finally {
          client.release();
        }
      };
    },
    async close(): Promise<void> {
      await pool.end();
    },
  };
}

let sqliteModulePromise: Promise<any> | null = null;
async function getSqliteConstructor(): Promise<any> {
  if (!sqliteModulePromise) {
    sqliteModulePromise = import('better-sqlite3');
  }
  const mod = await sqliteModulePromise;
  return mod.default || mod;
}

function createSqliteFallbackDb(): AsyncDbClient {
  const DATA_DIR = path.resolve(process.cwd(), 'data');
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  const DB_PATH = path.join(DATA_DIR, 'nepefy.db');

  let instance: Database.Database | null = null;
  let initPromise: Promise<Database.Database> | null = null;
  let txDepth = 0;
  let txQueue: Promise<void> = Promise.resolve();

  const removeWalFiles = () => {
    for (const suffix of ['-wal', '-shm', '-journal']) {
      const target = `${DB_PATH}${suffix}`;
      if (fs.existsSync(target)) fs.unlinkSync(target);
    }
  };

  const removeDatabaseFiles = () => {
    for (const suffix of ['', '-wal', '-shm', '-journal']) {
      const target = `${DB_PATH}${suffix}`;
      if (fs.existsSync(target)) fs.unlinkSync(target);
    }
  };

  const isCorruptionError = (err: any): boolean => {
    const code = String(err?.code || '');
    const msg = String(err?.message || '').toLowerCase();
    return (
      code === 'SQLITE_NOTADB' ||
      code === 'SQLITE_CORRUPT' ||
      msg.includes('file is not a database') ||
      msg.includes('malformed') ||
      msg.includes('corrupt') ||
      msg.includes('orphan index') ||
      msg.includes('quick_check failed')
    );
  };

  const getInstance = async (): Promise<Database.Database> => {
    if (instance) return instance;
    if (!initPromise) {
      initPromise = (async () => {
        const SqliteCtor = await getSqliteConstructor();
        const tryOpen = () => {
          const handle = new SqliteCtor(DB_PATH);
          try {
            handle.pragma('busy_timeout = 5000');
            try {
              handle.pragma('wal_checkpoint(TRUNCATE)');
            } catch {
              // ignore
            }
            handle.pragma('journal_mode = TRUNCATE');
            handle.pragma('synchronous = FULL');
            handle.pragma('foreign_keys = ON');
            handle.prepare('SELECT 1').get();
            const integrity = handle.pragma('quick_check', { simple: true });
            if (integrity !== 'ok') {
              throw new Error('SQLite quick_check failed');
            }
            return handle;
          } catch (innerErr) {
            try {
              handle.close();
            } catch {
              // ignore
            }
            throw innerErr;
          }
        };

        try {
          instance = tryOpen();
        } catch (err: any) {
          if (!isCorruptionError(err)) throw err;
          try {
            removeWalFiles();
            instance = tryOpen();
          } catch {
            removeDatabaseFiles();
            instance = tryOpen();
          }
        }
        if (!instance) {
          throw new Error('Failed to initialize SQLite database');
        }
        return instance;
      })();
    }
    return initPromise;
  };

  const sqliteStorage = new AsyncLocalStorage<boolean>();

  return {
    prepare(sql: string): PreparedStatement {
      return {
        async get(...params: any[]) {
          const handle = await getInstance();
          return handle.prepare(sql).get(...params);
        },
        async all(...params: any[]) {
          const handle = await getInstance();
          return handle.prepare(sql).all(...params);
        },
        async run(...params: any[]) {
          const handle = await getInstance();
          const info = handle.prepare(sql).run(...params);
          return { changes: info.changes };
        },
      };
    },
    async exec(sql: string): Promise<void> {
      const handle = await getInstance();
      handle.exec(sql);
    },
    transaction<T>(fn: () => Promise<T>): () => Promise<T> {
      return async () => {
        const handle = await getInstance();
        if (sqliteStorage.getStore()) {
          const spName = `sp_${++txDepth}`;
          handle.exec(`SAVEPOINT ${spName}`);
          try {
            const res = await sqliteStorage.run(true, fn);
            handle.exec(`RELEASE SAVEPOINT ${spName}`);
            return res;
          } catch (err) {
            handle.exec(`ROLLBACK TO SAVEPOINT ${spName}`);
            throw err;
          }
        }

        const runSerialized = txQueue.then(async () => {
          handle.exec('BEGIN IMMEDIATE');
          try {
            const res = await sqliteStorage.run(true, fn);
            handle.exec('COMMIT');
            return res;
          } catch (err) {
            try {
              handle.exec('ROLLBACK');
            } catch {
              // ignore
            }
            throw err;
          }
        });

        txQueue = runSerialized.then(
          () => undefined,
          () => undefined
        );
        return runSerialized;
      };
    },
    async close(): Promise<void> {
      if (instance) {
        try {
          instance.pragma('wal_checkpoint(TRUNCATE)');
          instance.close();
        } catch {
          // ignore
        }
        instance = null;
      }
    },
  };
}

let activeDb: AsyncDbClient = isPostgres
  ? createPostgresDb(activePostgresUrl)
  : createSqliteFallbackDb();

export const db: AsyncDbClient = {
  prepare(sql: string): PreparedStatement {
    return activeDb.prepare(sql);
  },
  exec(sql: string): Promise<void> {
    return activeDb.exec(sql);
  },
  transaction<T>(fn: () => Promise<T>): () => Promise<T> {
    return activeDb.transaction(fn);
  },
  close(): Promise<void> {
    return activeDb.close();
  },
};

export function getDatabaseMode(): 'postgres' | 'sqlite' {
  return isPostgres ? 'postgres' : 'sqlite';
}

export function generateId(prefix: string): string {
  const rand = crypto.randomBytes(4).toString('hex').toUpperCase();
  const ts = Date.now().toString(36).slice(-4).toUpperCase();
  return `${prefix}-${ts}${rand}`;
}

export async function generateUnique8DigitUid(): Promise<string> {
  for (let i = 0; i < 25; i++) {
    const candidate = String(crypto.randomInt(10000000, 100000000));
    const exists = await db.prepare('SELECT id FROM users WHERE uid = ?').get(candidate);
    if (!exists) return candidate;
  }
  return String(Date.now()).slice(-8).padStart(8, '1');
}

export async function generateShortTicketId(): Promise<string> {
  for (let i = 0; i < 40; i++) {
    const code = crypto.randomInt(1000, 10000);
    const candidate = `SUP-${code}`;
    const exists = await db.prepare('SELECT id FROM support_threads WHERE id = ?').get(candidate);
    if (!exists) return candidate;
  }
  const fallback = crypto.randomBytes(3).toString('hex').toUpperCase();
  return `SUP-${fallback}`;
}

export const TOP_30_PAIRS: [string, string, string, number, number, number, number][] = [
  ['BTC/USDT', 'BTC', 'Bitcoin', 64750.0, 10, 0.28, 0.65],
  ['ETH/USDT', 'ETH', 'Ethereum', 1834.0, 12, 0.35, 1.45],
  ['BNB/USDT', 'BNB', 'BNB Chain', 593.3, 15, 0.30, 0.85],
  ['SOL/USDT', 'SOL', 'Solana', 72.7, 18, 0.45, 2.25],
  ['XRP/USDT', 'XRP', 'Ripple', 0.963, 20, 0.40, 1.20],
  ['DOGE/USDT', 'DOGE', 'Dogecoin', 0.05901, 25, 0.55, 1.40],
  ['ADA/USDT', 'ADA', 'Cardano', 0.154, 22, 0.45, 0.90],
  ['TRX/USDT', 'TRX', 'TRON', 0.3063, 20, 0.30, 0.50],
  ['TON/USDT', 'TON', 'Toncoin', 1.60, 20, 0.45, 1.15],
  ['AVAX/USDT', 'AVAX', 'Avalanche', 7.193, 22, 0.45, 1.60],
  ['SHIB/USDT', 'SHIB', 'Shiba Inu', 0.00000387, 30, 0.65, 2.10],
  ['LINK/USDT', 'LINK', 'Chainlink', 9.178, 20, 0.42, 1.35],
  ['DOT/USDT', 'DOT', 'Polkadot', 0.737, 22, 0.45, 0.95],
  ['BCH/USDT', 'BCH', 'Bitcoin Cash', 208.9, 20, 0.38, 1.10],
  ['SUI/USDT', 'SUI', 'Sui', 0.7249, 25, 0.55, 2.40],
  ['LTC/USDT', 'LTC', 'Litecoin', 44.74, 18, 0.35, 0.75],
  ['NEAR/USDT', 'NEAR', 'NEAR Protocol', 3.248, 24, 0.50, 1.85],
  ['UNI/USDT', 'UNI', 'Uniswap', 5.306, 22, 0.45, 1.05],
  ['APT/USDT', 'APT', 'Aptos', 0.4611, 25, 0.52, 1.70],
  ['PEPE/USDT', 'PEPE', 'Pepe', 0.00000396, 30, 0.70, 2.80],
  ['ICP/USDT', 'ICP', 'Internet Computer', 2.463, 25, 0.48, 1.25],
  ['ETC/USDT', 'ETC', 'Ethereum Classic', 5.89, 22, 0.40, 0.80],
  ['XLM/USDT', 'XLM', 'Stellar', 0.1386, 24, 0.40, 1.15],
  ['HBAR/USDT', 'HBAR', 'Hedera', 0.05693, 25, 0.48, 1.30],
  ['ARB/USDT', 'ARB', 'Arbitrum', 0.1317, 25, 0.52, 1.45],
  ['OP/USDT', 'OP', 'Optimism', 0.0784, 25, 0.52, 1.20],
  ['FIL/USDT', 'FIL', 'Filecoin', 0.6116, 25, 0.48, 0.95],
  ['ATOM/USDT', 'ATOM', 'Cosmos', 1.335, 24, 0.44, 0.85],
  ['INJ/USDT', 'INJ', 'Injective', 7.328, 24, 0.55, 2.15],
  ['RENDER/USDT', 'RENDER', 'Render', 1.387, 25, 0.55, 1.90],
];

let pgExistingColsCache: Set<string> | null = null;

async function preloadPostgresColumns(): Promise<void> {
  if (!isPostgres) return;
  try {
    const rows = (await db
      .prepare("SELECT table_name, column_name FROM information_schema.columns WHERE table_schema = 'public'")
      .all()) as { table_name: string; column_name: string }[];
    pgExistingColsCache = new Set(rows.map((r) => `${r.table_name}.${r.column_name}`));
  } catch {
    pgExistingColsCache = null;
  }
}

async function ensureColumn(tableName: string, columnName: string, columnDef: string): Promise<void> {
  if (isPostgres) {
    if (pgExistingColsCache?.has(`${tableName}.${columnName}`)) {
      return;
    }
    await db.exec(`ALTER TABLE ${tableName} ADD COLUMN IF NOT EXISTS ${columnName} ${columnDef}`);
    pgExistingColsCache?.add(`${tableName}.${columnName}`);
    return;
  }
  const cols = (await db.prepare(`PRAGMA table_info('${tableName}')`).all()) as { name: string }[];
  if (!cols.some((c) => c.name === columnName)) {
    await db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${columnDef}`);
  }
}

export async function initDatabase(): Promise<void> {
  if (isPostgres) {
    try {
      await activeDb.exec('SELECT 1');
    } catch (primaryErr: any) {
      const dotenvUrl = readDotenvPostgresUrl();
      let recovered = false;
      if (dotenvUrl && dotenvUrl !== activePostgresUrl) {
        try {
          await activeDb.close().catch(() => {});
          activePostgresUrl = dotenvUrl;
          activeDb = createPostgresDb(dotenvUrl);
          await activeDb.exec('SELECT 1');
          recovered = true;
        } catch {
          recovered = false;
        }
      }
      if (!recovered) {
        console.warn(
          `[db] PostgreSQL unreachable (${primaryErr?.message || 'connection error'}); falling back to local SQLite.`
        );
        await activeDb.close().catch(() => {});
        isPostgres = false;
        activePostgresUrl = '';
        activeDb = createSqliteFallbackDb();
      }
    }
  }

  await db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      uid TEXT,
      email TEXT UNIQUE NOT NULL,
      full_name TEXT NOT NULL,
      password_hash TEXT NOT NULL DEFAULT '',
      strong_password_set INTEGER NOT NULL DEFAULT 0,
      avatar_url TEXT,
      phone TEXT NOT NULL DEFAULT '',
      country TEXT NOT NULL DEFAULT '',
      date_of_birth TEXT NOT NULL DEFAULT '',
      address TEXT NOT NULL DEFAULT '',
      occupation TEXT NOT NULL DEFAULT '',
      bio TEXT NOT NULL DEFAULT '',
      two_fa_enabled INTEGER NOT NULL DEFAULT 0,
      two_fa_secret TEXT,
      role TEXT NOT NULL DEFAULT 'USER',
      status TEXT NOT NULL DEFAULT 'ACTIVE',
      kyc_status TEXT NOT NULL DEFAULT 'UNVERIFIED',
      main_balance DOUBLE PRECISION NOT NULL DEFAULT 0,
      claimable_balance DOUBLE PRECISION NOT NULL DEFAULT 0,
      locked_balance DOUBLE PRECISION NOT NULL DEFAULT 0,
      profit_balance DOUBLE PRECISION NOT NULL DEFAULT 0,
      referral_code TEXT UNIQUE NOT NULL,
      referred_by TEXT,
      first_deposit_rewarded INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS wallets_ledger (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      wallet_type TEXT NOT NULL,
      tx_type TEXT NOT NULL,
      amount DOUBLE PRECISION NOT NULL,
      balance_after DOUBLE PRECISION NOT NULL,
      reference_id TEXT,
      description TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS deposit_requests (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      amount DOUBLE PRECISION NOT NULL,
      gateway TEXT NOT NULL,
      trx_id TEXT UNIQUE NOT NULL,
      screenshot_data TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'PENDING',
      admin_note TEXT,
      reviewed_by TEXT,
      created_at TEXT NOT NULL,
      reviewed_at TEXT,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS withdraw_requests (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      amount DOUBLE PRECISION NOT NULL,
      fee_usd DOUBLE PRECISION NOT NULL DEFAULT 0,
      gateway TEXT NOT NULL,
      destination_address TEXT NOT NULL,
      proof_note TEXT,
      status TEXT NOT NULL DEFAULT 'PENDING',
      admin_note TEXT,
      reviewed_by TEXT,
      created_at TEXT NOT NULL,
      reviewed_at TEXT,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS p2p_offers (
      id TEXT PRIMARY KEY,
      creator_id TEXT NOT NULL,
      side TEXT NOT NULL,
      total_amount DOUBLE PRECISION NOT NULL,
      available_amount DOUBLE PRECISION NOT NULL,
      min_limit DOUBLE PRECISION NOT NULL,
      max_limit DOUBLE PRECISION NOT NULL,
      rate_usd DOUBLE PRECISION NOT NULL,
      fiat_currency TEXT NOT NULL DEFAULT 'USD',
      payment_method TEXT NOT NULL,
      payment_window_min INTEGER NOT NULL DEFAULT 15,
      terms TEXT,
      status TEXT NOT NULL DEFAULT 'ACTIVE',
      created_at TEXT NOT NULL,
      FOREIGN KEY (creator_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS p2p_orders (
      id TEXT PRIMARY KEY,
      offer_id TEXT NOT NULL,
      buyer_id TEXT NOT NULL,
      seller_id TEXT NOT NULL,
      amount_vusd DOUBLE PRECISION NOT NULL,
      fee_usd DOUBLE PRECISION NOT NULL DEFAULT 0,
      fiat_total DOUBLE PRECISION NOT NULL,
      fiat_currency TEXT NOT NULL DEFAULT 'USD',
      payment_method TEXT NOT NULL,
      payment_reference TEXT,
      seller_payment_snapshot TEXT,
      status TEXT NOT NULL DEFAULT 'ESCROW_LOCKED',
      dispute_reason TEXT,
      dispute_opened_by TEXT,
      admin_resolution_note TEXT,
      expires_at TEXT,
      paid_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (offer_id) REFERENCES p2p_offers(id),
      FOREIGN KEY (buyer_id) REFERENCES users(id),
      FOREIGN KEY (seller_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS p2p_messages (
      id TEXT PRIMARY KEY,
      order_id TEXT NOT NULL,
      sender_id TEXT,
      sender_role TEXT NOT NULL DEFAULT 'USER',
      msg_type TEXT NOT NULL DEFAULT 'TEXT',
      body TEXT NOT NULL,
      attachment_data TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (order_id) REFERENCES p2p_orders(id)
    );

    CREATE INDEX IF NOT EXISTS idx_p2p_messages_order_id ON p2p_messages(order_id, created_at);

    CREATE TABLE IF NOT EXISTS market_pairs (
      symbol TEXT PRIMARY KEY,
      base_asset TEXT NOT NULL,
      name TEXT NOT NULL,
      current_price DOUBLE PRECISION NOT NULL,
      spread_bps DOUBLE PRECISION NOT NULL DEFAULT 15,
      target_price DOUBLE PRECISION,
      volatility_pct DOUBLE PRECISION NOT NULL DEFAULT 0.35,
      auto_drift INTEGER NOT NULL DEFAULT 1,
      change_24h_pct DOUBLE PRECISION NOT NULL DEFAULT 0,
      high_24h DOUBLE PRECISION NOT NULL DEFAULT 0,
      low_24h DOUBLE PRECISION NOT NULL DEFAULT 0,
      turnover_24h DOUBLE PRECISION NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS user_coin_holdings (
      user_id TEXT NOT NULL,
      asset TEXT NOT NULL,
      quantity DOUBLE PRECISION NOT NULL DEFAULT 0,
      avg_entry_price DOUBLE PRECISION NOT NULL DEFAULT 0,
      PRIMARY KEY (user_id, asset),
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS spot_trades (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      symbol TEXT NOT NULL,
      order_mode TEXT NOT NULL,
      side TEXT NOT NULL,
      amount_usd DOUBLE PRECISION NOT NULL,
      quantity DOUBLE PRECISION NOT NULL,
      entry_price DOUBLE PRECISION NOT NULL,
      exit_price DOUBLE PRECISION,
      limit_price DOUBLE PRECISION,
      tp_price DOUBLE PRECISION,
      sl_price DOUBLE PRECISION,
      spread_bps DOUBLE PRECISION NOT NULL,
      fee_usd DOUBLE PRECISION NOT NULL DEFAULT 0,
      fee_role TEXT NOT NULL DEFAULT 'TAKER',
      is_liquidated INTEGER NOT NULL DEFAULT 0,
      pnl_usd DOUBLE PRECISION NOT NULL DEFAULT 0,
      admin_override TEXT NOT NULL DEFAULT 'NONE',
      status TEXT NOT NULL DEFAULT 'OPEN',
      created_at TEXT NOT NULL,
      settled_at TEXT,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS staking_positions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      package_code TEXT NOT NULL,
      duration_months INTEGER NOT NULL,
      annual_roi_pct DOUBLE PRECISION NOT NULL,
      principal_amount DOUBLE PRECISION NOT NULL,
      total_profit_paid DOUBLE PRECISION NOT NULL DEFAULT 0,
      months_paid INTEGER NOT NULL DEFAULT 0,
      quarters_paid INTEGER NOT NULL DEFAULT 0,
      total_quarters INTEGER NOT NULL,
      monthly_draw_entries INTEGER NOT NULL DEFAULT 1,
      next_payout_at TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'ACTIVE',
      penalty_amount DOUBLE PRECISION NOT NULL DEFAULT 0,
      emergency_payout_at TEXT,
      accrued_days INTEGER NOT NULL DEFAULT 0,
      accrued_profit DOUBLE PRECISION NOT NULL DEFAULT 0,
      next_daily_accrual_at TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS staking_daily_logs (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      position_id TEXT NOT NULL,
      package_code TEXT NOT NULL,
      day_number INTEGER NOT NULL,
      daily_amount DOUBLE PRECISION NOT NULL,
      total_accrued DOUBLE PRECISION NOT NULL,
      credited_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id),
      FOREIGN KEY (position_id) REFERENCES staking_positions(id)
    );

    CREATE INDEX IF NOT EXISTS idx_staking_daily_logs_user ON staking_daily_logs(user_id, credited_at DESC);

    CREATE TABLE IF NOT EXISTS presale_rounds (
      id TEXT PRIMARY KEY,
      token_symbol TEXT NOT NULL,
      token_name TEXT NOT NULL,
      face_value DOUBLE PRECISION NOT NULL DEFAULT 10.00,
      lot_size INTEGER NOT NULL DEFAULT 50,
      issue_price DOUBLE PRECISION NOT NULL DEFAULT 1.50,
      lot_price DOUBLE PRECISION NOT NULL,
      network_fee DOUBLE PRECISION NOT NULL DEFAULT 0.50,
      tokens_per_lot DOUBLE PRECISION NOT NULL,
      projected_win_payout DOUBLE PRECISION NOT NULL,
      total_lots INTEGER NOT NULL,
      total_issue_size DOUBLE PRECISION NOT NULL DEFAULT 0,
      sold_lots INTEGER NOT NULL DEFAULT 0,
      draw_date TEXT NOT NULL,
      listing_date TEXT,
      min_lots INTEGER NOT NULL DEFAULT 1,
      max_lots INTEGER NOT NULL DEFAULT 500,
      status TEXT NOT NULL DEFAULT 'OPEN',
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS presale_tickets (
      id TEXT PRIMARY KEY,
      round_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      lots_count INTEGER NOT NULL,
      principal_paid DOUBLE PRECISION NOT NULL,
      fee_paid DOUBLE PRECISION NOT NULL,
      result TEXT NOT NULL DEFAULT 'PENDING',
      payout_amount DOUBLE PRECISION NOT NULL DEFAULT 0,
      settled_at TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (round_id) REFERENCES presale_rounds(id),
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS lucky_draws (
      id TEXT PRIMARY KEY,
      quarter_label TEXT NOT NULL,
      title TEXT NOT NULL DEFAULT 'Quarterly Jackpot',
      prize_pool DOUBLE PRECISION NOT NULL,
      ticket_price DOUBLE PRECISION NOT NULL DEFAULT 1.00,
      winner_user_id TEXT,
      winner_email TEXT,
      winner_name TEXT,
      winning_ticket_number TEXT,
      draw_hash TEXT,
      status TEXT NOT NULL DEFAULT 'OPEN',
      draw_at TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS jackpot_tickets (
      id TEXT PRIMARY KEY,
      draw_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      ticket_count INTEGER NOT NULL,
      ticket_numbers TEXT NOT NULL DEFAULT '[]',
      cost_usd DOUBLE PRECISION NOT NULL,
      status TEXT NOT NULL DEFAULT 'ACTIVE',
      prize_won DOUBLE PRECISION NOT NULL DEFAULT 0,
      winning_ticket_number TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (draw_id) REFERENCES lucky_draws(id),
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS referrals (
      id TEXT PRIMARY KEY,
      referrer_id TEXT NOT NULL,
      referred_user_id TEXT UNIQUE NOT NULL,
      bonus_amount DOUBLE PRECISION NOT NULL DEFAULT 15.00,
      status TEXT NOT NULL DEFAULT 'PENDING_DEPOSIT',
      created_at TEXT NOT NULL,
      credited_at TEXT,
      FOREIGN KEY (referrer_id) REFERENCES users(id),
      FOREIGN KEY (referred_user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS referral_milestone_claims (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      tier_code TEXT NOT NULL,
      target_count INTEGER NOT NULL,
      bonus_amount DOUBLE PRECISION NOT NULL,
      claimed_at TEXT NOT NULL,
      UNIQUE(user_id, tier_code),
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS user_payment_methods (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      method TEXT NOT NULL,
      account_label TEXT NOT NULL DEFAULT '',
      account_number TEXT NOT NULL,
      extra_details TEXT NOT NULL DEFAULT '',
      is_default INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE INDEX IF NOT EXISTS idx_user_payment_methods_user_id ON user_payment_methods(user_id);

    CREATE TABLE IF NOT EXISTS support_threads (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      subject TEXT NOT NULL DEFAULT 'General Support',
      category TEXT NOT NULL DEFAULT 'GENERAL',
      status TEXT NOT NULL DEFAULT 'OPEN',
      user_unread INTEGER NOT NULL DEFAULT 0,
      admin_unread INTEGER NOT NULL DEFAULT 0,
      last_message TEXT,
      last_message_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE INDEX IF NOT EXISTS idx_support_threads_user ON support_threads(user_id, updated_at);

    CREATE TABLE IF NOT EXISTS support_messages (
      id TEXT PRIMARY KEY,
      thread_id TEXT NOT NULL,
      sender_id TEXT,
      sender_role TEXT NOT NULL DEFAULT 'USER',
      body TEXT NOT NULL,
      attachment_data TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (thread_id) REFERENCES support_threads(id)
    );

    CREATE INDEX IF NOT EXISTS idx_support_messages_thread ON support_messages(thread_id, created_at);

    CREATE TABLE IF NOT EXISTS platform_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS kyc_submissions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      doc_type TEXT NOT NULL,
      legal_name TEXT NOT NULL,
      doc_number TEXT NOT NULL,
      doc_front_data TEXT NOT NULL,
      selfie_data TEXT,
      status TEXT NOT NULL DEFAULT 'PENDING',
      admin_note TEXT,
      reviewed_by TEXT,
      reviewed_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE INDEX IF NOT EXISTS idx_kyc_submissions_user ON kyc_submissions(user_id, created_at);

    CREATE TABLE IF NOT EXISTS notifications (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      category TEXT NOT NULL DEFAULT 'SYSTEM',
      title TEXT NOT NULL,
      message TEXT NOT NULL,
      link_tab TEXT,
      is_read INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, created_at);

    CREATE TABLE IF NOT EXISTS login_sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      jti TEXT UNIQUE NOT NULL,
      device_info TEXT NOT NULL,
      ip_address TEXT NOT NULL,
      is_revoked INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      last_active_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE INDEX IF NOT EXISTS idx_login_sessions_user ON login_sessions(user_id, last_active_at);

    CREATE TABLE IF NOT EXISTS password_reset_codes (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      email TEXT NOT NULL,
      code TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      used INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS signup_otp_codes (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL,
      code TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      used INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_signup_otp_email ON signup_otp_codes(email, created_at);

    CREATE TABLE IF NOT EXISTS admin_audit_logs (
      id TEXT PRIMARY KEY,
      admin_id TEXT NOT NULL,
      admin_email TEXT NOT NULL,
      action_type TEXT NOT NULL,
      target_type TEXT NOT NULL,
      target_id TEXT NOT NULL DEFAULT '',
      summary TEXT NOT NULL,
      ip_address TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_admin_audit_created ON admin_audit_logs(created_at DESC);

    DROP TABLE IF EXISTS user_biometrics;
  `);

  await preloadPostgresColumns();

  const nowSettings = new Date().toISOString();
  const defaultPlatformSettings: [string, string][] = [
    ['binance_pay_id', '904182775'],
    ['bybit_uid', '55109283'],
    ['min_deposit_usd', '10'],
    ['max_deposit_usd', '100000'],
    ['min_withdraw_usd', '10'],
    ['max_withdraw_usd', '50000'],
    ['withdraw_fee_usd', '1.0'],
    ['p2p_fee_usd', '0.1'],
    ['send_fee_usd', '0.2'],
    ['presale_network_fee_usd', '0.5'],
    ['spot_maker_fee_pct', '0.02'],
    ['spot_taker_fee_pct', '0.03'],
    ['staking_emergency_penalty_rate', '0.005'],
    ['maintenance_mode', '0'],
    ['maintenance_message', 'Scheduled exchange maintenance is in progress. Please check back shortly.'],
  ];
  const existingSettingRows = (await db.prepare('SELECT key FROM platform_settings').all()) as { key: string }[];
  const existingSettingKeys = new Set(existingSettingRows.map((r) => r.key));
  const missingSettings = defaultPlatformSettings.filter(([k]) => !existingSettingKeys.has(k));
  if (missingSettings.length > 0) {
    const insertSetting = db.prepare(
      'INSERT INTO platform_settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT DO NOTHING'
    );
    await Promise.all(missingSettings.map(([k, v]) => insertSetting.run(k, v, nowSettings)));
  }

  // Ensure columns exist on pre-existing databases
  await ensureColumn('users', 'status', "TEXT NOT NULL DEFAULT 'ACTIVE'");
  await ensureColumn('users', 'kyc_status', "TEXT NOT NULL DEFAULT 'UNVERIFIED'");
  await ensureColumn('users', 'password_hash', "TEXT NOT NULL DEFAULT ''");
  await ensureColumn('users', 'strong_password_set', 'INTEGER NOT NULL DEFAULT 0');
  await ensureColumn('users', 'avatar_url', 'TEXT');
  await ensureColumn('users', 'phone', "TEXT NOT NULL DEFAULT ''");
  await ensureColumn('users', 'country', "TEXT NOT NULL DEFAULT ''");
  await ensureColumn('users', 'date_of_birth', "TEXT NOT NULL DEFAULT ''");
  await ensureColumn('users', 'address', "TEXT NOT NULL DEFAULT ''");
  await ensureColumn('users', 'occupation', "TEXT NOT NULL DEFAULT ''");
  await ensureColumn('users', 'bio', "TEXT NOT NULL DEFAULT ''");
  await ensureColumn('users', 'two_fa_enabled', 'INTEGER NOT NULL DEFAULT 0');
  await ensureColumn('users', 'two_fa_secret', 'TEXT');
  await ensureColumn('users', 'uid', 'TEXT');
  await db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_users_uid ON users(uid)');

  // Lock any legacy accounts missing a password_hash with a random CSPRNG credential
  const missingPwdUsers = (await db
    .prepare("SELECT id, role FROM users WHERE password_hash IS NULL OR TRIM(password_hash) = ''")
    .all()) as { id: string; role: string }[];
  for (const row of missingPwdUsers) {
    const randomHash = bcrypt.hashSync(crypto.randomBytes(24).toString('base64url'), 10);
    await db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(randomHash, row.id);
  }

  if (!isPostgres) {
    const userCols = (await db.prepare("PRAGMA table_info('users')").all()) as { name: string }[];
    if (userCols.some((c) => c.name === 'pin_hash')) {
      await db.exec('ALTER TABLE users DROP COLUMN pin_hash');
    }
  }

  // Keep kyc_status aligned with 4-step verification OR approved KYC document submission
  await db.exec(`
    UPDATE users
    SET kyc_status = CASE
      WHEN EXISTS (SELECT 1 FROM kyc_submissions ks WHERE ks.user_id = users.id AND ks.status = 'APPROVED')
        OR (
          LENGTH(TRIM(COALESCE(full_name, ''))) >= 2
          AND COALESCE(email, '') LIKE '%_@_%'
          AND LENGTH(TRIM(COALESCE(phone, ''))) >= 5
          AND LENGTH(TRIM(COALESCE(country, ''))) >= 2
          AND LENGTH(TRIM(COALESCE(date_of_birth, ''))) >= 4
          AND LENGTH(TRIM(COALESCE(address, ''))) >= 4
          AND LENGTH(TRIM(COALESCE(occupation, ''))) >= 2
          AND COALESCE(strong_password_set, 0) = 1
          AND COALESCE(two_fa_enabled, 0) = 1
          AND EXISTS (SELECT 1 FROM user_payment_methods pm WHERE pm.user_id = users.id)
        )
      THEN 'VERIFIED'
      ELSE 'UNVERIFIED'
    END
  `);

  const missingUidUsers = (await db
    .prepare('SELECT id FROM users WHERE uid IS NULL OR LENGTH(TRIM(uid)) != 8')
    .all()) as { id: string }[];
  for (const row of missingUidUsers) {
    const nextUid = row.id === 'CL-ADMIN' && !(await db.prepare('SELECT id FROM users WHERE uid = ? AND id != ?').get('10000001', row.id))
      ? '10000001'
      : await generateUnique8DigitUid();
    await db.prepare('UPDATE users SET uid = ? WHERE id = ?').run(nextUid, row.id);
  }

  await ensureColumn('spot_trades', 'limit_price', 'DOUBLE PRECISION');
  await ensureColumn('spot_trades', 'fee_usd', 'DOUBLE PRECISION NOT NULL DEFAULT 0');
  await ensureColumn('spot_trades', 'fee_role', "TEXT NOT NULL DEFAULT 'TAKER'");
  await ensureColumn('spot_trades', 'is_liquidated', 'INTEGER NOT NULL DEFAULT 0');
  await ensureColumn('spot_trades', 'tp_price', 'DOUBLE PRECISION');
  await ensureColumn('spot_trades', 'sl_price', 'DOUBLE PRECISION');

  await ensureColumn('market_pairs', 'high_24h', 'DOUBLE PRECISION NOT NULL DEFAULT 0');
  await ensureColumn('market_pairs', 'low_24h', 'DOUBLE PRECISION NOT NULL DEFAULT 0');
  await ensureColumn('market_pairs', 'turnover_24h', 'DOUBLE PRECISION NOT NULL DEFAULT 0');

  if (!isPostgres) {
    await db.exec(`
      UPDATE OR IGNORE market_pairs SET symbol = REPLACE(REPLACE(symbol, '/vUSD', '/USDT'), '/USD', '/USDT') WHERE symbol LIKE '%/vUSD' OR symbol LIKE '%/USD';
      DELETE FROM market_pairs WHERE symbol LIKE '%/vUSD' OR (symbol LIKE '%/USD' AND symbol NOT LIKE '%/USDT');
      UPDATE spot_trades SET symbol = REPLACE(REPLACE(symbol, '/vUSD', '/USDT'), '/USD', '/USDT') WHERE symbol LIKE '%/vUSD' OR symbol LIKE '%/USD';
    `);
  }

  await ensureColumn('users', 'profit_balance', 'DOUBLE PRECISION NOT NULL DEFAULT 0');
  await ensureColumn('staking_positions', 'months_paid', 'INTEGER NOT NULL DEFAULT 0');
  await ensureColumn('staking_positions', 'penalty_amount', 'DOUBLE PRECISION NOT NULL DEFAULT 0');
  await ensureColumn('staking_positions', 'emergency_payout_at', 'TEXT');
  await ensureColumn('staking_positions', 'accrued_days', 'INTEGER NOT NULL DEFAULT 0');
  await ensureColumn('staking_positions', 'accrued_profit', 'DOUBLE PRECISION NOT NULL DEFAULT 0');
  await ensureColumn('staking_positions', 'next_daily_accrual_at', 'TEXT');
  const leastExpr = isPostgres ? 'LEAST(duration_months, quarters_paid * 3)' : 'MIN(duration_months, quarters_paid * 3)';
  await db.exec(`UPDATE staking_positions SET months_paid = ${leastExpr} WHERE months_paid = 0 AND quarters_paid > 0`);

  await ensureColumn('lucky_draws', 'title', "TEXT NOT NULL DEFAULT 'Quarterly Jackpot'");
  await ensureColumn('lucky_draws', 'ticket_price', 'DOUBLE PRECISION NOT NULL DEFAULT 1.00');
  await ensureColumn('lucky_draws', 'winner_name', 'TEXT');
  await ensureColumn('lucky_draws', 'winning_ticket_number', 'TEXT');
  await ensureColumn('lucky_draws', 'draw_hash', 'TEXT');
  await ensureColumn('jackpot_tickets', 'ticket_numbers', "TEXT NOT NULL DEFAULT '[]'");
  await ensureColumn('jackpot_tickets', 'winning_ticket_number', 'TEXT');

  // Backfill unique 6-digit random ticket numbers for any legacy jackpot_tickets rows
  const allLegacyTickets = (await db
    .prepare('SELECT id, draw_id, ticket_count, ticket_numbers, status, winning_ticket_number FROM jackpot_tickets ORDER BY created_at ASC')
    .all()) as {
    id: string;
    draw_id: string;
    ticket_count: number;
    ticket_numbers: string | null;
    status: string;
    winning_ticket_number: string | null;
  }[];
  if (allLegacyTickets.length > 0) {
    const usedByDraw = new Map<string, Set<string>>();
    for (const row of allLegacyTickets) {
      let parsed: string[] = [];
      try {
        const arr = JSON.parse(row.ticket_numbers || '[]');
        if (Array.isArray(arr)) parsed = arr.map((v) => String(v));
      } catch {
        parsed = [];
      }
      if (!usedByDraw.has(row.draw_id)) usedByDraw.set(row.draw_id, new Set<string>());
      const set = usedByDraw.get(row.draw_id)!;
      for (const n of parsed) set.add(n);
    }

    for (const row of allLegacyTickets) {
      let parsed: string[] = [];
      try {
        const arr = JSON.parse(row.ticket_numbers || '[]');
        if (Array.isArray(arr)) parsed = arr.map((v) => String(v));
      } catch {
        parsed = [];
      }
      const expected = Math.max(1, Number(row.ticket_count || 1));
      if (parsed.length === expected) continue;

      if (!usedByDraw.has(row.draw_id)) usedByDraw.set(row.draw_id, new Set<string>());
      const usedSet = usedByDraw.get(row.draw_id)!;
      while (parsed.length < expected) {
        let candidate = '';
        for (let attempt = 0; attempt < 50; attempt++) {
          const rand = String(crypto.randomInt(100000, 1000000));
          if (!usedSet.has(rand)) {
            candidate = rand;
            break;
          }
        }
        if (!candidate) {
          candidate = String(crypto.randomInt(1000000, 10000000));
        }
        usedSet.add(candidate);
        parsed.push(candidate);
      }

      const winNum = row.status === 'WON' ? row.winning_ticket_number || parsed[0] : row.winning_ticket_number;
      await db
        .prepare('UPDATE jackpot_tickets SET ticket_numbers = ?, winning_ticket_number = ? WHERE id = ?')
        .run(JSON.stringify(parsed), winNum || null, row.id);
      if (row.status === 'WON' && winNum) {
        await db
          .prepare("UPDATE lucky_draws SET winning_ticket_number = COALESCE(winning_ticket_number, ?) WHERE id = ?")
          .run(winNum, row.draw_id);
      }
    }
  }

  await ensureColumn('withdraw_requests', 'fee_usd', 'DOUBLE PRECISION NOT NULL DEFAULT 0');
  await ensureColumn('p2p_offers', 'fiat_currency', "TEXT NOT NULL DEFAULT 'USD'");
  await ensureColumn('p2p_offers', 'payment_window_min', 'INTEGER NOT NULL DEFAULT 15');
  await ensureColumn('p2p_orders', 'fee_usd', 'DOUBLE PRECISION NOT NULL DEFAULT 0');
  await ensureColumn('p2p_orders', 'fiat_currency', "TEXT NOT NULL DEFAULT 'USD'");
  await ensureColumn('p2p_orders', 'seller_payment_snapshot', 'TEXT');
  await ensureColumn('p2p_orders', 'expires_at', 'TEXT');
  await ensureColumn('p2p_orders', 'paid_at', 'TEXT');

  await ensureColumn('presale_rounds', 'face_value', 'DOUBLE PRECISION NOT NULL DEFAULT 10.00');
  await ensureColumn('presale_rounds', 'lot_size', 'INTEGER NOT NULL DEFAULT 50');
  await ensureColumn('presale_rounds', 'issue_price', 'DOUBLE PRECISION NOT NULL DEFAULT 1.50');
  await ensureColumn('presale_rounds', 'total_issue_size', 'DOUBLE PRECISION NOT NULL DEFAULT 0');
  await ensureColumn('presale_rounds', 'listing_date', 'TEXT');
  await ensureColumn('presale_rounds', 'min_lots', 'INTEGER NOT NULL DEFAULT 1');
  await ensureColumn('presale_rounds', 'max_lots', 'INTEGER NOT NULL DEFAULT 500');

  // Ensure all Top 30 live market pairs exist
  const existingPairRows = (await db.prepare('SELECT symbol FROM market_pairs').all()) as { symbol: string }[];
  const existingPairSet = new Set(existingPairRows.map((r) => r.symbol));
  const missingPairs = TOP_30_PAIRS.filter(([sym]) => !existingPairSet.has(sym));
  if (missingPairs.length > 0) {
    const nowEnsure = new Date().toISOString();
    const ensurePair = db.prepare(`
      INSERT INTO market_pairs (symbol, base_asset, name, current_price, spread_bps, target_price, volatility_pct, auto_drift, change_24h_pct, updated_at)
      VALUES (?, ?, ?, ?, ?, NULL, ?, 1, ?, ?)
      ON CONFLICT DO NOTHING
    `);
    await Promise.all(
      missingPairs.map(([sym, base, name, price, spread, vol, chg]) =>
        ensurePair.run(sym, base, name, price, spread, vol, chg, nowEnsure)
      )
    );
  }

  await ensureCorePlatformBootstrap();
}

async function ensureCorePlatformBootstrap(): Promise<void> {
  const now = new Date().toISOString();

  // 1. Seed Master Administrator automatically only when INITIAL_ADMIN_PASSWORD is configured;
  // otherwise the first-run inline Claim Master Admin flow allows the owner to set it securely.
  const existingAdmin = await db.prepare("SELECT id FROM users WHERE role = 'ADMIN' LIMIT 1").get();
  const configuredPwd = process.env.INITIAL_ADMIN_PASSWORD?.trim();
  if (!existingAdmin && configuredPwd && configuredPwd.length >= 6) {
    const adminEmail = process.env.INITIAL_ADMIN_EMAIL?.trim().toLowerCase() || 'admin@nepefy.app';
    const adminPwdHash = bcrypt.hashSync(configuredPwd, 10);

    await db
      .prepare(`
        INSERT INTO users (id, uid, email, full_name, password_hash, strong_password_set, role, status, kyc_status, main_balance, claimable_balance, locked_balance, referral_code, referred_by, first_deposit_rewarded, created_at)
        VALUES (?, ?, ?, ?, ?, 1, 'ADMIN', 'ACTIVE', 'VERIFIED', 0, 0, 0, ?, NULL, 1, ?)
        ON CONFLICT DO NOTHING
      `)
      .run('CL-ADMIN', '10000001', adminEmail, 'Master Administrator', adminPwdHash, 'NEPEFYADM', now);
  }

  // 2. Ensure at least one active quarterly lucky draw round exists
  const openDraw = await db.prepare("SELECT id FROM lucky_draws WHERE status = 'OPEN' LIMIT 1").get();
  if (!openDraw) {
    const nextQuarter = new Date(Date.now() + 90 * 86400000).toISOString();
    const currentYear = new Date().getUTCFullYear();
    const quarterNum = Math.floor(new Date().getUTCMonth() / 3) + 1;
    const label = `Q${quarterNum} ${currentYear}`;
    await db
      .prepare(`
        INSERT INTO lucky_draws (id, quarter_label, title, ticket_price, prize_pool, winner_user_id, winner_email, winner_name, status, draw_at, created_at)
        VALUES (?, ?, ?, 1.00, 0, NULL, NULL, NULL, 'OPEN', ?, ?)
        ON CONFLICT DO NOTHING
      `)
      .run(`DRW-Q${quarterNum}-${currentYear}`, label, `${label} Quarterly Jackpot`, nextQuarter, now);
  } else {
    const migratedFlag = await db
      .prepare("SELECT value FROM platform_settings WHERE key = 'jackpot_ticket_price_1usd_migrated'")
      .get();
    if (!migratedFlag) {
      await db.prepare("UPDATE lucky_draws SET ticket_price = 1.00 WHERE status = 'OPEN' AND ticket_price = 10.00").run();
      await db
        .prepare(`
          INSERT INTO platform_settings (key, value, updated_at)
          VALUES ('jackpot_ticket_price_1usd_migrated', '1', ?)
          ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
        `)
        .run(now);
    }
  }
}

export async function appendLedger(
  userId: string,
  walletType: 'MAIN' | 'CLAIMABLE',
  txType: string,
  amount: number,
  balanceAfter: number,
  referenceId: string,
  description: string
): Promise<void> {
  await db
    .prepare(`
      INSERT INTO wallets_ledger (id, user_id, wallet_type, tx_type, amount, balance_after, reference_id, description, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    .run(generateId('LDG'), userId, walletType, txType, amount, balanceAfter, referenceId, description, new Date().toISOString());
}
