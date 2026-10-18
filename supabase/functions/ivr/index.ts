// Supabase Edge Function "ivr": the phone line (ימות המשיח, extensions of type=api). Deploy with Verify JWT off:
// the phone system calls it without a login. It answers in Yemot's plain-text grammar. One mode per extension:
//   ?mode=listen    the main room: what is new since this number last listened (newest first), then older.
//   ?mode=record    a voice message to the main room, posted without a name ("מהטלפון"), with a transcript.
//   ?mode=rooms     a room that an admin gave a number (channels.phone_key): hear it.
//   ?mode=polls     personal code, then pick a poll and vote (private, like on the site).
//   ?mode=personal  personal code: hear private chats, record to the main room in his name, answer by voice.
//   ?mode=tzintuk   rings (צינתוק) the members who asked, for a message an inspector flagged (called by the database).
// Recordings live in the extension's folder REC_FOLDER (the api_dir of every extension below), so "f-<file>" plays them.
// Secret YEMOT_TOKEN ("<system number>:<password>") copies recordings to the site and sends rings; without it a
// recording is posted but heard only on the phone, and no rings are sent.
import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { encodeBase64 } from 'jsr:@std/encoding@1/base64';

const REC_FOLDER = '/2';
const LISTEN_COUNT = 10;

const text = (body: string) => new Response(body, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
const play = (...parts: string[]) => text(`id_list_message=${parts.join('.')}`);
/** A line spoken by the phone system's own Hebrew voice. */
const t = (s: string) => `t-${say(s)}`;

/** Text for Yemot TTS: dots, dashes, = and & are part of the response grammar, so they become spaces. */
function say(s: string): string {
  return s
    .replace(/https?:\/\/\S+/g, ' קישור ')
    .replace(/[^\p{Script=Hebrew}a-zA-Z0-9\s,!?'"]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 220);
}

/** Ask for digits: name, (no reuse), max, min, seconds to wait, how to repeat it, block *, block 0. */
const askDigits = (prompt: string, name: string, max: number, min = 1) =>
  text(`read=${t(prompt)}=${name},no,${max},${min},10,Digits,no,no`);

function wavSeconds(b: Uint8Array): number {
  if (b.length < 44) return 0;
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const byteRate = v.getUint32(28, true);
  return byteRate ? Math.round((b.length - 44) / byteRate) : 0;
}

interface Row {
  id: number;
  author_id: string | null;
  anonymous: boolean;
  body: string;
  attachment: { type?: string; yemot?: string; phone?: boolean } | null;
}

function lineFor(m: Row, names: Map<string, string>): string | null {
  const who = m.attachment?.phone ? 'הודעה קולית מהטלפון' : m.anonymous || !m.author_id ? 'אנונימי כתב' : `${names.get(m.author_id) ?? 'חבר'} כתב`;
  if (m.attachment?.yemot && !m.body) return `${t(m.attachment.phone ? who : `${who.replace(/ כתב$/, '')} שלח הודעה קולית`)}.f-${m.attachment.yemot}`;
  if (say(m.body)) return `${t(who)}.${t(m.body)}${m.attachment ? '.t-וצירף קובץ' : ''}`;
  if (m.attachment) return t(`${who.replace(/ כתב$/, ' שלח')} ${m.attachment.type === 'video' ? 'סרטון' : 'תמונה'}`);
  return null;
}

/** A short Hebrew transcript through the shared Gemini keys (ai_take_key); null when none is free. */
async function transcribe(db: SupabaseClient, wav: Uint8Array): Promise<string | null> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const { data } = await db.rpc('ai_take_key', { p_user: null });
    const k = (Array.isArray(data) ? data[0] : data) as { id: number | null; api_key: string; model: string } | null;
    if (!k?.id) return null;
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(k.model)}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': k.api_key },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [
          { inline_data: { mime_type: 'audio/wav', data: encodeBase64(wav) } },
          { text: 'תמלל את ההקלטה בעברית, מילה במילה, בלי הקדמה ובלי הערות. אם אין דיבור ברור, החזר רק: (לא נשמע דיבור ברור)' },
        ] }],
        generationConfig: { temperature: 0 },
      }),
    });
    if (!r.ok) {
      await db.rpc('ai_key_result', { p_id: k.id, p_error: `${r.status}: ${(await r.text()).slice(0, 200)}`, p_cooldown: r.status === 429 ? 65 : r.status >= 500 ? 30 : 3600 });
      continue;
    }
    await db.rpc('ai_key_result', { p_id: k.id, p_error: null, p_cooldown: 0 });
    const j = await r.json();
    const out = (j.candidates?.[0]?.content?.parts ?? []).map((x: { text?: string }) => x.text ?? '').join('').trim();
    return out ? out.slice(0, 1500) : null;
  }
  return null;
}

