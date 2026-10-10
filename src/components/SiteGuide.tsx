import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { BOT_NAME } from '../pages/BotPage';
import Icon, { type IconName } from './Icon';

interface Step {
  target: string; // data-tour value of the element the step points at
  icon: IconName;
  title: string;
  body: string;
}

// Each step sits right next to the thing it explains. A target that isn't on screen (e.g. the closed sidebar on a
// phone) shows the step in the middle instead.
const STEPS: Step[] = [
  { target: 'main', icon: 'forum', title: "ברוך הבא! זה הצ'אט הראשי", body: "כאן מדברים כל הוועד. לחיצה על שם או תמונה של חבר פותחת את הכרטיס שלו, ומשם אפשר לשלוח לו הודעה." },
  { target: 'composer', icon: 'send', title: 'כותבים כאן', body: "תמונות, סרטונים, אימוג'י ותיוג חברים עם @. מי שקיבל הרשאה רואה כאן גם מתג \"אנונימי\": החברים לא יודעים מי כתב. לפי כתב ההסכמה, למנהל הצ'אט יש את היכולת והרשות המלאה לבדוק מי כתב כל הודעה." },
  { target: 'composer', icon: 'more_vert', title: 'מה עושים עם הודעה', body: "מעבירים את העכבר על הודעה (בטלפון: לחיצה ארוכה): לייק, אימוג'י וציטוט. בתפריט ⋮ יש העברה, כוכב, נעיצה, קישור, \"מי אמר את זה?\" ודיווח." },
  { target: 'flash', icon: 'newspaper', title: 'מבזק', body: `מכינים כאן מבזק חדשות בסגנון עיתון (גם ${BOT_NAME} יכול לכתוב לך אחד). המבזקים מופיעים בבאנר הכחול.` },
  { target: 'hero', icon: 'workspace_premium', title: 'מבזק השבוע', body: 'בבאנר הכחול: המבזקים האחרונים, והתמונה והציטוט הכי אהובים של השבוע. החץ מקפל את הבאנר לשורה אחת.' },
  { target: 'rooms', icon: 'add', title: 'חדרים לפי נושא', body: 'חדר קטן לכל נושא. הפלוס פותח חדר חדש, וכל אחד יכול לפתוח.' },
  { target: 'bot', icon: 'smart_toy', title: `${BOT_NAME}: הבינה המלאכותית של הוועד`, body: `שואלים אותו מה הנייעס, מה מישהו כתב, מבקשים שיעביר שאלה לחבר, או סתם פאנץ'. 10 הודעות חינם ביום. תשובה מוזרה? כותבים לו "יש לי תלונה עליך".` },
  { target: 'more', icon: 'interests', title: "הפינה של הפאנצ'ים", body: 'וידויים אנונימיים ומשחק "מי אמר את זה?" עם טבלת מובילים. נקודה על הסמל = יש שם משהו חדש.' },
  { target: 'polls', icon: 'ballot', title: 'סקרים', body: 'ההצבעה חסויה, והתוצאות בגרף.' },
  { target: 'events', icon: 'calendar_month', title: 'לוח אירועים', body: "כל האירועים של הוועד. יום הולדת עברי מכניסים בהגדרות, והצ'אט יברך אותך בבוקר." },
  { target: 'account', icon: 'person', title: 'הפרופיל וההגדרות', body: 'הפרופיל שלך (מוניטין, כינויים, תגיות), התראות לטלפון או למייל, והמדריך הזה שוב אם תצטרך.' },
  { target: 'contact', icon: 'mail', title: 'משהו לא עובד? יש רעיון?', body: 'כותבים כאן להנהלה, והתשובה מגיעה לכאן. זהו, תהנה!' },
];

const PAD = 6;
const CARD_W = 320;
const GAP = 14;

type Side = 'left' | 'right' | 'below' | 'above' | 'center';

function visibleRect(target: string): DOMRect | null {
  const el = document.querySelector<HTMLElement>(`[data-tour="${target}"]`);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  const vw = window.innerWidth, vh = window.innerHeight;
  if (r.width < 4 || r.height < 4 || r.right <= 0 || r.left >= vw || r.bottom <= 0 || r.top >= vh) return null;
  return r;
}

