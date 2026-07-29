import {
  composerIcon,
  MagnifyingGlass,
  menuIcon,
  User as UserIcon,
} from '$components/icons/phosphor';
import { ResponsiveMenu } from '$components/ResponsiveMenu';
import { UserAvatar } from '$components/user-avatar/UserAvatar.tsx';
import { useMediaAuthentication } from '$hooks/useMediaAuthentication.ts';
import {
  getCurrentlyUsedPerMessageProfileForRoom,
  getAllPerMessageProfiles,
  type PerMessageProfileMsc4461,
  setCurrentlyUsedPerMessageProfileIdForRoom,
  getCurrentlyUsedPerMessageProfileForAccount,
  setCurrentlyUsedPerMessageProfileIdForAccount,
} from '$hooks/usePerMessageProfile';
import { mxcUrlToHttp } from '$utils/matrix.ts';
import { isMobileOrTablet } from '$utils/platform';
import { nameInitials } from '$utils/common';
import {
  Avatar,
  Box,
  config,
  IconButton,
  Input,
  Menu,
  MenuItem,
  type RectCords,
  Scroll,
  Text,
  toRem,
  Badge,
} from 'folds';
import type { MatrixClient } from 'matrix-js-sdk';
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import * as css from './PersonaPicker.css.ts';
import { InfoCard } from '$components/info-card/InfoCard.tsx';
import { InfoIcon, XIcon } from '@phosphor-icons/react';
import { ThemeKind, useActiveTheme } from '$hooks/useTheme.ts';

const pillStyles = {
  cursor: 'pointer',
} as const;

export enum PersonaPickerPresentation {
  TemporarySelectorMenu = 'TemporarySelectorMenu',
  PersistentPicker = 'PersistentPicker',
}
export enum PersonaPickerTab {
  Global = 'Global',
  PerRoom = 'PerRoom',
}

type PersonaPickerProps = {
  tab?: PersonaPickerTab;
  mx: MatrixClient;
  roomId?: string;
  suppressEditorRefocus?: () => void;
  onTabChange?: (tab: PersonaPickerTab) => void;
  latchedPersona?: PerMessageProfileMsc4461;
  hideTabs?: boolean;
  onPersonaSelect?: (persona: PerMessageProfileMsc4461 | undefined) => void;
  requestClose?: () => void;
  showNoneOption?: boolean;
  hideButton?: boolean;
  anchor?: RectCords;
};

function PersonaSelectMenuTabs({
  tab,
  setTab,
}: {
  tab: PersonaPickerTab;
  setTab: (tab: PersonaPickerTab) => void;
}) {
  return (
    <Box gap="100" style={{ marginBlock: '0.25rem' }}>
      <Badge
        style={pillStyles}
        as="button"
        variant="Secondary"
        fill={tab == PersonaPickerTab.Global ? 'Solid' : 'None'}
        size="500"
        onClick={() => setTab(PersonaPickerTab.Global)}
      >
        <Text as="span" size="L400">
          Global
        </Text>
      </Badge>
      <Badge
        style={pillStyles}
        as="button"
        variant="Secondary"
        fill={tab == PersonaPickerTab.PerRoom ? 'Solid' : 'None'}
        size="500"
        onClick={() => setTab(PersonaPickerTab.PerRoom)}
      >
        <Text as="span" size="L400">
          Per-room
        </Text>
      </Badge>
    </Box>
  );
}

export function TemporaryPersonaPicker(props: PersonaPickerProps) {
  return (
    <PersonaPicker {...props} presentation={PersonaPickerPresentation.TemporarySelectorMenu} />
  );
}
export function PersistentPersonaPicker(props: PersonaPickerProps) {
  return <PersonaPicker {...props} presentation={PersonaPickerPresentation.PersistentPicker} />;
}

