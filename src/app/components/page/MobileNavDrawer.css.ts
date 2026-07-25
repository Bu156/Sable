import { globalStyle, style } from '@vanilla-extract/css';

export const NoScrollbar = style({
  msOverflowStyle: 'none',
  scrollbarWidth: 'none',
});

globalStyle(`${NoScrollbar}::-webkit-scrollbar`, {
  display: 'none',
});
