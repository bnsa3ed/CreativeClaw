import { createServer } from 'node:http';
import { mergeConfig } from '../../../packages/core/src/index.js';
import { ToolRegistry } from '../../../packages/tool-registry/src/index.js';
import { MemoryStore } from '../../../packages/memory/src/index.js';
import { AdobeConnectorHub } from '../../../packages/connectors-adobe/src/index.js';

const config = mergeConfig({});
const tools = new ToolRegistry();
const memory = new MemoryStore();
const connectors = new AdobeConnectorHub();

tools.register({
  name: 'search_tools',
  description: 'Discover tools progressively by query and detail level',
  risk: 'low',
  schema: { query: 'string', detail_level: 'name_only|name_description|full_schema' }
});

const server = createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true, app: 'creativeclaw-gateway' }));
    return;
  }
  if (req.url?.startsWith('/tools')) {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(tools.list()));
    return;
  }
  if (req.url?.startsWith('/connectors/health')) {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(connectors.health()));
    return;
  }
  if (req.url?.startsWith('/memory/demo')) {
    memory.remember({ editType: 'trim_clip', projectId: 'demo', confidence: 0.8, timestamp: Date.now(), signals: { shotLength: 2.4 } });
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(memory.aggregate('demo')));
    return;
  }

  res.writeHead(404, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ error: 'not_found' }));
});

server.listen(config.gateway.port, config.gateway.host, () => {
  console.log(`CreativeClaw gateway running at http://${config.gateway.host}:${config.gateway.port}`);
});
