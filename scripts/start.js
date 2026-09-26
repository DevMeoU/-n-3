const { spawn } = require('child_process');
const path = require('path');

const rootDir = path.join(__dirname, '..');
const services = [
  'services/user/index.js',
  'services/book/index.js',
  'services/borrow/index.js',
  'gateway/index.js'
];
const children = services.map((file) => spawn(process.execPath, [path.join(rootDir, file)], { stdio: 'inherit', env: process.env }));

function stop() {
  children.forEach((child) => child.kill());
  process.exit();
}
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
