/**
 * The photo survey: the campus cut into zones to photograph on site, each with numbered places
 * to stand and what to capture there (docs/12-photo-survey.md). Photos come back sorted by zone
 * code, and each zone is then rebuilt and compared from the same standing points: the debug
 * camera can stand at any station (`?station=T1-02.S1`).
 *
 * Outlines and stations are drawn on the current map, so where the map is still a guess the
 * survey says so (`confirm`). Zones with no outline are things whose place is not known yet.
 */
import { campusIndex, campusMap } from './campus';
import type { Vec2 } from './frame';
import type { Polygon } from './geometry';
import { rect } from './geometry';
import type { FloorId } from './schema';

export type SurveyGroup = 'Chung' | 'Ngoài trời' | 'Tầng trệt' | 'Tầng 2' | 'Tầng 3' | 'Mái';
/** 1: needed to rebuild the campus at all, 2: needed for this zone to look right, 3: nice to have. */
export type SurveyPriority = 1 | 2 | 3;
export type SurveyStatus = 'todo' | 'received' | 'rebuilt' | 'checked';

export const SURVEY_STATUS_LABEL: Record<SurveyStatus, string> = {
  todo: 'Chưa chụp',
  received: 'Đã nhận ảnh',
  rebuilt: 'Đã dựng lại',
  checked: 'Đã đối chiếu',
};

export interface SurveyStation {
  /** `S1`, `S2`… within the zone. */
  id: string;
  at: Vec2;
  /** The middle of the first photo taken from here. */
  look: Vec2;
  /** Where to stand, in words someone on site can follow. */
  hint: string;
}

export interface SurveyZone {
  /** Stable code, used as the folder name for the zone's photos: `NT-01`, `T1-02`, `T2-05`… */
  code: string;
  name: string;
  group: SurveyGroup;
  floor: FloorId;
  priority: SurveyPriority;
  status: SurveyStatus;
  /** Where the zone is on the current map. Missing when its place is not known yet. */
  outline?: Polygon;
  /** For zones without an outline: how to find it on site. */
  where?: string;
  /** Where the zone code goes on the survey map, when the middle of the outline is a bad spot. */
  labelAt?: Vec2;
  /** Map ids the photos of this zone will correct. */
  covers: string[];
  stations: SurveyStation[];
  /** What to photograph, on top of the steps every zone gets. */
  shots: string[];
  /** What to count or measure (by paces or floor tiles if there is no tape). */
  count: string[];
  /** Guesses on the current map that the photos should settle. */
  confirm: string[];
}

const areaOutline = (id: string): Polygon => {
  const area = campusIndex.areas.get(id);
  if (!area) throw new Error(`survey: no area ${id}`);
  return area.polygon;
};

const station = (id: string, at: Vec2, look: Vec2, hint: string): SurveyStation => ({
  id,
  at,
  look,
  hint,
});

/** Steps every zone gets, whatever is in it. */
export const SURVEY_STEPS: readonly string[] = [
  'Từ mỗi điểm đứng (S1, S2…) chụp một ảnh theo hướng mũi tên, rồi thêm một ảnh lệch trái và một ảnh lệch phải. Cầm máy ngang, ngang tầm mắt, dùng ống góc rộng (0.5×) nếu có',
  'Một ảnh panorama ở giữa khu (Panorama hoặc Photo Sphere), quay đủ một vòng',
  'Mỗi bức tường hoặc mặt đứng: một ảnh chụp thẳng góc, thấy cả chân tường lẫn trần',
  'Sàn, trần, đèn: mỗi loại một ảnh cận, thấy rõ vật liệu và kiểu lát',
  'Mỗi loại đồ đạc: một ảnh tổng và một ảnh cận, ghi số lượng',
  'Thước đo: đếm số viên gạch lát hoặc số bước chân dọc hai cạnh của khu; có thước dây thì đo một hai thứ (bậc, bàn, quầy)',
  'Đứng ở cửa hoặc lối đi sang khu bên cạnh, chụp một ảnh nhìn sang khu đó, để ghép các khu lại với nhau',
  'Biển tên, biển chỉ dẫn, sơ đồ thoát hiểm nếu gặp',
];

/** Rules on site. Photos never go into the repository: it is public. */
export const SURVEY_RULES: readonly string[] = [
  'Xin phép bộ phận hành chính hoặc an ninh của VNG trước khi chụp',
  'Chụp lúc vắng người (sáng sớm, cuối giờ chiều); không chụp rõ mặt người',
  'Không chụp màn hình máy tính, bảng trắng, giấy tờ, thẻ nhân viên, bàn phím mã cửa',
  'Không vào và không chụp phòng máy chủ, phòng an ninh hay phòng điều khiển, kho, nhà vệ sinh, phòng thay đồ, khu có trẻ em; khu nào cấm thì chỉ ghi chú là có',
  'Giữ nguyên ảnh gốc, không cắt hay chỉnh: giờ chụp và toạ độ GPS (ngoài trời) trong ảnh giúp đặt ảnh lên bản đồ',
  'Ảnh gửi riêng cho mình trong cuộc trò chuyện, không đưa lên repo (repo đang để công khai)',
];

