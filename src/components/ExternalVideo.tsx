import { useState } from 'react';
import Icon from './Icon';

/** A video from the source site: a card first, the player only after a click (so the chat stays light). */
export default function ExternalVideo({ url }: { url: string }) {
  const [on, setOn] = useState(false);
  const [failed, setFailed] = useState(false);
  if (failed) {
    return (
      <div className="ext-video ext-failed">
        <Icon name="error" size={18} />
        <span>הסרטון לא נטען (ייתכן שהאתר חסום אצלך). </span>
        <a href={url} target="_blank" rel="noopener noreferrer">פתיחה בחלון נפרד</a>
      </div>
    );
  }
  if (!on) {
    return (
      <button type="button" className="ext-video ext-card" onClick={() => setOn(true)}>
        <Icon name="videocam" size={22} />
        <span>סרטון מהחתול השחור. לחיצה לניגון</span>
      </button>
    );
  }
  return (
    <div className="ext-video">
      <video src={url} controls autoPlay playsInline preload="metadata" onError={() => setFailed(true)} />
    </div>
  );
}
