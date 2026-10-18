import { useEffect, useState, type FormEvent } from 'react';
import { supabase } from '../supabase';
import { errorText } from '../lib/format';
import { useFeedback } from './Feedback';

interface PhoneId {
  code: string;
  phone: string | null;
  tzintuk: boolean;
}

// The line's number is shown only when the site was built with VITE_PHONE_LINE (the repo is public).
const LINE = (import.meta.env.VITE_PHONE_LINE as string | undefined) || '';

/** A personal 6-digit code for the phone line: private chats, voice messages in his own name, polls. */
export default function PhoneSettings() {
  const { toast, confirm } = useFeedback();
  const [saved, setSaved] = useState<PhoneId | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [code, setCode] = useState('');
  const [phone, setPhone] = useState('');
  const [ring, setRing] = useState(false);
  const [busy, setBusy] = useState(false);

  async function load() {
    const { data } = await supabase.rpc('my_phone_id');
    const row = ((data as PhoneId[] | null) ?? [])[0] ?? null;
    setSaved(row);
    setCode(row?.code ?? '');
    setPhone(row?.phone ?? '');
    setRing(row?.tzintuk ?? false);
    setLoaded(true);
  }
  useEffect(() => {
    load();
  }, []);

  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    const { error } = await supabase.rpc('set_phone_id', { p_code: code, p_phone: phone || null, p_tzintuk: ring });
    setBusy(false);
    if (error) return toast(errorText(error), 'error');
    toast('הקוד נשמר');
    load();
  }

  async function clear() {
    const ok = await confirm({ title: 'ביטול הקוד האישי', body: 'לא תוכל להיכנס לאזור האישי בטלפון עד שתגדיר קוד חדש.', confirmLabel: 'ביטול הקוד', danger: true });
    if (!ok) return;
    const { error } = await supabase.rpc('clear_phone_id');
    if (error) return toast(errorText(error), 'error');
    toast('הקוד בוטל');
    load();
  }

  if (!loaded) return null;
  const dirty = !saved || code !== saved.code || (phone || '') !== (saved.phone ?? '') || ring !== saved.tzintuk;
  return (
    <form className="settings-card" onSubmit={save}>
      <h2>קו הטלפון</h2>
      <p className="muted small">
        {LINE ? `מחייגים ל-${LINE}. ` : ''}בלי קוד אפשר לשמוע את הצ'אט הראשי ולהקליט אליו הודעה בלי שם. עם קוד אישי תוכל גם לשמוע הודעות פרטיות,
        לענות עליהן בקול, להקליט לצ'אט הראשי בשמך ולהצביע בסקרים. את הקוד מקישים בטלפון, ולכן הוא צריך להישאר סודי.
      </p>
      <label className="field">
        <span>קוד אישי (שש ספרות)</span>
        <input value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))} inputMode="numeric" maxLength={6} placeholder="למשל 482915" autoComplete="off" />
      </label>
      <label className="field">
        <span>מספר הטלפון שלי (לא חובה)</span>
        <input value={phone} onChange={(e) => setPhone(e.target.value.replace(/[^\d-]/g, '').slice(0, 12))} inputMode="tel" placeholder="0501234567" dir="ltr" />
        <span className="field-hint">נשמר רק כדי לצלצל אליך, אם תבקש למטה.</span>
      </label>
      <label className="switch-row">
        <span>
          <strong>צינתוק כשההנהלה מסמנת הודעה</strong>
          <span className="muted small">צלצול קצר, בלי עלות לך, כשמפקח או מנהל מסמן הודעה חשובה. עד חמישה ביום לכולם.</span>
        </span>
        <input type="checkbox" className="switch" checked={ring} disabled={!phone} onChange={(e) => setRing(e.target.checked)} />
      </label>
      <div className="form-actions">
        {saved && <button type="button" className="btn text danger" onClick={clear}>ביטול הקוד</button>}
        <button className="btn filled" disabled={busy || !dirty || code.length !== 6}>{saved ? 'שמירה' : 'הגדרת קוד'}</button>
      </div>
    </form>
  );
}
