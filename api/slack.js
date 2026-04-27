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
dotCMS offers Open Time Off — no accrual, no cap. Use it for vacations, illness, family emergencies, mental health days, doctor's appointments, weddings, jury duty, bereavement, or anything else that requires stepping away.

Notice required for planned absences:
- 1 day: 5 business days notice
- 2–5 days: 15 business days notice
- 5+ days: 30 business days notice

Important limits:
- Unplanned absences: Let your manager know ASAP. Submit the absence in Bamboo when you return.
- New hires: Maximum 5 time off days in first 90 days.
- General limit: No more than 10 time off days in any 30-day window (exceptions require executive approval).

Sick days: If health-related absences exceed 15 business days per year, additional days are unpaid. Medical documentation required for absences longer than 5 consecutive days.

Best practices:
- Plan ahead. Delegate work, brief your team, prepare what colleagues need while you're away.
- Fully disconnect. Avoid "soft availability" — being half-checked-in isn't rest.
- Update your Slack status, set OOO on Gmail, and let people know who to contact.
- Spread time off throughout the year rather than front/back-loading it.

How to request: Log into BambooHR → Main Page → "Request Time Off". All requests need manager approval. BambooHR is the system of record — if it's not there, it didn't happen.

Calendars:
- Who's Out Calendar: https://dotcms.bamboohr.com/feeds/feed.php?id=3a7642bd650e0430b5c7e8bac2d0549a
- Company Holidays (11 paid holidays/year): https://calendar.google.com/calendar/embed?src=c_0a7fa996a51bb20a088197e4d91fd4ab731e9be9cce1a82d26afa15ce2a3b2d9%40group.calendar.google.com

URL: https://www.notion.so/26ff3ed090a480debaebdd96c4fa8b7c

=== PARENTAL LEAVE ===
dotCMS offers fully paid parental leave for birth, adoption, or foster placement.

Primary Caregiver: 12 weeks at 100% base pay. Leave starts on birth/adoption date. Must be one continuous period.
Optional Phased Return (weeks 13–15, all at 100% pay):
- Week 13: 50% of regular hours
- Week 14: 75% of regular hours
- Week 15: Full regular hours
The phased return is optional and only available after at least 12 continuous weeks of leave.

Secondary Caregiver: 4 weeks at 100% base pay. Must be taken within 6 months of birth/adoption. One continuous period.

How to request:
1. Notify People & Culture at least 45 days before leave start date.
2. Submit forms and supporting documents (due date, adoption confirmation, etc.).
3. HR coordinates with your manager for task handover.
4. If using phased return, coordinate weeks 13–15 schedule before leave starts.

EOR employees (via Deel): Also notify Deel through the platform, request leave in Deel, and forward government benefit confirmation (e.g., Service Canada) for salary top-up calculation.

Additional time beyond paid entitlement: Personal leave of absence — requires formal approval from People & Culture and the President/CEO.

URL: https://www.notion.so/271f3ed090a48061a4b7cafff6cc4c98

=== BENEFITS ===
- Open Time Off (no accrual, no cap)
- Office equipment: approved laptop + supplemental equipment budget for home office. 3-year hardware refresh cycle.
- Parental Leave: 12 weeks primary / 4 weeks secondary, fully paid
- Claude AI License (Anthropic Team License) — for writing, research, analysis, brainstorming. Follow the AI Acceptable Use Policy.
- Udemy licenses — contact People & Culture to request access
- Annual off-site (subject to company financial status) — whole team gathers in person once a year
- Wellness & Engagement: ongoing programs — coffee chats, wellness sessions, leadership conversations, Values Club
- Referral Program: $1,000 for full-time referrals, $300 for part-time (paid after 90 days). Most credits at end of quarter wins a prize!
Questions about benefits: Contact People & Culture.
URL: https://www.notion.so/271f3ed090a480a8af28dae5feb8e6cd

=== PAYROLL & REIMBURSEMENTS ===
Schedule: Semimonthly — paid on the 15th and last day of each month. If pay date falls on a weekend, payment is on the prior Friday.

Payroll platforms:
- Deel: International contractors and EOR (Canada)
- ADP: US employees

2026 Pay Dates (adjusted for weekends):
- January: Jan 15, Jan 30 (Jan 31 falls on Saturday)
- February: Feb 13, Feb 27 (both adjusted for weekends)
- March: Mar 13, Mar 31 (Mar 15 falls on Sunday)
- April: Apr 15, Apr 30
- May: May 15, May 29 (May 31 falls on Sunday)
- June: Jun 15, Jun 30
- July: Jul 15, Jul 31
- August: Aug 14, Aug 31 (Aug 15 falls on Saturday)
- September: Sep 15, Sep 30
- October: Oct 15, Oct 30 (Oct 31 falls on Saturday)
- November: Nov 13, Nov 30 (Nov 15 falls on Sunday)
- December: Dec 15, Dec 31

International team members: Payment dates may vary based on country's banking system and local holidays. Check with People & Culture.

Expense reimbursements — use Brex:
1. New hires: Enroll in Brex (check your inbox for the invitation email from Brex or dotCMS Finance).
2. Log in to Brex → Wallet or Expenses → Request Reimbursement.
3. Fill in: date of purchase, amount, receipt, and memo (e.g., "Client dinner — Chicago offsite").
4. Submit — manager approves in Brex → Tasks → Reimbursements.
5. Finance processes payment after approval (typically within 48 hours).
Splitting across budgets: Submit two separate requests with the same receipt, adjusting the amount on each.
Video tutorial: https://drive.google.com/drive/folders/0AOVtPBGsl7jxUk9PVA

Countries NOT on Brex (Venezuela, Panama, Peru, Pakistan, Bolivia, Colombia):
Fill out the expense reimbursement template, attach receipts, email payroll@dotcms.com, and copy your manager.

URL: https://www.notion.so/328f3ed090a481a0858aec4e2c81058f

=== OFFICE & EQUIPMENT REQUEST ===
All hardware and equipment requests go through Bamboo and require manager approval.

Laptop renewal: dotCMS targets a 3-year hardware refresh cycle, but age alone is NOT a reason for replacement. Need objective evidence of a performance issue:
- Degraded performance (significantly slower, freezing, overheating)
- Hardware failure (broken screen, failed keyboard, battery issues)
- Software incompatibility (cannot run required tools for current workloads)
Diagnostics, benchmarks, or IT assessment required as evidence.

How to request laptop renewal:
1. Contact your manager — describe the issue and share diagnostic evidence.
2. Manager submits in Bamboo — opens "Equipment Upgrade or Supplemental Equipment" request with details.
3. HR confirms — People & Culture reviews and coordinates next steps.

Supplemental equipment (monitors, keyboards, chairs, etc.):
Option A — Haven't used New Hire Allowance: Go to Bamboo → Assets Tab → Equipment Request. Add cost, item link, description. Manager approves. HR processes reimbursement.
Option B — Already used New Hire Allowance: Discuss with your manager. Manager opens request in Bamboo under your profile → "Equipment Upgrade or Supplemental Equipment" → completes item name, link, cost, business justification. HR processes reimbursement.

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
