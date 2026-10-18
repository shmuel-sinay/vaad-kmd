// Supabase Edge Function "ivr": the phone line (ימות המשיח, extensions of type=api). Deploy with Verify JWT off:
// the phone system calls it without a login. It answers in Yemot's plain-text grammar.
//   ?mode=listen  reads the latest main-room messages aloud (phone recordings are played from the line itself:
//                 the extension's api_dir points at the recordings folder).
//   ?mode=record  records a message (read=...record) and posts it to the main room as a voice message, then adds
//                 a short transcript under it (Gemini through the shared AI keys, when one is free).
// Needs the secret YEMOT_TOKEN ("<system number>:<password>" or an API token) to copy recordings to the site;
// without it a recording is still posted, but can be heard only on the phone.
import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { encodeBase64 } from 'jsr:@std/encoding@1/base64';

const REC_FOLDER = '/2'; // where the record extension saves files (= api_dir of the listen extension)
const LISTEN_COUNT = 10;

const text = (body: string) => new Response(body, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });

/** Text for Yemot TTS: dots, dashes, = and & are part of the response grammar, so they become spaces. */
function say(s: string): string {
  return s
    .replace(/https?:\/\/\S+/g, ' קישור ')
    .replace(/[^\p{Script=Hebrew}a-zA-Z0-9\s,!?'"]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 220);
}

/** Seconds of audio in a PCM WAV file (0 when the header can't be read). */
function wavSeconds(b: Uint8Array): number {
  if (b.length < 44) return 0;
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const byteRate = v.getUint32(28, true);
  return byteRate ? Math.round((b.length - 44) / byteRate) : 0;
}

/** A short Hebrew transcript of a recording through the shared Gemini keys (ai_take_key); null when none is free. */
async function transcribe(db: SupabaseClient, wav: Uint8Array): Promise<string | null> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const { data } = await db.rpc('ai_take_key', { p_user: null });
    const k = (Array.isArray(data) ? data[0] : data) as { id: number | null; api_key: string; model: string } | null;
    if (!k?.id) return null;
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(k.model)}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': k.api_key },
      body: JSON.stringify({
        contents: [{
          role: 'user',
          parts: [
            { inline_data: { mime_type: 'audio/wav', data: encodeBase64(wav) } },
            { text: 'תמלל את ההקלטה בעברית, מילה במילה, בלי הקדמה ובלי הערות. אם אין דיבור ברור, החזר רק: (לא נשמע דיבור ברור)' },
          ],
        }],
        generationConfig: { temperature: 0 },
      }),
    });
    if (!r.ok) {
      await db.rpc('ai_key_result', { p_id: k.id, p_error: `${r.status}: ${(await r.text()).slice(0, 200)}`, p_cooldown: r.status === 429 ? 65 : r.status >= 500 ? 30 : 3600 });
      continue;
    }
    await db.rpc('ai_key_result', { p_id: k.id, p_error: null, p_cooldown: 0 });
    const j = await r.json();
    const t = (j.candidates?.[0]?.content?.parts ?? []).map((x: { text?: string }) => x.text ?? '').join('').trim();
    return t ? t.slice(0, 1500) : null;
  }
  return null;
}

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const p = url.searchParams;
  if (req.method === 'POST') {
    const form = await req.formData().catch(() => null);
    form?.forEach((v, k) => p.set(k, String(v)));
  }
  if (p.get('hangup') === 'yes') return text('');
  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
  const mode = p.get('mode');

  if (mode === 'record') {
    const rec = p.get('REC');
    if (!rec) {
      const name = `${Date.now()}${Math.floor(Math.random() * 900 + 100)}`;
      // REC, (no reuse), record, folder, file name, (recording menu), not on hang-up, (no append), 1..120 seconds
      return text(`read=t-הקליטו את ההודעה לצ'אט הראשי אחרי הצליל, ובסיום הקישו סולמית=REC,,record,${REC_FOLDER},${name},,no,,1,120`);
    }
    const file = (rec.match(/(\d{6,20})(?:\.wav)?\s*$/) ?? [])[1];
    if (!file) return text("id_list_message=t-ההקלטה לא נשמרה, נסו שוב");
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
    const { data: mid, error } = await db.rpc('ivr_post', { p_file: file, p_path: path, p_seconds: seconds, p_phone: p.get('ApiPhone') ?? '' });
    if (error) return text(`id_list_message=t-${say('לא הצלחנו לשלוח את ההודעה, ' + error.message)}`);
    // The caller doesn't wait for the transcript: it is added under the voice message a few seconds later.
    if (mid && wav) {
      const job = transcribe(db, wav).then((t) => t && db.rpc('ivr_transcript', { p_message: mid, p_text: t })).catch(() => {});
      (globalThis as unknown as { EdgeRuntime?: { waitUntil(p: Promise<unknown>): void } }).EdgeRuntime?.waitUntil(job);
    }
    return text("id_list_message=t-ההודעה נשלחה לצ'אט הראשי, תודה");
  }

  // listen (default)
  const { data: main } = await db.from('channels').select('id').eq('is_main', true).maybeSingle();
  const { data: rows } = await db.from('messages').select('author_id, anonymous, body, attachment, poll_id')
    .eq('channel_id', main?.id ?? -1).eq('deleted', false).order('id', { ascending: false }).limit(LISTEN_COUNT * 3);
  const { data: ppl } = await db.from('profiles').select('id, display_name');
  const names = new Map(((ppl ?? []) as { id: string; display_name: string }[]).map((x) => [x.id, x.display_name]));
  const parts: string[] = [];
  for (const m of (rows ?? []) as { author_id: string | null; anonymous: boolean; body: string; attachment: { type?: string; yemot?: string; phone?: boolean } | null }[]) {
    if (parts.length >= LISTEN_COUNT) break;
    const who = m.attachment?.phone ? 'הודעה קולית מהטלפון' : m.anonymous || !m.author_id ? 'אנונימי כתב' : `${names.get(m.author_id) ?? 'חבר'} כתב`;
    if (m.attachment?.phone && m.attachment.yemot) parts.push(`t-${say(who)}.f-${m.attachment.yemot}`);
    else if (say(m.body)) parts.push(`t-${say(who)}.t-${say(m.body)}${m.attachment ? ".t-וצירף קובץ" : ''}`);
    else if (m.attachment) parts.push(`t-${say(who.replace(/ כתב$/, ' שלח'))} ${m.attachment.type === 'video' ? 'סרטון' : 'תמונה'}`);
  }
  if (!parts.length) return text("id_list_message=t-אין עדיין הודעות בצ'אט הראשי");
  // The explanation is heard only on a number's first call; after that the messages start right away.
  const phone = (p.get('ApiPhone') ?? '').replace(/\D/g, '');
  let intro = true;
  if (phone) {
    const { data: seen } = await db.from('phone_listeners').select('phone').eq('phone', phone).maybeSingle();
    if (seen) intro = false;
    else await db.from('phone_listeners').insert({ phone });
  }
  return text(`id_list_message=${intro ? "t-ההודעות האחרונות בצ'אט הראשי, מהחדשה לישנה." : ''}${parts.join('.')}`);
});
