import type { KnownBlock, PlainTextOption, View } from '@slack/web-api';
import { client } from './slack-utils';
import { logInteraction } from './notion';

type BlockActionPayload = {
  type: 'block_actions';
  trigger_id: string;
  user: { id: string };
  channel?: { id: string };
  team?: { id: string };
  message?: { ts?: string; thread_ts?: string };
  view?: { id: string; private_metadata?: string };
  actions?: {
    action_id: string;
    selected_option?: { value: string };
  }[];
};

type ViewSubmissionPayload = {
  type: 'view_submission';
  user: { id: string };
  team?: { id: string };
  view: {
    id: string;
    callback_id: string;
    private_metadata?: string;
    state: {
      values: Record<
        string,
        Record<
          string,
          {
            value?: string;
            selected_date?: string;
            selected_option?: { value?: string; text?: { text?: string } };
            selected_options?: { value: string; text: { text: string } }[];
          }
        >
      >;
    };
  };
};

// Thread of the message where the button was clicked (to keep everything grouped)
function buttonThreadTs(payload: BlockActionPayload): string | undefined {
  return payload.message?.thread_ts || payload.message?.ts || undefined;
}

// ==================== HR REQUEST MODAL ====================

const REQUEST_TYPE_OPTIONS: PlainTextOption[] = [
  { text: { type: 'plain_text', text: 'Employment Certification' }, value: 'employment_certification' },
  { text: { type: 'plain_text', text: 'Document Request' }, value: 'document_request' },
  { text: { type: 'plain_text', text: 'Other' }, value: 'other' },
];

export function requestModalView(selectedType?: string, privateMetadata?: string): View {
  const selected = REQUEST_TYPE_OPTIONS.find((o) => o.value === selectedType);

  const typeBlock: KnownBlock = {
    type: 'input',
    block_id: 'request_type_block',
    dispatch_action: true,
    label: { type: 'plain_text', text: 'Request Type' },
    element: {
      type: 'static_select',
      action_id: 'request_type_action',
      placeholder: { type: 'plain_text', text: 'Select a type' },
      options: REQUEST_TYPE_OPTIONS,
      ...(selected ? { initial_option: selected } : {}),
    },
  };

  // Employment Certification asks its own follow-ups; other types get a free-text field
  const certBlocks: KnownBlock[] = [
    {
      type: 'input',
      block_id: 'cert_include_block',
      optional: true,
      label: { type: 'plain_text', text: 'What should it include?' },
      element: {
        type: 'checkboxes',
        action_id: 'cert_include_action',
        options: [
          { text: { type: 'plain_text', text: 'Salary' }, value: 'salary' },
          { text: { type: 'plain_text', text: 'Hire date' }, value: 'hire_date' },
        ],
      },
    },
    {
      type: 'input',
      block_id: 'cert_language_block',
      label: { type: 'plain_text', text: 'Language' },
      element: {
        type: 'static_select',
        action_id: 'cert_language_action',
        placeholder: { type: 'plain_text', text: 'Select a language' },
        options: [
          { text: { type: 'plain_text', text: 'English' }, value: 'english' },
          { text: { type: 'plain_text', text: 'Español' }, value: 'spanish' },
        ],
      },
    },
    {
      type: 'input',
      block_id: 'cert_purpose_block',
      label: { type: 'plain_text', text: 'What is it for?' },
      element: {
        type: 'static_select',
        action_id: 'cert_purpose_action',
        placeholder: { type: 'plain_text', text: 'Select a purpose' },
        options: [
          { text: { type: 'plain_text', text: 'Bank' }, value: 'bank' },
          { text: { type: 'plain_text', text: 'Visa / Embassy' }, value: 'visa_embassy' },
          { text: { type: 'plain_text', text: 'Rental / Landlord' }, value: 'rental' },
          { text: { type: 'plain_text', text: 'Government / Tax office' }, value: 'government' },
          { text: { type: 'plain_text', text: 'Other' }, value: 'other' },
        ],
      },
    },
    {
      type: 'input',
      block_id: 'details_block',
      optional: true,
      label: { type: 'plain_text', text: 'Anything else we should know?' },
      element: {
        type: 'plain_text_input',
        action_id: 'details_action',
        multiline: true,
        placeholder: { type: 'plain_text', text: 'e.g. it must be addressed to a specific bank' },
      },
    },
  ];

  const defaultBlocks: KnownBlock[] = [
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
  ];

  const deadlineBlock: KnownBlock = {
    type: 'input',
    block_id: 'deadline_block',
    label: { type: 'plain_text', text: 'Deadline (optional)' },
    optional: true,
    element: {
      type: 'datepicker',
      action_id: 'deadline_action',
      placeholder: { type: 'plain_text', text: 'Pick a date' },
    },
  };

  return {
    type: 'modal',
    callback_id: 'hr_request_modal',
    title: { type: 'plain_text', text: 'HR Request' },
    submit: { type: 'plain_text', text: 'Submit' },
    close: { type: 'plain_text', text: 'Cancel' },
    ...(privateMetadata ? { private_metadata: privateMetadata } : {}),
    blocks: [
      typeBlock,
      ...(selectedType === 'employment_certification' ? certBlocks : defaultBlocks),
      deadlineBlock,
    ],
  };
}

