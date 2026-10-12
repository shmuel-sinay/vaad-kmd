import { useEffect } from 'react';
import Icon from '../components/Icon';

/** Shown to everyone but the owner while maintenance mode is on: a plain "still in development" page, no site name. */
export default function MaintenancePage() {
  useEffect(() => {
    document.title = 'האתר בבנייה';
  }, []);
  return (
    <div className="auth-screen">
      <div className="auth-card maintenance-card">
        <span className="status-icon"><Icon name="settings" size={32} /></span>
        <h1 className="auth-title">האתר בשלבי פיתוח</h1>
        <p className="auth-sub">אנחנו עדיין עובדים על האתר והוא לא זמין כרגע. נשמח לראותכם כשיהיה מוכן.</p>
      </div>
    </div>
  );
}
