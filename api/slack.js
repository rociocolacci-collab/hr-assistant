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

// HR page IDs — read live from Notion on every request
const HR_PAGE_IDS = [
  // People & HR
  '26ff3ed090a480debaebdd96c4fa8b7c', // Time Off
  '271f3ed090a48061a4b7cafff6cc4c98', // Parental Leave
  '271f3ed090a480a8af28dae5feb8e6cd', // Benefits
  '328f3ed090a481a0858aec4e2c81058f', // Payroll & Reimbursements
  '310f3ed090a480429655ea7efcf06060', // Office & Equipment Request
  // Professional Development
  '345f3ed090a480bbaaf8e322502f8222', // dotCMS Career Path
  '322f3ed090a4811b9d21d0e3a9332050', // Annual Review Process
  '326f3ed090a48163ae54c9a533644789', // Professional Development
  // Company Policies
  '334f3ed090a480a88fe5c607399a192c', // Remote Work Policy
  '278f3ed090a480a3a9a0df1ec03e198b', // Travel & Expenses
  '328f3ed090a481948026c0cf78987b5d', // Harassment Prevention
  '328f3ed090a481918794df886bad2409', // Grievance & Escalation Process
  // Onboarding
  '328f3ed090a481d18722e8dfed62706b', // Onboarding
];

// Fallback knowledge — used if Notion is unreachable
const HR_FALLBACK = `
=== TIME OFF / PTO ===
dotCMS offers Open Time Off — no accrual, no cap. Use it for vacations, illness, family emergencies, mental health days, doctor's appointments, weddings, jury duty, bereavement, or anything else that requires stepping away.
Notice required: 1 day = 5 business days; 2–5 days = 15 business days; 5+ days = 30 business days.
Limits: New hires max 5 days in first 90 days. No more than 10 days in any 30-day window (exceptions need exec approval).
Sick days: If health absences exceed 15 business days/year, additional days are unpaid. Documentation required for 5+ consecutive days.
How to request: Log into BambooHR → Main Page → "Request Time Off". All requests need manager approval.
URL: https://www.notion.so/26ff3ed090a480debaebdd96c4fa8b7c

=== PARENTAL LEAVE ===
dotCMS offers fully paid parental leave for birth, adoption, or foster placement.
Primary Caregiver: 12 weeks at 100% base pay. Starts on birth/adoption date. One continuous period.
Optional Phased Return: Week 13 = 50% hours, Week 14 = 75% hours, Week 15 = full hours — all at 100% pay.
Secondary Caregiver: 4 weeks at 100% base pay. Must be taken within 6 months of birth/adoption.
How to request: Give 45 days notice to People & Culture. Submit forms and documentation. EOR/Deel employees must also notify Deel.
URL: https://www.notion.so/271f3ed090a48061a4b7cafff6cc4c98

=== BENEFITS ===
- Open Time Off (no accrual, no cap)
- Office equipment: approved laptop + supplemental home office budget. 3-year hardware refresh cycle.
- Parental Leave: 12 weeks primary / 4 weeks secondary, fully paid
- Claude AI License (Anthropic Team)
- Udemy licenses — contact People & Culture
- Annual off-site (subject to financial status)
- Wellness & Engagement programs (coffee chats, wellness sessions, Values Club)
- Referral Program: $1,000 for full-time, $300 for part-time (paid after 90 days)
URL: https://www.notion.so/271f3ed090a480a8af28dae5feb8e6cd

=== PAYROLL & REIMBURSEMENTS ===
Schedule: Semimonthly — 15th and last day of each month. Weekend pay dates shift to prior Friday.
Platforms: Deel (international contractors + EOR Canada), ADP (US employees).
Expense reimbursements: Use Brex → Wallet → Request Reimbursement. Manager approves, Finance pays within 48h.
Countries without Brex (Venezuela, Panama, Peru, Pakistan, Bolivia, Colombia): Email payroll@dotcms.com with receipts, copy manager.
URL: https://www.notion.so/328f3ed090a481a0858aec4e2c81058f

=== OFFICE & EQUIPMENT REQUEST ===
All hardware requests go through Bamboo and require manager approval. 3-year refresh cycle — age alone is not enough, need evidence of performance issue (slow, hardware failure, software incompatibility).
How to request laptop: Contact manager → Manager submits in Bamboo → HR confirms.
Supplemental equipment: Bamboo → Assets Tab → Equipment Request (if New Hire Allowance unused) or discuss with manager (if already used).
URL: https://www.notion.so/310f3ed090a480429655ea7efcf06060

=== ANNUAL REVIEW PROCESS ===
Annual Reviews happen once a year in November/December. dotCMS uses a performance distribution model (Bell Curve) for fair and consistent evaluations.

Performance categories:
- Exceptional (top 10%): Consistently exceeds all expectations, drives major business impact, inspires others.
- Exceed Expectations (next 20%): Consistently above expectations, takes initiative, measurable impact beyond core role.
- Meet Expectations (40% — median): Meets all goals and expectations consistently. This is a great place to be!
- Below Expectations (next 20%): Occasionally fails to meet expectations, needs improvement and coaching.
- Low Performer (bottom 10%): Consistently underperforms, may require a performance improvement plan (PIP).

How ratings work — your final rating = Performance (1–5) + Values (A–C):
- Performance: 1=Exceptional, 2=Exceeds, 3=Meets, 4=Below, 5=Low
- Values: A=Exemplary (5+ positive ratings, 0 negatives), B=Strong (4+ positive, ≤1 negative), C=Developing (3+ positive, ≤2 negatives)
- Combined example: 3A = Meets Expectations + Exemplary Values

Process steps:
1. Self-assessment + Manager assessment in Ninety (covers Values, GWC, Performance, Manager Review, Reflection).
2. Bell Curve placement by managers and department heads.
3. Calibration across teams — salary increase % assigned consistently per rating.
4. 1:1 conversation with manager to share results and align on development priorities.
URL: https://www.notion.so/322f3ed090a4811b9d21d0e3a9332050

=== CAREER PATH & LEVELS ===
dotCMS has two career tracks — Individual Contributors (ICs) and Managers. Both are equally valued.
Levels are based on skills and impact, not tenure alone.

IC Track:
- L1 Associate/Trainee: Learning basics, needs close guidance. 0–2 years.
- L2 Junior: Handles routine work more independently, owns defined deliverables. 2–4 years.
- L3 Mid Level: Executes independently, owns small projects end-to-end. 4+ years.
- L4 Senior: Drives company objectives, high autonomy, leads small project teams. 7+ years. (Path branches here to Tech Lead or Management)
- L5 Staff: Technical leader for large cross-functional projects, mentors others, thought leader. 7+ years.
- L6 Principal: Sets direction for entire domain, shapes company strategy, highest autonomy. 10+ years.

Manager Track (branches from L4 Senior):
- M1 Manager: Manages small team of ICs, 1-quarter time horizon. 5+ years total.
- M2 Senior Manager: Manages ICs and possibly other managers, multi-quarter scope. 8+ years.
- M3 Director: Manages through other managers, drives company-wide impact. 12+ years.
- M4 Senior Director: Leads full functional business unit, strategic contributions. 15+ years.

Note: Most people exhibit qualities across 2 levels at any time — that's normal.
URL: https://www.notion.so/345f3ed090a480bbaaf8e322502f8222

=== PROFESSIONAL DEVELOPMENT ===
Three conversation types guide growth at dotCMS:
1. Monthly 1:1s — build trust. At least once/month. Personal check-in, wins, blockers, feedback both ways.
2. Quarterly Career Conversations — 3x/year (Apr, Jul, Oct). Cover Values, GWC (Get it/Want it/Capacity), performance Rocks, and growth questions.
3. Annual Performance Review — once/year (December). Determines Bell Curve position, career level, and compensation.

GWC Framework:
- G (Get it): Do you understand your role and its impact?
- W (Want it): Are you genuinely energized by this work?
- C (Capacity): Do you have the skills and bandwidth to deliver?

The goal is continuous feedback with no surprises at any stage.
URL: https://www.notion.so/326f3ed090a48163ae54c9a533644789

=== REMOTE WORK POLICY ===
dotCMS is a remote-first company. When your work location changes, follow these rules:

Relocation types:
- Temporary (less than 30 days): Submit in BambooHR at least 5 business days before. Requires manager approval.
- Extended Temporary (30+ days): Submit written request to Manager + People & Culture at least 30 days before. Reviewed by Department Head.
- Permanent: Submit to Manager + People & Culture at least 90 days before. May trigger contract changes and/or compensation adjustments.

All relocations require prior approval — moving first and asking later is not compliant.
Tax and legal implications may apply, especially for permanent moves.
Set new core collaboration hours with your manager before any move.
URL: https://www.notion.so/334f3ed090a480a88fe5c607399a192c

=== ONBOARDING ===
New hire onboarding covers 90 days in 4 phases:
- Phase 1 (Week 1): Get oriented — setup checklist, meet team, system access.
- Phase 2 (Weeks 2–4): Learn the ropes — culture, processes, role scope. Day 30 check-in with People & Culture.
- Phase 3 (Weeks 5–8): Build momentum — start owning work, build relationships.
- Phase 4 (Weeks 9–12): Own your role — operate independently, Day 90 manager review.

Two tracks run in parallel: General Onboarding (this page) + Role-Specific Guide (Engineering, Product, CX, Sales, Marketing, Professional Services).
Start with: New Hire General Material (setup checklist, tools, policies).
Questions? Reach out to People & Culture on Slack anytime.
URL: https://www.notion.so/328f3ed090a481d18722e8dfed62706b
`;

