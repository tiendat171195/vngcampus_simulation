import type { AdminMeDto } from '@campus/shared';

/** Landing page; the live dashboard comes with P5.4. */
export function OverviewPage({ me }: { me: AdminMeDto }) {
  return (
    <section>
      <h1>Tổng quan</h1>
      <p>Xin chào {me.displayName}.</p>
      <p className="muted">
        Số liệu trực tiếp (người online, phễu nhiệm vụ hôm nay) sẽ hiện ở đây. Trong lúc chờ, nhiệm
        vụ được nạp bằng lệnh <code>pnpm missions:load</code>.
      </p>
    </section>
  );
}
