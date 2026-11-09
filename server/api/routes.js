const express = require('express');
const router = express.Router();
const { exportWorld, backupFilename } = require('../backup/export');
const { trustedDockerGateway, isPrivateIPv4 } = require('../backup/dockerGateway');
const dockerGateway = trustedDockerGateway();

// Backups contain private world history. Docker LAN access is accepted only
// for the explicitly configured private bind address, with no proxy headers.
router.post('/backup', (req, res) => {
  res.set('Cache-Control', 'no-store');
  const peer = req.socket.remoteAddress;
  const normalizedPeer = peer?.replace(/^::ffff:/, '');
  const localPeer = ['127.0.0.1', '::1'].includes(normalizedPeer);
  const dockerPeer = !!dockerGateway && (normalizedPeer === dockerGateway || isPrivateIPv4(normalizedPeer));
  const host = req.get('host');
  let localOrigin = false;
  try {
    const origin = new URL(req.get('origin'));
    const loopback = localPeer && ['localhost', '127.0.0.1', '[::1]'].includes(origin.hostname);
    const configuredBind = process.env.WILLOWBROOK_BACKUP_BIND_ADDRESS;
    const dockerOrigin = dockerPeer && origin.hostname === configuredBind &&
      (configuredBind === '127.0.0.1' || isPrivateIPv4(configuredBind));
    localOrigin = origin.protocol === 'http:' && origin.host === host && (loopback || dockerOrigin);
  } catch (_) { /* Missing or invalid Origin is not a local browser request. */ }
  const forwarded = Object.keys(req.headers).some(h => h === 'forwarded' || h.startsWith('x-forwarded-'));
  if (!localOrigin || forwarded || req.get('x-willowbrook-backup') !== '1') {
    return res.status(403).json({ error: 'Backup downloads require a direct connection to the configured private address.' });
  }
  try {
    const created = new Date();
    const backup = exportWorld(req.app.get('engine'), created);
    res.set('Content-Disposition', `attachment; filename="${backupFilename(created)}"`);
    res.set('X-Content-Type-Options', 'nosniff');
    return res.type('application/json').send(backup);
  } catch (err) {
    console.error('Backup export failed:', err.message);
    return res.status(503).json({ error: 'Unable to create a complete world backup.' });
  }
});

router.get('/state', (req, res) => {
  const engine = req.app.get('engine');
  res.json(engine.getState());
});

router.get('/characters', (req, res) => {
  const engine = req.app.get('engine');
  const chars = engine.world.characters.map(c => c.toSummary());
  res.json(chars);
});

router.get('/character/:id', (req, res) => {
  const engine = req.app.get('engine');
  const char = engine.world.characters.find(c => c.id === req.params.id);
  if (!char) return res.status(404).json({ error: 'Character not found' });
  res.json(char.toDetail());
});

router.get('/log', (req, res) => {
  const engine = req.app.get('engine');
  res.json(engine.world.activityLog);
});

router.get('/config', (req, res) => {
  const engine = req.app.get('engine');
  const cfg = { ...engine.config };
  if (cfg.llm) {
    cfg.llm = { ...cfg.llm, apiKey: '***' };
  }
  res.json(cfg);
});

router.post('/speed', (req, res) => {
  const engine = req.app.get('engine');
  const { speed } = req.body;
  if (![0, 1, 2, 5].includes(speed)) {
    return res.status(400).json({ error: 'Speed must be 0, 1, 2, or 5' });
  }
  engine.setSpeed(speed);
  res.json({ speed });
});

router.post('/pause', (req, res) => {
  const engine = req.app.get('engine');
  engine.togglePause();
  res.json({ paused: engine.paused });
});

router.get('/stats', (req, res) => {
  const engine = req.app.get('engine');
  res.json(engine.getStats());
});

router.get('/drama', (req, res) => {
  const engine = req.app.get('engine');
  res.json({
    townMood: engine.dramaEngine.townMood,
    activeStorylines: engine.dramaEngine.activeStorylines,
    gossipNetwork: engine.dramaEngine.gossipNetwork,
    characterDrama: engine.dramaEngine.characterDrama
  });
});

module.exports = router;
