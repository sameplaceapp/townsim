require('dotenv').config();
const express = require('express');
const http = require('http');
const path = require('path');
const config = require('../config/default.json');
const { setupWebSocket } = require('./api/websocket');
const { SimulationEngine } = require('./simulation/engine');

const app = express();
const server = http.createServer(app);
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));

// API routes
const apiRoutes = require('./api/routes');
app.use('/api', apiRoutes);

// WebSocket setup
const wss = setupWebSocket(server);

// Simulation engine
const engine = new SimulationEngine(config, wss);

// Make engine accessible to API routes
app.set('engine', engine);

// Start simulation
engine.start();

// Graceful shutdown
function shutdown() {
  console.log('Shutting down...');
  engine.stop();
  engine.save();
  server.close(() => {
    console.log('Server closed.');
    process.exit(0);
  });
  setTimeout(() => process.exit(0), 3000);
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

server.listen(PORT, () => {
  console.log(`TownSim running at http://localhost:${PORT}`);
  console.log(`Tick interval: ${config.simulation.tickInterval}ms`);
});
