import { waitUntil } from '@vercel/functions';
import {
  handleEscalate,
  handleSubmitRequest,
  handleViewSubmission,
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

      if (action?.action_id === 'submit_hr_request') {
        waitUntil(
          handleSubmitRequest(payload).catch((err) =>
            console.error('handleSubmitRequest error:', err)
          )
        );
      }

      if (action?.action_id === 'escalate_to_hr') {
        waitUntil(
          handleEscalate(payload).catch((err) =>
            console.error('handleEscalate error:', err)
          )
        );
      }

      return new Response('', { status: 200 });
    }

    if (payload.type === 'view_submission') {
      waitUntil(
        handleViewSubmission(payload).catch((err) =>
          console.error('handleViewSubmission error:', err)
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
