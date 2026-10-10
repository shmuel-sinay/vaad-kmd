import { useCallback, useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { supabase } from '../supabase';
import { clockTime, colorFor, dayLabel, errorText, fullDate, initials } from '../lib/format';
import { imageDataUrl } from '../lib/media';
import Icon from '../components/Icon';
import { SpaceTile } from '../components/Avatar';
import { Modal } from '../components/Feedback';

interface Msg {
  id: number;
  name: string;
  body: string;
  created_at: string;
  mine: boolean;
  has_image: boolean;
}
interface Info {
  title: string;
  expires_at: string | null;
  mode: 'open' | 'code' | 'limit' | 'emails';
  people: number;
  max_people: number | null;
  my_name: string | null;
}

const NAME_KEY = 'side-chat-name';
const store = {
  get: (k: string) => {
    try {
      return localStorage.getItem(k) ?? '';
    } catch {
      return '';
    }
  },
  set: (k: string, v: string) => {
    try {
      if (v) localStorage.setItem(k, v);
      else localStorage.removeItem(k);
    } catch {
      /* private mode: asked again next time */
    }
  },
};
const readName = () => store.get(NAME_KEY);

function Initials({ name, size = 32 }: { name: string; size?: number }) {
  return (
    <span className="avatar" style={{ width: size, height: size, background: colorFor(name), fontSize: size * 0.4 }}>
      {initials(name)}
    </span>
  );
}

// Photos are fetched once each and kept for the session.
const imageCache = new Map<number, string>();
function SideImage({ token, chatKey, id, onOpen }: { token: string; chatKey: string; id: number; onOpen: (url: string) => void }) {
  const [url, setUrl] = useState(imageCache.get(id) ?? '');
  useEffect(() => {
    if (url) return;
    supabase.rpc('side_chat_image', { p_token: token, p_key: chatKey, p_id: id }).then(({ data }) => {
      if (typeof data === 'string') {
        imageCache.set(id, data);
        setUrl(data);
      }
    });
  }, [token, chatKey, id, url]);
  return (
    <button className="b-media" style={{ aspectRatio: url ? undefined : '4 / 3' }} onClick={() => url && onOpen(url)} aria-label="הגדלת התמונה">
      {url ? <img src={url} alt="" /> : <span className="media-loading" />}
    </button>
  );
}

/**
 * #/x/<token>: a chat for a few people outside the community, in the regular chat look but showing nothing of it.
 * Entry depends on the chat's mode (open / entry code / limited seats / listed emails with a mailed one-time code).
 * Joining returns a key kept in this browser; every call carries it. New messages are polled.
 */
export default function SideChatPage({ token }: { token: string }) {
  const keyName = `side-key-${token}`;
  const [chatKey, setChatKey] = useState(() => store.get(keyName));
  const [info, setInfo] = useState<Info | null | undefined>(undefined);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const last = useRef(0);
  const end = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const [photo, setPhoto] = useState<string | null>(null);
  const [big, setBig] = useState<string | null>(null);

  const loadInfo = useCallback(async () => {
    const { data, error: e } = await supabase.rpc('side_chat_info', { p_token: token, p_key: chatKey || null });
    if (e) return setError(errorText(e));
    const row = (Array.isArray(data) ? data[0] : data) as Info | undefined;
    setInfo(row ?? null);
    if (row) document.title = row.title;
  }, [token, chatKey]);
  useEffect(() => {
    loadInfo();
  }, [loadInfo]);

  const joined = !!info?.my_name;
  const poll = useCallback(async () => {
    const { data } = await supabase.rpc('side_chat_messages', { p_token: token, p_key: chatKey, p_after: last.current });
    const rows = (data as Msg[]) ?? [];
    if (rows.length) {
      last.current = rows[rows.length - 1].id;
      setMsgs((prev) => [...prev, ...rows.filter((r) => !prev.some((p) => p.id === r.id))]);
    }
  }, [token, chatKey]);

  useEffect(() => {
    if (!joined) return;
    poll();
    const t = setInterval(poll, 2500);
    return () => clearInterval(t);
  }, [joined, poll]);

  useEffect(() => {
    end.current?.scrollIntoView({ block: 'end' });
  }, [msgs.length]);

  function entered(k: string) {
    store.set(keyName, k);
    setChatKey(k);
  }

  // The key stopped working (removed by the owner): back to the entry screen.
  function kickedOut() {
    store.set(keyName, '');
    setChatKey('');
    setMsgs([]);
    last.current = 0;
  }

  async function pickPhoto(file: File | undefined | null) {
    if (!file) return;
    try {
      setPhoto(await imageDataUrl(file));
      setError('');
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function send(e?: FormEvent) {
    e?.preventDefault();
    const body = text.trim();
    if ((!body && !photo) || busy) return;
    setBusy(true);
    const { error: e2 } = await supabase.rpc('side_chat_send', { p_token: token, p_key: chatKey, p_body: body, p_image: photo });
    setBusy(false);
    if (e2) {
      if ((e2 as { code?: string }).code === '42501') return kickedOut();
      return setError(errorText(e2));
    }
    setError('');
    setText('');
    setPhoto(null);
    poll();
    input.current?.focus();
  }

  function onKey(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  }

  if (info === undefined && !error) return <div className="auth-screen"><div className="spinner" /></div>;
  if (!info) {
    return (
      <div className="auth-screen">
        <div className="auth-card">
          <span className="status-icon bad"><Icon name="link" size={32} /></span>
          <h1 className="auth-title">הצ'אט לא זמין</h1>
          <p className="auth-sub">{error || 'הקישור שגוי, או שהצ\'אט כבר נסגר.'}</p>
        </div>
      </div>
    );
  }
  if (!joined) return <JoinScreen token={token} info={info} onJoined={entered} />;

  const name = info.my_name!;
  const until = info.expires_at
    ? `נסגר ב-${new Date(info.expires_at).toLocaleString('he-IL', { day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit' })}`
    : 'צ\'אט פרטי';
  const people = [...new Set(msgs.map((m) => m.name))];

  return (
    <div className="side-app">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark"><Icon name="forum" filled size={22} /></span>
          <span className="brand-name">{info.title}</span>
        </div>
        <span className="grow" />
        <button className="chip-btn" onClick={() => setRenaming(true)} title="החלפת השם">
          <Icon name="edit" size={16} /> {name}
        </button>
        <Initials name={name} size={34} />
      </header>
      <main className="main side-main">
        <section className="pane chat-pane">
          <header className="pane-head">
            <SpaceTile name={info.title} size={40} />
            <div className="pane-titles">
              <h1>{info.title}</h1>
              <p>{people.length ? `${people.join(', ')} · ` : ''}{until}</p>
            </div>
          </header>
          <div className="stream bubbles">
            <div className="stream-inner">
              {msgs.length === 0 && (
                <div className="empty-state">
                  <Icon name="forum" size={48} />
                  <h2>{info.title}</h2>
                  <p className="muted">עוד אין כאן הודעות. כתבו את הראשונה!</p>
                </div>
              )}
              {msgs.map((m, i) => {
                const prev = msgs[i - 1];
                const newDay = !prev || dayLabel(prev.created_at) !== dayLabel(m.created_at);
                const grouped = !!prev && !newDay && prev.name === m.name && prev.mine === m.mine && new Date(m.created_at).getTime() - new Date(prev.created_at).getTime() < 5 * 60e3;
                const mine = m.mine;
                return (
                  <div key={m.id}>
                    {newDay && <div className="day-sep" role="separator"><span>{dayLabel(m.created_at)}</span></div>}
                    <div className={`b-row ${mine ? 'mine' : 'theirs'} ${grouped ? 'grouped' : ''}`}>
                      {!mine && <div className="b-avatar">{!grouped && <Initials name={m.name} />}</div>}
                      <div className="b-col">
                        {!grouped && !mine && (
                          <div className="b-head">
                            <span className="author">{m.name}</span>
                            <time title={fullDate(m.created_at)}>{clockTime(m.created_at)}</time>
                          </div>
                        )}
                        <div className="b-line">
                          <div className="bubble">
                            {m.has_image && <SideImage token={token} chatKey={chatKey} id={m.id} onOpen={setBig} />}
                            {m.body && <div className="b-text">{m.body}</div>}
                            {(grouped || mine) && <div className="b-meta"><time>{clockTime(m.created_at)}</time></div>}
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
              <div ref={end} />
            </div>
          </div>
          <div className="composer-wrap">
            {error && <div className="alert error"><Icon name="error" size={18} /> {error}</div>}
            <form className="composer" onSubmit={send}>
              {photo && (
                <div className="side-photo-preview">
                  <img src={photo} alt="" />
                  <button type="button" className="icon-btn small" onClick={() => setPhoto(null)} aria-label="הסרת התמונה" title="הסרת התמונה"><Icon name="close" size={18} /></button>
                </div>
              )}
              <div className="composer-row">
                <button type="button" className="anon-toggle" onClick={() => fileInput.current?.click()} title="שליחת תמונה" aria-label="שליחת תמונה">
                  <Icon name="add_photo_alternate" size={20} />
                </button>
                <input ref={fileInput} type="file" accept="image/*" hidden onChange={(e) => { pickPhoto(e.target.files?.[0]); e.target.value = ''; }} />
                <textarea
                  ref={input}
                  rows={1}
                  value={text}
                  maxLength={2000}
                  onChange={(e) => setText(e.target.value)}
                  onKeyDown={onKey}
                  onPaste={(e) => {
                    const f = [...e.clipboardData.files].find((x) => x.type.startsWith('image/'));
                    if (f) {
                      e.preventDefault();
                      pickPhoto(f);
                    }
                  }}
                  placeholder={`הודעה ל${info.title}`}
                />
                <button className="send-btn" disabled={(!text.trim() && !photo) || busy} aria-label="שליחה" title="שליחה"><Icon name="send" filled size={20} /></button>
              </div>
            </form>
          </div>
        </section>
      </main>
      {big && (
        <div className="lightbox" onClick={() => setBig(null)}>
          <img src={big} alt="" />
          <button className="icon-btn lightbox-close" onClick={() => setBig(null)} aria-label="סגירה"><Icon name="close" /></button>
        </div>
      )}
      {renaming && <RenameDialog token={token} chatKey={chatKey} name={name} onClose={() => setRenaming(false)} onDone={loadInfo} />}
    </div>
  );
}

function RenameDialog({ token, chatKey, name, onClose, onDone }: { token: string; chatKey: string; name: string; onClose: () => void; onDone: () => void }) {
  const [v, setV] = useState(name);
  const [err, setErr] = useState('');
  async function save(e: FormEvent) {
    e.preventDefault();
    const { error } = await supabase.rpc('side_chat_rename', { p_token: token, p_key: chatKey, p_name: v.trim() });
    if (error) return setErr(errorText(error));
    store.set(NAME_KEY, v.trim());
    onDone();
    onClose();
  }
  return (
    <Modal title="החלפת השם" onClose={onClose}>
      <form className="form-stack" onSubmit={save}>
        <p className="muted small">ההודעות הבאות שלך יופיעו בשם החדש.</p>
        <input className="side-name" value={v} maxLength={30} onChange={(e) => setV(e.target.value)} autoFocus />
        {err && <div className="alert error"><Icon name="error" size={18} /> {err}</div>}
        <div className="dialog-actions">
          <button type="button" className="btn text" onClick={onClose}>ביטול</button>
          <button className="btn filled" disabled={!v.trim()}>שמירה</button>
        </div>
      </form>
    </Modal>
  );
}

/** The entry screen: a name, plus the entry code or the email address when the chat asks for one. */
function JoinScreen({ token, info, onJoined }: { token: string; info: Info; onJoined: (key: string) => void }) {
  const [name, setName] = useState(readName);
  const [code, setCode] = useState('');
  const [email, setEmail] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const full = info.mode === 'limit' && info.max_people != null && info.people >= info.max_people;

  async function join(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    const { data, error } = await supabase.rpc('side_chat_join', {
      p_token: token,
      p_name: name.trim(),
      p_code: info.mode === 'code' ? code.trim() : null,
      p_email: info.mode === 'emails' ? email.trim() : null,
    });
    setBusy(false);
    if (error) return setErr(errorText(error));
    if (!data) return setErr(info.mode === 'emails' ? 'הכתובת הזו לא ברשימת המוזמנים.' : 'קוד הכניסה שגוי.');
    store.set(NAME_KEY, name.trim());
    onJoined(data as string);
  }

  const sub =
    info.mode === 'code'
      ? 'הוזמנת לצ\'אט. כדי להיכנס צריך את קוד הכניסה שקיבלת.'
      : info.mode === 'limit'
      ? `הוזמנת לצ'אט. תפוסים ${info.people} מתוך ${info.max_people} מקומות.`
      : info.mode === 'emails'
      ? 'הצ\'אט פתוח רק למוזמנים. כותבים את כתובת המייל שאליה הוזמנת.'
      : 'הוזמנת לצ\'אט. איך לקרוא לך?';
  const needs = (info.mode === 'code' && !code.trim()) || (info.mode === 'emails' && !email.includes('@'));

  return (
    <div className="auth-screen">
      <div className="auth-card">
        <span className="status-icon"><Icon name={info.mode === 'open' ? 'forum' : 'lock'} size={32} /></span>
        <h1 className="auth-title">{info.title}</h1>
        <p className="auth-sub">{full ? 'הצ\'אט מלא, אין בו יותר מקומות פנויים.' : sub}</p>
        {!full && (
          <form className="form-stack" onSubmit={join}>
            <input className="side-name" value={name} maxLength={30} onChange={(e) => setName(e.target.value)} placeholder="השם שלך" autoFocus />
            {info.mode === 'code' && <input className="side-name" dir="ltr" value={code} onChange={(e) => setCode(e.target.value)} placeholder="קוד כניסה" />}
            {info.mode === 'emails' && <input className="side-name" type="email" dir="ltr" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@example.com" />}
            {err && <div className="alert error"><Icon name="error" size={18} /> {err}</div>}
            <div className="auth-actions">
              <span />
              <button className="btn filled" disabled={busy || !name.trim() || needs}>כניסה לצ'אט</button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
