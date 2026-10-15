import { describe, it, expect } from 'vitest';
import { addMonthsToMonth, availableMonths, monthNeighbours, timelineNavMonths } from '../months';

describe('addMonthsToMonth', () => {
  it('steps forward across a year end', () => {
    expect(addMonthsToMonth('2026-11', 3)).toBe('2027-02');
  });

  it('steps backward across a year start', () => {
    expect(addMonthsToMonth('2026-02', -3)).toBe('2025-11');
  });

  it('accepts a full date and returns the month', () => {
    expect(addMonthsToMonth('2026-10-15', 11)).toBe('2027-09');
  });
});

describe('availableMonths', () => {
  it('runs from the start month to the end month inclusive, across a year end', () => {
    expect(availableMonths('2026-11-20', '2027-02-28')).toEqual(['2026-11', '2026-12', '2027-01', '2027-02']);
  });
});

describe('timelineNavMonths', () => {
  it('caps only the forward end at the horizon; every past month stays', () => {
    expect(timelineNavMonths('2026-07-05', '2027-09-30', '2026-12')).toEqual([
      '2026-07', '2026-08', '2026-09', '2026-10', '2026-11', '2026-12',
    ]);
  });

  it('keeps the horizon month itself', () => {
    expect(timelineNavMonths('2026-10-01', '2027-09-30', '2026-10')).toEqual(['2026-10']);
  });

  it('with no known horizon, the window is the limit', () => {
    expect(timelineNavMonths('2026-10-01', '2026-12-31', null)).toEqual(['2026-10', '2026-11', '2026-12']);
  });
});

describe('monthNeighbours', () => {
  const months = ['2026-08', '2026-09', '2026-10'];

  it('gives both neighbours in the middle', () => {
    expect(monthNeighbours(months, '2026-09')).toEqual({ previous: '2026-08', next: '2026-10' });
  });

  it('has no previous at the first month', () => {
    expect(monthNeighbours(months, '2026-08')).toEqual({ previous: null, next: '2026-09' });
  });

  it('has no next at the last month', () => {
    expect(monthNeighbours(months, '2026-10')).toEqual({ previous: '2026-09', next: null });
  });

  it('from a month before the list, Next reaches the first listed month', () => {
    expect(monthNeighbours(months, '2026-06')).toEqual({ previous: null, next: '2026-08' });
  });

  it('from a month after the list, Previous reaches the last listed month', () => {
    expect(monthNeighbours(months, '2026-12')).toEqual({ previous: '2026-10', next: null });
  });

  it('an empty list has nowhere to go', () => {
    expect(monthNeighbours([], '2026-10')).toEqual({ previous: null, next: null });
  });
});
