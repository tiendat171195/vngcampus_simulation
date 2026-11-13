import type { Object3D, Sprite } from 'three';
import { createLabelSprite } from '../world/labels';

const MAX_CHARS = 48;
/** Above the name tag. */
const BUBBLE_HEIGHT = 2.45;

/** One speech bubble sprite per speaker, created when the text changes and removed when it expires. */
export class BubbleView {
  private sprite: Sprite | null = null;
  private text = '';

  update(parent: Object3D, text: string | null, x: number, y: number, z: number): void {
    if (!text) {
      this.clear();
      return;
    }
    if (text !== this.text || !this.sprite) {
      this.clear();
      const shown = text.length > MAX_CHARS ? `${text.slice(0, MAX_CHARS - 1)}…` : text;
      this.sprite = createLabelSprite(`💬 ${shown}`, 0.34);
      this.sprite.name = 'speech-bubble';
      this.text = text;
      parent.add(this.sprite);
    }
    this.sprite.position.set(x, y + BUBBLE_HEIGHT, z);
  }

  clear(): void {
    if (!this.sprite) return;
    this.sprite.removeFromParent();
    this.sprite.material.map?.dispose();
    this.sprite.material.dispose();
    this.sprite = null;
    this.text = '';
  }
}
