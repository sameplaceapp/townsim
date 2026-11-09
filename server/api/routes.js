const express = require('express');
const router = express.Router();
const { exportWorld, backupFilename } = require('../backup/export');

// Backups contain private world history. Only a direct local browser may
// request one; forwarded/proxied and cross-origin requests are not accepted.
router.post('/backup', (req, res) => {
  res.set('Cache-Control', 'no-store');
  const peer = req.socket.remoteAddress;
  const localPeer = ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(peer);
  const host = req.get('host');
  let localOrigin = false;
  try {
    const origin = new URL(req.get('origin'));
    localOrigin = origin.protocol === 'http:' && origin.host === host &&
      ['localhost', '127.0.0.1', '[::1]'].includes(origin.hostname);
  } catch (_) { /* Missing or invalid Origin is not a local browser request. */ }
  const forwarded = Object.keys(req.headers).some(h => h === 'forwarded' || h.startsWith('x-forwarded-'));
  if (!localPeer || !localOrigin || forwarded || req.get('x-willowbrook-backup') !== '1') {
    return res.status(403).json({ error: 'Backup downloads require a direct local browser connection.' });
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