/** The recording the phone system just made: its name, and (with YEMOT_TOKEN) a copy in the site's storage. */
async function saveRecording(db: SupabaseClient, rec: string) {
  const file = (rec.match(/(\d{6,20})(?:\.wav)?\s*$/) ?? [])[1];
  if (!file) return null;
  let path: string | null = null;
  let seconds = 0;
  let wav: Uint8Array | null = null;
  const token = Deno.env.get('YEMOT_TOKEN');
  if (token) {
    try {
      const r = await fetch(`https://www.call2all.co.il/ym/api/DownloadFile?token=${encodeURIComponent(token)}&path=${encodeURIComponent(`ivr2:${REC_FOLDER}/${file}.wav`)}`);
      const bytes = new Uint8Array(await r.arrayBuffer());
      // A real recording starts with "RIFF"; an error comes back as JSON text.
      if (r.ok && bytes.length > 44 && String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF') {
        seconds = wavSeconds(bytes);
        wav = bytes;
        const name = `m/${crypto.randomUUID()}.wav`;
        const up = await db.storage.from('media').upload(name, bytes, { contentType: 'audio/wav' });
        if (!up.error) path = name;
      }
    } catch {
      /* keep it phone-only */
    }
  }
  return { file, path, seconds, wav };
}

/** After answering: add a transcript under the voice message in the background. */
function transcribeLater(db: SupabaseClient, wav: Uint8Array | null, fn: 'ivr_transcript' | 'ivr_transcript_dm', id: number | null) {
  if (!wav || !id) return;
  const job = transcribe(db, wav).then((tx) => tx && db.rpc(fn, { p_message: id, p_text: tx })).catch(() => {});
  (globalThis as unknown as { EdgeRuntime?: { waitUntil(p: Promise<unknown>): void } }).EdgeRuntime?.waitUntil(job);
}

const recordPrompt = (prompt: string, name: string) =>
  // REC, (no reuse), record, folder, file name, (recording menu), not saved on hang-up, (no append), 1..120 seconds
  text(`read=${t(prompt)}=REC,,record,${REC_FOLDER},${name},,no,,1,120`);
const newName = () => `${Date.now()}${Math.floor(Math.random() * 900 + 100)}`;

/** Reads a room aloud: what is new for this caller (newest first), else the latest three. */
async function listenRoom(db: SupabaseClient, who: string, channelId: number, title: string): Promise<Response> {
  const { data: seen } = await db.from('phone_seen').select('last_id').eq('who', who).eq('channel_id', channelId).maybeSingle();
  const lastId = Number(seen?.last_id ?? 0);
  const { data: rows } = await db.from('messages').select('id, author_id, anonymous, body, attachment')
    .eq('channel_id', channelId).eq('deleted', false).order('id', { ascending: false }).limit(LISTEN_COUNT * 3);
  const all = (rows ?? []) as Row[];
  if (!all.length) return play(t(`אין עדיין הודעות ב${title}`));
  const { data: ppl } = await db.from('profiles').select('id, display_name');
  const names = new Map(((ppl ?? []) as { id: string; display_name: string }[]).map((x) => [x.id, x.display_name]));
  const fresh = all.filter((m) => m.id > lastId);
  const parts: string[] = [];
  for (const m of fresh.length ? fresh : all) {
    if (parts.length >= (fresh.length ? LISTEN_COUNT : 3)) break;
    const l = lineFor(m, names);
    if (l) parts.push(l);
  }
  if (!parts.length) return play(t(`אין עדיין הודעות ב${title}`));
  await db.from('phone_seen').upsert({ who, channel_id: channelId, last_id: all[0].id });
  // The explanation is for the first call only; after that the messages start at once.
  const intro = !seen ? t(`ההודעות האחרונות ב${title}, מהחדשה לישנה`) : fresh.length ? 't-הודעות חדשות' : t('אין הודעות חדשות, אלה האחרונות');
  return play(intro, ...parts);
}

/** The member behind a personal code: asks for it, or answers with a message (Response), or his id. */
async function who(db: SupabaseClient, p: URLSearchParams): Promise<string | Response> {
  const code = p.get('CODE');
  if (!code) return text(`read=${t('הקישו את הקוד האישי שלכם, שש ספרות')}=CODE,no,6,6,10,Digits,no,no`);
  const { data, error } = await db.rpc('phone_login', { p_code: code, p_caller: p.get('ApiPhone') ?? '' });
  if (error) return play(t('יותר מדי נסיונות שגויים, נסו שוב מאוחר יותר'));
  if (!data) return play(t('הקוד שגוי. את הקוד קובעים באתר, בהגדרות'));
  return data as string;
}

