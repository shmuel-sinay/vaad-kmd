import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { appUrl, supabase } from '../supabase';
import { errorText, timeAgo } from '../lib/format';
import { Modal, useFeedback } from './Feedback';
import Icon from './Icon';

type Mode = 'open' | 'code' | 'limit' | 'emails';
interface SideChat {
  id: number;
  token: string;
  title: string;
  created_at: string;
  expires_at: string | null;
  mode: Mode;
  access_code: string | null;
  max_people: number | null;
  allowed_emails: string[];
  people: number;
  messages: number;
}
interface Person {
  id: number;
  name: string;
  email: string | null;
  created_at: string;
  messages: number;
}
interface Access {
  mode: Mode;
  code: string;
  max: number;
  emails: string;
}

const HOURS = [
  { h: 6, label: '6 שעות' },
  { h: 24, label: 'יום' },
  { h: 72, label: '3 ימים' },
  { h: 168, label: 'שבוע' },
  { h: 0, label: 'ללא הגבלה' },
];
const MODES: { id: Mode; label: string; hint: string }[] = [
  { id: 'open', label: 'קישור בלבד', hint: 'כל מי שיש לו את הקישור נכנס אחרי שהוא כותב שם.' },
  { id: 'code', label: 'קוד כניסה', hint: 'צריך גם את הקישור וגם קוד שאתה נותן. שלח את הקוד בנפרד מהקישור.' },
  { id: 'limit', label: 'מגבלת משתתפים', hint: 'רק מספר האנשים הראשונים שנכנסים. אחר כך הצ\'אט מלא (אפשר להסיר מישהו ולפנות מקום).' },
  { id: 'emails', label: 'רק מיילים מסוימים', hint: 'רק מי שכותב כתובת שברשימה נכנס (בלי אימות במייל). אותה כתובת ממכשיר אחר חוזרת לאותו מקום.' },
];
const linkOf = (token: string) => `${appUrl()}#/x/${token}`;
const randomCode = () => String(Math.floor(100000 + Math.random() * 900000));
const emailList = (s: string) => s.split(/[\s,;]+/).map((x) => x.trim()).filter(Boolean);
const accessSummary = (c: SideChat) =>
  c.mode === 'code'
    ? `קוד כניסה: ${c.access_code}`
    : c.mode === 'limit'
    ? `${c.people} מתוך ${c.max_people} מקומות`
    : c.mode === 'emails'
    ? `${c.allowed_emails.length} כתובות מייל`
    : 'קישור בלבד';

/** Entry rules: mode plus the code / seat count / address list it needs. */
function AccessFields({ value, onChange }: { value: Access; onChange: (a: Access) => void }) {
  const mode = MODES.find((m) => m.id === value.mode)!;
  return (
    <div className="form-stack">
      <div className="chips">
        {MODES.map((m) => (
          <button type="button" key={m.id} className={`chip-btn ${value.mode === m.id ? 'on' : ''}`} onClick={() => onChange({ ...value, mode: m.id, code: m.id === 'code' && !value.code ? randomCode() : value.code })}>
            {m.label}
          </button>
        ))}
      </div>
      <p className="muted small">{mode.hint}</p>
      {value.mode === 'code' && (
        <div className="row gap">
          <input className="grow" dir="ltr" value={value.code} onChange={(e) => onChange({ ...value, code: e.target.value })} placeholder="קוד כניסה (לפחות 4 תווים)" />
          <button type="button" className="btn text small" onClick={() => onChange({ ...value, code: randomCode() })}>קוד חדש</button>
        </div>
      )}
      {value.mode === 'limit' && (
        <label className="row gap">
          <span>כמה אנשים יכולים להיכנס:</span>
          <input type="number" min={1} max={500} value={value.max} onChange={(e) => onChange({ ...value, max: Number(e.target.value) })} style={{ width: 90 }} />
        </label>
      )}
      {value.mode === 'emails' && (
        <textarea dir="ltr" rows={3} value={value.emails} onChange={(e) => onChange({ ...value, emails: e.target.value })} placeholder="כתובת מייל בכל שורה" />
      )}
    </div>
  );
}

