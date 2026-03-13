import { parseHTML } from 'linkedom';

const SiteList: Record<string, string> = {
  'equal-love': 'https://equal-love.jp',
  'not-equal-me': 'https://not-equal-me.jp',
  'nearly-equal-joy': 'https://nearly-equal-joy.jp',
};

type EventItem = {
  tag: string;
  title: string;
  href: string;
  category: string;
};

type Result = Record<string, EventItem[]>;

const trim = (s = '') => s.replace(/\s+/g, ' ').trim();

const json = (data: unknown, status = 200): Response => {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'access-control-allow-origin': '*',
    },
  });
};

function parseUrlParams(
  params: URLSearchParams
): { year: string; month: string } | { error: string } {
  const tokyoDate = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Tokyo' }));
  const defaultYear = String(tokyoDate.getFullYear());
  const defaultMonth = String(tokyoDate.getMonth() + 1).padStart(2, '0');

  const inputYear = params.get('year')?.trim();
  const inputMonth = params.get('month')?.trim();

  let year = defaultYear;
  let month = defaultMonth;

  if (inputYear) {
    const y = Number(inputYear);
    if (!/^\d{4}$/.test(inputYear) || y < 2000 || y > 2100) {
      return { error: 'Invalid year. Must be between 2000 and 2100.' };
    }
    year = inputYear;
  }

  if (inputMonth) {
    const m = Number(inputMonth);
    if (!/^\d{1,2}$/.test(inputMonth) || m < 1 || m > 12) {
      return { error: 'Invalid month. Must be between 1 and 12.' };
    }
    month = String(m).padStart(2, '0');
  }

  return { year, month };
}

function extractCalendar(html: string, baseUrl: string, tag: string): Result {
  const { document } = parseHTML(html);
  const out: Result = {};

  const cells = Array.from(document.querySelectorAll('.calendarBody .cell')) as any[];

  for (const cell of cells) {
    const dateText = trim(cell.querySelector('.date')?.textContent ?? '');
    const day = Number.parseInt(dateText, 10);

    if (!Number.isFinite(day)) continue;

    const events: EventItem[] = [];
    const eventLinks = Array.from(cell.querySelectorAll('div[class*="live"] a[href]')) as any[];

    for (const a of eventLinks) {
      const rawHref = (a.getAttribute('href') ?? '').trim();
      if (!rawHref) continue;

      const href = new URL(rawHref, baseUrl).toString();
      const category = trim(a.querySelector('.cat')?.textContent ?? '');
      const title = trim(a.querySelector('.tit')?.textContent ?? '');

      events.push({ tag, title, category, href });
    }

    if (events.length > 0) {
      const key = String(day);
      out[key] = events;
    }
  }

  return out;
}

export default {
  async fetch(request: Request): Promise<Response> {
    try {
      const url = new URL(request.url);
      const params = parseUrlParams(url.searchParams);

      if ('error' in params) {
        return json({ error: params.error }, 400);
      }

      const { year, month } = params;

      const fetchTasks = Object.entries(SiteList).map(async ([tag, baseUrl]) => {
        const fetchUrl = `${baseUrl}/schedule/calender/${year}/${month}`;
        const response = await fetch(fetchUrl);

        if (!response.ok) {
          throw new Error(`Unable to fetch ${fetchUrl}: ${response.status}`);
        }

        const html = await response.text();
        return extractCalendar(html, fetchUrl, tag);
      });

      const results = await Promise.allSettled(fetchTasks);

      const aggregatedResult: Result = {};
      const errors: string[] = [];
      for (const res of results) {
        if (res.status === 'fulfilled') {
          const siteData = res.value;
          for (const [day, events] of Object.entries(siteData)) {
            (aggregatedResult[day] ??= []).push(...events);
          }
        } else {
          errors.push(res.reason instanceof Error ? res.reason.message : String(res.reason));
        }
      }

      if (
        Object.keys(aggregatedResult).length === 0 &&
        errors.length === Object.keys(SiteList).length
      ) {
        return json({ error: 'All upstream fetches failed', details: errors }, 502);
      }

      return json({
        data: aggregatedResult,
        _meta: errors.length > 0 ? { warnings: errors } : undefined,
      });
    } catch (e) {
      return json({ error: e instanceof Error ? e.message : String(e) }, 500);
    }
  },
} satisfies ExportedHandler;
