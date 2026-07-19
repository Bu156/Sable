import { globalStyle, style } from '@vanilla-extract/css';
import { config, toRem } from 'folds';
import { messageJumpHighlight } from '$components/message/layout/layout.css';

export const SequenceCardStyle = style({
  padding: config.space.S300,
});

export const settingsSectionBody = style({
  width: '100%',
  maxWidth: toRem(800),
  marginInline: 'auto',
});

globalStyle(`${settingsSectionBody} *`, {
  scrollbarWidth: 'none',
});
globalStyle(`${settingsSectionBody} *::-webkit-scrollbar`, {
  display: 'none',
});

export const settingsHeader = style({
  paddingLeft: config.space.S300,
  paddingRight: config.space.S200,
});

export const focusedSettingTile = messageJumpHighlight;