export async function handleSubmitRequest(payload: BlockActionPayload): Promise<void> {
  // Remember where the button was clicked so the confirmation lands in the same thread
  const context = JSON.stringify({
    channel: payload.channel?.id || payload.user.id,
    thread_ts: buttonThreadTs(payload) || null,
  });
  await client.views.open({
    trigger_id: payload.trigger_id,
    view: requestModalView(undefined, context),
  });
}

// Re-render the modal when the request type changes
export async function handleRequestTypeChange(payload: BlockActionPayload): Promise<void> {
  const selectedType = payload.actions?.[0]?.selected_option?.value;
  if (!payload.view?.id) return;
  await client.views.update({
    view_id: payload.view.id,
    view: requestModalView(selectedType, payload.view.private_metadata),
  });
}

// Creates the deadline event automatically via the Google Apps Script webhook
// (CALENDAR_WEBHOOK_URL). Returns false when unset or failing, so the caller
// can fall back to the one-click link.
async function createDeadlineEvent(
  title: string,
  dateStr: string,
  description: string
): Promise<boolean> {
  const url = process.env.CALENDAR_WEBHOOK_URL;
  if (!url) return false;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        secret: process.env.CALENDAR_WEBHOOK_SECRET || '',
        title,
        date: dateStr,
        description,
      }),
    });
    const body = await res.text();
    if (!res.ok || !body.includes('ok')) {
      console.error(`Calendar webhook rejected: ${res.status} ${body.slice(0, 200)}`);
      return false;
    }
    return true;
  } catch (err) {
    console.error('Calendar webhook failed:', err instanceof Error ? err.message : String(err));
    return false;
  }
}

// One-click "add to Google Calendar" link for an all-day event on the deadline
function gcalDeadlineLink(title: string, dateStr: string): string {
  const start = dateStr.replace(/-/g, '');
  // all-day events use an exclusive end date → the next day
  const end = new Date(Date.parse(`${dateStr}T00:00:00Z`) + 86400000)
    .toISOString()
    .slice(0, 10)
    .replace(/-/g, '');
  return `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${encodeURIComponent(
    title
  )}&dates=${start}/${end}`;
}

export async function handleRequestSubmission(payload: ViewSubmissionPayload): Promise<void> {
  const userId = payload.user.id;
  const v = payload.view.state.values;
  const type = v.request_type_block?.request_type_action?.selected_option;
  const typeLabel = type?.text?.text || 'Unknown';

  const lines = [`*Type:* ${typeLabel}`];
  if (type?.value === 'employment_certification') {
    const includes = (v.cert_include_block?.cert_include_action?.selected_options || []).map(
      (o) => o.text.text
    );
    lines.push(
      `*Include:* ${includes.length ? includes.join(', ') : 'Standard (no salary, no hire date)'}`
    );
    lines.push(`*Language:* ${v.cert_language_block?.cert_language_action?.selected_option?.text?.text || '—'}`);
    lines.push(`*Purpose:* ${v.cert_purpose_block?.cert_purpose_action?.selected_option?.text?.text || '—'}`);
  }
  const details = v.details_block?.details_action?.value;
  if (details) lines.push(`*Details:* ${details}`);
  const deadline = v.deadline_block?.deadline_action?.selected_date; // YYYY-MM-DD
  if (deadline) lines.push(`*Deadline:* ${deadline}`);
  const summary = lines.join('\n');

  let hrText = `📥 *New HR Request* from <@${userId}>\n${summary}`;
  if (deadline) {
    const eventTitle = `HR Request due: ${typeLabel}`;
    const eventCreated = await createDeadlineEvent(
      eventTitle,
      deadline,
      `Requested via People Assistant by <@${userId}>\n\n${summary.replace(/\*/g, '')}`
    );
    hrText += eventCreated
      ? '\n📅 Deadline event added to Google Calendar'
      : `\n<${gcalDeadlineLink(eventTitle, deadline)}|📅 Add deadline to Google Calendar>`;
  }

  let delivered = false;
  if (process.env.SLACK_HR_CHANNEL) {
    try {
      await client.chat.postMessage({ channel: process.env.SLACK_HR_CHANNEL, text: hrText });
      delivered = true;
    } catch (err) {
      console.error('HR channel post failed:', err instanceof Error ? err.message : String(err));
    }
  } else {
    console.error('SLACK_HR_CHANNEL is not set');
  }
  if (!delivered) {
    // Never lose a request: fall back to DMing the People team directly
    for (const envKey of ['SLACK_SOFI_ID', 'SLACK_ROCIO_ID']) {
      const memberId = process.env[envKey];
      if (!memberId) continue;
      try {
        await client.chat.postMessage({
          channel: memberId,
          text: `${hrText}\n_(sent by DM because the HR channel is unreachable)_`,
        });
      } catch (err) {
        console.error(
          `Fallback DM to ${envKey} failed:`,
          err instanceof Error ? err.message : String(err)
        );
      }
    }
  }

  let ctx: { channel?: string; thread_ts?: string | null } = {};
  try {
    ctx = JSON.parse(payload.view.private_metadata || '{}');
  } catch (err) {
    console.error('Bad private_metadata:', err instanceof Error ? err.message : String(err));
  }
  await client.chat.postMessage({
    channel: ctx.channel || userId,
    ...(ctx.thread_ts ? { thread_ts: ctx.thread_ts } : {}),
    text: `✅ Got it! Your *${typeLabel}* request was sent to People & Culture. We'll get back to you soon.`,
  });

  await logInteraction({
    userId,
    question: summary.replace(/\*/g, ''),
    response: 'Request sent to HR',
    type: 'hr_request',
    foundAnswer: true,
  });
}

