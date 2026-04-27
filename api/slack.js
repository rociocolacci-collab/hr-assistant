const { waitUntil } = require('@vercel/functions');
const { WebClient } = require('@slack/web-api');
const { Client: NotionClient } = require('@notionhq/client');
const Anthropic = require('@anthropic-ai/sdk');

const slack = new WebClient(process.env.SLACK_TOKEN);
const notionClient = new NotionClient({ auth: process.env.NOTION_TOKEN });
const anthropic = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });

const NOTION_DB_IDS = {
  HR_REQUESTS: process.env.NOTION_HR_REQUESTS_ID,
  INTERACTIONS_LOG: process.env.NOTION_INTERACTIONS_LOG_ID,
};

// HR page IDs in Notion — bot reads these live on every question
const HR_PAGE_IDS = [
  '26ff3ed090a480debaebdd96c4fa8b7c', // Time Off
  '271f3ed090a48061a4b7cafff6cc4c98', // Parental Leave
  '271f3ed090a480a8af28dae5feb8e6cd', // Benefits
  '328f3ed090a481a0858aec4e2c81058f', // Payroll & Reimbursements
  '310f3ed090a480429655ea7efcf06060', // Office & Equipment Request
];

// ==================== NOTION ====================

/**
 * Extract plain text from Notion blocks
 */
function extractTextFromBlocks(blocks) {
  const lines = [];
  for (const block of blocks) {
    const type = block.type;
    const content = block[type];
    if (!content) continue;

    const richText = content.rich_text || [];
    const text = richText.map((t) => t.plain_text).join('');

    if (text) {
      if (type === 'heading_1' || type === 'heading_2' || type === 'heading_3') {
        lines.push(`\n### ${text}`);
      } else if (type === 'bulleted_list_item' || type === 'numbered_list_item') {
        lines.push(`- ${text}`);
      } else if (type === 'callout') {
        lines.push(`> ${text}`);
      } else if (type === 'table_row') {
        const cells = (content.cells || []).map((cell) =>
          cell.map((t) => t.plain_text).join('')
        );
        lines.push(cells.join(' | '));
      } else {
        lines.push(text);
      }
    }

    if (block.has_children && block.children) {
      lines.push(...extractTextFromBlocks(block.children));
    }
  }
  return lines;
}

/**
 * Fetch all blocks from a Notion page (handles pagination)
 */
async function fetchPageBlocks(pageId) {
  const blocks = [];
  let cursor;
  do {
    const res = await notionClient.blocks.children.list({
      block_id: pageId,
      start_cursor: cursor,
      page_size: 100,
    });
    blocks.push(...res.results);
    cursor = res.has_more ? res.next_cursor : undefined;
  } while (cursor);
  return blocks;
}

/**
 * Fetch live HR knowledge from Notion — called on every question
 */
async function fetchHRKnowledge() {
  const pages = [];
  await Promise.all(
    HR_PAGE_IDS.map(async (pageId) => {
      try {
        const [pageMeta, blocks] = await Promise.all([
          notionClient.pages.retrieve({ page_id: pageId }),
          fetchPageBlocks(pageId),
        ]);

        const title =
          pageMeta.properties?.title?.title?.[0]?.plain_text ||
          pageMeta.properties?.Page?.title?.[0]?.plain_text ||
          pageMeta.properties?.Name?.title?.[0]?.plain_text ||
          'HR Policy';

        const content = extractTextFromBlocks(blocks).join('\n').trim();

        pages.push({ title, content, url: `https://www.notion.so/${pageId}` });
      } catch (err) {
        console.error(`Failed to fetch Notion page ${pageId}:`, err.message);
      }
    })
  );
  return pages;
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

async function generateAnswer(question, hrPages) {
  const knowledgeContext = hrPages.length > 0
    ? hrPages.map((p) => `=== ${p.title.toUpperCase()} ===\n${p.content}\nURL: ${p.url}`).join('\n\n')
    : 'No HR content could be loaded from Notion at this time.';

  const message = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 500,
    system: `You are the People Assistant at dotCMS, answering HR questions in Slack.

The following HR knowledge comes directly from the dotCMS Notion wiki and is always up to date:

${knowledgeContext}

Formatting rules (Slack mrkdwn):
- Use *bold* (single asterisk), not **bold**
- Never use # or ## headers
- Use bullet points with • or -
- Keep responses concise and conversational
- Always answer from the knowledge above
- For questions not covered, suggest contacting People & Culture directly`,
    messages: [{ role: 'user', content: question }],
  });

  const raw = message.content[0]?.type === 'text'
    ? message.content[0].text
    : 'I encountered an error. Please contact HR directly.';

  return raw
    .replace(/\*\*(.*?)\*\*/g, '*$1*')
    .replace(/^#{1,3}\s+/gm, '')
    .replace(/\[(.*?)\]\((.*?)\)/g, '<$2|$1>');
}

