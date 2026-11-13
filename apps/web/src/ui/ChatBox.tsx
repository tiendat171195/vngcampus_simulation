import { CHAT } from '@campus/shared';
import { type FormEvent, useEffect, useRef, useState } from 'react';
import { useSession } from '../game/core/session';
import { net } from '../game/net/net';

/** Lines older than this fade out of the box unless it is open. */
const FRESH_MS = 20_000;
const VISIBLE_LINES = 6;

/**
 * Nearby chat: people within about 12 m hear you. Enter opens the input on a keyboard; a button
 * does on touch screens. Nothing typed here is stored anywhere.
 */
export function ChatBox() {
  const lines = useSession((state) => state.chat);
  const online = useSession((state) => state.net.status === 'online');
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [, setTick] = useState(0);
  const field = useRef<HTMLInputElement>(null);

  // Re-render now and then so old lines fade even when nobody speaks.
  useEffect(() => {
    const timer = window.setInterval(() => setTick((n) => n + 1), 5000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Enter' || open) return;
      const target = event.target as HTMLElement | null;
      if (target && ['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON'].includes(target.tagName)) return;
      event.preventDefault();
      setOpen(true);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  useEffect(() => {
    if (open) field.current?.focus();
  }, [open]);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const trimmed = text.trim();
    if (trimmed) net.sendChat(trimmed);
    setText('');
    setOpen(false);
  };

  const now = Date.now();
  const shown = (open ? lines : lines.filter((line) => now - line.at < FRESH_MS)).slice(
    -VISIBLE_LINES,
  );

  return (
    <div className="chat" data-open={open}>
      {shown.length > 0 && (
        <ol className="chat-lines" aria-label="Trò chuyện gần đây" aria-live="polite">
          {shown.map((line) => (
            <li key={line.id} data-mine={line.mine}>
              <b>{line.name}:</b> {line.text}
            </li>
          ))}
        </ol>
      )}
      {open ? (
        <form className="chat-form" onSubmit={submit}>
          <input
            ref={field}
            className="chat-input"
            value={text}
            maxLength={CHAT.maxLength}
            placeholder={online ? 'Nói với người xung quanh…' : 'Chưa kết nối'}
            disabled={!online}
            aria-label="Tin nhắn"
            onChange={(event) => setText(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                setText('');
                setOpen(false);
              }
            }}
            onBlur={() => {
              if (!text) setOpen(false);
            }}
          />
          <button type="submit">Gửi</button>
        </form>
      ) : (
        <button type="button" className="chat-open" onClick={() => setOpen(true)}>
          💬 Trò chuyện <kbd>Enter</kbd>
        </button>
      )}
    </div>
  );
}
