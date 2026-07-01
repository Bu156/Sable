import { Box, toRem, Text, color, config, Menu, Icon, Icons, Line, MenuItem } from 'folds';
import { SquaresFour, sizedIcon } from '$components/icons/phosphor';
import { PageNav, PageNavHeader } from '$components/page';
import { useEffect, useState } from 'react';
import { ScreenSize, useScreenSizeContext } from '$hooks/useScreenSize';
import { useSetting } from '$state/hooks/settings';
import { settingsAtom } from '$state/settings';
import { SidebarResizer } from '../sidebar/SidebarResizer';
import { useSetAtom } from 'jotai';
import { isResizingSidebarAtom } from '$state/isResizingSidebar';
import { AccountMenuOption, PresenceMenuOption } from '../sidebar/UserMenuTab';
import { useMatrixClient } from '$hooks/useMatrixClient';
import { GlobalUserHeroName, UserHero } from '$components/user-profile/UserHero';
import { getMxIdLocalPart, mxcUrlToHttp } from '$utils/matrix';
import { useMediaAuthentication } from '$hooks/useMediaAuthentication';
import { useUserPresence } from '$hooks/useUserPresence';
import { useUserProfile } from '$hooks/useUserProfile';
import { useOpenSettings } from '$features/settings';
import { UserQuickTools } from '../sidebar/UserQuickTools';

export function ProfileMobile() {
  const mx = useMatrixClient();
  const useAuthentication = useMediaAuthentication();
  const openSettings = useOpenSettings();
  const [oldSidebar] = useSetting(settingsAtom, 'oldSidebar');

  const userId = mx.getUserId() ?? '';
  const profile = useUserProfile(userId);
  const presence = useUserPresence(userId);

  const displayName = profile.displayName ?? getMxIdLocalPart(userId) ?? userId;
  const heroAvatarUrl = profile.avatarUrl
    ? (mxcUrlToHttp(mx, profile.avatarUrl, useAuthentication, 160, 160, 'crop') ?? undefined)
    : undefined;

  const parsedBanner =
    typeof profile.bannerUrl === 'string' ? profile.bannerUrl.replace(/^"|"$/g, '') : undefined;
  const heroBannerUrl = parsedBanner
    ? (mxcUrlToHttp(mx, parsedBanner, useAuthentication, 640, 192, 'scale') ?? undefined)
    : undefined;

  const setIsResizingSidebar = useSetAtom(isResizingSidebarAtom);
  const [roomSidebarWidth, setRoomSidebarWidth] = useSetting(settingsAtom, 'roomSidebarWidth');
  const [curWidth, setCurWidth] = useState(roomSidebarWidth);

  useEffect(() => {
    setCurWidth(roomSidebarWidth);
  }, [roomSidebarWidth]);
  const screenSize = useScreenSizeContext();
  const isMobile = screenSize === ScreenSize.Mobile;
  const hideText = curWidth <= 80 && !isMobile;

  return (
    <>
      {!isMobile && (
        <Box
          shrink="No"
          style={{
            position: 'relative',
            width: toRem(curWidth),
            borderRight: 'solid',
            borderColor: color.SurfaceVariant.ContainerLine,
            borderWidth: `0 ${config.borderWidth.B300} 0 0`,
          }}
        >
          <PageNav>
            <PageNavHeader size="600">
              <Box grow="Yes" gap="300" justifyContent="Center">
                {!hideText ? (
                  <Box grow="Yes">
                    <Text size="H4" truncate align="Center">
                      Profile
                    </Text>
                  </Box>
                ) : (
                  sizedIcon(SquaresFour, '200', { filled: true })
                )}
              </Box>
            </PageNavHeader>
            <SidebarResizer
              setCurWidth={setCurWidth}
              sidebarWidth={roomSidebarWidth}
              setSidebarWidth={setRoomSidebarWidth}
              instep={50}
              outstep={190}
              minValue={50}
              maxValue={500}
              setAnnouncement={setIsResizingSidebar}
            />
          </PageNav>
          {!oldSidebar && !isMobile && <UserQuickTools width={curWidth + 66} compact={false} />}
        </Box>
      )}
      <Box
        direction="Column"
        gap="0"
        alignItems="Center"
        style={{ width: '100%', minWidth: '100%' }}
      >
        <Menu style={{ minWidth: '100%', overflowY: 'scroll' }}>
          <UserHero
            userId={userId}
            avatarUrl={heroAvatarUrl}
            bannerUrl={heroBannerUrl}
            presence={presence}
            showColor={false}
            allowEditing={true}
          />

          <Box style={{ padding: `0 ${config.space.S200} ${config.space.S200}` }}>
            <GlobalUserHeroName displayName={displayName} userId={userId} />
          </Box>
          <Line variant="Surface" size="300" />
          <PresenceMenuOption initialOpen isMobile />
          <AccountMenuOption isMobile />

          <Line variant="Surface" size="300" />

          <MenuItem
            size="300"
            radii="300"
            before={<Icon size="100" src={Icons.Setting} />}
            onClick={() => openSettings()}
          >
            <Text style={{ flexGrow: 1 }} size="T300">
              Settings
            </Text>
          </MenuItem>
        </Menu>
      </Box>
    </>
  );
}
