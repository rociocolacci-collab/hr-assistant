import { Client as NotionClient } from '@notionhq/client';
import type { BlockObjectResponse } from '@notionhq/client/build/src/api-endpoints';

export const notionClient = new NotionClient({ auth: process.env.NOTION_TOKEN });

const NOTION_DB_IDS = {
  HR_REQUESTS: process.env.NOTION_HR_REQUESTS_ID,
  INTERACTIONS_LOG: process.env.NOTION_INTERACTIONS_LOG_ID,
};

export const HR_PAGE_IDS = [
  '26ff3ed090a480debaebdd96c4fa8b7c',
  '271f3ed090a48061a4b7cafff6cc4c98',
  '271f3ed090a480a8af28dae5feb8e6cd',
  '328f3ed090a481a0858aec4e2c81058f',
  '310f3ed090a480429655ea7efcf06060',
  '334f3ed090a480268a76d0817f4e56fe',
  '326f3ed090a480f8bda5f37b6927d564',
  'b5bbce16fd2444a191ed5ea465a6bc86',
  '328f3ed090a481d18722e8dfed62706b',
  '326f3ed090a48003aa67e0269c1eb9b6',
  '328f3ed090a481a1b233d108ea50f5f1',
  '345f3ed090a480bbaaf8e322502f8222',
  '326f3ed090a48163ae54c9a533644789',
  '322f3ed090a4811b9d21d0e3a9332050',
  '334f3ed090a481f8951ad5b89360ba8c',
  '334f3ed090a480a88fe5c607399a192c',
  '278f3ed090a480a3a9a0df1ec03e198b',
  '328f3ed090a481948026c0cf78987b5d',
  '328f3ed090a481918794df886bad2409',
  '26ff3ed090a480d7bcf9dcb810571429',
  '333f3ed090a480ac85b0ef8eec74fc0a',
  '322f3ed090a48010a5dae4c57fdef597',
  '333f3ed090a481dbbe9ed6c769a5e5e9',
  '33ef3ed090a4801d88f7e974b46dabd8',
  '272f3ed090a480569866d26a62caae7a',
  '272f3ed090a480fcaba4f5b246aaadf8',
  '272f3ed090a4806aa0bdd172cd83fe09',
];

export type HRPage = {
  title: string;
  content: string;
  url: string;
};

export type InteractionLog = {
  userId: string;
  question: string;
  response: string;
  type: string;
  foundAnswer: boolean;
};

export type HRRequestInput = {
  requestType: string;
  details: Record<string, string>;
  userId: string;
};

type NotionBlock = BlockObjectResponse & { children?: NotionBlock[] };

function extractTextFromBlocks(blocks: NotionBlock[]): string[] {
  const lines: string[] = [];

  for (const block of blocks) {
    const type = block.type;
    const content = block[type as keyof NotionBlock] as
      | { rich_text?: { plain_text: string }[]; cells?: { plain_text: string }[][] }
      | undefined;

    if (!content) continue;

    const richText = content.rich_text ?? [];
    const text = richText.map((t) => t.plain_text).join('');

    if (text) {
      if (type === 'heading_1' || type === 'heading_2' || type === 'heading_3') {
        lines.push(`\n### ${text}`);
      } else if (type === 'bulleted_list_item' || type === 'numbered_list_item') {
        lines.push(`- ${text}`);
      } else if (type === 'callout') {
        lines.push(`> ${text}`);
      } else if (type === 'table_row' && content.cells) {
        const cells = content.cells.map((cell) => cell.map((t) => t.plain_text).join(''));
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

async function fetchPageBlocks(pageId: string): Promise<NotionBlock[]> {
  const blocks: NotionBlock[] = [];
  let cursor: string | undefined;

  do {
    const res = await notionClient.blocks.children.list({
      block_id: pageId,
      start_cursor: cursor,
      page_size: 100,
    });

    blocks.push(...(res.results as NotionBlock[]));
    cursor = res.has_more ? res.next_cursor ?? undefined : undefined;
  } while (cursor);

  return blocks;
}

function getPageTitle(pageMeta: Awaited<ReturnType<typeof notionClient.pages.retrieve>>): string {
  if (!('properties' in pageMeta) || !pageMeta.properties) {
    return 'HR Policy';
  }

  const props = pageMeta.properties as Record<
    string,
    { type: string; title?: { plain_text: string }[] }
  >;

  for (const key of ['title', 'Page', 'Name']) {
    const prop = props[key];
    if (prop?.type === 'title' && prop.title?.[0]?.plain_text) {
      return prop.title[0].plain_text;
    }
  }

  return 'HR Policy';
}

export async function fetchHRKnowledge(): Promise<HRPage[]> {
  const pages: HRPage[] = [];

  await Promise.all(
    HR_PAGE_IDS.map(async (pageId) => {
      try {
        const [pageMeta, blocks] = await Promise.all([
          notionClient.pages.retrieve({ page_id: pageId }),
          fetchPageBlocks(pageId),
        ]);

        const title = getPageTitle(pageMeta);
        const content = extractTextFromBlocks(blocks).join('\n').trim();

        pages.push({
          title,
          content,
          url: `https://www.notion.so/${pageId}`,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`Notion page ${pageId} error:`, message);
      }
    })
  );

  return pages;
}

export async function buildKnowledgeText(): Promise<string> {
  const hrPages = await fetchHRKnowledge();

  if (hrPages.length === 0) {
    return '';
  }

  return hrPages
    .map((p) => `=== ${p.title.toUpperCase()} ===\n${p.content}\nURL: ${p.url}`)
    .join('\n\n');
}

export async function logInteraction(data: InteractionLog): Promise<void> {
  if (!NOTION_DB_IDS.INTERACTIONS_LOG) return;

  try {
    await notionClient.pages.create({
      parent: { database_id: NOTION_DB_IDS.INTERACTIONS_LOG },
      properties: {
        'User ID': { rich_text: [{ text: { content: data.userId } }] },
        Question: { rich_text: [{ text: { content: data.question.slice(0, 2000) } }] },
        Response: { rich_text: [{ text: { content: data.response.slice(0, 2000) } }] },
        Timestamp: { date: { start: new Date().toISOString() } },
        Type: { select: { name: data.type } },
        'Found Answer': { checkbox: data.foundAnswer },
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('Failed to log interaction:', message);
  }
}

export async function createHRRequest(hrRequest: HRRequestInput): Promise<string> {
  if (!NOTION_DB_IDS.HR_REQUESTS) {
    throw new Error('NOTION_HR_REQUESTS_ID is not configured');
  }

  const response = await notionClient.pages.create({
    parent: { database_id: NOTION_DB_IDS.HR_REQUESTS },
    properties: {
      Title: {
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
      Status: { select: { name: 'Pending' } },
      'Submission Date': { date: { start: new Date().toISOString() } },
      Details: {
        rich_text: [
          {
            text: {
              content: JSON.stringify(hrRequest.details, null, 2).slice(0, 2000),
            },
          },
        ],
      },
    },
  });

  return response.id;
}
