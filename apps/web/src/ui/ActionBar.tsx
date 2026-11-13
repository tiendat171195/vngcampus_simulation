import { EMOTES, type EmoteName } from '@campus/shared';
import { useEffect, useState } from 'react';
import { input } from '../game/core/input';
import { useSession } from '../game/core/session';

const ICONS: Record<EmoteName, string> = {
  wave: '👋',
  clap: '👏',
  bow: '🙇',
  cheer: '🙌',
  dance: '💃',
  think: '🤔',
};
const NAMES = Object.keys(EMOTES) as EmoteName[];

/**
 * Bottom-right actions: the emote row (also keys 1–6) and, near a free seat, a button to sit
 * (also E). On touch screens the emote row folds behind one button.
 */
export function ActionBar() {
  const prompt = useSession((state) => state.prompt);
  const [open, setOpen] = useState(false);

  return (
    <div className="action-bar">
      {prompt && (
        <button
          type="button"
          className="action-prompt"
          onPointerDown={(event) => {
            event.stopPropagation();
            input.interact = true;
          }}
        >
          <kbd>E</kbd> {prompt.label}
        </button>
      )}
      <div className="emotes" data-open={open}>
        {NAMES.map((name, index) => (
          <button
            key={name}
            type="button"
            title={`${EMOTES[name].label} (phím ${index + 1})`}
            aria-label={EMOTES[name].label}
            onPointerDown={(event) => {
              event.stopPropagation();
              input.emote = EMOTES[name].id;
              setOpen(false);
            }}
          >
            {ICONS[name]}
          </button>
        ))}
      </div>
      <button
        type="button"
        className="emote-toggle"
        aria-label="Biểu cảm"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        😊
      </button>
    </div>
  );
}

/** A short line from the game ("this seat is taken"), shown for a moment. */
export function NoticeToast() {
  const notice = useSession((state) => state.notice);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!notice) return;
    setVisible(true);
    const timer = window.setTimeout(() => setVisible(false), 2500);
    return () => window.clearTimeout(timer);
  }, [notice]);

  if (!notice) return null;
  return (
    <div className="notice-toast" data-visible={visible} role="status">
      {notice.text}
    </div>
  );
}
