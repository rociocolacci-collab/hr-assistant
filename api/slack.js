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
  '334f3ed090a480268a76d0817f4e56fe', // Recognitions
  // Community
  '326f3ed090a480f8bda5f37b6927d564', // Company Holidays
  'b5bbce16fd2444a191ed5ea465a6bc86', // Engagement Activities
  '328f3ed090a481d18722e8dfed62706b', // Onboarding
  '326f3ed090a48003aa67e0269c1eb9b6', // Offboarding
  '328f3ed090a481a1b233d108ea50f5f1', // Referral Bonus & Role Transition
  // Professional Development
  '345f3ed090a480bbaaf8e322502f8222', // dotCMS Career Path
  '326f3ed090a48163ae54c9a533644789', // Professional Development
  '322f3ed090a4811b9d21d0e3a9332050', // Annual Review Process
  '334f3ed090a481f8951ad5b89360ba8c', // Annual Review Timeline
  // Company Policies
  '334f3ed090a480a88fe5c607399a192c', // Remote Work Policy
  '278f3ed090a480a3a9a0df1ec03e198b', // Travel & Expenses
  '328f3ed090a481948026c0cf78987b5d', // Harassment Prevention
  '328f3ed090a481918794df886bad2409', // Grievance & Escalation Process
  // dotCMS
  '26ff3ed090a480d7bcf9dcb810571429', // Our Values
];

