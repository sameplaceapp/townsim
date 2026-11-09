const fs = require('node:fs');
const net = require('node:net');

// Docker's bridge may forward host-published connections from its gateway.
function dockerGateway(routeTable) {
  for (const line of routeTable.trim().split('\n').slice(1)) {
    const fields = line.trim().split(/\s+/);
    if (fields[1] !== '00000000' || !/^[0-9a-f]{8}$/i.test(fields[2] || '') || !(parseInt(fields[3], 16) & 2)) continue;
    const hex = fields[2];
    return [6, 4, 2, 0].map(i => parseInt(hex.slice(i, i + 2), 16)).join('.');
  }
  return null;
}

function trustedDockerGateway() {
  const bindAddress = process.env.WILLOWBROOK_BACKUP_BIND_ADDRESS;
  if (process.env.WILLOWBROOK_BACKUP_DOCKER_GATEWAY !== '1' || !fs.existsSync('/.dockerenv') ||
      (bindAddress !== '127.0.0.1' && !isPrivateIPv4(bindAddress))) return null;
  try { return dockerGateway(fs.readFileSync('/proc/net/route', 'utf8')); }
  catch (_) { return null; }
}

function isPrivateIPv4(address) {
  if (net.isIP(address || '') !== 4) return false;
  const [a, b] = address.split('.').map(Number);
  return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
}

module.exports = { dockerGateway, trustedDockerGateway, isPrivateIPv4 };
