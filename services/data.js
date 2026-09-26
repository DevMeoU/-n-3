const fs = require('fs');
const path = require('path');

const dataDir = path.join(__dirname, '..', 'data');
function load(name, fallback) {
  const file = path.join(dataDir, name + '.json');
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : fallback;
}
function save(name, value) {
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(path.join(dataDir, name + '.json'), JSON.stringify(value, null, 2));
}
function nextId(items) { return items.length ? Math.max(...items.map((x) => x.id)) + 1 : 1; }
module.exports = { load, save, nextId };