Deno.serve(async (req) => {
  const p = new URL(req.url).searchParams;
  if (req.method === 'POST') {
    const form = await req.formData().catch(() => null);
    form?.forEach((v, k) => p.set(k, String(v)));
  }
  if (p.get('hangup') === 'yes') return text('');
  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
  const mode = p.get('mode') ?? 'listen';
  const phone = (p.get('ApiPhone') ?? '').replace(/\D/g, '') || 'hidden';
  const { data: main } = await db.from('channels').select('id, name').eq('is_main', true).maybeSingle();
  const mainId = (main?.id as number | undefined) ?? -1;

  // ---- rings for a flagged message (called by the database; it only sends what the management asked for) ----
  if (mode === 'tzintuk') {
    const token = Deno.env.get('YEMOT_TOKEN');
    const { data: batch } = await db.rpc('tzintuk_batch');
    const out: unknown[] = [];
    for (const b of (batch ?? []) as { id: number; phones: string[] }[]) {
      if (!token || !b.phones.length) { out.push({ id: b.id, skipped: true }); continue; }
      const r = await fetch(`https://www.call2all.co.il/ym/api/RunTzintuk?token=${encodeURIComponent(token)}&phones=${b.phones.join(',')}`);
      out.push({ id: b.id, status: r.status, body: (await r.text()).slice(0, 200) });
    }
    return Response.json(out);
  }

  // ---- a nameless voice message to the main room ----
  if (mode === 'record') {
    const rec = p.get('REC');
    if (!rec) return recordPrompt("הקליטו את ההודעה לצ'אט הראשי אחרי הצליל, ובסיום הקישו סולמית", newName());
    const r = await saveRecording(db, rec);
    if (!r) return play(t('ההקלטה לא נשמרה, נסו שוב'));
    const { data: mid, error } = await db.rpc('ivr_post', { p_file: r.file, p_path: r.path, p_seconds: r.seconds, p_phone: phone, p_channel: null, p_reply_to: null });
    if (error) return play(t(`לא הצלחנו לשלוח את ההודעה, ${error.message}`));
    transcribeLater(db, r.wav, 'ivr_transcript', mid as number | null);
    return play(t("ההודעה נשלחה לצ'אט הראשי, תודה"));
  }

  // ---- a room with a phone number ----
  if (mode === 'rooms') {
    const { data: rooms } = await db.from('channels').select('id, name, phone_key').not('phone_key', 'is', null).order('phone_key');
    const list = (rooms ?? []) as { id: number; name: string; phone_key: number }[];
    if (!list.length) return play(t('עדיין אין חדרים בטלפון'));
    const room = list.find((x) => String(x.phone_key) === p.get('ROOM'));
    if (!room) {
      const menu = list.map((x) => `לחדר ${x.name} הקישו ${x.phone_key}`).join('. ');
      return askDigits(menu, 'ROOM', 3);
    }
    return await listenRoom(db, phone, room.id, `חדר ${room.name}`);
  }

  // ---- polls: vote with the personal code ----
  if (mode === 'polls') {
    const u = await who(db, p);
    if (typeof u !== 'string') return u;
    const { data: polls } = await db.from('polls').select('id, question').eq('closed', false).order('id', { ascending: false }).limit(5);
    const list = (polls ?? []) as { id: number; question: string }[];
    if (!list.length) return play(t('אין כרגע סקרים פתוחים'));
    const poll = list[Number(p.get('POLL')) - 1];
    if (!poll) return askDigits(list.map((x, i) => `סקר ${i + 1}, ${x.question}`).join('. ') + '. הקישו את מספר הסקר', 'POLL', 1);
    const { data: opts } = await db.from('poll_options').select('id, label').eq('poll_id', poll.id).order('position');
    const options = (opts ?? []) as { id: number; label: string }[];
    const opt = options[Number(p.get('OPT')) - 1];
    if (!opt) return askDigits(`${poll.question}. ` + options.map((o, i) => `ל${o.label} הקישו ${i + 1}`).join('. '), 'OPT', 1);
    const { error } = await db.rpc('phone_vote', { p_user: u, p_poll: poll.id, p_option: opt.id });
    if (error) return play(t(`ההצבעה לא נקלטה, ${error.message}`));
    const { data: votes } = await db.from('poll_votes').select('option_id').eq('poll_id', poll.id);
    const counts = options.map((o) => `${o.label}, ${((votes ?? []) as { option_id: number }[]).filter((v) => v.option_id === o.id).length}`);
    return play(t('הצבעתכם נקלטה, תודה'), t(`התוצאות כרגע. ${counts.join('. ')}`));
  }

  // ---- the personal area ----
  if (mode === 'personal') {
    const u = await who(db, p);
    if (typeof u !== 'string') return u;
    const menu = p.get('MENU');
    if (!menu) return askDigits("לשמיעת הודעות פרטיות הקישו 1. להקלטת הודעה לצ'אט הראשי בשמכם הקישו 2. למענה קולי לשיחה הפרטית האחרונה הקישו 3", 'MENU', 1);

    // 1: private messages not read yet, newest conversation first
    if (menu === '1') {
      const { data: mine } = await db.from('dm_participants').select('conversation_id, hidden, last_read_at').eq('user_id', u);
      const { data: ppl } = await db.from('profiles').select('id, display_name');
      const names = new Map(((ppl ?? []) as { id: string; display_name: string }[]).map((x) => [x.id, x.display_name]));
      const parts: string[] = [];
      const convs = (mine ?? []) as { conversation_id: number; hidden: boolean; last_read_at: string }[];
      for (const c of convs) {
        if (parts.length >= 8) break;
        const { data: msgs } = await db.from('dm_messages').select('id, sender_id, body, attachment').eq('conversation_id', c.conversation_id)
          .eq('deleted', false).gt('created_at', c.last_read_at).order('id', { ascending: false }).limit(5);
        let any = false;
        for (const m of (msgs ?? []) as { id: number; sender_id: string | null; body: string; attachment: { yemot?: string } | null }[]) {
          if (m.sender_id === u || (m.sender_id === null && c.hidden)) continue; // my own messages
          const from = m.sender_id ? names.get(m.sender_id) ?? 'חבר' : 'אנונימי';
          if (m.attachment?.yemot && !m.body) parts.push(`${t(`${from} שלח הודעה קולית`)}.f-${m.attachment.yemot}`);
          else if (say(m.body)) parts.push(`${t(`${from} כתב`)}.${t(m.body)}`);
          else continue;
          any = true;
        }
        if (any) await db.rpc('phone_dm_read', { p_user: u, p_conv: c.conversation_id });
      }
      return parts.length ? play(t('הודעות פרטיות חדשות'), ...parts) : play(t('אין הודעות פרטיות חדשות'));
    }

    // 2: a voice message to the main room, in his own name
    if (menu === '2') {
      const rec = p.get('REC');
      if (!rec) return recordPrompt("הקליטו את ההודעה לצ'אט הראשי אחרי הצליל, ובסיום הקישו סולמית", newName());
      const r = await saveRecording(db, rec);
      if (!r) return play(t('ההקלטה לא נשמרה, נסו שוב'));
      const { data: mid, error } = await db.rpc('phone_send_message', { p_user: u, p_channel: mainId, p_file: r.file, p_path: r.path, p_seconds: r.seconds });
      if (error) return play(t(`לא הצלחנו לשלוח, ${error.message}`));
      transcribeLater(db, r.wav, 'ivr_transcript', mid as number | null);
      return play(t("ההודעה נשלחה לצ'אט הראשי בשמכם, תודה"));
    }

    // 3: a voice answer in the private conversation with the latest activity
    if (menu === '3') {
      const { data: mine } = await db.from('dm_participants').select('conversation_id').eq('user_id', u);
      const ids = ((mine ?? []) as { conversation_id: number }[]).map((x) => x.conversation_id);
      const { data: last } = ids.length
        ? await db.from('dm_conversations').select('id').in('id', ids).order('last_message_at', { ascending: false }).limit(1).maybeSingle()
        : { data: null };
      if (!last) return play(t('אין לכם שיחות פרטיות'));
      const rec = p.get('REC');
      if (!rec) return recordPrompt('הקליטו את התשובה אחרי הצליל, ובסיום הקישו סולמית', newName());
      const r = await saveRecording(db, rec);
      if (!r) return play(t('ההקלטה לא נשמרה, נסו שוב'));
      const { data: mid, error } = await db.rpc('phone_send_dm', { p_user: u, p_conv: last.id, p_file: r.file, p_path: r.path, p_seconds: r.seconds });
      if (error) return play(t(`לא הצלחנו לשלוח, ${error.message}`));
      transcribeLater(db, r.wav, 'ivr_transcript_dm', mid as number | null);
      return play(t('התשובה נשלחה, תודה'));
    }
    return play(t('בחירה לא תקינה'));
  }

  // ---- listen (default): the main room ----
  return await listenRoom(db, phone, mainId, main?.name ? `${main.name}` : "צ'אט הראשי");
});
