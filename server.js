import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createMcpExpressApp } from '@modelcontextprotocol/sdk/server/express.js';
import { z } from 'zod';

const {
  AIRTABLE_TOKEN,
  AIRTABLE_BASE_ID,
  AIRTABLE_USERS_TABLE,
  AIRTABLE_RESERVATIONS_TABLE,
  PORT = '3000',
} = process.env;

function requireEnv() {
  const missing = [];

  if (!AIRTABLE_TOKEN) missing.push('AIRTABLE_TOKEN');
  if (!AIRTABLE_BASE_ID) missing.push('AIRTABLE_BASE_ID');
  if (!AIRTABLE_USERS_TABLE) missing.push('AIRTABLE_USERS_TABLE');
  if (!AIRTABLE_RESERVATIONS_TABLE) {
    missing.push('AIRTABLE_RESERVATIONS_TABLE');
  }

  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variables: ${missing.join(', ')}`
    );
  }
}

function airtableUrl(tableId) {
  return `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${tableId}`;
}

async function airtableRequest(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${AIRTABLE_TOKEN}`,
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });

  const data = await response.json();

  if (!response.ok) {
    console.error('Airtable error:', data);

    throw new Error(
      data?.error?.message ||
        data?.error?.type ||
        `Airtable request failed with status ${response.status}`
    );
  }

  return data;
}

async function findGuestByName(guestName) {
  const formula = `{Name}="${guestName.replaceAll('"', '\\"')}"`;

  const url =
    `${airtableUrl(AIRTABLE_USERS_TABLE)}` +
    `?maxRecords=1&filterByFormula=${encodeURIComponent(formula)}`;

  const data = await airtableRequest(url);

  if (!data.records?.length) {
    return null;
  }

  return data.records[0];
}

function createServer() {
  const server = new McpServer({
    name: 'aurora-resort-mcp',
    version: '1.0.0',
  });

  server.registerTool(
    'fetch_user_profile',
    {
      title: 'Fetch Aurora Resort Guest Profile',
      description:
        'Find an Aurora Resort guest by name and return their saved guest preferences. Use this when a guest identifies themselves.',
      inputSchema: {
        guestName: z
          .string()
          .describe(
            'Full guest name, for example Alex Morgan.'
          ),
      },
    },
    async ({ guestName }) => {
      try {
        const record = await findGuestByName(guestName);

        if (!record) {
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  found: false,
                  message: `No guest profile found for ${guestName}.`,
                }),
              },
            ],
          };
        }

        const fields = record.fields;

        const profile = {
          found: true,
          recordId: record.id,
          name: fields.Name ?? guestName,
          guestType: fields['Guest Type'] ?? null,
          dietaryPreference:
            fields['Dietary Preference'] ?? null,
          activityPreference:
            fields['Activity Preference'] ?? null,
          roomPreference:
            fields['Room Preference'] ?? null,
          language: fields.Language ?? null,
          mobile: fields.Mobile ?? null,
          email: fields.Email ?? null,
        };

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(profile),
            },
          ],
          structuredContent: profile,
        };
      } catch (error) {
        console.error('fetch_user_profile failed:', error);

        return {
          isError: true,
          content: [
            {
              type: 'text',
              text: `Unable to fetch guest profile: ${error.message}`,
            },
          ],
        };
      }
    }
  );

  server.registerTool(
    'book_guest_experience',
    {
      title: 'Book Aurora Resort Guest Experience',
      description:
        'Create a confirmed Aurora Resort reservation for Dining, Activity, or Transportation and link it to the guest profile.',
      inputSchema: {
        guestName: z
          .string()
          .describe(
            'Full guest name associated with the reservation.'
          ),

        service: z
          .enum(['Dining', 'Activity', 'Transportation'])
          .describe(
            'Type of guest experience being booked.'
          ),

        serviceName: z
          .string()
          .describe(
            'Name of the restaurant, activity, or transportation service.'
          ),

        date: z
          .string()
          .describe(
            'Reservation date or demo-friendly date such as Saturday.'
          ),

        time: z
          .string()
          .describe(
            'Reservation time, for example 7:30 PM.'
          ),

        notes: z
          .string()
          .optional()
          .describe(
            'Optional reservation notes such as dietary preferences or pickup location.'
          ),
      },
    },
    async ({
      guestName,
      service,
      serviceName,
      date,
      time,
      notes,
    }) => {
      try {
        const guest = await findGuestByName(guestName);

        if (!guest) {
          return {
            isError: true,
            content: [
              {
                type: 'text',
                text: `Cannot create reservation because no guest profile was found for ${guestName}.`,
              },
            ],
          };
        }

        const prefixes = {
          Dining: 'DIN',
          Activity: 'ACT',
          Transportation: 'TRN',
        };

        const randomNumber = Math.floor(
          1000 + Math.random() * 9000
        );

        const confirmationNumber =
          `${prefixes[service]}-${randomNumber}`;

        const body = {
          records: [
            {
              fields: {
                'Confirmation Number':
                  confirmationNumber,

                Users: [guest.id],

                Service: service,

                'Service Name': serviceName,

                Date: date,

                Time: time,

                Status: 'Confirmed',

                Notes: notes ?? '',
              },
            },
          ],
        };

        const data = await airtableRequest(
          airtableUrl(AIRTABLE_RESERVATIONS_TABLE),
          {
            method: 'POST',
            body: JSON.stringify(body),
          }
        );

        const createdRecord = data.records?.[0];

        const result = {
          success: true,
          reservationId: createdRecord?.id ?? null,
          confirmationNumber,
          guestName,
          service,
          serviceName,
          date,
          time,
          status: 'Confirmed',
        };

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result),
            },
          ],
          structuredContent: result,
        };
      } catch (error) {
        console.error(
          'book_guest_experience failed:',
          error
        );

        return {
          isError: true,
          content: [
            {
              type: 'text',
              text: `Unable to create guest reservation: ${error.message}`,
            },
          ],
        };
      }
    }
  );

  return server;
}

requireEnv();

const app = createMcpExpressApp({
  host: '0.0.0.0',
});

app.get('/', (_req, res) => {
  res.json({
    service: 'Aurora Resort MCP',
    status: 'ok',
    tools: [
      'fetch_user_profile',
      'book_guest_experience',
    ],
  });
});

app.post('/mcp', async (req, res) => {
  const server = createServer();

  try {
    const transport =
      new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
      });

    await server.connect(transport);

    await transport.handleRequest(
      req,
      res,
      req.body
    );

    res.on('close', () => {
      transport.close();
      server.close();
    });
  } catch (error) {
    console.error('MCP request error:', error);

    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: '2.0',
        error: {
          code: -32603,
          message: 'Internal server error',
        },
        id: null,
      });
    }
  }
});

app.get('/mcp', (_req, res) => {
  res.status(405).json({
    error: 'Use POST /mcp',
  });
});

app.delete('/mcp', (_req, res) => {
  res.status(405).json({
    error: 'Method not allowed',
  });
});

app.listen(Number(PORT), '0.0.0.0', () => {
  console.log(
    `Aurora Resort MCP listening on port ${PORT}`
  );
});