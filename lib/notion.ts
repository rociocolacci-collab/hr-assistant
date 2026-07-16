import { Client as NotionClient } from '@notionhq/client';
import type { BlockObjectResponse } from '@notionhq/client/build/src/api-endpoints';

export const notionClient = new NotionClient({ auth: process.env.NOTION_TOKEN });

const NOTION_DB_IDS = {
  HR_REQUESTS: process.env.NOTION_HR_REQUESTS_ID,
  INTERACTIONS_LOG: process.env.NOTION_INTERACTIONS_LOG_ID,
};

const KNOWLEDGE_TTL_MS = 60 * 60 * 1000; // 1h
const PAGE_FETCH_CONCURRENCY = 6;
const MAX_KNOWLEDGE_CHARS = 120_000;

let knowledgeCache: { text: string; expiresAt: number } | null = null;

function normalizeNotionId(id: string): string {
  return id.replace(/-/g, '');
}

function isExcludedDatabasePage(
  pageMeta: Awaited<ReturnType<typeof notionClient.pages.retrieve>>
): boolean {
  if (!('parent' in pageMeta) || pageMeta.parent.type !== 'database_id') {
    return false;
  }

  const parentId = normalizeNotionId(pageMeta.parent.database_id);
  const excluded = [NOTION_DB_IDS.HR_REQUESTS, NOTION_DB_IDS.INTERACTIONS_LOG]
    .filter(Boolean)
    .map((id) => normalizeNotionId(id as string));

  return excluded.includes(parentId);
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<R | null>
): Promise<R[]> {
  const results: R[] = [];
  let index = 0;

  async function worker() {
    while (index < items.length) {
      const current = index++;
      const result = await fn(items[current]);
      if (result !== null) {
        results.push(result);
      }
    }
  }

  const workers = Math.min(concurrency, items.length);
  await Promise.all(Array.from({ length: workers }, () => worker()));
  return results;
}

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

async function fetchBlockChildren(blockId: string, depth = 0): Promise<NotionBlock[]> {
  if (depth > 5) {
    return [];
  }

  const blocks: NotionBlock[] = [];
  let cursor: string | undefined;

  do {
    const res = await notionClient.blocks.children.list({
      block_id: blockId,
      start_cursor: cursor,
      page_size: 100,
    });

    for (const block of res.results as NotionBlock[]) {
      if (
        block.has_children &&
        block.type !== 'child_page' &&
        block.type !== 'child_database'
      ) {
        block.children = await fetchBlockChildren(block.id, depth + 1);
      }
      blocks.push(block);
    }

    cursor = res.has_more ? res.next_cursor ?? undefined : undefined;
  } while (cursor);

  return blocks;
}

async function fetchPageBlocks(pageId: string): Promise<NotionBlock[]> {
  return fetchBlockChildren(pageId);
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

  for (const prop of Object.values(props)) {
    if (prop?.type === 'title' && prop.title?.[0]?.plain_text) {
      return prop.title[0].plain_text;
    }
  }

  return 'HR Policy';
}

async function discoverHRPageIds(): Promise<string[]> {
  const pageIds: string[] = [];
  let cursor: string | undefined;

  do {
    const res = await notionClient.search({
      filter: { property: 'object', value: 'page' },
      start_cursor: cursor,
      page_size: 100,
    });

    for (const result of res.results) {
      if (result.object === 'page' && 'id' in result) {
        pageIds.push(result.id);
      }
    }

    cursor = res.has_more ? res.next_cursor ?? undefined : undefined;
  } while (cursor);

  return pageIds;
}

export async function fetchHRKnowledge(): Promise<HRPage[]> {
  const pageIds = await discoverHRPageIds();
  console.log(`Notion search discovered ${pageIds.length} pages`);

  const pages = await mapWithConcurrency(pageIds, PAGE_FETCH_CONCURRENCY, async (pageId) => {
    try {
      const pageMeta = await notionClient.pages.retrieve({ page_id: pageId });

      if ('archived' in pageMeta && pageMeta.archived) {
        return null;
      }

      if (isExcludedDatabasePage(pageMeta)) {
        return null;
      }

      const blocks = await fetchPageBlocks(pageId);
      const title = getPageTitle(pageMeta);
      const content = extractTextFromBlocks(blocks).join('\n').trim();

      if (!content) {
        return null;
      }

      return {
        title,
        content,
        url: `https://www.notion.so/${pageId.replace(/-/g, '')}`,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`Notion page ${pageId} error:`, message);
      return null;
    }
  });

  console.log(`Notion knowledge loaded ${pages.length} pages with content`);
  return pages;
}

export async function buildKnowledgeText(): Promise<string> {
  if (knowledgeCache && Date.now() < knowledgeCache.expiresAt) {
    return knowledgeCache.text;
  }

  const hrPages = await fetchHRKnowledge();

  if (hrPages.length === 0) {
    knowledgeCache = null;
    return '';
  }

  const sections: string[] = [];
  let totalChars = 0;

  for (const page of hrPages) {
    const section = `=== ${page.title.toUpperCase()} ===\n${page.content}\nURL: ${page.url}`;
    if (totalChars + section.length > MAX_KNOWLEDGE_CHARS) {
      console.warn(
        `Knowledge truncated at ${sections.length} pages (${totalChars} chars) to stay within limit`
      );
      break;
    }
    sections.push(section);
    totalChars += section.length;
  }

  const text = sections.join('\n\n');
  console.log(`Knowledge text size: ${text.length} chars from ${sections.length} pages`);

  knowledgeCache = {
    text,
    expiresAt: Date.now() + KNOWLEDGE_TTL_MS,
  };

  return text;
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