// ==================== TALK TO HR ====================

const HR_TEAM = {
  sofi: {
    name: 'Sofi Mendieta',
    idEnv: 'SLACK_SOFI_ID',
    topics: 'Onboarding · Payroll · Internal Activities · Quarterly Conversations',
  },
  rocio: {
    name: 'Rocío Colacci',
    idEnv: 'SLACK_ROCIO_ID',
    topics: 'Performance · Departmental Structure · Retention · Compensation · Recruiting · Culture',
  },
} as const;

type HRTeamKey = keyof typeof HR_TEAM;

// "Talk to HR" → show who covers what, let the person pick who to chat with
export async function handleTalkToHR(payload: BlockActionPayload): Promise<void> {
  await client.chat.postEphemeral({
    channel: payload.channel?.id || payload.user.id,
    user: payload.user.id,
    ...(buttonThreadTs(payload) ? { thread_ts: buttonThreadTs(payload) } : {}),
    text: 'Who should you talk to?',
    blocks: [
      {
        type: 'section',
        text: { type: 'mrkdwn', text: 'Happy to connect you! Pick the person who covers your topic:' },
      },
      {
        type: 'section',
        text: { type: 'mrkdwn', text: `*${HR_TEAM.sofi.name}*\n${HR_TEAM.sofi.topics}` },
        accessory: {
          type: 'button',
          text: { type: 'plain_text', text: 'Chat with Sofi' },
          action_id: 'chat_with_sofi',
        },
      },
      {
        type: 'section',
        text: { type: 'mrkdwn', text: `*${HR_TEAM.rocio.name}*\n${HR_TEAM.rocio.topics}` },
        accessory: {
          type: 'button',
          text: { type: 'plain_text', text: 'Chat with Rocío' },
          action_id: 'chat_with_rocio',
        },
      },
    ],
  });
}

export async function handleChatChoice(
  payload: BlockActionPayload,
  personKey: HRTeamKey
): Promise<void> {
  const person = HR_TEAM[personKey];
  const userId = payload.user.id;
  const personId = process.env[person.idEnv];
  const mention = personId ? `<@${personId}>` : `*${person.name}*`;

  await client.chat.postEphemeral({
    channel: payload.channel?.id || userId,
    user: userId,
    ...(buttonThreadTs(payload) ? { thread_ts: buttonThreadTs(payload) } : {}),
    text: `${mention} is your go-to for ${person.topics
      .toLowerCase()
      .replace(/ · /g, ', ')}. Send them a DM — I already gave them a heads-up so they know you'll reach out. :garland-dot:`,
  });

  // Heads-up to the chosen person (DM if we have their ID, HR channel as fallback)
  const headsUp = `👋 <@${userId}> would like to chat with you (via People Assistant).`;
  if (personId) {
    await client.chat.postMessage({ channel: personId, text: headsUp });
  } else if (process.env.SLACK_HR_CHANNEL) {
    await client.chat.postMessage({
      channel: process.env.SLACK_HR_CHANNEL,
      text: `👋 <@${userId}> would like to chat with *${person.name}* (via People Assistant).`,
    });
  }

  await logInteraction({
    userId,
    question: `Talk to HR: chose ${person.name}`,
    response: 'Redirected to DM',
    type: 'escalation',
    foundAnswer: true,
  });
}

export type { BlockActionPayload, ViewSubmissionPayload };
