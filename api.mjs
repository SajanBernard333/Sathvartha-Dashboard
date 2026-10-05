// Zion Sathvartha dashboard API on Netlify Functions + Netlify Blobs (one blob per record).
import { getStore } from "@netlify/blobs";

const TABLES = {
  contacts: { cols: ['name','phone','location','fellowship','evg','source','pickup','escort','notes','date',
                     'ready','ready_date','attended','sathvartha_date','in_fellowship','fellowship_date'],
              required: ['name','phone'], prefix: 'ZS-' },
  followups: { cols: ['contact_id','date','topic','notes'], required: ['contact_id','topic'], prefix: 'fu-' },
  missions:  { cols: ['host','date','attendees','topic','highlights','fellowship'], required: ['host','topic'], prefix: 'hm-' },
  topics:    { cols: ['title','type','date'], required: ['title'], prefix: 'tp-' },
};
const today = () => new Date().toISOString().slice(0, 10);
const json = (d, s = 200) => new Response(JSON.stringify(d), { status: s, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
const newId = (p) => p + crypto.randomUUID().replace(/-/g, '').slice(0, 6).toUpperCase();

function pick(table, body) {
  const out = {};
  for (const c of TABLES[table].cols) if (body[c] !== undefined) out[c] = typeof body[c] === 'string' ? body[c].trim().slice(0, 1000) : body[c];
  return out;
}

export default async (req, context) => {
  const url = new URL(req.url);
  const path = url.pathname.replace(/\/+$/, '');

  const pass = Netlify.env.get('TEAM_PASSCODE');
  if (pass && (req.headers.get('x-passcode') || '') !== pass) return json({ error: 'unauthorized' }, 401);

  const store = getStore({ name: 'zion-sathvartha', consistency: 'strong' });
  const touch = () => store.set('meta/version', String(Date.now()));

  if (path === '/api/version') return json({ v: (await store.get('meta/version')) || '0' });

  if (path === '/api/state' && req.method === 'GET') {
    const out = { serverDate: today(), v: (await store.get('meta/version')) || '0' };
    await Promise.all(Object.keys(TABLES).map(async (t) => {
      const { blobs } = await store.list({ prefix: t + '/' });
      const rows = await Promise.all(blobs.map(b => store.get(b.key, { type: 'json' })));
      out[t] = rows.filter(Boolean).sort((a, b) => ((b.created_at || '') > (a.created_at || '') ? 1 : -1));
    }));
    return json(out);
  }

  const m = path.match(/^\/api\/(contacts|followups|missions|topics)(?:\/([\w-]+))?$/);
  if (!m) return json({ error: 'not found' }, 404);
  const [, table, id] = m;
  const spec = TABLES[table];

  try {
    if (req.method === 'POST' && !id) {
      const body = pick(table, await req.json());
      for (const r of spec.required) if (!body[r]) return json({ error: `${r} is required` }, 400);
      if (!body.date) body.date = today();
      const row = { id: newId(spec.prefix), ...body, created_at: new Date().toISOString() };
      await store.setJSON(`${table}/${row.id}`, row);
      await touch();
      return json(row, 201);
    }
    if (req.method === 'PATCH' && id) {
      const body = pick(table, await req.json());
      const cur = await store.get(`${table}/${id}`, { type: 'json' });
      if (!cur) return json({ error: 'not found' }, 404);
      await store.setJSON(`${table}/${id}`, { ...cur, ...body });
      await touch();
      return json({ ok: true });
    }
    if (req.method === 'DELETE' && id) {
      await store.delete(`${table}/${id}`);
      if (table === 'contacts') {
        const { blobs } = await store.list({ prefix: 'followups/' });
        await Promise.all(blobs.map(async (b) => {
          const f = await store.get(b.key, { type: 'json' });
          if (f && f.contact_id === id) await store.delete(b.key);
        }));
      }
      await touch();
      return json({ ok: true });
    }
  } catch (e) {
    return json({ error: String(e.message || e) }, 500);
  }
  return json({ error: 'method not allowed' }, 405);
};

export const config = { path: '/api/*' };
