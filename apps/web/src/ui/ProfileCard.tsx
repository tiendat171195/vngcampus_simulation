import type { PublicProfileDto } from '@campus/shared';
import { useEffect, useState } from 'react';
import { input } from '../game/core/input';
import { useSession } from '../game/core/session';
import { loadProfile } from '../services/directory';

const WAVE = 1;

/** A colleague's card: name, department, title, and a wave (docs/04 §6). */
export function ProfileCard() {
  const card = useSession((state) => state.profileCard);
  const setCard = useSession((state) => state.setProfileCard);
  const [profile, setProfile] = useState<PublicProfileDto | string | null>(null);

  useEffect(() => {
    setProfile(null);
    if (!card) return;
    let live = true;
    void loadProfile(card.userId).then((result) => {
      if (live) setProfile(result);
    });
    return () => {
      live = false;
    };
  }, [card]);

  useEffect(() => {
    if (!card) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setCard(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [card, setCard]);

  if (!card) return null;
  const loaded = profile && typeof profile !== 'string' ? profile : null;
  const guest = loaded ? loaded.isGuest : card.guest;
  return (
    <section
      className="profile-card"
      aria-label={`Hồ sơ của ${card.name}`}
      data-testid="profile-card"
    >
      <div className="profile-card-head">
        <h2>{loaded?.displayName ?? card.name}</h2>
        {guest && <span className="profile-chip">Khách</span>}
      </div>
      {loaded ? (
        <dl>
          <dt>Phòng ban</dt>
          <dd>{loaded.department ?? 'Chưa chọn'}</dd>
          <dt>Chức danh</dt>
          <dd>{loaded.title ?? 'Chưa ghi'}</dd>
        </dl>
      ) : (
        <p className="note">{typeof profile === 'string' ? profile : 'Đang tải…'}</p>
      )}
      <div className="profile-card-actions">
        <button
          type="button"
          className="profile-action"
          onClick={() => {
            input.emote = WAVE;
            setCard(null);
          }}
        >
          👋 Vẫy chào
        </button>
        <button type="button" className="profile-action" onClick={() => setCard(null)}>
          Đóng
        </button>
      </div>
    </section>
  );
}
