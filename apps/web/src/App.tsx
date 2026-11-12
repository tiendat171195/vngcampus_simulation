import { Canvas } from '@react-three/fiber';
import { SpinningCube } from './SpinningCube';
import { type ServiceState, useServiceStatus } from './useServiceStatus';

const LABEL: Record<ServiceState, string> = {
  pending: 'đang kiểm tra…',
  ok: 'hoạt động',
  error: 'không kết nối được',
};

export function App() {
  const status = useServiceStatus();

  return (
    <>
      <div className="scene">
        <Canvas camera={{ position: [0, 0, 5], fov: 50 }} dpr={[1, 2]}>
          <ambientLight intensity={0.6} />
          <directionalLight position={[3, 4, 5]} intensity={2} />
          <SpinningCube />
        </Canvas>
      </div>

      <section className="panel" aria-live="polite">
        <h1>VNG Campus Online</h1>
        <p>Khung dự án đã chạy. Campus sẽ xuất hiện ở đây từ P1.</p>
        <dl className="status">
          <dt>API</dt>
          <dd>
            <span className="dot" data-state={status.api} />
            {LABEL[status.api]}
          </dd>
          <dt>Realtime</dt>
          <dd>
            <span className="dot" data-state={status.realtime} />
            {LABEL[status.realtime]}
            {status.visitors !== null && ` · ${status.visitors} người đang xem`}
          </dd>
        </dl>
      </section>
    </>
  );
}
