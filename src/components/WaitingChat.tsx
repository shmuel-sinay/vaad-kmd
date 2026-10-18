import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { supabase } from '../supabase';
import { errorText } from '../lib/format';
import type { FeedbackRow } from '../pages/ContactPage';
import { Modal, useFeedback } from './Feedback';
import FeedbackThread from './FeedbackThread';

/** The system conversation(s) the management opened with someone (kind 'system'). */
function useSystemThreads(userId: string) {
  const [rows, setRows] = useState<FeedbackRow[] | null>(null);
  const load = useCallback(async () => {
    const { data } = await supabase.from('feedback').select('*').eq('author_id', userId).eq('kind', 'system').order('id');
    setRows((data as FeedbackRow[]) ?? []);
  }, [userId]);
  useEffect(() => {
    load();
  }, [load]);
  return { rows, load };
}

/** Admin: write to someone waiting for approval, without approving him (message_waiting; he also gets an email). */
export function WaitingChatDialog({ userId, name, onClose }: { userId: string; name: string; onClose: () => void }) {
  const { toast } = useFeedback();
  const { rows, load } = useSystemThreads(userId);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);

  async function send(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    const { error } = await supabase.rpc('message_waiting', { p_user: userId, p_body: text.trim() });
    setBusy(false);
    if (error) return toast(errorText(error), 'error');
    setText('');
    toast('נשלח. הוא יראה את ההודעה במסך ההמתנה ויקבל מייל.');
    load();
  }

  return (
    <Modal title={`שיחה עם ${name}`} onClose={onClose}>
      <p className="muted small">
        {name} עדיין ממתין לאישור. ההודעה תופיע לו במסך ההמתנה ותישלח למייל שאיתו נרשם. הוא יכול לענות, אבל לא רואה שום דבר אחר
        באתר. התשובות שלו יופיעו גם בלשונית "פניות".
      </p>
      {rows === null ? (
        <div className="spinner" />
      ) : rows.length ? (
        rows.map((f) => <FeedbackThread key={f.id} f={f} adminView onChange={load} />)
      ) : (
        <form className="form-stack" onSubmit={send}>
          <textarea rows={4} maxLength={2000} value={text} onChange={(e) => setText(e.target.value)} placeholder={`הודעה ל${name}…`} autoFocus />
          <div className="dialog-actions">
            <button type="button" className="btn text" onClick={onClose}>ביטול</button>
            <button className="btn filled" disabled={busy || !text.trim()}>שליחה</button>
          </div>
        </form>
      )}
    </Modal>
  );
}

/** On the waiting screen: messages from the management, with a reply box. */
export function WaitingInbox({ userId }: { userId: string }) {
  const { rows, load } = useSystemThreads(userId);
  useEffect(() => {
    const t = setInterval(load, 20000);
    return () => clearInterval(t);
  }, [load]);
  if (!rows?.length) return null;
  return (
    <div className="waiting-inbox">
      <strong>הודעה מהניהול</strong>
      {rows.map((f) => <FeedbackThread key={f.id} f={f} adminView={false} onChange={load} />)}
    </div>
  );
}
