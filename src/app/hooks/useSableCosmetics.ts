import { useMemo } from 'react';
import type { IContent } from '$types/matrix-sdk';
import type { Room } from '$types/matrix-sdk';
import { usePowerLevels } from './usePowerLevels';
import { useRoomCreators } from './useRoomCreators';
import { useAccessiblePowerTagColors, useGetMemberPowerTag } from './useMemberPowerTag';
import { useRoomCreatorsTag } from './useRoomCreatorsTag';
import { usePowerLevelTags } from './usePowerLevelTags';
import { useTheme } from './useTheme';
import { useUserProfile } from './useUserProfile';
import { useSetting } from '$state/hooks/settings';
import { settingsAtom } from '$state/settings';
import { accessibleColor, accessibleColorWeakCorrection } from '$plugins/color';

export function useSableCosmetics(
  userId: string,
  room: Room,
  isUserHero?: boolean,
  fetchProfile = true
) {
  const theme = useTheme();
  const profile = useUserProfile(userId, room, undefined, false, fetchProfile);

  const powerLevels = usePowerLevels(room);
  const creators = useRoomCreators(room);
  const creatorsTag = useRoomCreatorsTag();
  const powerLevelTags = usePowerLevelTags(room, powerLevels);
  const getPowerTag = useGetMemberPowerTag(room, creators, powerLevels);

  const accessibleTagColors = useAccessiblePowerTagColors(theme.kind, creatorsTag, powerLevelTags);
  const [nameColorLightnessCorrection] = useSetting(settingsAtom, 'nameColorLightnessCorrection');

  return useMemo(() => {
    if (!room || !userId) return { color: undefined, font: undefined };

    const accessibleNameColor = (color: string | undefined) => {
      if (!color || nameColorLightnessCorrection === 'off') {
        return color;
      } else if (nameColorLightnessCorrection === 'strong') {
        return accessibleColor(theme.kind, color);
      } else {
        /* weak color correction */
        return accessibleColorWeakCorrection(theme.kind, color);
      }
    };

    let finalColor = accessibleNameColor(
      isUserHero ? profile.heroNameColor : profile.resolvedColor
    );
    if (!finalColor) {
      const memberPowerTag = getPowerTag(userId);
      finalColor = memberPowerTag?.color
        ? accessibleTagColors?.get(memberPowerTag.color)
        : undefined;
    }
    const resolvedCosmetics: IContent = {
      color: finalColor,
      font: profile.resolvedFont,
    };

    return resolvedCosmetics;
  }, [
    room,
    userId,
    isUserHero,
    profile.heroNameColor,
    profile.resolvedColor,
    profile.resolvedFont,
    getPowerTag,
    accessibleTagColors,
    nameColorLightnessCorrection,
    theme.kind,
  ]);
}
