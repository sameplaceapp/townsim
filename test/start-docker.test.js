const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const launcher = path.join(__dirname, '../scripts/start-docker.sh');

function setup() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'willow-launcher-'));
  const write = (name, body) => fs.writeFileSync(path.join(dir, name), `#!/bin/sh\n${body}\n`, { mode: 0o755 });
  write('ip', '[ "${TEST_NO_ROUTE:-}" = 1 ] && exit 1; case "$*" in "-4 route show default") echo "default via ignored dev eth-test";; "-o -4 addr show dev eth-test scope global") echo "2: eth-test inet $TEST_IP/24";; *) exit 1;; esac');
  write('hostname', '[ -n "${TEST_HOSTNAME_IPS:-}" ] || exit 1; printf "%s\\n" "$TEST_HOSTNAME_IPS"');
  write('route', 'exit 1');
  write('ipconfig', 'exit 1');
  write('docker', 'printf "%s\\n%s\\n" "$WILLOWBROOK_BIND_ADDRESS" "$*" > "$TEST_CAPTURE"');
  const env = { ...process.env, PATH: `${dir}:/usr/bin:/bin`, TEST_IP:'10.23.45.67', TEST_CAPTURE:path.join(dir,'capture') };
  delete env.WILLOWBROOK_BIND_ADDRESS;
  const run = () => spawnSync('sh', [launcher], { env, encoding:'utf8' });
  return { dir, env, run };
}

test('Docker launcher discovers the private default-interface address', () => {
  const t = setup();
  try {
    const result = t.run();
    assert.equal(result.status, 0, result.stderr);
    assert.equal(fs.readFileSync(t.env.TEST_CAPTURE, 'utf8'), `${t.env.TEST_IP}\ncompose up -d --build\n`);
    assert.match(result.stdout, /:3000/);
  } finally { fs.rmSync(t.dir, { recursive:true, force:true }); }
});

test('Docker launcher falls back to host addresses or accepts a private override', () => {
  const t = setup();
  try {
    t.env.TEST_NO_ROUTE = '1';
    t.env.TEST_HOSTNAME_IPS = '10.4.5.6';
    assert.equal(t.run().status, 0);
    assert.match(fs.readFileSync(t.env.TEST_CAPTURE, 'utf8'), /^10\.4\.5\.6\n/);
    t.env.WILLOWBROOK_BIND_ADDRESS = '172.20.1.5';
    assert.equal(t.run().status, 0);
    assert.match(fs.readFileSync(t.env.TEST_CAPTURE, 'utf8'), /^172\.20\.1\.5\n/);
  } finally { fs.rmSync(t.dir, { recursive:true, force:true }); }
});

test('Docker launcher rejects public and malformed addresses before starting Docker', () => {
  const t = setup();
  try {
    for (const address of ['0.0.0.0', '8.8.8.8', '10.001.2.3']) {
      t.env.WILLOWBROOK_BIND_ADDRESS = address;
      assert.notEqual(t.run().status, 0);
      assert.equal(fs.existsSync(t.env.TEST_CAPTURE), false);
    }
    delete t.env.WILLOWBROOK_BIND_ADDRESS;
    t.env.TEST_IP = '8.8.8.8';
    assert.notEqual(t.run().status, 0);
    assert.equal(fs.existsSync(t.env.TEST_CAPTURE), false);
  } finally { fs.rmSync(t.dir, { recursive:true, force:true }); }
});