// Fallback knowledge — used if Notion is unreachable
const HR_FALLBACK = `
=== OUR VALUES ===
dotCMS has 6 core values — these are how a "dot" operates every day:
1. We are Accountable: Own your work end-to-end. Raise issues early, think beyond your task, follow through even when no one is watching.
2. We are Team Players: Jump in to help even when it's not your job. Share context proactively, adapt when priorities shift, celebrate teammates' wins.
3. We are Doers: Ship, iterate, improve. Don't wait for perfect. Bring quality and care to every task, find a way forward through obstacles.
4. We are Passionately Dedicated: Ask the "why", speak honestly even when it's hard, stay committed through setbacks, bring energy and intentionality.
5. We are Humble: Give credit generously, ask for help, treat every conversation as a chance to learn, don't let success stop your growth.
6. We are Customer Obsessed: Ask "how does this affect the customer?" Listen more than you talk. Treat customer feedback as a gift.
URL: https://www.notion.so/26ff3ed090a480d7bcf9dcb810571429

=== TIME OFF / PTO ===
dotCMS offers Open Time Off — no accrual, no cap. Use it for vacations, illness, family emergencies, mental health days, doctor's appointments, weddings, jury duty, bereavement, or anything else that requires stepping away.
Notice required: 1 day = 5 business days; 2–5 days = 15 business days; 5+ days = 30 business days.
Limits: New hires max 5 days in first 90 days. No more than 10 days in any 30-day window (exceptions need exec approval).
Sick days: If health absences exceed 15 business days/year, additional days are unpaid. Documentation required for 5+ consecutive days.
How to request: Log into BambooHR → Main Page → "Request Time Off". All requests need manager approval.
URL: https://www.notion.so/26ff3ed090a480debaebdd96c4fa8b7c

=== COMPANY HOLIDAYS ===
dotCMS offers 11 paid company holidays per year per location. All full-time team members are covered.
If a holiday falls on Saturday → observed on Friday. If Sunday → observed on Monday.
If a company holiday falls during your approved PTO, that day does NOT count against your PTO balance.
If your role requires working on a holiday, coordinate with your manager in advance.
Subscribe to the holiday calendar: https://calendar.google.com/calendar/embed?src=c_0a7fa996a51bb20a088197e4d91fd4ab731e9be9cce1a82d26afa15ce2a3b2d9%40group.calendar.google.com
Full holiday list by location (Google Sheets): https://docs.google.com/spreadsheets/d/1jicu_-Qoac15UYgEkiTa17AUjukITihlLNRVsYU4fc8
BambooHR Slack commands: /timeoff (balances), /whosout (who's out today), /requesttimeoff (submit request), /whois (employee lookup).
URL: https://www.notion.so/326f3ed090a480f8bda5f37b6927d564

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

=== RECOGNITIONS ===
dotCMS uses Matter in Slack for peer recognition. Join #dot-kudos to give and receive kudos.
Goal: celebrate day-to-day wins, recognize big and small accomplishments, make recognition a weekly habit.
URL: https://www.notion.so/334f3ed090a480268a76d0817f4e56fe

=== REFERRAL BONUS & ROLE TRANSITION ===
Referral Program: Know someone great? Refer them and earn:
- Full-time role: $1,000 USD (paid after they complete 90 days)
- Part-time role: $300 USD (paid after they complete 90 days)
To refer: Message Rocio Colacci via email with candidate's name, contact info, and the role.

Internal Role Transition: Interested in a different role at dotCMS?
1. Check BambooHR for open positions.
2. Notify your current manager before applying.
3. Contact People & Culture to learn more and set up a call.
4. Interview process: resume + screening + hiring manager interview + skills assessment (no cultural interview needed for internal candidates).
5. If selected: offer details + up to 60-day transition period for knowledge transfer.
URL: https://www.notion.so/328f3ed090a481a1b233d108ea50f5f1

=== ENGAGEMENT ACTIVITIES ===
dotCMS runs several recurring engagement programs:
1. Coffee Chats: Monthly themed virtual 30-min gatherings (camera-on encouraged). 2026 themes include Women's Day, World Cup, Gamer Day, Halloween, Year-End.
2. Values Club: Quarterly sessions bringing one company value to life through team stories and activities.
3. Leadership Q&A Series: Informal sessions where leaders share personal journeys — no slides, just honest stories + open Q&A.
Got ideas? Reach out to People & Culture anytime.
URL: https://www.notion.so/b5bbce16fd2444a191ed5ea465a6bc86

=== ONBOARDING ===
New hire onboarding covers 90 days in 4 phases:
- Phase 1 (Week 1): Get oriented — setup checklist, meet team, system access.
- Phase 2 (Weeks 2–4): Learn the ropes — culture, processes, role scope. Day 30 check-in with People & Culture.
- Phase 3 (Weeks 5–8): Build momentum — start owning work, build relationships.
- Phase 4 (Weeks 9–12): Own your role — operate independently, Day 90 manager review.
Two tracks run in parallel: General Onboarding + Role-Specific Guide (Engineering, Product, CX, Sales, Marketing, Professional Services).
Questions? Reach out to People & Culture on Slack anytime.
URL: https://www.notion.so/328f3ed090a481d18722e8dfed62706b

=== OFFBOARDING ===
If you're leaving dotCMS, the process:
1. Email People & Culture + cc your manager with: resignation statement, last working day, brief reason (optional). English required.
2. Notice period: per your contract, typically 2–4 weeks.
3. Manager schedules transition conversation. People Ops confirms last day.
4. Before last day: knowledge transfer, handover meetings, return equipment.
5. Exit interview with People & Culture (confidential, 30 min).
6. Final paycheck on next regular pay date. Pending expenses must be submitted before last day.
7. Equipment: People & Culture will offer option to purchase your laptop at book price. Otherwise, return it.
8. US/EoR only: health insurance ends on last day, COBRA info provided if eligible.
URL: https://www.notion.so/326f3ed090a48003aa67e0269c1eb9b6

=== ANNUAL REVIEW PROCESS ===
Annual Reviews happen once a year in November/December. dotCMS uses a Bell Curve performance model.

Performance categories:
- Exceptional (top 10%): Consistently exceeds all expectations, drives major business impact.
- Exceed Expectations (next 20%): Consistently above expectations, measurable impact beyond core role.
- Meet Expectations (40% — median): Meets all goals consistently. This is a great place to be!
- Below Expectations (next 20%): Occasionally fails to meet expectations, needs improvement.
- Low Performer (bottom 10%): Consistently underperforms, may require a PIP.

Final rating = Performance (1–5) + Values (A–C):
- Performance: 1=Exceptional, 2=Exceeds, 3=Meets, 4=Below, 5=Low
- Values: A=Exemplary (5+ positive, 0 negatives), B=Strong (4+ positive, ≤1 negative), C=Developing (3+ positive, ≤2 negatives)
- Example: 3A = Meets Expectations + Exemplary Values

Process: Self-assessment in Ninety → Manager evaluation → Bell Curve calibration → 1:1 conversation with manager.
URL: https://www.notion.so/322f3ed090a4811b9d21d0e3a9332050

=== ANNUAL REVIEW TIMELINE ===
All dates are in December each year:
- Through Dec 5: Complete your self-assessment in Ninety (HARD DEADLINE — late submissions delay your whole team).
- Dec 6–15: Managers assess direct reports and work on Bell Curve placements.
- Dec 16–19: Leadership calibration — ratings and salary increases assigned.
- Dec 19–26: 1:1 Annual Conversation with your manager. Official letter via BambooHR by Dec 26.
- Jan 1: All salary adjustments and promotions take effect. First January paycheck reflects changes.
URL: https://www.notion.so/334f3ed090a481f8951ad5b89360ba8c

=== CAREER PATH & LEVELS ===
dotCMS has two career tracks — Individual Contributors (ICs) and Managers. Both are equally valued.

IC Track:
- L1 Associate/Trainee: Learning basics, needs close guidance. 0–2 years.
- L2 Junior: Handles routine work more independently. 2–4 years.
- L3 Mid Level: Executes independently, owns small projects end-to-end. 4+ years.
- L4 Senior: Drives company objectives, high autonomy, leads small teams. 7+ years. (Branches to Tech Lead or Management)
- L5 Staff: Technical leader for large cross-functional projects, mentors others. 7+ years.
- L6 Principal: Sets direction for entire domain, shapes company strategy. 10+ years.

Manager Track (from L4):
- M1 Manager: Small team of ICs, 1-quarter horizon. 5+ years total.
- M2 Senior Manager: ICs + possibly other managers, multi-quarter scope. 8+ years.
- M3 Director: Manages through other managers, company-wide impact. 12+ years.
- M4 Senior Director: Full functional business unit, strategic contributions. 15+ years.
URL: https://www.notion.so/345f3ed090a480bbaaf8e322502f8222

=== PROFESSIONAL DEVELOPMENT ===
Three conversation types guide growth:
1. Monthly 1:1s — at least once/month. Personal check-in, wins, blockers, feedback both ways.
2. Quarterly Career Conversations — 3x/year (Apr, Jul, Oct). Cover Values, GWC, performance Rocks, growth.
3. Annual Performance Review — December. Determines Bell Curve position, career level, compensation.

GWC Framework:
- G (Get it): Do you understand your role and its impact?
- W (Want it): Are you genuinely energized by this work?
- C (Capacity): Do you have the skills and bandwidth to deliver?
URL: https://www.notion.so/326f3ed090a48163ae54c9a533644789

=== REMOTE WORK POLICY ===
dotCMS is remote-first. When your location changes:
- Temporary (<30 days): Submit in BambooHR at least 5 business days before. Manager approval required.
- Extended Temporary (30+ days): Written request to Manager + People & Culture at least 30 days before. Department Head review.
- Permanent: Written request at least 90 days before. May trigger contract changes and/or compensation adjustments.
All relocations require prior approval — moving first and asking later is not compliant.
URL: https://www.notion.so/334f3ed090a480a88fe5c607399a192c

=== TRAVEL & EXPENSES ===
dotCMS reimburses business-related expenses. Rules:
- Expenses must have a clear business connection.
- Submit within 30 days of the trip or event.
- One expense report per trip, consolidating all costs.
- Always keep receipts — no receipt, no reimbursement.
How to submit: Select "Travel and Transportation Policy" in Brex and follow the reimbursement process.
Processing: Reimbursement within 24 hours after manager approval.
URL: https://www.notion.so/278f3ed090a480a3a9a0df1ec03e198b

=== HARASSMENT PREVENTION ===
dotCMS has zero tolerance for harassment and discrimination.
How to report: Talk to manager or HR directly (Slack, in person, or email). Go straight to HR if your manager is involved. Anonymous reporting form available (link shared soon).
Witnesses also have a responsibility to report, even if the affected person asks you not to.
After reporting: HR notifies senior management → investigation begins → findings reviewed → both parties notified of outcome.
All reports are confidential and on need-to-know basis. Retaliation is strictly prohibited.
URL: https://www.notion.so/328f3ed090a481948026c0cf78987b5d

=== GRIEVANCE & ESCALATION PROCESS ===
Use this for non-harassment concerns: workload disagreements, process frustrations, interpersonal conflicts, feeling unheard.
Steps:
1. Start with your manager — a direct 1:1 conversation resolves most issues.
2. If your manager is involved or Step 1 didn't work → reach out to People & Culture directly via Slack or email. No formal form needed.
3. For serious unresolved concerns → People & Culture involves senior leadership.
People & Culture acknowledges within 2 business days. Conversations are confidential. No negative consequences for raising concerns in good faith.
URL: https://www.notion.so/328f3ed090a481918794df886bad2409
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
