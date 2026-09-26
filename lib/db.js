const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();

function openDatabase(file) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new sqlite3.Database(file);
  db.configure('busyTimeout', 3000);

  return {
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

module.exports = { openDatabase };
