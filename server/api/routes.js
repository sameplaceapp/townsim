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

router.post('/welcome-back', (req, res) => {
  const engine = req.app.get('engine');
  engine.sync();
  const current = engine.getVisitMarker();
  const previous = req.body?.previous;
  if (previous == null || previous.worldId !== current.worldId) return res.json({ mode:'first', marker:current });
  const t = previous.time;
  if (!t || !Number.isSafeInteger(t.day) || t.day < 1 || !Number.isInteger(t.hour) || t.hour < 0 || t.hour > 23 ||
      !Number.isInteger(t.minute) || t.minute < 0 || t.minute > 59 ||
      !(previous.lastEventId === null || (typeof previous.lastEventId === 'string' && previous.lastEventId.length <= 128))) {
    return res.status(400).json({ error:'Invalid visit marker' });
  }
  const minutes = time => ((time.day - 1) * 24 + time.hour) * 60 + time.minute;
  const elapsed = minutes(current.time) - minutes(t);
  const history = engine.history.since(previous.lastEventId);
  if (elapsed < 0 || history === null) return res.json({ mode:'first', marker:current });
  res.json({ mode:'return', marker:current, elapsedMinutes:elapsed, count:history.count, events:history.events });
});

router.get('/history', (req, res) => {
  const { type, entity, kind, limit = '50', offset = '0', order, before, fromDay, toDay } = req.query;
  if (typeof limit !== 'string' || !/^\d+$/.test(limit) ||
      typeof offset !== 'string' || !/^\d+$/.test(offset) ||
      [before, fromDay, toDay].some(v => v !== undefined && (typeof v !== 'string' || !/^\d+$/.test(v)))) {
    return res.status(400).json({ error: 'Invalid history query' });
  }
  try {
    res.json(req.app.get('engine').history.query({ type, entity, kind, limit: Number(limit), offset: Number(offset),
      order, before: before === undefined ? undefined : Number(before),
      fromDay: fromDay === undefined ? undefined : Number(fromDay), toDay: toDay === undefined ? undefined : Number(toDay) }));
  } catch (err) {
    if (err instanceof TypeError) return res.status(400).json({ error: 'Invalid history query' });
    throw err;
  }
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
