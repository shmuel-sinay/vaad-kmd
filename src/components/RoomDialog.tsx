import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp } from '../AppContext';
import { supabase } from '../supabase';
import { errorText } from '../lib/format';
import type { Room } from '../types';
import { Modal, useFeedback } from './Feedback';

/** Create a new topic room, or edit an existing one (name, topic, announcement mode). */
export default function RoomDialog({ room, onClose }: { room?: Room; onClose: () => void }) {
  const { isMod, isAdmin, reloadRooms } = useApp();
  const { toast } = useFeedback();
  const navigate = useNavigate();
  const [name, setName] = useState(room?.name ?? '');
  const [description, setDescription] = useState(room?.description ?? '');
  const [announce, setAnnounce] = useState(room?.admin_only_post ?? false);
  const [phoneKey, setPhoneKey] = useState('');
  const [busy, setBusy] = useState(false);

  // The room's number on the phone line (admins only; the main room is the phone line's own default).
  useEffect(() => {
    if (!room || !isAdmin || room.is_main) return;
    supabase.from('channels').select('phone_key').eq('id', room.id).maybeSingle().then(({ data }) => setPhoneKey(data?.phone_key ? String(data.phone_key) : ''));
  }, [room, isAdmin]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    if (room) {
      const patch: Record<string, unknown> = { name: name.trim(), description: description.trim() || null };
      if (isMod && !room.is_main) patch.admin_only_post = announce;
      if (isAdmin && !room.is_main) patch.phone_key = phoneKey.trim() ? Number(phoneKey) : null;
      const { error } = await supabase.from('channels').update(patch).eq('id', room.id);
      setBusy(false);
      if (error) return toast(errorText(error), 'error');
      toast('החדר עודכן');
      await reloadRooms();
      onClose();
    } else {
      const { data, error } = await supabase.rpc('create_room', { p_name: name.trim(), p_description: description.trim() || null });
      setBusy(false);
      if (error) return toast(errorText(error), 'error');
      await reloadRooms();
      onClose();
      navigate(`/room/${(data as { id: number }).id}`);
    }
  }

  return (
    <Modal title={room ? 'הגדרות החדר' : 'חדר צ\'אט חדש'} onClose={onClose}>
      <form className="form-stack" onSubmit={submit}>
        {!room && <p className="dialog-body">חדר קטן לשיחה על נושא מסוים. כל חברי הקהילה יוכלו להיכנס ולהשתתף.</p>}
        <label className="field">
          <span>שם החדר</span>
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} required autoFocus placeholder="למשל: תיאום נסיעות" />
        </label>
        <label className="field">
          <span>על מה מדברים? (לא חובה)</span>
          <input value={description} onChange={(e) => setDescription(e.target.value)} maxLength={300} />
        </label>
        {room && isMod && !room.is_main && (
          <label className="switch-row">
            <span>
              <strong>חדר הודעות</strong>
              <span className="muted small">רק מנהלים ומנחים יכולים לכתוב בו.</span>
            </span>
            <input type="checkbox" className="switch" checked={announce} onChange={(e) => setAnnounce(e.target.checked)} />
          </label>
        )}
        {room && isAdmin && !room.is_main && (
          <label className="field">
            <span>מספר החדר בטלפון (לא חובה)</span>
            <input value={phoneKey} onChange={(e) => setPhoneKey(e.target.value.replace(/\D/g, '').slice(0, 3))} inputMode="numeric" maxLength={3} dir="ltr" placeholder="למשל 7" />
            <span className="field-hint">מי שמחייג לחדרים בטלפון מקיש את המספר הזה כדי לשמוע את החדר. כל מספר לחדר אחד.</span>
          </label>
        )}
        <div className="dialog-actions">
          <button type="button" className="btn text" onClick={onClose}>ביטול</button>
          <button className="btn filled" disabled={busy || !name.trim()}>{room ? 'שמירה' : 'פתיחת החדר'}</button>
        </div>
      </form>
    </Modal>
  );
}
