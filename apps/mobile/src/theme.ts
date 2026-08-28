/**
 * The few values the scaffold's screens share.
 *
 * Lifted from the web app's inline styles so the two do not drift apart on
 * day one — #0F2044 is the navy used for headings on the signin page,
 * #FAFAF8 the page background, #6B7280 the muted text. This is not a design
 * system and should not grow into one here; it exists so that three screens
 * do not each invent their own navy.
 */
export const theme = {
  color: {
    background: '#FAFAF8',
    surface: '#FFFFFF',
    border: '#E5E7EB',
    heading: '#0F2044',
    body: '#1F2937',
    muted: '#6B7280',
    danger: '#DC2626',
    dangerSurface: '#FEF2F2',
    dangerBorder: '#FECACA',
  },
  space: { xs: 4, sm: 8, md: 16, lg: 24, xl: 32 },
  radius: { md: 12, lg: 16 },
} as const;