function accessArgs(a: Access) {
  return {
    p_mode: a.mode,
    p_code: a.mode === 'code' ? a.code.trim() : null,
    p_max: a.mode === 'limit' ? a.max : null,
    p_emails: a.mode === 'emails' ? emailList(a.emails) : null,
  };
}

/** Change who may enter, see who joined, and remove someone. */
function AccessDialog({ chat, onClose, onSaved }: { chat: SideChat; onClose: () => void; onSaved: () => void }) {
  const { toast, confirm } = useFeedback();
  const [access, setAccess] = useState<Access>({ mode: chat.mode, code: chat.access_code ?? '', max: chat.max_people ?? 5, emails: chat.allowed_emails.join('\n') });
  const [people, setPeople] = useState<Person[] | null>(null);
  const loadPeople = useCallback(async () => {
    const { data } = await supabase.rpc('side_chat_people_list', { p_id: chat.id });
    setPeople((data as Person[]) ?? []);
  }, [chat.id]);
  useEffect(() => {
    loadPeople();
  }, [loadPeople]);

  async function save() {
    const { error } = await supabase.rpc('side_chat_set_access', { p_id: chat.id, ...accessArgs(access) });
    if (error) return toast(errorText(error), 'error');
    toast('הכניסה עודכנה. מי שכבר בפנים נשאר.');
    onSaved();
    onClose();
  }

  async function remove(p: Person) {
    if (!(await confirm({ title: `הסרת ${p.name}`, body: 'הוא ייצא מהצ\'אט ולא יוכל לכתוב. ההודעות שלו נשארות. כדי לחזור הוא יצטרך להיכנס שוב לפי כללי הכניסה.', confirmLabel: 'הסרה', danger: true }))) return;
    const { error } = await supabase.rpc('side_chat_remove_person', { p_person: p.id });
    if (error) return toast(errorText(error), 'error');
    loadPeople();
    onSaved();
  }

  return (
    <Modal title={`כניסה ל"${chat.title}"`} onClose={onClose}>
      <AccessFields value={access} onChange={setAccess} />
      <div className="dialog-actions">
        <button className="btn text" onClick={onClose}>סגירה</button>
        <button className="btn filled" onClick={save}>שמירת כללי הכניסה</button>
      </div>
      <h3 className="side-people-title">מי בפנים ({people?.length ?? 0})</h3>
      {people === null ? (
        <div className="spinner" />
      ) : people.length === 0 ? (
        <p className="muted small">עוד אף אחד לא נכנס.</p>
      ) : (
        <ul className="list">
          {people.map((p) => (
            <li key={p.id} className="list-row static">
              <div className="list-main">
                <div className="list-title">{p.name}</div>
                <div className="list-sub">{p.email ? <span dir="ltr">{p.email}</span> : 'בלי מייל'} · נכנס {timeAgo(p.created_at)} · {p.messages} הודעות</div>
              </div>
              <button className="btn text small danger" onClick={() => remove(p)}>הסרה</button>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}

/** Owner only: chats by secret link for people outside the community (no site account, not shown anywhere). */
export default function SideChatsAdmin() {
  const { toast, confirm } = useFeedback();
  const [list, setList] = useState<SideChat[] | null>(null);
  const [title, setTitle] = useState('');
  const [hours, setHours] = useState(24);
  const [access, setAccess] = useState<Access>({ mode: 'open', code: '', max: 5, emails: '' });
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<SideChat | null>(null);

  const load = useCallback(async () => {
    const { data, error } = await supabase.rpc('side_chat_list');
    if (error) toast(errorText(error), 'error');
    setList((data as SideChat[]) ?? []);
  }, [toast]);
  useEffect(() => {
    load();
  }, [load]);

  async function copy(c: { token: string; mode: Mode; access_code: string | null }) {
    const text = c.mode === 'code' ? `${linkOf(c.token)}\nקוד כניסה: ${c.access_code}` : linkOf(c.token);
    await navigator.clipboard.writeText(text);
    toast(c.mode === 'code' ? 'הקישור והקוד הועתקו.' : 'הקישור הועתק.');
  }

  async function create(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    const { data, error } = await supabase.rpc('side_chat_create', { p_title: title.trim(), p_hours: hours, ...accessArgs(access) });
    setBusy(false);
    if (error) return toast(errorText(error), 'error');
    setTitle('');
    await load();
    copy({ token: data as string, mode: access.mode, access_code: access.code.trim() });
    setAccess({ mode: 'open', code: '', max: 5, emails: '' });
  }

  async function close(c: SideChat) {
    const ok = await confirm({ title: `סגירת "${c.title}"`, body: 'הצ\'אט וכל ההודעות בו יימחקו לצמיתות, והקישור יפסיק לעבוד.', confirmLabel: 'סגירה ומחיקה', danger: true });
    if (!ok) return;
    const { error } = await supabase.rpc('side_chat_close', { p_id: c.id });
    if (error) return toast(errorText(error), 'error');
    load();
  }

  async function extend(c: SideChat, h: number) {
    const { error } = await supabase.rpc('side_chat_extend', { p_id: c.id, p_hours: h });
    if (error) return toast(errorText(error), 'error');
    toast(h ? 'הוארך ביום' : 'הצ\'אט פתוח עכשיו ללא הגבלת זמן');
    load();
  }

  return (
    <section className="card-section">
      <div className="section-head"><h2>צ'אט זמני בקישור</h2></div>
      <p className="muted small">
        צ'אט נפרד לגמרי לאנשים מחוץ לישיבה, בלי חשבון באתר. נכנסים בקישור, והוא לא מופיע בשום מקום באתר: חברי הקהילה והבוט לא רואים
        אותו. בפתיחה בוחרים מי יכול להיכנס ולכמה זמן. צ'אט עם זמן נמחק בסופו עם כל ההודעות.
      </p>
      <form className="form-stack side-create" onSubmit={create}>
        <div className="row gap wrap">
          <input className="grow" value={title} maxLength={60} onChange={(e) => setTitle(e.target.value)} placeholder="שם הצ'אט (מה שהאורחים יראו)" />
          <select value={hours} onChange={(e) => setHours(Number(e.target.value))} aria-label="למשך">
            {HOURS.map((o) => <option key={o.h} value={o.h}>{o.label}</option>)}
          </select>
        </div>
        <AccessFields value={access} onChange={setAccess} />
        <div className="row">
          <button className="btn filled" disabled={busy || !title.trim()}>פתיחה והעתקת קישור</button>
        </div>
      </form>
      {list === null ? (
        <div className="spinner" />
      ) : list.length === 0 ? (
        <div className="empty-inline small"><Icon name="forum" /><span>אין צ'אטים זמניים פתוחים.</span></div>
      ) : (
        <ul className="list">
          {list.map((c) => (
            <li key={c.id} className="list-row static">
              <div className="list-main">
                <div className="list-title">{c.title}</div>
                <div className="list-sub">
                  {accessSummary(c)} · {c.people} בפנים · {c.messages} הודעות · נפתח {timeAgo(c.created_at)} ·{' '}
                  {c.expires_at ? `נסגר ב-${new Date(c.expires_at).toLocaleString('he-IL', { day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit' })}` : 'ללא הגבלת זמן'}
                </div>
              </div>
              <div className="row gap wrap">
                <a className="btn text small" href={linkOf(c.token)} target="_blank" rel="noreferrer">פתיחה</a>
                <button className="btn text small" onClick={() => copy(c)}><Icon name="link" size={16} /> קישור</button>
                <button className="btn text small" onClick={() => setEditing(c)}><Icon name="group" size={16} /> כניסה ומשתתפים</button>
                {c.expires_at && <button className="btn text small" onClick={() => extend(c, 24)}>+ יום</button>}
                {c.expires_at && <button className="btn text small" onClick={() => extend(c, 0)}>ללא הגבלה</button>}
                <button className="btn text small danger" onClick={() => close(c)}>סגירה</button>
              </div>
            </li>
          ))}
        </ul>
      )}
      {editing && <AccessDialog chat={editing} onClose={() => setEditing(null)} onSaved={load} />}
    </section>
  );
}
