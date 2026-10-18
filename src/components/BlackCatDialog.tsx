import { useState, type FormEvent } from 'react';
import { embedsOf } from '../lib/embeds';
import { Modal } from './Feedback';
import ExternalVideo from './ExternalVideo';

/** Share a video from "החתול השחור": explains how to copy its address, checks it, shows a preview and posts it. */
export default function BlackCatDialog({ onSend, onClose }: { onSend: (text: string) => Promise<boolean>; onClose: () => void }) {
  const [url, setUrl] = useState('');
  const [caption, setCaption] = useState('');
  const [busy, setBusy] = useState(false);
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
    </Modal>
  );
}