// ==================== NOTION ====================

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
        console.error(`Notion page ${pageId} error:`, err.message);
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

async function generateAnswer(question, knowledgeText) {
  const message = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 300,
    system: `You are the People Assistant at dotCMS. Give short, direct answers — like a helpful colleague on Slack, not a manual.

CRITICAL RULES:
- Keep answers to 3–5 lines max. No walls of text.
- Answer the specific question asked. Don't dump everything you know about a topic.
- NEVER say "check the policy" or "I recommend reviewing" — just answer directly.
- If something is truly not covered, only then suggest contacting People & Culture.
- End with ONE short follow-up question offering to go deeper on a specific part (e.g. "Want the details on how to submit in Brex?" or "Need info on the timeline?").
- If the question is already very specific, skip the follow-up question.

HR KNOWLEDGE BASE:
${knowledgeText}

Slack formatting rules:
- Use *bold* (single asterisk only), never **double asterisk**
- No # headers
- Bullet points with -
- Links as plain URLs`,
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

  // Try Notion first (5s timeout); fall back to hardcoded if it fails
  let knowledgeText = HR_FALLBACK;
  try {
    const notionPromise = fetchHRKnowledge();
    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error('Notion timeout')), 5000)
    );
    const hrPages = await Promise.race([notionPromise, timeoutPromise]);
    if (hrPages.length > 0) {
      knowledgeText = hrPages
        .map((p) => `=== ${p.title.toUpperCase()} ===\n${p.content}\nURL: ${p.url}`)
        .join('\n\n');
      console.log(`Loaded ${hrPages.length} pages from Notion`);
    }
  } catch (err) {
    console.log('Using fallback knowledge:', err.message);
  }

  const answer = await generateAnswer(question, knowledgeText);

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
    foundAnswer: true,
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
