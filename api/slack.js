const { waitUntil } = require('@vercel/functions');
const { WebClient } = require('@slack/web-api');
const { Client: NotionClient } = require('@notionhq/client');
const Anthropic = require('@anthropic-ai/sdk');

const slack = new WebClient(process.env.SLACK_TOKEN);
const notionClient = new NotionClient({ auth: process.env.NOTION_TOKEN });
const anthropic = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });

const NOTION_DB_IDS = {
  HR_KNOWLEDGE: process.env.NOTION_HR_KB_ID,
  HR_REQUESTS: process.env.NOTION_HR_REQUESTS_ID,
  INTERACTIONS_LOG: process.env.NOTION_INTERACTIONS_LOG_ID,
};

// ==================== NOTION ====================

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
    console.error('Failed to fetch HR knowledge:', err.message);
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
    console.error('Failed to log interaction:', err.message);
  }
}

// ==================== CLAUDE ====================

async function generateAnswer(question, knowledge) {
  const knowledgeContext = knowledge
    .map((k) => `Title: ${k.title}\nContent: ${k.content}\nURL: ${k.url}`)
    .join('\n\n---\n\n');

  const message = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 500,
    system: `You are a helpful HR Assistant. Answer questions about HR policies, benefits, PTO, onboarding, and other HR topics.
${knowledgeContext ? `\nKNOWLEDGE BASE:\n${knowledgeContext}` : ''}
Rules: be concise and professional. If not found in knowledge base, suggest contacting HR directly. Do not invent policies.`,
    messages: [{ role: 'user', content: question }],
  });

  return message.content[0]?.type === 'text'
    ? message.content[0].text
    : 'I encountered an error. Please contact HR directly.';
}

// ==================== EVENT HANDLER ====================

async function handleAppMention(event) {
  if (event.bot_id || event.bot_profile) return;

  const question = event.text.replace(/<@[^>]+>/g, '').trim();
  if (!question) return;

  console.log('Processing app_mention:', question);

  const knowledge = await fetchHRKnowledge(question);
  const answer = await generateAnswer(question, knowledge);

  await slack.chat.postMessage({
    channel: event.channel,
    thread_ts: event.ts,
    text: answer,
    blocks: [
      { type: 'section', text: { type: 'mrkdwn', text: answer } },
      {
        type: 'actions',
        elements: [
          {
            type: 'button',
            text: { type: 'plain_text', text: 'Submit HR Request' },
            action_id: 'submit_hr_request',
          },
          {
            type: 'button',
            text: { type: 'plain_text', text: 'Talk to HR' },
            action_id: 'escalate_to_hr',
          },
        ],
      },
    ],
  });

  await logInteraction({
    userId: event.user,
    question,
    response: answer,
    type: 'question',
    foundAnswer: knowledge.length > 0,
  });
}

// ==================== VERCEL HANDLER ====================

module.exports = async (req, res) => {
  const body = req.body;

  if (body?.type === 'url_verification') {
    return res.status(200).json({ challenge: body.challenge });
  }

  const event = body?.event;

  if (event?.type === 'app_mention') {
    // waitUntil keeps the Vercel function alive after res.send()
    waitUntil(
      handleAppMention(event).catch((err) =>
        console.error('handleAppMention error:', err.message)
      )
    );
  }

  return res.status(200).send();
};
