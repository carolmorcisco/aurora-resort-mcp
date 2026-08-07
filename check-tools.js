import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const client = new Client({
  name: 'aurora-schema-check',
  version: '1.0.0',
});

const transport = new StreamableHTTPClientTransport(
  new URL('http://localhost:3000/mcp'),
  {
    requestInit: {
      headers: {
        'x-api-key': 'aurora-demo-2026',
      },
    },
  }
);

await client.connect(transport);

const result = await client.listTools();

console.dir(result, {
  depth: null,
  colors: true,
});

await client.close();