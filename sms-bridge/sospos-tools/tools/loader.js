const fs   = require('fs');
const path = require('path');

const registry = [];

function loadTools(app) {
  const toolsDir = __dirname;
  const folders  = fs.readdirSync(toolsDir).filter(name => {
    const full = path.join(toolsDir, name);
    return fs.statSync(full).isDirectory() && fs.existsSync(path.join(full, 'index.js'));
  });

  for (const folder of folders) {
    try {
      const tool = require(path.join(toolsDir, folder, 'index.js'));
      if (!tool.name || !tool.router) {
        console.warn(`[tools] Skipping "${folder}" — missing name or router`);
        continue;
      }
      const mountPath = `/api/tools/${folder}`;
      app.use(mountPath, tool.router);
      registry.push({ id: folder, name: tool.name, description: tool.description || '',
        version: tool.version || '1.0.0', endpoints: tool.endpoints || [], mountPath,
        loadedAt: new Date().toISOString() });
      console.log(`[tools] Loaded "${tool.name}" → ${mountPath}`);
    } catch (err) {
      console.error(`[tools] Failed to load "${folder}":`, err.message);
    }
  }
  console.log(`[tools] ${registry.length} tool(s) active`);
}

function getRegistry() { return registry; }

module.exports = { loadTools, getRegistry };
