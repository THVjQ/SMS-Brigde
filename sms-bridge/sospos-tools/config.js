const path = require('path');

// Single source of truth for where persistent state lives, so the database and the server keypair
// can never end up on opposite sides of the container's volume mount. Defaults to the app
// directory for a bare `node server.js`; the Docker deployment sets DB_DIR to a mounted dataset.
const DATA_DIR = process.env.DB_DIR || __dirname;

module.exports = {
  DATA_DIR,
  DB_FILE:  path.join(DATA_DIR, 'sms-bridge.db'),
  KEYS_DIR: path.join(DATA_DIR, '.keys'),
};
