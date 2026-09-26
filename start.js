const { spawn } = require('child_process');
const path = require('path');

const services = ['services/user-service.js', 'services/book-service.js', 'services/borrow-service.js', 'gateway.js'];
const children = services.map((file) => spawn(process.execPath, [path.join(__dirname, file)], { stdio: 'inherit', env: process.env }));

function stop() {
  children.forEach((child) => child.kill());
  process.exit();
}
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
