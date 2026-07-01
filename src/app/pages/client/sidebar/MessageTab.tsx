import { SidebarAvatar, SidebarItem, SidebarItemTooltip } from '$components/sidebar';
import { getPhosphorIconSize } from '$components/icons/phosphor';
import { matchPath, useNavigate } from 'react-router-dom';
import { HOME_PATH, SETTINGS_PATH } from '$pages/paths';
import { ChatTextIcon } from '@phosphor-icons/react';
import { useAtom, useAtomValue } from 'jotai';
import { searchModalAtom } from '$state/searchModal';
import { useInboxSelected } from '$hooks/router/useInbox';
import { Box, color, Text } from 'folds';
import { useNavigateSelected } from '$hooks/router/useNavigateSelected';
import { useProfileSelected } from '$hooks/router/useProfileSelected';
import { getSpacePath } from '$pages/pathUtils';
import { lastVisitedSpaceIdAtom } from '$state/room/lastSpace';

export function MessageTab({ isBottom, isMobile }: { isBottom?: boolean; isMobile?: boolean }) {
  const navigate = useNavigate();
  const lastSpaceId = useAtomValue(lastVisitedSpaceIdAtom);
  const [searchSelected] = useAtom(searchModalAtom);
  const navigateRouteActive = useNavigateSelected();
  const profileRouteActive = useProfileSelected();
  const inboxSelected = useInboxSelected();
  const opened = !(
    matchPath(SETTINGS_PATH, location.pathname) ||
    searchSelected ||
    navigateRouteActive ||
    profileRouteActive ||
    inboxSelected
  );
  const onBack = () => {
    if (!lastSpaceId) {
      navigate(HOME_PATH);
      return;
    }

    navigate(getSpacePath(lastSpaceId));
  };

  return (
    <SidebarItem active={opened} isBottom={isBottom}>
      <SidebarItemTooltip tooltip="Messages" position={isBottom ? 'Top' : 'Right'}>
        {(triggerRef) => (
          <Box direction="Column" alignItems="Center">
            <SidebarAvatar
              as="button"
              ref={triggerRef}
              outlined={!isMobile}
              onClick={onBack}
              size={'400'}
            >
              <ChatTextIcon
                size={getPhosphorIconSize(isBottom ? 'inline' : 'toolbar')}
                weight={opened ? 'fill' : 'regular'}
                mirrored
                color={opened && isMobile ? color.Primary.Main : color.Background.OnContainer}
              />
            </SidebarAvatar>
            {isMobile && (
              <Text size="O400" priority="300">
                Messages
              </Text>
            )}
          </Box>
        )}
      </SidebarItemTooltip>
    </SidebarItem>
  );
}