/** How to hand the photos over. */
export const SURVEY_DELIVERY: readonly string[] = [
  'Mỗi khu một thư mục đặt đúng tên mã khu: `NT-01`, `T1-02`…',
  'Không bắt buộc đổi tên ảnh; nếu tiện thì thêm điểm đứng vào đầu tên: `S2_…jpg`',
  'Nén mỗi khu (hoặc vài khu) thành một file zip rồi gửi vào cuộc trò chuyện; khu nào chụp xong gửi trước được',
  'Gặp thứ không có trong danh sách: chụp, rồi ghi một dòng "ở đâu, cạnh khu nào" vào file `ghi-chu.txt` trong thư mục khu gần nhất',
  'Quay thêm video đi bộ chậm (1–2 phút mỗi đoạn): cổng → sảnh → Atrium → canteen; Atrium → tầng 2 → sang block 2; một vòng quanh hồ bơi',
];

/** Zones of one office floor; both floors are laid out alike on the current map. */
function officeZones(floor: 'F2' | 'F3'): SurveyZone[] {
  const n = floor === 'F2' ? 2 : 3;
  const key = floor.toLowerCase();
  const group: SurveyGroup = floor === 'F2' ? 'Tầng 2' : 'Tầng 3';
  const code = (i: number) => `T${n}-0${i}`;
  const zone = (z: Omit<SurveyZone, 'group' | 'floor' | 'status'>): SurveyZone => ({
    group,
    floor,
    status: 'todo',
    ...z,
  });
  const desks = 'Một hàng bàn: ảnh tổng và ảnh cận bàn, ghế, màn hình, hộp cây cuối hàng';
  const noScreens =
    'Không chụp màn hình máy tính, bảng trắng, giấy tờ hay người đang ngồi làm việc';
  return [
    zone({
      code: code(1),
      name: `Hành lang quanh Atrium và booth (tầng ${n})`,
      priority: 1,
      outline: [
        [-16, -17],
        [16, -17],
        [23, -10],
        [23, 14],
        [16, 21],
        [-16, 21],
        [-23, 14],
        [-23, -10],
      ],
      covers: ['structure.main#atrium', 'booth_house', `seat.booth_${key}_*`],
      stations: [
        floor === 'F2'
          ? station(
              'S1',
              [-6, -13.5],
              [-6, 14],
              'Đỉnh khán đài, quay lưng vào văn phòng, nhìn xuống Atrium',
            )
          : station('S1', [-6, -14], [-6, 14], 'Mép hành lang phía bắc, nhìn xuống Atrium'),
        station('S2', [19.6, -9], [19.6, 8], 'Hành lang phía đông, nhìn dọc dãy booth'),
        station('S3', [0, 18.5], [0, -12], 'Hành lang phía nam, nhìn qua Atrium sang phía bắc'),
        station('S4', [-20.5, 2], [20, 2], 'Hành lang phía tây, nhìn qua Atrium sang phía đông'),
      ],
      shots: [
        'Lan can: kính, tay vịn, chân lan can (ảnh cận)',
        'Booth hình ngôi nhà: cả dãy, rồi một booth từ trước mặt và từ bên trong',
        'Nhìn xuống Atrium từ cả bốn phía',
        'Những cây cầu thang bắc ngang Atrium nhìn từ tầng này',
        'Sofa, ghế, cây dọc hành lang',
      ],
      count: ['Bề rộng hành lang (bước chân)', 'Số booth, bề ngang và chiều sâu một booth'],
      confirm: [
        'Booth nằm ở hành lang nào, tầng nào',
        'Hành lang có chạy kín một vòng quanh Atrium không',
      ],
    }),
    zone({
      code: code(2),
      name: `Văn phòng mở block chính — phía bắc (tầng ${n})`,
      priority: 2,
      outline: [
        [-66, -33.5],
        [35, -33.9],
        [42, -17],
        [-57, -17],
      ],
      covers: [`area.office.${key}.main`, 'desk_cluster', 'planter_box'],
      stations: [
        station('S1', [-50, -20], [10, -26], 'Đầu tây khu làm việc, nhìn dọc về phía đông'),
        station('S2', [30, -30], [-20, -22], 'Đầu đông, nhìn ngược về phía tây'),
      ],
      shots: [
        desks,
        'Khu hotdesk, bàn đứng, phone booth, tủ cá nhân, máy in',
        'Cửa sổ: thấy gì bên ngoài',
        noScreens,
      ],
      count: ['Số chỗ ngồi của một hàng bàn', 'Khoảng cách giữa hai hàng bàn (bước chân)'],
      confirm: ['Hàng bàn chạy song song với mặt kính nào'],
    }),
    zone({
      code: code(3),
      name: `Văn phòng mở block chính — phía tây và nam (tầng ${n})`,
      priority: 2,
      outline: [
        [-57, -17],
        [-23, -17],
        [-23, 20],
        [40, 20],
        [40, 30],
        [-22.5, 46.3],
        [-51.4, -6.1],
      ],
      labelAt: [-38, 22],
      covers: [`area.office.${key}.main`, 'desk_cluster', 'plant_shelf'],
      stations: [
        station('S1', [-45, 0], [-25, 35], 'Phía tây bắc khu, nhìn về phía nam'),
        station('S2', [10, 26], [-20, 30], 'Phía nam gần mặt kính hướng sông, nhìn về phía tây'),
      ],
      shots: [desks, 'Góc nghỉ, sofa, kệ cây', 'Cửa sổ phía sông: thấy gì bên ngoài', noScreens],
      count: ['Số hàng bàn trong khu'],
      confirm: ['Khu này là văn phòng mở hay có phòng kín'],
    }),
    zone({
      code: code(4),
      name: `Văn phòng mở block chính — phía đông (tầng ${n})`,
      priority: 2,
      outline: [
        [23, -17],
        [42.3, -17],
        [57, 19.5],
        [23, 19.5],
      ],
      covers: [`area.office.${key}.main`, 'desk_cluster'],
      stations: [
        station('S1', [26, -14], [50, 15], 'Góc tây bắc khu, nhìn chéo về phía đông nam'),
        station('S2', [52, 14], [28, -12], 'Góc đông nam, nhìn ngược lại'),
      ],
      shots: [desks, 'Cửa sổ phía hồ bơi: thấy gì bên ngoài', noScreens],
      count: ['Số hàng bàn trong khu'],
      confirm: ['Có lối ra ban công hay sân thượng ở phía này không'],
    }),
    zone({
      code: code(5),
      name: `Phòng họp (tầng ${n})`,
      priority: 1,
      outline: rect(-44.5, -34, -18.5, -25),
      covers: [`area.meeting.${key}_01…04`, 'meeting_room', `seat.meeting_${key}_*`],
      stations: [station('S1', [-31, -26], [-31, -31], 'Trước dãy phòng họp, nhìn thẳng vào')],
      shots: [
        'Mặt ngoài dãy phòng: vách kính, cửa, bảng tên, màn hình đặt phòng',
        'Bên trong một phòng còn trống: bàn, ghế, màn hình, sàn, trần',
        'Phòng họp lớn hoặc phòng đào tạo nếu có',
        'Không chụp nội dung trên màn hình hay bảng trắng',
      ],
      count: [
        'Số phòng họp trên tầng và sức chứa ghi trên bảng tên',
        'Kích thước một phòng (bước chân)',
      ],
      confirm: ['Tên của từng phòng họp (ghi lại hết)', 'Phòng họp nằm dọc mặt nào của toà nhà'],
    }),
    zone({
      code: code(6),
      name: `Pantry (tầng ${n})`,
      priority: 2,
      outline: areaOutline(`area.pantry.${key}`),
      covers: [`area.pantry.${key}`, 'pantry_counter', 'high_table', `seat.pantry_${key}_*`],
      stations: [station('S1', [30, -13.5], [35, -21], 'Lối vào pantry, nhìn vào trong')],
      shots: [
        'Quầy, máy pha cà phê, tủ lạnh, bồn rửa',
        'Chỗ ngồi: sofa, ghế bành, bàn cao',
        'Tường (gạch?), sàn, đèn',
      ],
      count: ['Số chỗ ngồi'],
      confirm: ['Mỗi tầng có mấy pantry, nằm ở đâu'],
    }),
    zone({
      code: code(7),
      name: `Văn phòng block 2 (tầng ${n})`,
      priority: 2,
      outline: campusIndex.structures.get('structure.block2')?.footprint ?? [],
      covers: [`area.office.${key}.block2`, 'connector.block2.1', 'connector.block2.2'],
      stations: [
        station('S1', [-64, -21], [-100, -21], 'Vừa qua cửa nối từ block chính, nhìn vào block 2'),
        floor === 'F2'
          ? station('S2', [-95, -13], [-95, 30], 'Đầu cầu thang block 2, nhìn về phía nam')
          : station('S2', [-89, 3], [-89, 35], 'Đầu cầu thang block 2, nhìn về phía nam'),
        floor === 'F2'
          ? station('S3', [-108, 40], [-100, 0], 'Đầu phía nam block 2, nhìn ngược về phía bắc')
          : station('S3', [-108, 25], [-100, -10], 'Gần đầu phía nam block 2, nhìn về phía bắc'),
      ],
      shots: [
        desks,
        'Cầu thang và thang máy của block 2',
        'Các phòng dọc hành lang (ghi tên biển)',
        noScreens,
      ],
      count: ['Số hàng bàn', 'Bề rộng hành lang chính (bước chân)'],
      confirm: ['Block 2 tầng này dùng làm gì (văn phòng, phòng họp, đào tạo…)'],
    }),
  ];
}