/** Where the card goes: beside the target if there is room (left first, RTL), else below / above, kept on screen. */
function place(r: DOMRect | null, cardH: number): { side: Side; style: CSSProperties; arrow: number } {
  const vw = window.innerWidth, vh = window.innerHeight, w = Math.min(CARD_W, vw - 24);
  if (!r) return { side: 'center', style: { left: (vw - w) / 2, top: Math.max(12, (vh - cardH) / 2), width: w }, arrow: 0 };
  const clampY = (y: number) => Math.min(Math.max(12, y), vh - cardH - 12);
  const clampX = (x: number) => Math.min(Math.max(12, x), vw - w - 12);
  const midY = r.top + r.height / 2, midX = r.left + r.width / 2;
  if (r.left - PAD - GAP - w >= 12) {
    const top = clampY(midY - cardH / 2);
    return { side: 'left', style: { left: r.left - PAD - GAP - w, top, width: w }, arrow: midY - top };
  }
  if (r.right + PAD + GAP + w <= vw - 12) {
    const top = clampY(midY - cardH / 2);
    return { side: 'right', style: { left: r.right + PAD + GAP, top, width: w }, arrow: midY - top };
  }
  const left = clampX(midX - w / 2);
  if (r.bottom + PAD + GAP + cardH <= vh - 12) return { side: 'below', style: { left, top: r.bottom + PAD + GAP, width: w }, arrow: midX - left };
  return { side: 'above', style: { left, top: Math.max(12, r.top - PAD - GAP - cardH), width: w }, arrow: midX - left };
}

/** A guided tour: dims the page, spotlights one button at a time and explains it in a bubble right next to it. */
export default function SiteGuide({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate();
  const location = useLocation();
  const [i, setI] = useState(0);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const [cardH, setCardH] = useState(200);
  const card = useRef<HTMLDivElement>(null);
  const step = STEPS[i];
  const last = i === STEPS.length - 1;

  // The tour explains the main room, so it starts there.
  useEffect(() => {
    if (location.pathname !== '/') navigate('/');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const measure = useCallback(() => setRect(visibleRect(step.target)), [step.target]);
  useLayoutEffect(() => {
    document.querySelector(`[data-tour="${step.target}"]`)?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    measure();
    // The page may still be rendering (after navigating home): measure again shortly.
    const t = setTimeout(measure, 350);
    window.addEventListener('resize', measure);
    window.addEventListener('scroll', measure, true);
    return () => {
      clearTimeout(t);
      window.removeEventListener('resize', measure);
      window.removeEventListener('scroll', measure, true);
    };
  }, [measure, location.pathname]);
  useLayoutEffect(() => {
    if (card.current) setCardH(card.current.offsetHeight);
  }, [i, rect]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowLeft') setI((n) => Math.min(n + 1, STEPS.length - 1));
      if (e.key === 'ArrowRight') setI((n) => Math.max(n - 1, 0));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const pos = place(rect, cardH);
  return (
    <div className="tour" role="dialog" aria-modal="true" aria-label="מדריך לאתר">
      {rect ? (
        <>
          {/* four dim panels around the hole (a huge box-shadow isn't painted reliably) */}
          <div className="tour-dim" style={{ left: 0, top: 0, right: 0, height: Math.max(0, rect.top - PAD) }} />
          <div className="tour-dim" style={{ left: 0, top: rect.bottom + PAD, right: 0, bottom: 0 }} />
          <div className="tour-dim" style={{ left: 0, top: rect.top - PAD, width: Math.max(0, rect.left - PAD), height: rect.height + PAD * 2 }} />
          <div className="tour-dim" style={{ left: rect.right + PAD, top: rect.top - PAD, right: 0, height: rect.height + PAD * 2 }} />
          <div className="tour-spot" style={{ left: rect.left - PAD, top: rect.top - PAD, width: rect.width + PAD * 2, height: rect.height + PAD * 2 }} />
        </>
      ) : (
        <div className="tour-dim" style={{ inset: 0 }} />
      )}
      <div ref={card} className={`tour-card side-${pos.side}`} style={{ ...pos.style, '--arrow': `${pos.arrow}px` } as CSSProperties}>
        <div className="tour-head">
          <span className="bot-avatar"><Icon name={step.icon} size={20} /></span>
          <h3>{step.title}</h3>
        </div>
        <p>{step.body}</p>
        <div className="tour-foot">
          <span className="muted small">{i + 1} / {STEPS.length}</span>
          <div className="row gap">
            {!last && <button className="btn text small" onClick={onClose}>דילוג</button>}
            {i > 0 && <button className="btn tonal small" onClick={() => setI(i - 1)}>הקודם</button>}
            <button className="btn filled small" onClick={() => (last ? onClose() : setI(i + 1))} autoFocus>{last ? 'סיום' : 'הבא'}</button>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Counts this browser's visits (one per tab session) and says whether the tour is due: from the second visit, until seen. */
export function guideDue(userId: string): boolean {
  try {
    const seenKey = `guide-seen-${userId}`;
    if (localStorage.getItem(seenKey)) return false;
    const visitsKey = `guide-visits-${userId}`;
    let visits = Number(localStorage.getItem(visitsKey) ?? 0);
    if (!sessionStorage.getItem(visitsKey)) {
      sessionStorage.setItem(visitsKey, '1');
      visits += 1;
      localStorage.setItem(visitsKey, String(visits));
    }
    return visits >= 2;
  } catch {
    return false;
  }
}

export function markGuideSeen(userId: string) {
  try {
    localStorage.setItem(`guide-seen-${userId}`, new Date().toISOString());
  } catch {
    /* private mode: it may show again next visit */
  }
}
