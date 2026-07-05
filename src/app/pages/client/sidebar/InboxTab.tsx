import { useNavigate } from 'react-router-dom';
import { useAtomValue } from 'jotai';
import {
  SidebarAvatar,
  SidebarUnreadBadge,
  SidebarItemTooltip,
  SidebarItem,
} from '$components/sidebar';
import {
  getInboxInvitesPath,
  getInboxNotificationsPath,
  getInboxPath,
  joinPathComponent,
} from '$pages/pathUtils';
import {
  useInboxBookmarksSelected,
  useInboxInvitesSelected,
  useInboxNotificationsSelected,
  useInboxSelected,
} from '$hooks/router/useInbox';
import { ScreenSize, useScreenSizeContext } from '$hooks/useScreenSize';
import { useNavToActivePathAtom } from '$state/hooks/navToActivePath';
import { useInviteCount } from '$hooks/useInviteCount';
import { Text, Box } from 'folds';
import { searchModalAtom } from '$state/searchModal';
import { EnvelopeSimple, getPhosphorIconSize, Tray } from '$components/icons/phosphor';
import { BookmarkIcon, ChatCircleDotsIcon } from '@phosphor-icons/react';

export function InboxTab({ isBottom, isMobile }: { isBottom?: boolean; isMobile?: boolean }) {
  const screenSize = useScreenSizeContext();
  const navigate = useNavigate();
  const navToActivePath = useAtomValue(useNavToActivePathAtom());
  const inboxSelected = useInboxSelected();
  const inviteCount = useInviteCount();
  const isSearch = useAtomValue(searchModalAtom);
  const opened = inboxSelected && !isSearch;
  const InboxIconSize = getPhosphorIconSize(isBottom ? 'inline' : 'toolbar');

  const notificationsSelected = useInboxNotificationsSelected();
  const bookmarksSelected = useInboxBookmarksSelected();
  const invitesSelected = useInboxInvitesSelected();

  const handleInboxClick = () => {
    if (screenSize === ScreenSize.Mobile) {
      navigate(getInboxPath());
      return;
    }
    const activePath = navToActivePath.get('inbox');
    if (activePath) {
      navigate(joinPathComponent(activePath));
      return;
    }

    const path = inviteCount > 0 ? getInboxInvitesPath() : getInboxNotificationsPath();
    navigate(path);
  };

  return (
    <SidebarItem active={opened} isBottom={isBottom}>
      <SidebarItemTooltip tooltip="Inbox" position={isBottom ? 'Top' : 'Right'}>
        {(triggerRef) => (
          <Box direction="Column" alignItems="Center">
            <SidebarAvatar
              as="button"
              ref={triggerRef}
              outlined={!isMobile}
              onClick={handleInboxClick}
              size={'400'}
            >
              {(notificationsSelected && (
                <ChatCircleDotsIcon size={InboxIconSize} weight="fill" />
              )) ||
                (bookmarksSelected && <BookmarkIcon size={InboxIconSize} weight="fill" />) ||
                (invitesSelected && <EnvelopeSimple size={InboxIconSize} weight="fill" />) || (
                  <Tray size={InboxIconSize} weight={inboxSelected ? 'fill' : 'regular'} />
                )}
            </SidebarAvatar>
            {isMobile && (
              <Text size="O400" priority="300">
                Inbox
              </Text>
            )}
          </Box>
        )}
      </SidebarItemTooltip>
      {inviteCount > 0 && <SidebarUnreadBadge highlight count={inviteCount} />}
    </SidebarItem>
  );
}
