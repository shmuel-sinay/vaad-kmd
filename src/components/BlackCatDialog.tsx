import { useState, type FormEvent } from 'react';
import { supabase } from '../supabase';
import { errorText } from '../lib/format';
import { embedsOf } from '../lib/embeds';
import { Modal, useFeedback } from './Feedback';
import ExternalVideo from './ExternalVideo';

/** Share a video from "החתול השחור": explains how to copy its address, checks it, shows a preview and posts it. */
export default function BlackCatDialog({ onSend, onClose }: { onSend: (text: string) => Promise<boolean>; onClose: () => void }) {
  const [url, setUrl] = useState('');
  const [caption, setCaption] = useState('');
  const [busy, setBusy] = useState(false);
  const { toast } = useFeedback();
  // A request to the management to support another site (it arrives in the "פניות" tab like any request).
  const [askOpen, setAskOpen] = useState(false);
  const [site, setSite] = useState('');
  const [why, setWhy] = useState('');
  const [asking, setAsking] = useState(false);

  async function ask(e: FormEvent) {
    e.preventDefault();
    if (!site.trim()) return;
    setAsking(true);
    const body = `בקשה להוספת אתר להטמעת סרטונים\nהאתר: ${site.trim()}${why.trim() ? `\nהערה: ${why.trim()}` : ''}`;
    const { error } = await supabase.rpc('send_feedback', { p_kind: 'idea', p_body: body });
    setAsking(false);
    if (error) return toast(errorText(error), 'error');
    toast('הבקשה נשלחה להנהלה. התשובה תגיע ב"יצירת קשר עם הניהול"');
    setAskOpen(false);
    setSite('');
    setWhy('');
  }
  const found = embedsOf(url.trim());
  const valid = found.length === 1 && found[0] === url.trim();

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!valid) return;
    setBusy(true);
    const ok = await onSend(caption.trim() ? `${caption.trim()}\n${url.trim()}` : url.trim());
    setBusy(false);
    if (ok) onClose();
  }

  return (
    <Modal title="סרטון מהחתול השחור" onClose={onClose}>
      <form className="form-stack" onSubmit={submit}>
        <ol className="dialog-body" style={{ paddingInlineStart: 20, margin: 0 }}>
          <li>באתר החתול השחור, לוחצים קליק ימני על הסרטון.</li>
          <li>בוחרים <strong>"העתק כתובת וידאו"</strong> (Copy video address).</li>
          <li>מדביקים כאן.</li>
        </ol>
        <p className="muted small">
          הסרטון לא עובר דרך האתר שלנו: הוא מתנגן ישירות מהמקור, ורק למי שהאתר ההוא פתוח אצלו. בטלפון אין תמיד "העתק כתובת וידאו".
          אז אפשר לצרף את הסרטון עצמו בכפתור התמונה והסרטון (עד 20MB).
        </p>
        <label className="field">
          <span>כתובת הוידאו</span>
          <input value={url} onChange={(e) => setUrl(e.target.value)} dir="ltr" placeholder="https://cdn.thechats.click/…mp4" autoFocus />
          {url.trim() && !valid && (
            <span className="field-hint" style={{ color: 'var(--danger, #b3261e)' }}>
              זו לא נראית כמו כתובת וידאו של האתר. היא צריכה להתחיל ב-cdn.thechats.click ולהסתיים ב-mp4.
            </span>
          )}
        </label>
        {valid && <ExternalVideo url={found[0]} />}
        <label className="field">
          <span>הוספת כמה מילים (לא חובה)</span>
          <input value={caption} onChange={(e) => setCaption(e.target.value)} maxLength={300} />
        </label>
        <div className="dialog-actions">
          <button type="button" className="btn text" onClick={onClose}>ביטול</button>
          <button className="btn filled" disabled={busy || !valid}>שליחה לצ'אט</button>
        </div>
      </form>
      <div className="form-stack" style={{ marginTop: 16, paddingTop: 12, borderTop: '1px solid var(--divider)' }}>
        {!askOpen ? (
          <p className="muted small" style={{ margin: 0 }}>
            רוצים תמיכה גם באתרים אחרים שפתוחים בנטפרי? <button type="button" className="link-like" onClick={() => setAskOpen(true)}>בקשה להוספת אתר</button>
          </p>
        ) : (
          <form className="form-stack" onSubmit={ask}>
            <strong>בקשה להוספת אתר</strong>
            <label className="field">
              <span>כתובת האתר</span>
              <input value={site} onChange={(e) => setSite(e.target.value)} dir="ltr" maxLength={200} placeholder="https://…" required />
            </label>
            <label className="field">
              <span>הערה (לא חובה)</span>
              <input value={why} onChange={(e) => setWhy(e.target.value)} maxLength={400} placeholder="למשל: סרטונים שמתפרסמים שם, ושאתר זה פתוח בנטפרי" />
            </label>
            <div className="dialog-actions">
              <button type="button" className="btn text" onClick={() => setAskOpen(false)}>ביטול</button>
              <button className="btn tonal" disabled={asking || !site.trim()}>שליחה להנהלה</button>
            </div>
          </form>
        )}
      </div>
    </Modal>
  );
}
