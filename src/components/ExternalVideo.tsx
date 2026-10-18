import { useState } from 'react';
import Icon from './Icon';

/** A video from the source site, shown in the message right away (first frame, with controls); a click plays it. */
export default function ExternalVideo({ url }: { url: string }) {
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
  return (
    <div className="ext-video">
      {/* #t=0.1 makes phones show a frame instead of a black box before play */}
      <video src={`${url}#t=0.1`} controls playsInline preload="metadata" onError={() => setFailed(true)} />
    </div>
  );
}
