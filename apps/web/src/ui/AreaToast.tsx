import { useEffect, useState } from 'react';
import { useSession } from '../game/core/session';

/** Shows the name of a place for a moment when the player walks into it. */
export function AreaToast() {
  const location = useSession((state) => state.location);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!location) return;
    setVisible(true);
    const timer = window.setTimeout(() => setVisible(false), 2600);
    return () => window.clearTimeout(timer);
  }, [location]);

  if (!location) return null;
  return (
    <div className="area-toast" data-visible={visible} role="status" aria-live="polite">
      <span className="area-toast-name">{location.name}</span>
      <span className="area-toast-floor">{location.floorLabel}</span>
    </div>
  );
}
