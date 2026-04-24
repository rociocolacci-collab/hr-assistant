const { WebClient } = require('@slack/web-api');
const { Client: NotionClient } = require('@notionhq/client');
const Anthropic = require('@anthropic-ai/sdk');
const crypto = require('crypto');

// ==================== CONFIGURATION ====================

const slack = new WebClient(process.env.SLACK_TOKEN);

const notionClient = new NotionClient({
  auth: process.env.NOTION_TOKEN,
});

const anthropic = new Anthropic({
  apiKey: process.env.CLAUDE_API_KEY,
});

// Database IDs (from Notion)
const NOTION_DB_IDS = {
  HR_KNOWLEDGE: process.env.NOTION_HR_KB_ID,
  HR_REQUESTS: process.env.NOTION_HR_REQUESTS_ID,
  INTERACTIONS_LOG: process.env.NOTION_INTERACTIONS_LOG_ID,
};

// ==================== TYPES & INTERFACES ====================

/**
 * @typedef {Object} HRQuestion
 * @property {string} userId - Slack user ID
 * @property {string} channelId - Slack channel ID
 * @property {string} question - User's question
 * @property {string} timestamp - Message timestamp
 */

/**
 * @typedef {Object} HRRequest
 * @property {string} requestType - Type of request (e.g., employment_verification)
 * @property {Object} details - Form details collected from user
 * @property {string} userId - Slack user ID
 * @property {string} submissionTime - When request was submitted
 */

// ==================== UTILITY FUNCTIONS ====================

/**
 * Log interaction to Notion for analytics
 */
async function logInteraction(data) {
  try {
    await notionClient.pages.create({
      parent: { database_id: NOTION_DB_IDS.INTERACTIONS_LOG },
      properties: {
        'User ID': { rich_text: [{ text: { content: data.userId } }] },
        'Question': { rich_text: [{ text: { content: data.question } }] },
        'Response': { rich_text: [{ text: { content: data.response } }] },
        'Timestamp': { date: { start: new Date().toISOString() } },
        'Type': { select: { name: data.type } },
        'Found Answer': { checkbox: data.foundAnswer },
      },
    });
  } catch (error) {
    console.error('Failed to log interaction:', error);
  }
}

/**
 * Fetch HR knowledge base from Notion
 */
async function fetchHRKnowledge(query) {
  try {
    const response = await notionClient.databases.query({
      database_id: NOTION_DB_IDS.HR_KNOWLEDGE,
      filter: {
        or: [
          {
            property: 'Title',
            rich_text: { contains: query },
          },
          {
            property: 'Content',
            rich_text: { contains: query },
          },
          {
            property: 'Tags',
            multi_select: { contains: query },
          },
        ],
      },
    });

    return response.results.map((page) => ({
      id: page.id,
      title: page.properties.Title?.title?.[0]?.plain_text || '',
      content: page.properties.Content?.rich_text?.[0]?.plain_text || '',
      url: page.public_url || `https://notion.so/${page.id.replace(/-/g, '')}`,
      category: page.properties.Category?.select?.name,
      lastUpdated: page.last_edited_time,
    }));
  } catch (error) {
    console.error('Failed to fetch HR knowledge:', error);
    return [];
  }
}

/**
 * Use Claude to answer HR questions based on knowledge base
 */
async function answerHRQuestion(question, knowledgeBase) {
  try {
    const knowledgeContext = knowledgeBase
      .map((item) => `Title: ${item.title}\nContent: ${item.content}\nURL: ${item.url}`)
      .join('\n\n---\n\n');

    const message = await anthropic.messages.create({
      model: 'claude-opus-4-20250805',
      max_tokens: 500,
      system: `You are a helpful HR Assistant. Answer questions about HR policies, benefits, PTO, onboarding, and other HR-related topics based on the knowledge base provided.

KNOWLEDGE BASE:
${knowledgeContext}

Rules:
1. Be concise and professional
2. If the answer is found in the knowledge base, include the relevant links
3. If the answer is NOT found, be transparent and suggest next steps (e.g., contact HR@company.com)
4. Always maintain a helpful tone
5. Do not make up policies or information

When providing links, format them as: [Link Title](URL)`,
      messages: [
        {
          role: 'user',
          content: question,
        },
      ],
    });

    return message.content[0].type === 'text' ? message.content[0].text : '';
  } catch (error) {
    console.error('Failed to answer question with Claude:', error);
    return 'I encountered an error processing your question. Please contact HR directly.';
  }
}

// ==================== SLACK HANDLERS ====================

