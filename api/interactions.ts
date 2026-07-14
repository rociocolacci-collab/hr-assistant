import { waitUntil } from '@vercel/functions';
import {
  handleChatChoice,
  handleRequestSubmission,
  handleRequestTypeChange,
  handleSubmitRequest,
  handleTalkToHR,
  type BlockActionPayload,
  type ViewSubmissionPayload,
} from '../lib/hr-actions';
import { verifyInteractionRequest } from '../lib/slack-utils';

export async function POST(request: Request) {
  const rawBody = await request.text();

  try {
    await verifyInteractionRequest({ request, rawBody });

    const params = new URLSearchParams(rawBody);
    const payload = JSON.parse(params.get('payload') ?? '{}') as
      | BlockActionPayload
      | ViewSubmissionPayload;

    if (payload.type === 'block_actions') {
      const action = payload.actions?.[0];
      const route: Record<string, () => Promise<void>> = {
        submit_hr_request: () => handleSubmitRequest(payload),
        escalate_to_hr: () => handleTalkToHR(payload),
        chat_with_sofi: () => handleChatChoice(payload, 'sofi'),
        chat_with_rocio: () => handleChatChoice(payload, 'rocio'),
        request_type_action: () => handleRequestTypeChange(payload),
      };

      const handler = action?.action_id ? route[action.action_id] : undefined;
      if (handler) {
        waitUntil(
          handler().catch((err) =>
            console.error(`${action?.action_id} error:`, err)
          )
        );
      }

      return new Response('', { status: 200 });
    }

    if (
      payload.type === 'view_submission' &&
      payload.view?.callback_id === 'hr_request_modal'
    ) {
      waitUntil(
        handleRequestSubmission(payload).catch((err) =>
          console.error('handleRequestSubmission error:', err)
        )
      );

      return new Response('', { status: 200 });
    }

    return new Response('', { status: 200 });
  } catch (error) {
    console.error('Error handling Slack interaction:', error);
    return new Response('Invalid request', { status: 400 });
  }
}
