/**
 * Display typeface: Barlow Condensed (SIL Open Font License), for headings, scores and big numbers.
 * Body text stays on the system font. Each weight is imported from its own file so only these three are
 * bundled (about 315 KB).
 */
import { BarlowCondensed_600SemiBold } from '@expo-google-fonts/barlow-condensed/600SemiBold';
import { BarlowCondensed_800ExtraBold } from '@expo-google-fonts/barlow-condensed/800ExtraBold';
import { BarlowCondensed_800ExtraBold_Italic } from '@expo-google-fonts/barlow-condensed/800ExtraBold_Italic';

export const FONT_FILES = { BarlowCondensed_600SemiBold, BarlowCondensed_800ExtraBold, BarlowCondensed_800ExtraBold_Italic };

export const FONTS = {
  display: 'BarlowCondensed_800ExtraBold',
  displayItalic: 'BarlowCondensed_800ExtraBold_Italic',
  displaySemi: 'BarlowCondensed_600SemiBold',
};