export const SURVEY_ZONES: readonly SurveyZone[] = [
  // --- Chung -------------------------------------------------------------------------------------
  {
    code: 'SD-01',
    name: 'Sơ đồ thoát hiểm của từng tầng',
    group: 'Chung',
    floor: 'F1',
    priority: 1,
    status: 'todo',
    where:
      'Dán ở sảnh thang máy, đầu hành lang, cạnh cầu thang bộ của mỗi tầng. Đây là tư liệu quý nhất: cho biết vị trí thật của mọi phòng',
    covers: ['structure.*', 'area.*'],
    stations: [],
    shots: [
      'Mỗi tầng ít nhất một sơ đồ, chụp thẳng góc, đủ sáng, không loá, đọc được chữ',
      'Nếu sơ đồ chỉ vẽ một phần tầng: chụp hết các bản ở các đầu hành lang',
      'Một ảnh xa hơn cho biết sơ đồ dán ở đâu (để biết chấm "Bạn đang ở đây")',
    ],
    count: ['Toà nhà có mấy tầng, có tầng hầm, tầng lửng, sân thượng không'],
    confirm: ['Hai khối nhà có thông nhau ở mọi tầng không'],
  },
  {
    code: 'SD-02',
    name: 'Thang máy, thang bộ, nhà vệ sinh (mọi tầng)',
    group: 'Chung',
    floor: 'F1',
    priority: 2,
    status: 'todo',
    where: 'Có ở nhiều nơi: mỗi lần gặp thì chụp và ghi kèm mã khu đang đứng',
    covers: ['connector.*'],
    stations: [],
    shots: [
      'Sảnh thang máy: số cửa, bảng số tầng',
      'Thang bộ: cửa vào và một ảnh nhìn lên chiếu nghỉ',
      'Nhà vệ sinh: chỉ chụp cửa và biển từ bên ngoài',
    ],
    count: ['Số thang máy ở mỗi sảnh', 'Số bậc của một vế thang bộ'],
    confirm: ['Các tầng ghi trên bảng thang máy (có B1, M, R không)'],
  },
  {
    code: 'H-01',
    name: 'Tầng hầm và bãi xe trong nhà (nếu có)',
    group: 'Chung',
    floor: 'F1',
    priority: 3,
    status: 'todo',
    where:
      'Hỏi bảo vệ lối xuống hầm. Ảnh báo chí có một sảnh tròn, cây lớn ở giữa, cổng soát vé phía sau: có thể nằm ở đây',
    covers: [],
    stations: [],
    shots: [
      'Lối xe xuống hầm, bãi xe máy, bãi ô tô',
      'Sảnh thang máy dưới hầm, sảnh tròn có cây (nếu có)',
    ],
    count: ['Số tầng hầm'],
    confirm: ['Sảnh tròn có cây ở giữa nằm ở đâu'],
  },

  // --- Ngoài trời --------------------------------------------------------------------------------
  {
    code: 'NT-01',
    name: 'Cổng chính, mái che chữ V, đài phun nước',
    group: 'Ngoài trời',
    floor: 'F1',
    priority: 1,
    status: 'todo',
    outline: [
      [6, 40],
      [34, 33],
      [40, 36],
      [40, 58],
      [4, 58],
    ],
    covers: [
      'area.gate_main',
      'area.fountain',
      'path.road.roundabout',
      'canopy_v',
      'door.main.south',
    ],
    stations: [
      station(
        'S1',
        [21.5, 55.5],
        [20, 36],
        'Bên kia đài phun nước, nhìn thẳng vào cửa chính, lấy trọn mái che',
      ),
      station(
        'S2',
        [21, 40.5],
        [21.5, 49],
        'Dưới mép mái che, quay lưng vào cửa, nhìn ra đài phun nước',
      ),
      station('S3', [8, 41.5], [34, 34], 'Góc tây sân trước, nhìn dọc mặt kính về phía đông'),
      station('S4', [38, 38], [6, 41], 'Góc đông sân trước, nhìn dọc mặt kính về phía tây'),
    ],
    shots: [
      'Mái che chữ V: ảnh tổng, ảnh ngước lên thấy kết cấu, ảnh chân cột',
      'Cửa chính: kiểu cửa, số cánh, khung',
      'Đài phun nước: tổng thể và cận mép bồn',
      'Sân trước: gạch lát, bậc, dốc cho xe lăn, bồn cây, đèn',
    ],
    count: [
      'Số cột của mái che; bề ngang và chiều sâu mái (bước chân)',
      'Đường kính bồn phun nước',
    ],
    confirm: ['Cửa chính có nằm giữa mái che không', 'Xe đưa đón dừng ở đâu'],
  },
  {
    code: 'NT-02',
    name: 'Mặt đứng phía sông và biển chữ VNG',
    group: 'Ngoài trời',
    floor: 'F1',
    priority: 2,
    status: 'todo',
    outline: [
      [-24, 47.5],
      [6, 40],
      [6, 57],
      [-26, 57],
    ],
    covers: ['structure.main', 'logo_sign'],
    stations: [
      station('S1', [-6, 56], [-6, 44], 'Mép bãi xe, nhìn thẳng vào biển chữ VNG'),
      station('S2', [-22, 54], [20, 37], 'Góc tây nam, nhìn chéo cả mặt đứng phía sông'),
    ],
    shots: [
      'Mặt đứng: chụp thẳng góc từng đoạn, thấy đủ các tầng và mái',
      'Biển chữ VNG: ở tầng nào, cách góc nhà bao xa',
      'Lam che nắng, cây leo, ban công',
      'Chân tường: bồn cây, cửa thoát hiểm',
    ],
    count: ['Số ô kính giữa hai cột', 'Số tầng nhìn thấy'],
    confirm: ['Biển chữ VNG ở tầng mấy'],
  },
  {
    code: 'NT-03',
    name: 'Bãi xe dọc đường phía sông',
    group: 'Ngoài trời',
    floor: 'F1',
    priority: 3,
    status: 'todo',
    outline: rect(-76, 55, 8, 69),
    covers: ['area.parking', 'car'],
    stations: [
      station('S1', [-73, 60], [8, 62], 'Đầu tây bãi xe, nhìn dọc hàng xe'),
      station('S2', [5, 60], [-74, 62], 'Đầu đông, nhìn ngược lại'),
      station('S3', [-34, 68], [-34, 50], 'Giữa bãi, quay lưng ra sông, nhìn vào toà nhà'),
    ],
    shots: [
      'Vạch kẻ ô đỗ, bó vỉa, cây bóng mát',
      'Lối người đi từ bãi xe vào cổng',
      'Bãi xe máy nếu có',
    ],
    count: ['Số ô đỗ ô tô', 'Bề rộng một ô đỗ (bước chân)'],
    confirm: ['Bãi xe máy nằm ở đâu', 'Có lối xuống hầm không'],
  },
  {
    code: 'NT-04',
    name: 'Công viên ven sông, lối dạo, bờ kè',
    group: 'Ngoài trời',
    floor: 'F1',
    priority: 2,
    status: 'todo',
    outline: areaOutline('area.riverside'),
    covers: ['area.riverside', 'path.walk.promenade', 'path.walk.river_spur', 'seat.riverside_*'],
    stations: [
      station('S1', [-100, 86], [-100, 100], 'Phía tây lối dạo, nhìn ra sông'),
      station('S2', [-40, 80], [-40, 50], 'Giữa công viên, quay lưng ra sông, nhìn về toà nhà'),
      station('S3', [21, 84], [21, 100], 'Cuối lối đi từ cổng ra sông, nhìn ra sông'),
      station('S4', [70, 78], [-30, 82], 'Đầu đông, nhìn dọc lối dạo về phía tây'),
    ],
    shots: [
      'Lối dạo: mặt lát, bề rộng, đèn, ghế',
      'Bờ kè và lan can ven sông',
      'Hàng cây: loại cây, khoảng cách',
      'Bãi cỏ, chỗ tập thể dục ngoài trời nếu có',
    ],
    count: ['Số ghế dọc lối dạo', 'Khoảng cách giữa hai cây (bước chân)'],
    confirm: ['Lối dạo có chạy hết chiều dài khu đất không'],
  },
  {
    code: 'NT-05',
    name: 'Sân vườn giữa hai block',
    group: 'Ngoài trời',
    floor: 'F1',
    priority: 2,
    status: 'todo',
    outline: areaOutline('area.forecourt'),
    covers: ['area.forecourt', 'area.garden_planter', 'planter_round'],
    stations: [
      station('S1', [-52.5, 27], [-52.5, 16], 'Phía nam bồn cây tròn, nhìn vào bồn'),
      station('S2', [-72, 44], [-50, 15], 'Góc tây nam sân, nhìn chéo về chỗ hai block giáp nhau'),
      station('S3', [-50, 3], [-55, 40], 'Chỗ hai block giáp nhau, quay lưng vào nhà, nhìn ra sân'),
    ],
    shots: [
      'Bồn cây tròn: tổng thể, mép bồn, cây giữa',
      'Lối đi uốn cong, mặt lát, bậc thang hay bậc ngồi ngoài trời',
      'Hai mặt đứng nhìn vào sân',
      'Một ảnh từ tầng 2 hoặc 3 nhìn xuống sân (nếu được)',
    ],
    count: ['Đường kính bồn cây', 'Số cây lớn'],
    confirm: ['Cửa nào của hai block mở ra sân'],
  },
  {
    code: 'NT-06',
    name: 'Hồ bơi và quán The Mojo',
    group: 'Ngoài trời',
    floor: 'F1',
    priority: 2,
    status: 'todo',
    outline: [
      [35, -45],
      [64, -45],
      [64, 15],
      [55, 15],
      [35, -34],
    ],
    covers: ['area.pool', 'area.pool_deck', 'seat.pool_*'],
    stations: [
      station('S1', [60, -42], [45, -20], 'Góc đông bắc sàn hồ bơi, nhìn chéo cả hồ'),
      station('S2', [59, 10], [46, -25], 'Góc nam, nhìn ngược lên'),
      station('S3', [40, -42], [50, -8], 'Góc tây bắc, nhìn chéo'),
    ],
    shots: [
      'Hồ: hình dạng mép hồ, bậc xuống, màu gạch',
      'Sàn quanh hồ: vật liệu, ghế nằm, dù',
      'Quán The Mojo: quầy, chỗ ngồi',
      'Cửa từ trong nhà ra hồ bơi',
    ],
    count: ['Chiều dài, chiều rộng hồ (bước chân dọc mép)', 'Số ghế nằm'],
    confirm: ['Ra hồ bơi bằng cửa nào', 'Phòng thay đồ ở đâu (chỉ ghi chú)'],
  },
  {
    code: 'NT-07',
    name: 'Ki-ốt cà phê ngoài trời và góc đông nam',
    group: 'Ngoài trời',
    floor: 'F1',
    priority: 3,
    status: 'todo',
    outline: rect(41, 31.5, 70, 60),
    covers: ['area.cafe_terrace', 'area.cafe_kiosk', 'seat.cafe_terrace_*'],
    stations: [
      station('S1', [45, 57], [55, 47], 'Từ phía sông, nhìn vào ki-ốt'),
      station('S2', [67, 40], [48, 32], 'Góc đông nam, nhìn mặt đứng phía đông nam'),
    ],
    shots: [
      'Ki-ốt: mái, quầy, chỗ ngồi (biển hiệu chỉ để tham khảo; trong game dùng tên chung)',
      'Bàn ghế ngoài trời',
      'Lối nối ki-ốt với cổng và với hồ bơi',
    ],
    count: ['Số bàn ngoài trời'],
    confirm: ['Ki-ốt mở cửa về phía nào'],
  },
  {
    code: 'NT-08',
    name: 'Phía đường Tân Thuận: đường nội bộ, cổng xe, chốt bảo vệ',
    group: 'Ngoài trời',
    floor: 'F1',
    priority: 3,
    status: 'todo',
    outline: rect(-126, -57, 90, -38),
    covers: ['area.gatehouse', 'path.road.loop', 'door.main.north', 'door.block2.north'],
    stations: [
      station('S1', [72, -50], [68, -54], 'Cạnh chốt bảo vệ, nhìn về cổng xe'),
      station('S2', [0, -44], [0, -34], 'Đối diện cửa phía bắc block chính'),
      station('S3', [-40, -44], [40, -44], 'Giữa đường nội bộ phía bắc, nhìn về phía đông'),
      station('S4', [-100, -44], [-92, -37], 'Trước cửa phía bắc block 2'),
    ],
    shots: [
      'Cổng xe ra vào: bề rộng, barie (chụp từ xa)',
      'Chốt bảo vệ: chỉ hình khối bên ngoài, không chụp thiết bị an ninh',
      'Mặt đứng phía bắc của hai block, cửa phụ',
      'Dải cây và hàng rào dọc đường Tân Thuận',
    ],
    count: ['Số làn xe ở cổng', 'Số cửa trên mặt đứng phía bắc'],
    confirm: [
      'Có cổng cho người đi bộ phía đường Tân Thuận không',
      'Chốt bảo vệ có ở góc đông bắc không',
    ],
  },
  {
    code: 'NT-09',
    name: 'Phía tây block 2 và hàng rào tây',
    group: 'Ngoài trời',
    floor: 'F1',
    priority: 3,
    status: 'todo',
    outline: rect(-126, -40, -117.5, 58),
    covers: ['structure.block2', 'door.block2.west'],
    stations: [
      station('S1', [-121, -33], [-121, 40], 'Góc tây bắc, nhìn dọc mặt tây về phía sông'),
      station('S2', [-121, 5], [-116, 5], 'Giữa mặt tây, nhìn vào cửa phía tây'),
      station('S3', [-121, 52], [-121, -30], 'Góc tây nam, nhìn ngược lên'),
    ],
    shots: [
      'Mặt đứng phía tây block 2',
      'Hàng rào và hàng cây ranh giới',
      'Một ảnh khu đất bên ngoài hàng rào',
    ],
    count: ['Khoảng cách từ tường nhà tới hàng rào (bước chân)'],
    confirm: ['Phía tây có lối ra vào không'],
  },

  // --- Tầng trệt ---------------------------------------------------------------------------------
  {
    code: 'T1-01',
    name: 'Sảnh lễ tân và cổng soát vé',
    group: 'Tầng trệt',
    floor: 'F1',
    priority: 1,
    status: 'todo',
    outline: areaOutline('area.lobby'),
    covers: ['area.lobby', 'speed_gate', 'reception_desk', 'seat.lobby_*', 'npc.reception'],
    stations: [
      station('S1', [20, 34], [20, 18], 'Vừa bước qua cửa chính, nhìn thẳng vào trong'),
      station('S2', [32, 21], [16, 20], 'Đầu đông hàng cổng soát vé, nhìn dọc hàng cổng'),
      station('S3', [19, 20], [32, 31], 'Phía trong cổng, quay lại nhìn về quầy lễ tân và cửa'),
    ],
    shots: [
      'Cổng soát vé: cả hàng, rồi cận một cổng (cánh kính, đầu đọc thẻ, đèn)',
      'Quầy lễ tân: mặt trước, mặt quầy',
      'Tường chữ, biển chào, màn hình',
      'Ghế chờ, cây',
    ],
    count: ['Số cổng soát vé, bề rộng một làn', 'Chiều dài quầy lễ tân'],
    confirm: [
      'Quầy lễ tân ở giữa, bên trái hay bên phải khi bước vào',
      'Hàng cổng nằm giữa sảnh và Atrium hay ở chỗ khác',
    ],
  },
  {
    code: 'T1-02',
    name: 'Atrium và khán đài gỗ',
    group: 'Tầng trệt',
    floor: 'F1',
    priority: 1,
    status: 'todo',
    outline: areaOutline('area.atrium'),
    covers: [
      'area.atrium',
      'area.atrium_bleachers',
      'connector.main.bleachers',
      'connector.main.south_1',
      'led_wall',
      'seat.atrium_*',
    ],
    stations: [
      station('S1', [-6, 9], [-6, -6], 'Trước màn LED, nhìn thẳng lên khán đài'),
      station('S2', [12, 2], [-14, 0], 'Phía đông Atrium, nhìn ngang qua khán đài'),
      station('S3', [-16, 12], [12, -8], 'Góc tây nam Atrium, nhìn chéo'),
      station(
        'S4',
        [0, 2],
        [0, -12],
        'Giữa Atrium: một ảnh như mũi tên, rồi một ảnh ngước thẳng lên giếng trời',
      ),
    ],
    shots: [
      'Khán đài: chính diện, nghiêng 45°, cận một bậc có vật làm thước đo (chai nước, ba lô)',
      'Lối bậc nhỏ giữa khán đài và lan can hai bên',
      'Màn LED và khối ốp gỗ quanh nó',
      'Từng cây cầu thang bắc ngang Atrium',
      'Giếng trời: chụp ngước thẳng lên',
      'Sàn gỗ, cột, mép sàn các tầng trên nhìn từ dưới lên',
    ],
    count: [
      'Số bậc khán đài; chiều cao và chiều sâu một bậc',
      'Bề ngang khán đài (bước chân)',
      'Số cầu thang trong Atrium, mỗi cái nối tầng nào với tầng nào',
    ],
    confirm: [
      'Khán đài quay mặt về màn LED, về sảnh hay hướng khác',
      'Khán đài lên tới hành lang tầng 2 không',
    ],
  },
  {
    code: 'T1-03',
    name: 'Khu hồ Koi và quầy cà phê',
    group: 'Tầng trệt',
    floor: 'F1',
    priority: 1,
    status: 'todo',
    outline: areaOutline('area.koi'),
    covers: [
      'area.koi',
      'area.koi_pond',
      'area.coffee_main',
      'coffee_bar',
      'back_bar',
      'seat.koi_*',
      'seat.coffee_*',
    ],
    stations: [
      station('S1', [-2, 24.5], [-2, 30], 'Mép bắc hồ Koi, nhìn qua hồ'),
      station('S2', [10, 33], [9.25, 27.4], 'Trước quầy cà phê, nhìn thẳng vào quầy'),
      station('S3', [-12, 40], [6, 26], 'Góc tây nam khu, nhìn chéo về quầy'),
    ],
    shots: [
      'Hồ Koi: hình dạng, mép hồ, đá, cây',
      'Quầy cà phê: mặt quầy, kệ sau quầy, bảng menu',
      'Chỗ ngồi quanh hồ và quanh quầy',
      'Ánh sáng: giếng trời, cửa kính',
    ],
    count: ['Kích thước hồ (bước chân hai chiều)', 'Số chỗ ngồi'],
    confirm: ['Hồ Koi có ở phía nam Atrium không', 'Quầy cà phê ở trung tâm campus là quán nào'],
  },
  {
    code: 'T1-04',
    name: 'Canteen',
    group: 'Tầng trệt',
    floor: 'F1',
    priority: 1,
    status: 'todo',
    outline: areaOutline('area.canteen'),
    covers: ['area.canteen', 'canteen_table', 'food_counter', 'slat_ceiling', 'seat.canteen_*'],
    stations: [
      station('S1', [10, -16], [30, -28], 'Lối vào canteen, nhìn chéo vào trong'),
      station('S2', [20, -25.5], [20, -31.5], 'Trước dãy quầy, nhìn thẳng vào quầy'),
      station('S3', [44, 6], [15, -26], 'Góc đông nam canteen, nhìn chéo cả sảnh'),
      station('S4', [40, -14], [8, -20], 'Phía đông, nhìn về phía tây'),
    ],
    shots: [
      'Dãy quầy phục vụ: tổng thể và từng quầy (bếp Á, bếp Âu, đồ uống…)',
      'Bàn ghế: một dãy bàn, rồi cận một bàn với ghế',
      'Trần: khung lam gỗ, đèn, ống kỹ thuật',
      'Khu trả khay, tủ nước, cửa ra ngoài',
      'Cửa kính: nhìn ra thấy gì',
    ],
    count: ['Số dãy bàn, số bàn mỗi dãy, số ghế mỗi bàn', 'Chiều dài một bàn', 'Số quầy phục vụ'],
    confirm: [
      'Canteen có ở góc đông bắc cạnh hồ bơi không',
      'Canteen có tầng lửng hay chỗ ngồi ngoài trời không',
    ],
  },
  {
    code: 'T1-05',
    name: 'Tầng trệt phía bắc: hành lang, cửa bắc, lối sang block 2',
    group: 'Tầng trệt',
    floor: 'F1',
    priority: 2,
    status: 'todo',
    outline: [
      [-66, -33.5],
      [5, -33.5],
      [5, -13],
      [-55, -13],
    ],
    covers: ['area.main.f1', 'door.main.north', 'door.main.link_f1'],
    stations: [
      station('S1', [0, -32], [0, -14], 'Ngay trong cửa phía bắc, nhìn vào'),
      station('S2', [-40, -24], [0, -24], 'Giữa khu, nhìn về phía đông'),
      station('S3', [-55, -19], [-66, -23], 'Trước cửa nối sang block 2'),
    ],
    shots: [
      'Hành lang: bề rộng, sàn, trần',
      'Cửa phía bắc và cửa nối sang block 2',
      'Các phòng hay quầy nằm ở đây (ghi tên trên biển)',
    ],
    count: ['Bề rộng cửa nối sang block 2'],
    confirm: ['Khu này thực tế là gì (văn phòng, kho, dịch vụ…)'],
  },
  {
    code: 'T1-06',
    name: 'Tầng trệt phía tây: giữa Atrium và cửa tây',
    group: 'Tầng trệt',
    floor: 'F1',
    priority: 2,
    status: 'todo',
    outline: [
      [-55.2, -13],
      [-18.5, -13],
      [-18.5, 20.5],
      [-14.5, 20.5],
      [-14.5, 42.5],
      [-22.5, 46.3],
      [-51.4, -5.85],
    ],
    covers: ['area.main.f1', 'door.main.west'],
    stations: [
      station('S1', [-36, 16], [-18, 6], 'Trong cửa phía tây, nhìn về Atrium'),
      station('S2', [-30, -8], [-30, 30], 'Phía bắc khu, nhìn về phía nam'),
    ],
    shots: [
      'Cửa phía tây và khu ngay trong cửa',
      'Những gì nằm giữa Atrium và mặt tây',
      'Biển chỉ dẫn',
    ],
    count: [],
    confirm: ['Cửa hàng tiện lợi, ATM, máy bán hàng có ở đây không'],
  },
  {
    code: 'T1-07',
    name: 'Tầng trệt phía đông: giữa sảnh, canteen và cửa đông',
    group: 'Tầng trệt',
    floor: 'F1',
    priority: 2,
    status: 'todo',
    outline: [
      [18, -12],
      [22, -12],
      [22, 10],
      [52, 10],
      [56.8, 21.5],
      [34.5, 31.5],
      [34.5, 17.5],
      [18, 17.5],
    ],
    covers: ['area.main.f1', 'door.main.east'],
    stations: [
      station('S1', [50, 13], [25, 13], 'Trong cửa phía đông, nhìn vào'),
      station('S2', [26, 15], [52, 16], 'Giữa khu, nhìn về cửa phía đông'),
    ],
    shots: ['Cửa phía đông', 'Lối từ sảnh sang canteen và ra hồ bơi', 'Các quầy hay phòng ở đây'],
    count: [],
    confirm: ['Lối ra hồ bơi và ki-ốt cà phê có đi qua đây không'],
  },
  {
    code: 'T1-08',
    name: 'Cửa hàng tiện lợi và dịch vụ (7-Eleven, máy bán hàng, ATM)',
    group: 'Tầng trệt',
    floor: 'F1',
    priority: 3,
    status: 'todo',
    where: 'Chưa biết ở đâu: ghi lại nằm cạnh khu nào, rồi chụp từ lối vào',
    covers: [],
    stations: [],
    shots: [
      'Mặt tiền (biển hiệu chỉ để tham khảo)',
      'Bên trong lúc vắng: kệ, quầy thanh toán',
      'Máy bán hàng tự động, ATM, tủ đồ',
    ],
    count: ['Bề ngang mặt tiền (bước chân)'],
    confirm: ['Nằm ở tầng nào, cạnh khu nào'],
  },
  {
    code: 'B1-01',
    name: 'Phòng gym UPFIT',
    group: 'Tầng trệt',
    floor: 'F1',
    priority: 1,
    status: 'todo',
    outline: areaOutline('area.gym'),
    covers: ['area.gym', 'gym_rack', 'treadmill', 'rower', 'dumbbell_rack', 'mirror_wall'],
    stations: [
      station('S1', [-75, -15.5], [-100, -31], 'Góc đông nam phòng gym, nhìn chéo'),
      station('S2', [-110, -16], [-80, -31], 'Góc tây nam, nhìn chéo ngược lại'),
      station('S3', [-92, -21], [-92, -33], 'Giữa phòng, nhìn về vách gương'),
    ],
    shots: [
      'Khu tạ tự do: rack, ghế, giá tạ, vách gương',
      'Khu máy chạy, máy chèo, xe đạp',
      'Phòng tập nhóm (yoga, boxing…) và quầy tiếp đón của gym',
      'Sàn cao su, trần, đèn',
      'Không chụp bên trong phòng thay đồ, phòng tắm, sauna',
    ],
    count: ['Số rack, số máy mỗi loại', 'Kích thước phòng (bước chân hai chiều)'],
    confirm: ['Gym có ở tầng trệt block 2 không', 'Phòng yoga ở đâu'],
  },
  {
    code: 'B1-02',
    name: 'Block 2 tầng trệt — phần còn lại',
    group: 'Tầng trệt',
    floor: 'F1',
    priority: 2,
    status: 'todo',
    outline: [
      [-116.6, -13.5],
      [-55.5, -13.5],
      [-51.8, -6.1],
      [-77, 9.2],
      [-76.9, 26.3],
      [-100.3, 48.4],
      [-113.2, 48],
      [-116, 47.2],
      [-116.9, 44],
    ],
    covers: ['area.block2.f1', 'connector.block2.1', 'door.block2.forecourt', 'door.block2.west'],
    stations: [
      station('S1', [-88, 35], [-95, 0], 'Trong cửa phía sân vườn, nhìn vào'),
      station('S2', [-95, 4], [-95, -8], 'Chân cầu thang block 2'),
      station('S3', [-112, 5], [-80, 5], 'Trong cửa phía tây, nhìn sang phía đông'),
    ],
    shots: [
      'Sảnh phụ của block 2',
      'Cầu thang và thang máy của block 2',
      'Các phòng dọc hành lang (ghi tên biển)',
      'Khu giữ trẻ nếu có: chỉ chụp lối vào, không chụp trẻ em',
    ],
    count: [],
    confirm: ['Tầng trệt block 2 gồm những khu gì'],
  },

  // --- Tầng trên ---------------------------------------------------------------------------------
  ...officeZones('F2'),
  ...officeZones('F3'),
  {
    code: 'T3-08',
    name: 'Phòng yoga',
    group: 'Tầng 3',
    floor: 'F3',
    priority: 3,
    status: 'todo',
    outline: areaOutline('area.yoga'),
    covers: ['area.yoga', 'yoga_mat'],
    stations: [station('S1', [-104, 32], [-112, 42], 'Cửa phòng yoga, nhìn vào trong')],
    shots: ['Sàn, gương, cửa kính và view ra ngoài', 'Thảm, dụng cụ'],
    count: ['Kích thước phòng (bước chân)'],
    confirm: ['Phòng yoga ở tầng nào, block nào'],
  },

  // --- Mái ---------------------------------------------------------------------------------------
  {
    code: 'M-01',
    name: 'Mái và sân thượng (nếu được phép lên)',
    group: 'Mái',
    floor: 'ROOF',
    priority: 3,
    status: 'todo',
    where: 'Chỉ khi được phép',
    covers: ['structure.main#roof'],
    stations: [],
    shots: [
      'Giếng trời Atrium nhìn từ trên mái',
      'Vườn trên mái, pin mặt trời',
      'Nhìn xuống sân vườn, hồ bơi, cổng',
    ],
    count: [],
    confirm: ['Mái có sân thượng cho nhân viên không'],
  },
];

/** A station by its full id, `T1-02.S1`. */
export function findSurveyStation(
  fullId: string,
): { zone: SurveyZone; station: SurveyStation } | undefined {
  const [code, id] = fullId.split('.');
  const zone = SURVEY_ZONES.find((z) => z.code === code);
  const found = zone?.stations.find((s) => s.id === id);
  return zone && found ? { zone, station: found } : undefined;
}

/** Camera height above the floor at a station: a person holding a phone. */
export const SURVEY_EYE_HEIGHT = 1.5;

/** Map version the outlines and stations were laid out on. */
export const SURVEY_MAP_VERSION = campusMap.version;
