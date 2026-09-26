// scripts/stop.js — kill tiến trình đang giữ port của stack (dùng khi npm start báo EADDRINUSE)
const { execSync } = require('child_process');
const config = require('../shared/config');

const ports = [
  config.gatewayPort,
  config.userServicePort,
  config.bookServicePort,
  config.borrowServicePort
];

function listeningPids() {
  const out = execSync('netstat -ano -p TCP', { encoding: 'utf8' });
  const pids = new Set();
  for (const line of out.split('\n')) {
    if (!line.includes('LISTENING')) continue;
    for (const port of ports) {
      // khớp chính xác :port ở cột local address (tránh nhầm :30000 với :3000)
      if (new RegExp(`[\\.:]${port}\\s`).test(line)) {
        const pid = Number(line.trim().split(/\s+/).pop());
        if (Number.isInteger(pid) && pid > 0 && pid !== process.pid) pids.add(pid);
      }
    }
  }
  return [...pids];
}

function processName(pid) {
  try {
    return execSync(`tasklist /FI "PID eq ${pid}" /NH /FO CSV`, { encoding: 'utf8' });
  } catch {
    return '';
  }
}

const pids = listeningPids();
if (pids.length === 0) {
  console.log(`Không có tiến trình nào giữ port ${ports.join(', ')}.`);
  process.exit(0);
}
for (const pid of pids) {
  const info = processName(pid);
  if (!/node\.exe/i.test(info)) {
    console.log(`Bỏ qua PID ${pid} (không phải node): ${info.trim().split('\n')[0]}`);
    continue;
  }
  try {
    execSync(`taskkill /PID ${pid} /F`, { stdio: 'ignore' });
    console.log(`Đã dừng node PID ${pid}.`);
  } catch (error) {
    console.log(`Không dừng được PID ${pid}: ${error.message}`);
  }
}
console.log('Xong. Chạy lại bằng: npm start');
