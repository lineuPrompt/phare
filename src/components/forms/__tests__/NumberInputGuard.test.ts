import { describe, expect, it, vi } from 'vitest';
import { onNumberKeyDown, onNumberWheel } from '../NumberInputGuard';

const numberField = () => ({ tagName: 'INPUT', type: 'number', blur: vi.fn() });

describe('NumberInputGuard', () => {
  it('stops ArrowUp and ArrowDown on a number field', () => {
    for (const key of ['ArrowUp', 'ArrowDown']) {
      const preventDefault = vi.fn();
      onNumberKeyDown({ key, target: numberField(), preventDefault });
      expect(preventDefault).toHaveBeenCalledTimes(1);
    }
  });

  it('leaves typing, other keys and other fields alone', () => {
    const preventDefault = vi.fn();
    onNumberKeyDown({ key: '5', target: numberField(), preventDefault });
    onNumberKeyDown({ key: 'ArrowLeft', target: numberField(), preventDefault });
    onNumberKeyDown({ key: 'ArrowUp', target: { tagName: 'INPUT', type: 'text' }, preventDefault });
    onNumberKeyDown({ key: 'ArrowDown', target: { tagName: 'SELECT' }, preventDefault });
    expect(preventDefault).not.toHaveBeenCalled();
  });

  it('blurs a focused number field on wheel, so the wheel cannot change it', () => {
    const field = numberField();
    onNumberWheel({ target: field }, field);
    expect(field.blur).toHaveBeenCalledTimes(1);
  });

  it('does not blur a number field that is not focused', () => {
    const field = numberField();
    onNumberWheel({ target: field }, null);
    expect(field.blur).not.toHaveBeenCalled();
  });
});
