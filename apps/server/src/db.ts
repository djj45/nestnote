import fs from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { config, paths } from './config.ts'

/**
 * SQLite（Node 自带，不需要编译原生模块）。
 * - documents：每个 Yjs 文档的完整状态（工作区一个，每个页面一个）
 * - snapshots：页面的历史版本
 * - assets：已上传文件的元信息（文件本体在 assets 目录）
 * - users / sessions：登录
 */

let db: DatabaseSync | null = null

export function getDb(): DatabaseSync {
  if (db) return db
  fs.mkdirSync(config.dataDir, { recursive: true })
  db = new DatabaseSync(paths.db())
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = NORMAL;
    PRAGMA busy_timeout = 5000;
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS documents (
      name TEXT PRIMARY KEY,
      data BLOB NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      data BLOB NOT NULL,
      size INTEGER NOT NULL,
      hash TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS snapshots_by_name ON snapshots (name, created_at);

    CREATE TABLE IF NOT EXISTS assets (
      id TEXT PRIMARY KEY,
      size INTEGER NOT NULL,
      mime TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS users (
      username TEXT PRIMARY KEY,
      password_hash TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY,
      username TEXT NOT NULL REFERENCES users(username) ON DELETE CASCADE,
      created_at INTEGER NOT NULL,
      last_seen INTEGER NOT NULL,
      expires_at INTEGER NOT NULL,
      user_agent TEXT
    );
  `)
  return db
}

export function closeDb() {
  db?.close()
  db = null
}