async function handleAppMention(event) {
  const question = event.text.replace(/<@[^>]+>/g, '').trim();

  const knowledge = await fetchHRKnowledge(question);
  const answer = await answerHRQuestion(
    question,
    knowledge.length > 0 ? knowledge : await fetchHRKnowledge('')
  );

  await logInteraction({
    userId: event.user,
    question,
    response: answer,
    type: 'question',
    foundAnswer: knowledge.length > 0,
  });

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
}

// ==================== NOTION OPERATIONS ====================

/**
 * Create HR request in Notion
 */
async function createHRRequest(hrRequest) {
  try {
    const response = await notionClient.pages.create({
      parent: { database_id: NOTION_DB_IDS.HR_REQUESTS },
      properties: {
        'Title': {
          title: [
            {
              text: {
                content: `${hrRequest.requestType} - ${new Date().toLocaleDateString()}`,
              },
            },
          ],
        },
        'User ID': { rich_text: [{ text: { content: hrRequest.userId } }] },
        'Request Type': { select: { name: hrRequest.requestType } },
        'Status': { select: { name: 'Pending' } },
        'Submission Date': { date: { start: new Date().toISOString() } },
        'Details': {
          rich_text: [
            {
              text: {
                content: JSON.stringify(hrRequest.details, null, 2),
              },
            },
          ],
        },
      },
    });

    return response.id;
  } catch (error) {
    console.error('Failed to create HR request:', error);
    throw error;
  }
}

// ==================== MODAL BUILDERS ====================

/**
 * Build HR Request Modal
 */
function createHRRequestModal() {
  return {
    type: 'modal',
    callback_id: 'hr_request_modal',
    title: {
      type: 'plain_text',
      text: 'HR Request',
      emoji: true,
    },
    submit: {
      type: 'plain_text',
      text: 'Submit',
      emoji: true,
    },
    close: {
      type: 'plain_text',
      text: 'Cancel',
      emoji: true,
    },
    blocks: [
      {
        type: 'header',
        text: {
          type: 'plain_text',
          text: 'What do you need help with?',
        },
      },
      {
        type: 'section',
        block_id: 'request_type_block',
        text: {
          type: 'mrkdwn',
          text: '*Request Type*',
        },
        accessory: {
          type: 'static_select',
          action_id: 'request_type_action',
          placeholder: {
            type: 'plain_text',
            text: 'Select a request type',
          },
          options: [
            {
              text: { type: 'plain_text', text: 'Employment Verification' },
              value: 'employment_verification',
            },
            {
              text: { type: 'plain_text', text: 'Salary Certificate' },
              value: 'salary_certificate',
            },
            {
              text: { type: 'plain_text', text: 'Document Request' },
              value: 'document_request',
            },
            {
              text: { type: 'plain_text', text: 'Policy Clarification' },
              value: 'policy_clarification',
            },
            {
              text: { type: 'plain_text', text: 'Benefits Question' },
              value: 'benefits_question',
            },
            {
              text: { type: 'plain_text', text: 'Other' },
              value: 'other',
            },
          ],
        },
      },
      {
        type: 'input',
        block_id: 'name_block',
        label: {
          type: 'plain_text',
          text: 'Full Name',
        },
        element: {
          type: 'plain_text_input',
          action_id: 'name_action',
          placeholder: {
            type: 'plain_text',
            text: 'Your full name',
          },
        },
      },
      {
        type: 'input',
        block_id: 'purpose_block',
        label: {
          type: 'plain_text',
          text: 'Purpose/Details',
        },
        element: {
          type: 'plain_text_input',
          action_id: 'purpose_action',
          multiline: true,
          placeholder: {
            type: 'plain_text',
            text: 'Please provide details about your request',
          },
        },
      },
      {
        type: 'input',
        block_id: 'deadline_block',
        label: {
          type: 'plain_text',
          text: 'Deadline (if urgent)',
        },
        element: {
          type: 'plain_text_input',
          action_id: 'deadline_action',
          placeholder: {
            type: 'plain_text',
            text: 'e.g., End of week',
          },
        },
        optional: true,
      },
    ],
  };
}

// ==================== VERCEL HANDLER ====================

module.exports = async (req, res) => {
  const body = req.body;

  // URL verification
  if (body?.type === 'url_verification') {
    return res.status(200).json({ challenge: body.challenge });
  }

  // Respond immediately so Slack doesn't retry
  res.status(200).send();

  // Handle events async
  if (body?.event?.type === 'app_mention') {
    await handleAppMention(body.event).catch(console.error);
  }
};
