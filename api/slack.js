const { WebClient } = require('@slack/web-api');
const { Client: NotionClient } = require('@notionhq/client');
const Anthropic = require('@anthropic-ai/sdk');
const crypto = require('crypto');

const slack = new WebClient(process.env.SLACK_TOKEN);
const notionClient = new NotionClient({ auth: process.env.NOTION_TOKEN });
const anthropic = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });

const NOTION_DB_IDS = {
  HR_KNOWLEDGE: process.env.NOTION_HR_KB_ID,
  HR_REQUESTS: process.env.NOTION_HR_REQUESTS_ID,
  INTERACTIONS_LOG: process.env.NOTION_INTERACTIONS_LOG_ID,
};

// ==================== SIGNATURE VERIFICATION ====================

function verifySlackSignature(rawBody, headers) {
  const timestamp = headers['x-slack-request-timestamp'];
  const slackSig = headers['x-slack-signature'];
  if (!timestamp || !slackSig) return false;
  if (Math.abs(Date.now() / 1000 - Number(timestamp)) > 300) return false;

  const sig = 'v0=' + crypto
    .createHmac('sha256', process.env.SLACK_SIGNING_SECRET)
    .update(`v0:${timestamp}:${rawBody}`)
    .digest('hex');

  try {
    return crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(slackSig));
  } catch {
    return false;
  }
}

// ==================== NOTION HELPERS ====================

async function fetchHRKnowledge(query) {
  if (!query || !NOTION_DB_IDS.HR_KNOWLEDGE) return [];
  try {
    const response = await notionClient.databases.query({
      database_id: NOTION_DB_IDS.HR_KNOWLEDGE,
      filter: {
        or: [
          { property: 'Title', rich_text: { contains: query } },
          { property: 'Content', rich_text: { contains: query } },
          { property: 'Tags', multi_select: { contains: query } },
        ],
      },
    });
    return response.results.map((page) => ({
      title: page.properties.Title?.title?.[0]?.plain_text || '',
      content: page.properties.Content?.rich_text?.[0]?.plain_text || '',
      url: page.public_url || `https://notion.so/${page.id.replace(/-/g, '')}`,
    }));
  } catch (err) {
    console.error('Notion fetchHRKnowledge error:', err.message);
    return [];
  }
}

async function logInteraction(data) {
  if (!NOTION_DB_IDS.INTERACTIONS_LOG) return;
  try {
    await notionClient.pages.create({
      parent: { database_id: NOTION_DB_IDS.INTERACTIONS_LOG },
      properties: {
        'User ID': { rich_text: [{ text: { content: data.userId } }] },
        'Question': { rich_text: [{ text: { content: data.question.slice(0, 2000) } }] },
        'Response': { rich_text: [{ text: { content: data.response.slice(0, 2000) } }] },
        'Timestamp': { date: { start: new Date().toISOString() } },
        'Type': { select: { name: data.type } },
        'Found Answer': { checkbox: data.foundAnswer },
      },
    });
  } catch (err) {
    console.error('Notion logInteraction error:', err.message);
  }
}

// ==================== CLAUDE ====================

async function generateAnswer(question, knowledge) {
  const knowledgeContext = knowledge
    .map((item) => `Title: ${item.title}\nContent: ${item.content}\nURL: ${item.url}`)
    .join('\n\n---\n\n');

  const message = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 500,
    system: `You are a helpful HR Assistant for a company. Answer questions about HR policies, benefits, PTO, onboarding, and other HR topics.
${knowledgeContext ? `\nKNOWLEDGE BASE:\n${knowledgeContext}` : ''}
Rules:
- Be concise and professional
- If the answer is in the knowledge base, include relevant links
- If not found, say so and suggest contacting HR directly
- Do not make up policies`,
    messages: [{ role: 'user', content: question }],
  });

  return message.content[0]?.type === 'text' ? message.content[0].text : 'I encountered an error. Please contact HR directly.';
}

// ==================== EVENT HANDLERS ====================

async function handleAppMention(event) {
  // Ignore messages from bots (prevents loops)
  if (event.bot_id || event.bot_profile) return;

  const question = event.text.replace(/<@[^>]+>/g, '').trim();
  if (!question) return;

  const knowledge = await fetchHRKnowledge(question);
  const answer = await generateAnswer(question, knowledge);

  await slack.chat.postMessage({
    channel: event.channel,
    thread_ts: event.ts,
    text: answer,
    blocks: [
      {
        type: 'section',
        text: { type: 'mrkdwn', text: answer },
      },
      {
        type: 'actions',
        elements: [
          {
            type: 'button',
            text: { type: 'plain_text', text: 'Submit HR Request' },
            value: 'submit_request',
            action_id: 'submit_hr_request',
          },
          {
            type: 'button',
            text: { type: 'plain_text', text: 'Talk to HR' },
            value: 'escalate',
            action_id: 'escalate_to_hr',
          },
        ],
      },
    ],
  });

  logInteraction({
    userId: event.user,
    question,
    response: answer,
    type: 'question',
    foundAnswer: knowledge.length > 0,
  }).catch((err) => console.error('logInteraction failed:', err.message));
}

// ==================== VERCEL HANDLER ====================

const handler = async (req, res) => {
  // Read raw body (required for signature verification)
  const rawBody = await new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => { data += chunk; });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });

  let payload;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return res.status(400).send('Invalid JSON');
  }

  // URL verification (no signature check needed)
  if (payload.type === 'url_verification') {
    return res.status(200).json({ challenge: payload.challenge });
  }

  // Verify Slack signature for all other requests
  if (!verifySlackSignature(rawBody, req.headers)) {
    return res.status(401).send('Unauthorized');
  }

  const event = payload.event;
  if (!event) return res.status(200).send();

  // Respond immediately so Slack doesn't retry (must be within 3s)
  res.status(200).send();

  // Process event asynchronously — awaiting keeps the Vercel function alive
  if (event.type === 'app_mention') {
    await handleAppMention(event).catch((err) =>
      console.error('handleAppMention error:', err.message)
    );
  }
};

// Disable Vercel body parser — we read raw body manually for signature verification
handler.config = { api: { bodyParser: false } };

module.exports = handler;
