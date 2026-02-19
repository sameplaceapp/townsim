const express = require('express');
const router = express.Router();

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