// ==================== EVENT HANDLER ====================

async function handleAppMention(event) {
  if (event.bot_id || event.bot_profile) return;

  const question = event.text.replace(/<@[^>]+>/g, '').trim();
  if (!question) return;

  console.log('Processing question:', question);

  const hrPages = await fetchHRKnowledge();
  const answer = await generateAnswer(question, hrPages);

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
    foundAnswer: hrPages.length > 0,
  });
}

// ==================== BUTTON HANDLERS ====================

async function handleSubmitRequest(payload) {
  await slack.views.open({
    trigger_id: payload.trigger_id,
    view: {
      type: 'modal',
      callback_id: 'hr_request_modal',
      title: { type: 'plain_text', text: 'HR Request' },
      submit: { type: 'plain_text', text: 'Submit' },
      close: { type: 'plain_text', text: 'Cancel' },
      blocks: [
        {
          type: 'input',
          block_id: 'request_type_block',
          label: { type: 'plain_text', text: 'Request Type' },
          element: {
            type: 'static_select',
            action_id: 'request_type_action',
            placeholder: { type: 'plain_text', text: 'Select a type' },
            options: [
              { text: { type: 'plain_text', text: 'Employment Verification' }, value: 'employment_verification' },
              { text: { type: 'plain_text', text: 'Salary Certificate' }, value: 'salary_certificate' },
              { text: { type: 'plain_text', text: 'Document Request' }, value: 'document_request' },
              { text: { type: 'plain_text', text: 'Policy Clarification' }, value: 'policy_clarification' },
              { text: { type: 'plain_text', text: 'Benefits Question' }, value: 'benefits_question' },
              { text: { type: 'plain_text', text: 'Other' }, value: 'other' },
            ],
          },
        },
        {
          type: 'input',
          block_id: 'details_block',
          label: { type: 'plain_text', text: 'Details' },
          element: {
            type: 'plain_text_input',
            action_id: 'details_action',
            multiline: true,
            placeholder: { type: 'plain_text', text: 'Describe your request...' },
          },
        },
        {
          type: 'input',
          block_id: 'deadline_block',
          label: { type: 'plain_text', text: 'Deadline (optional)' },
          optional: true,
          element: {
            type: 'plain_text_input',
            action_id: 'deadline_action',
            placeholder: { type: 'plain_text', text: 'e.g. End of week' },
          },
        },
      ],
    },
  });
}

async function handleEscalate(payload) {
  const userId = payload.user.id;
  const hrChannel = process.env.SLACK_HR_CHANNEL;

  if (hrChannel) {
    await slack.chat.postMessage({
      channel: hrChannel,
      text: `*Escalation Request*\nUser <@${userId}> needs HR assistance.`,
    });
  }

  await slack.chat.postEphemeral({
    channel: payload.channel?.id || userId,
    user: userId,
    text: '✅ Your request has been sent to HR. They will reach out to you soon.',
  });
}

// ==================== VERCEL HANDLER ====================

module.exports = async (req, res) => {
  const body = req.body;

  if (body?.type === 'url_verification') {
    return res.status(200).json({ challenge: body.challenge });
  }

  if (body?.type === 'block_actions') {
    const action = body.actions?.[0];
    if (action?.action_id === 'submit_hr_request') {
      waitUntil(handleSubmitRequest(body).catch((err) => console.error('handleSubmitRequest error:', err.message)));
    }
    if (action?.action_id === 'escalate_to_hr') {
      waitUntil(handleEscalate(body).catch((err) => console.error('handleEscalate error:', err.message)));
    }
    return res.status(200).send();
  }

  const event = body?.event;

  if (event?.type === 'app_mention') {
    waitUntil(
      handleAppMention(event).catch((err) =>
        console.error('handleAppMention error:', err.message)
      )
    );
  }

  if (event?.type === 'message' && event.channel_type === 'im' && !event.bot_id && !event.subtype) {
    waitUntil(
      handleAppMention(event).catch((err) =>
        console.error('handleDM error:', err.message)
      )
    );
  }

  return res.status(200).send();
};
