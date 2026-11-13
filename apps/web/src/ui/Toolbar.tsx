import { useState } from 'react';
import { DebugPanel } from '../game/debug/DebugPanel';
import { ChannelBadge } from './ConnectionBanner';
import { PeoplePanel } from './PeoplePanel';
import { ProfilePanel } from './ProfilePanel';
import { LeaderboardPanel, StatsChip } from './ProgressHud';
import { SettingsPanel } from './SettingsPanel';

type Open = 'profile' | 'people' | 'ranks' | 'settings' | 'debug' | null;

/** Buttons in the top-right corner, each opening its panel underneath. */
export function Toolbar() {
  const [open, setOpen] = useState<Open>(null);
  const toggle = (panel: Exclude<Open, null>) => setOpen(open === panel ? null : panel);

  return (
    <div className="toolbar">
      <div className="toolbar-buttons">
        <button
          type="button"
          className="pill"
          aria-expanded={open === 'profile'}
          onClick={() => toggle('profile')}
        >
          Hồ sơ
        </button>
        <button
          type="button"
          className="pill"
          aria-expanded={open === 'people'}
          onClick={() => toggle('people')}
        >
          Mọi người
        </button>
        <button
          type="button"
          className="pill"
          aria-expanded={open === 'ranks'}
          onClick={() => toggle('ranks')}
        >
          Xếp hạng
        </button>
        <button
          type="button"
          className="pill"
          aria-expanded={open === 'settings'}
          onClick={() => toggle('settings')}
        >
          Cài đặt
        </button>
        <button
          type="button"
          className="pill"
          aria-expanded={open === 'debug'}
          onClick={() => toggle('debug')}
        >
          Debug
        </button>
      </div>
      <ChannelBadge />
      <StatsChip />
      <ProfilePanel hidden={open !== 'profile'} />
      <PeoplePanel hidden={open !== 'people'} />
      <LeaderboardPanel hidden={open !== 'ranks'} />
      <SettingsPanel hidden={open !== 'settings'} />
      <DebugPanel hidden={open !== 'debug'} />
    </div>
  );
}
