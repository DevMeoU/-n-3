// shared/db.js — wrapper DB dùng chung cho 3 services.
// Mặc định: SQLite file local (sqlite3). Khi đặt TURSO_*_URL (+ TURSO_TOKEN)
// thì service tương ứng dùng Turso Cloud (SQLite remote, không cần thẻ).
// Test (NODE_ENV=test) luôn dùng file local để độc lập và dọn dẹp được.
const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const config = require('./config');

function tursoEndpoint(name) {
  if (config.isTest) return null;
  const key = `TURSO_${name.toUpperCase().replace(/-/g, '_')}_URL`;
  const url = process.env[key];
  if (!url) return null;
  return { url, authToken: process.env.TURSO_TOKEN || undefined };
}

function toNumber(value) {
  return typeof value === 'bigint' ? Number(value) : value;
}

function normalizeRow(row) {
  if (!row || typeof row !== 'object') return row;
  const out = Array.isArray(row) ? [] : {};
  for (const key of Object.keys(row)) out[key] = toNumber(row[key]);
  return out;
}

function openLocal(file) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new sqlite3.Database(file);
  db.configure('busyTimeout', 3000);

  return {
    backend: 'sqlite-local',
    exec(sql) {
      return new Promise((resolve, reject) => db.exec(sql, (error) => error ? reject(error) : resolve()));
    },
    run(sql, params = []) {
      return new Promise((resolve, reject) => db.run(sql, params, function onRun(error) {
        if (error) return reject(error);
        resolve({ lastID: this.lastID, changes: this.changes });
      }));
    },
    get(sql, params = []) {
      return new Promise((resolve, reject) => db.get(sql, params, (error, row) => error ? reject(error) : resolve(row)));
    },
    all(sql, params = []) {
      return new Promise((resolve, reject) => db.all(sql, params, (error, rows) => error ? reject(error) : resolve(rows)));
    },
    close() {
      return new Promise((resolve, reject) => db.close((error) => error ? reject(error) : resolve()));
    }
  };
}

function openRemote(endpoint) {
  const { createClient } = require('@libsql/client');
  const db = createClient(endpoint);

  return {
    backend: 'turso',
    async exec(sql) {
      await db.executeMultiple(sql);
    },
    async run(sql, params = []) {
      const rs = await db.execute({ sql, args: params });
      return { lastID: toNumber(rs.lastInsertRowid), changes: rs.rowsAffected };
    },
    async get(sql, params = []) {
      const rs = await db.execute({ sql, args: params });
      const row = rs.rows[0];
      return row === undefined ? undefined : normalizeRow({ ...row });
    },
    async all(sql, params = []) {
      const rs = await db.execute({ sql, args: params });
      return rs.rows.map((row) => normalizeRow({ ...row }));
    },
    async close() {
      db.close();
    }
  };
}

// name: 'user-service' | 'book-service' | 'borrow-service'
function openDatabase(name) {
  const endpoint = tursoEndpoint(name);
  if (endpoint) return openRemote(endpoint);
  return openLocal(config.dbPath(name));
}

module.exports = { openDatabase };