function PersonaPicker({
  tab: tabProp = PersonaPickerTab.Global,
  mx,
  roomId,
  suppressEditorRefocus,
  latchedPersona,
  onPersonaSelect,
  anchor,
  requestClose,
  presentation,
  onTabChange,
}: PersonaPickerProps & { presentation: PersonaPickerPresentation }) {
  const useAuthentication = useMediaAuthentication();
  const persistent = presentation === PersonaPickerPresentation.PersistentPicker;
  const [tab, setTab] = useState(tabProp);
  const [AddPersonaMenuAnchor, setAddPersonaMenuAnchor] = useState<RectCords | undefined>(anchor);
  const activeTheme = useActiveTheme();
  const [profiles, setProfiles] = useState<PerMessageProfileMsc4461[] | undefined>(undefined);
  const [selectedGlobalPersona, setSelectedGlobalPersona] =
    useState<PerMessageProfileMsc4461 | null>(null);
  const [selectedRoomPersona, setSelectedRoomPersona] = useState<PerMessageProfileMsc4461 | null>(
    latchedPersona ?? null
  );

  const nameColor = useCallback(
    (persona: PerMessageProfileMsc4461) =>
      activeTheme.kind === ThemeKind.Dark
        ? persona['eu.she-a.color']?.on_dark
        : persona['eu.she-a.color']?.on_light,
    [activeTheme]
  );

  const defactoPersona = () => selectedRoomPersona ?? selectedGlobalPersona;

  useEffect(() => {
    const syncProfile = async () => {
      if (roomId) {
        const syncedRoomProfile = await getCurrentlyUsedPerMessageProfileForRoom(mx, roomId);
        if (!selectedRoomPersona) setSelectedRoomPersona(syncedRoomProfile ?? null);

        const syncedGlobalProfile = await getCurrentlyUsedPerMessageProfileForAccount(mx);
        setSelectedGlobalPersona(syncedGlobalProfile ?? null);
      }
    };
    syncProfile();
  }, [mx, roomId, profiles, latchedPersona, selectedRoomPersona]);

  const fetchProfiles = async (mx_: MatrixClient) => {
    const fetchedProfiles = await getAllPerMessageProfiles(mx_);
    setProfiles(fetchedProfiles);
    setFilteredProfiles(fetchedProfiles);
  };

  const scrollRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const filter = useCallback(
    (e: FormEvent) => {
      const term = (e.target as HTMLInputElement).value.toLocaleLowerCase();

      const filtered = term
        ? profiles?.filter((profile) =>
            searchInputRef.current
              ? profile.displayname.toLocaleLowerCase().includes(searchInputRef.current?.value) ||
                profile.id.toLocaleLowerCase().includes(searchInputRef.current?.value)
              : true
          )
        : profiles;

      setFilteredProfiles(filtered);
    },
    [profiles]
  );

  const isSelected = (persona: PerMessageProfileMsc4461 | undefined) => {
    if (!persona) return undefined;
    const selected = tab === PersonaPickerTab.Global ? selectedGlobalPersona : selectedRoomPersona;
    return persona.id === selected?.id ? true : undefined;
  };

  const [filteredProfiles, setFilteredProfiles] = useState(profiles);

  useEffect(() => {
    fetchProfiles(mx);
  }, [mx]);

  const avatarUrl = useCallback(
    (profile: PerMessageProfileMsc4461) => {
      if (profile.avatar_url !== undefined) {
        return mxcUrlToHttp(mx, profile.avatar_url, useAuthentication, 96, 96, 'crop') ?? undefined;
      } else {
        return undefined;
      }
    },
    [mx, useAuthentication]
  );

  const handleSelect = useCallback(
    async (profile: PerMessageProfileMsc4461 | undefined) => {
      if (onPersonaSelect) {
        onPersonaSelect(profile);
        return;
      }
      if (!roomId) return;

      const isGlobal = tab === PersonaPickerTab.Global;
      const selectedPersona = isGlobal ? selectedGlobalPersona : selectedRoomPersona;
      const disabling = !profile || profile.id === selectedPersona?.id;

      if (!disabling) {
        if (isGlobal) {
          setSelectedGlobalPersona(profile);
          await setCurrentlyUsedPerMessageProfileIdForAccount(mx, profile.id);
        } else {
          setSelectedRoomPersona(profile);
          await setCurrentlyUsedPerMessageProfileIdForRoom(mx, roomId, profile.id);
        }
      } else {
        if (isGlobal) {
          setSelectedGlobalPersona(null);
          await setCurrentlyUsedPerMessageProfileIdForAccount(mx, undefined, undefined, true);
        } else {
          setSelectedRoomPersona(null);
          await setCurrentlyUsedPerMessageProfileIdForRoom(mx, roomId, undefined, undefined, true);
        }
      }
    },
    [
      mx,
      roomId,
      tab,
      selectedRoomPersona,
      selectedGlobalPersona,
      setSelectedGlobalPersona,
      setSelectedRoomPersona,
      onPersonaSelect,
    ]
  );

  return (
    <ResponsiveMenu
      anchor={AddPersonaMenuAnchor}
      position={!persistent ? 'Left' : 'Top'}
      align="Start"
      offset={!persistent ? 10 : 16}
      alignOffset={!persistent ? 0 : -44}
      requestClose={() => {
        setAddPersonaMenuAnchor(undefined);
        requestClose?.();
      }}
      menu={
        <Menu>
          <Box
            direction="Column"
            gap="100"
            style={{ padding: config.space.S200, minWidth: '18rem' }}
          >
            {persistent && (
              <PersonaSelectMenuTabs
                tab={tab}
                setTab={(newTab) => {
                  onTabChange?.(newTab);
                  setTab(newTab);
                }}
              />
            )}
            <>
              <Input
                ref={searchInputRef}
                variant="SurfaceVariant"
                size="400"
                placeholder="Search"
                maxLength={50}
                autoFocus={!isMobileOrTablet()}
                onChange={filter}
                before={menuIcon(MagnifyingGlass)}
              />

              <Scroll
                hideTrack
                ref={scrollRef}
                size="400"
                style={{ maxHeight: isMobileOrTablet() ? '55dvh' : '10rem' }}
              >
                {filteredProfiles?.map((profile) => (
                  <MenuItem
                    key={profile.id}
                    size="400"
                    radii="300"
                    className={css.PersonaPickerMenuItem}
                    aria-selected={isSelected(profile)}
                    onClick={() => handleSelect(profile)}
                    before={
                      <Avatar
                        size="300"
                        radii="400"
                        style={{
                          width: 28,
                          height: 28,
                          marginLeft: -6,
                        }}
                        aria-label="Profile avatar"
                      >
                        <UserAvatar
                          userId={profile.id}
                          src={avatarUrl(profile)}
                          fallbackColor={profile['eu.she-a.color']?.on_light ?? undefined}
                          renderFallback={() => (
                            <Text as="span" size="H4" aria-label="Avatar fallback">
                              {nameInitials(profile.displayname)}
                            </Text>
                          )}
                          alt={`Avatar for profile ${profile.id}`}
                        />
                      </Avatar>
                    }
                  >
                    <Text
                      truncate
                      style={{ color: nameColor(profile) ?? undefined, maxWidth: toRem(150) }}
                    >
                      {profile.displayname}
                    </Text>
                  </MenuItem>
                ))}
                {presentation !== PersonaPickerPresentation.PersistentPicker && (
                  <MenuItem
                    key={'none'}
                    size="400"
                    radii="300"
                    className={css.PersonaPickerMenuItem}
                    onClick={() => handleSelect(undefined)}
                    before={
                      <div
                        style={{
                          width: 28,
                          height: 28,
                          marginLeft: -6,
                        }}
                      >
                        {menuIcon(XIcon, { weight: 'regular', size: 28 })}{' '}
                      </div>
                    }
                  >
                    <Text truncate style={{ maxWidth: toRem(150) }}>
                      No persona
                    </Text>
                  </MenuItem>
                )}
              </Scroll>
              {presentation === PersonaPickerPresentation.PersistentPicker && (
                <InfoCard
                  before={menuIcon(InfoIcon, { weight: 'fill' })}
                  variant="Primary"
                  description={
                    selectedRoomPersona ? (
                      <>
                        Message will use your <em>per-room</em> persona.
                      </>
                    ) : selectedGlobalPersona ? (
                      <>
                        Message will use your <em>global</em> persona.
                      </>
                    ) : (
                      <>No persona chosen.</>
                    )
                  }
                />
              )}
            </>
          </Box>
        </Menu>
      }
    >
      {persistent && (
        <IconButton
          aria-pressed={!!AddPersonaMenuAnchor}
          onClick={(evt) => {
            // getAllPerMessageProfiles can return an empty list during initial startup.
            if (profiles?.length === 0) {
              fetchProfiles(mx);
            }
            setAddPersonaMenuAnchor(evt.currentTarget.getBoundingClientRect());
          }}
          onPointerDown={suppressEditorRefocus}
          variant="SurfaceVariant"
          size="300"
          style={{ backgroundColor: 'transparent' }}
          title="Switch persona"
          aria-label="Switch persona"
        >
          {(selectedRoomPersona ?? selectedGlobalPersona) ? (
            <Avatar
              size="200"
              radii="300"
              className={
                AddPersonaMenuAnchor
                  ? css.SelectedPersonaPickerButtonAvatar
                  : css.PersonaPickerButtonAvatar
              }
              aria-label="Profile avatar"
            >
              <UserAvatar
                className={css.PersonaPickerButtonAvatarImage}
                userId={defactoPersona()!.id}
                src={avatarUrl(defactoPersona()!)}
                renderFallback={() => (
                  <Text as="span" size="H6" aria-label="Avatar fallback">
                    {nameInitials(defactoPersona()!.displayname)}
                  </Text>
                )}
                alt={`Avatar for profile ${defactoPersona()!.id}`}
              />
            </Avatar>
          ) : (
            composerIcon(UserIcon, { weight: AddPersonaMenuAnchor ? 'fill' : 'regular' })
          )}
        </IconButton>
      )}
    </ResponsiveMenu>
  );
}
