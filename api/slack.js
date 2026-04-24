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
  if (!query) return [];
  try {
    const response = await notionClient.search({
      query,
      filter: { value: 'page', property: 'object' },
      page_size: 5,
    });
    return response.results.map((page) => ({
      title: page.properties?.title?.title?.[0]?.plain_text ||
             page.properties?.Name?.title?.[0]?.plain_text ||
             page.title?.[0]?.plain_text || '',
      content: '',
      url: page.url || `https://notion.so/${page.id.replace(/-/g, '')}`,
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

const HR_KNOWLEDGE = `
=== TIME OFF / PTO ===
dotCMS offers Open Time Off — no accrual, no cap. Use it for vacations, illness, family emergencies, mental health days, etc.
Notice required: 1 day = 5 business days notice; 2–5 days = 15 business days; 5+ days = 30 business days.
Limits: New hires max 5 days in first 90 days. No more than 10 days in any 30-day window (exceptions need exec approval).
Sick days: If health absences exceed 15 business days/year, additional days are unpaid. Medical documentation required for 5+ consecutive days.
How to request: Log into BambooHR → Main Page → "Request Time Off". All requests need manager approval.
URL: https://www.notion.so/26ff3ed090a480debaebdd96c4fa8b7c

=== PARENTAL LEAVE ===
dotCMS offers fully paid parental leave.
Primary Caregiver: 12 weeks at 100% base pay. Starts on birth/adoption date. Optional phased return weeks 13–15.
Secondary Caregiver: 4 weeks at 100% base pay. Must be taken within 6 months of birth/adoption.
How to request: Give 45 days notice to People & Culture. Submit forms and documentation. EOR employees (via Deel) must also notify Deel.
URL: https://www.notion.so/271f3ed090a48061a4b7cafff6cc4c98

=== BENEFITS ===
- Open Time Off (no accrual)
- Office equipment: approved laptop + supplemental equipment budget for home office. 3-year hardware refresh cycle.
- Parental Leave: 12 weeks primary / 4 weeks secondary, fully paid
- Claude AI License (Anthropic)
- Udemy licenses (contact People & Culture)
- Annual off-site (subject to financial status)
- Referral bonus: $1,000 for full-time referrals, $300 for part-time (paid after 90 days)
URL: https://www.notion.so/271f3ed090a480a8af28dae5feb8e6cd

=== PAYROLL ===
Schedule: Semimonthly — paid on the 15th and last day of each month. If pay date falls on weekend, paid on prior Friday.
Platforms: Deel (international contractors and EOR Canada), ADP (US employees).
Expense reimbursements: Use Brex. Submit via Brex → Wallet → Request Reimbursement.
Countries not on Brex (Venezuela, Panama, Peru, Pakistan, Bolivia, Colombia): Email payroll@dotcms.com with receipts, copy manager.
URL: https://www.notion.so/328f3ed090a481a0858aec4e2c81058f

=== OFFICE & EQUIPMENT REQUEST ===
All hardware requests go through Bamboo and require manager approval.
Laptop renewal: 3-year refresh cycle. Need objective evidence of performance issue (degraded speed, hardware failure, software incompatibility).
How to request: Contact manager → Manager submits in Bamboo → HR confirms.
Supplemental equipment: Go to Bamboo → Assets Tab → Equipment Request.
URL: https://www.notion.so/310f3ed090a480429655ea7efcf06060
`;

async function generateAnswer(question, knowledge) {
  const notionContext = knowledge.length > 0
    ? knowledge.map((k) => `- ${k.title}: ${k.url}`).join('\n')
    : '';

  const message = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 500,
    system: `You are the People Assistant at dotCMS, answering HR questions in Slack.

COMPANY HR KNOWLEDGE BASE:
${HR_KNOWLEDGE}
${notionContext ? `\nADDITIONAL RELEVANT PAGES:\n${notionContext}` : ''}

Formatting rules (Slack mrkdwn):
- Use *bold* (single asterisk), not **bold**
- Never use # or ## headers
- Use bullet points with • or -
- Keep responses concise and conversational
- Always answer from the knowledge base above
- For questions not covered, suggest contacting People & Culture directly`,
    messages: [{ role: 'user', content: question }],
  });

  const raw = message.content[0]?.type === 'text'
    ? message.content[0].text
    : 'I encountered an error. Please contact HR directly.';

  // Convert markdown to Slack mrkdwn
  return raw
    .replace(/\*\*(.*?)\*\*/g, '*$1*')       // **bold** → *bold*
    .replace(/^#{1,3}\s+/gm, '')              // remove # headers
    .replace(/\[(.*?)\]\((.*?)\)/g, '<$2|$1>'); // [text](url) → <url|text>
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

  // Button clicks / interactive components
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

  // Respond to DMs without needing @mention
  if (event?.type === 'message' && event.channel_type === 'im' && !event.bot_id && !event.subtype) {
    waitUntil(
      handleAppMention(event).catch((err) =>
        console.error('handleDM error:', err.message)
      )
    );
  }

  return res.status(200).send();
};
