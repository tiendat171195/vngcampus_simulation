import type { MissionEntity } from '@campus/shared';

/** How items are called in the prompt ("Nhặt ly cà phê"). Unknown items get a generic word. */
const ITEM_NAMES: Record<string, string> = {
  coffee_cup: 'ly cà phê',
  tea_cup: 'ly trà',
  badge: 'huy hiệu',
  book: 'cuốn sách',
  flower: 'bông hoa',
  gift: 'hộp quà',
  lantern: 'đèn lồng',
};

export const itemName = (item: string | undefined) => (item && ITEM_NAMES[item]) || 'vật phẩm';

export function entityLabel(entity: MissionEntity): string {
  return entity.kind === 'kiosk' ? 'Trả lời câu hỏi' : `Nhặt ${itemName(entity.item)}`;
}
