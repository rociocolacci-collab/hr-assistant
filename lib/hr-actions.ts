import type { View } from '@slack/web-api';
import { client } from './slack-utils';
import { createHRRequest, logInteraction } from './notion';

type BlockActionPayload = {
  type: 'block_actions';
  trigger_id: string;
  user: { id: string };
  channel?: { id: string };
  team?: { id: string };
  actions?: { action_id: string }[];
};

type ViewSubmissionPayload = {
  type: 'view_submission';
  user: { id: string };
  team?: { id: string };
  view: {
    callback_id: string;
    state: {
      values: Record<
        string,
        Record<
          string,
          {
            value?: string;
            selected_option?: { value: string };
          }
        >
      >;
    };
  };
};

export function createHRRequestModal(): View {
  return {
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
  };
}

export async function handleSubmitRequest(payload: BlockActionPayload): Promise<void> {
  await client.views.open({
    trigger_id: payload.trigger_id,
    view: createHRRequestModal(),
  });
}

export async function handleEscalate(payload: BlockActionPayload): Promise<void> {
  const userId = payload.user.id;
  const hrChannel = process.env.SLACK_HR_CHANNEL;

  if (hrChannel) {
    const userInfo = await client.users.info({ user: userId });
    const realName = userInfo.user?.real_name ?? userId;
    const email = userInfo.user?.profile?.email ?? 'N/A';

    await client.chat.postMessage({
      channel: hrChannel,
      text: `*Escalation Request*\nUser <@${userId}> needs HR assistance.`,
      blocks: [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `*Escalation Request*\n\nUser: <@${userId}>\nName: ${realName}\nEmail: ${email}\n\nUser needs immediate HR assistance.`,
          },
        },
        ...(payload.team?.id
          ? [
              {
                type: 'actions' as const,
                elements: [
                  {
                    type: 'button' as const,
                    text: { type: 'plain_text' as const, text: 'Open DM' },
                    url: `slack://user?team=${payload.team.id}&id=${userId}`,
                  },
                ],
              },
            ]
          : []),
      ],
    });
  }

  await client.chat.postEphemeral({
    channel: payload.channel?.id ?? userId,
    user: userId,
    text: '✅ Your request has been sent to HR. They will reach out to you soon.',
  });
}

export async function handleViewSubmission(payload: ViewSubmissionPayload): Promise<void> {
  if (payload.view.callback_id !== 'hr_request_modal') {
    return;
  }

  const userId = payload.user.id;
  const values = payload.view.state.values;

  const requestType =
    values.request_type_block?.request_type_action?.selected_option?.value ?? 'other';
  const details: Record<string, string> = {};

  for (const [blockId, block] of Object.entries(values)) {
    for (const [actionId, action] of Object.entries(block)) {
      const value = action.value ?? action.selected_option?.value;
      if (value) {
        details[`${blockId}.${actionId}`] = value;
      }
    }
  }

  const requestId = await createHRRequest({
    requestType,
    details,
    userId,
  });

  const userInfo = await client.users.info({ user: userId });
  const realName = userInfo.user?.real_name ?? userId;
  const email = userInfo.user?.profile?.email ?? 'N/A';
  const hrChannel = process.env.SLACK_HR_CHANNEL;

  if (hrChannel) {
    await client.chat.postMessage({
      channel: hrChannel,
      text: 'New HR Request Submitted',
      blocks: [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `*New HR Request*\n\n*Type:* ${requestType}\n*User:* <@${userId}>\n*Name:* ${realName}\n*Email:* ${email}\n*Request ID:* ${requestId}`,
          },
        },
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `*Details:*\n${Object.entries(details)
              .map(([key, value]) => `• ${key}: ${value}`)
              .join('\n')}`,
          },
        },
        {
          type: 'actions',
          elements: [
            {
              type: 'button',
              text: { type: 'plain_text', text: 'View in Notion' },
              url: `https://notion.so/${requestId.replace(/-/g, '')}`,
            },
          ],
        },
      ],
    });
  }

  await client.chat.postMessage({
    channel: userId,
    text: '✅ Your HR request has been submitted successfully!',
    blocks: [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*Request Submitted*\n\n*Request ID:* ${requestId}\n*Type:* ${requestType}\n*Status:* Pending\n\nEstimated turnaround: 1-2 business days\n\nWe'll notify you via Slack when your request is processed.`,
        },
      },
    ],
  });

  await logInteraction({
    userId,
    question: `Submitted ${requestType} request`,
    response: `Request created with ID: ${requestId}`,
    type: 'request_submission',
    foundAnswer: true,
  });
}

export type { BlockActionPayload, ViewSubmissionPayload };
