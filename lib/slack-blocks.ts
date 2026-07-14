import type { Block, KnownBlock } from '@slack/web-api';

export function actionButtonsBlock(): KnownBlock {
  return {
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
  };
}

export function answerBlocks(answer: string): (KnownBlock | Block)[] {
  return [
    { type: 'section', text: { type: 'mrkdwn', text: answer } },
    actionButtonsBlock(),
  ];
}

export const NOTION_ERROR_MESSAGE =
  'Tuve un problema conectándome a Notion 😕 Por favor intentá de nuevo en unos segundos o contactá a People & Culture directamente.';

export function formatSlackMrkdwn(text: string): string {
  return text
    .replace(/\*\*(.*?)\*\*/g, '*$1*')
    .replace(/^#{1,3}\s+/gm, '')
    .replace(/\[(.*?)\]\((.*?)\)/g, '<$2|$1>');
}
