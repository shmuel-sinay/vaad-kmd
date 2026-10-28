import { useEffect, useState } from 'react';
import { supabase } from '../supabase';
import { errorText } from '../lib/format';
import { useFeedback } from './Feedback';
import Icon from './Icon';

/** Owner only: maintenance mode. While on, everyone else sees only "the site is still in development". */
export default function MaintenanceAdmin() {
  const { confirm, toast } = useFeedback();
  const [on, setOn] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    supabase.rpc('site_maintenance').then(({ data }) => setOn(!!data));
  }, []);

  async function toggle() {
    const next = !on;
    if (next) {
      const ok = await confirm({
        title: 'הפעלת מצב בנייה',
        body: 'כל מי שייכנס לאתר, כולל חברים מחוברים, יראה רק "האתר בשלבי פיתוח". רק אתה תמשיך להיכנס כרגיל. אם תתנתק, נכנסים בכתובת האתר עם #/dev בסוף.',
        confirmLabel: 'הפעלה',
        danger: true,
      });
      if (!ok) return;
    }
    setBusy(true);
    const { error } = await supabase.rpc('set_maintenance', { p_on: next });
    setBusy(false);
    if (error) return toast(errorText(error), 'error');
    setOn(next);
    toast(next ? 'מצב בנייה פעיל: רק אתה רואה את האתר' : 'האתר פתוח שוב לכולם');
  }

  return (
    <section className="card-section">
      <div className="section-head">
        <h2>מצב בנייה</h2>
      </div>
      <p className="muted">
        סוגר את האתר לכולם חוץ ממך: מי שנכנס רואה רק "האתר בשלבי פיתוח", בלי שם האתר ובלי מסך התחברות. הצ'אטים הזמניים בקישור
        ממשיכים לעבוד. אם תתנתק, נכנסים בכתובת <span dir="ltr">{`${location.host}${location.pathname}#/dev`}</span>.
      </p>
      <div className={`guest-status ${on ? 'on' : ''}`}>
        <Icon name={on ? 'lock' : 'visibility'} size={20} />
        <span className="grow">{on === null ? 'בודק…' : on ? 'פעיל: האתר סגור לכולם חוץ ממך' : 'כבוי: האתר פתוח כרגיל'}</span>
        <button className={`btn small ${on ? 'filled' : 'outlined'}`} disabled={busy || on === null} onClick={toggle}>
          {on ? 'פתיחת האתר' : 'הפעלת מצב בנייה'}
        </button>
      </div>
    </section>
  );
}
