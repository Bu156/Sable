import { useMatrixClient } from '$hooks/useMatrixClient';
import type { PerMessageProfileMsc4461, Persona } from '$hooks/usePerMessageProfile';
import {
  addOrUpdatePerMessageProfile,
  getAllPerMessageProfiles,
  getPerMessageProfileById,
  ProfileCatalog,
} from '$hooks/usePerMessageProfile';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Box, Button, color, config, Dialog, Header, Spinner, Text } from 'folds';
import { generateShortId } from '$utils/shortIdGen';
import { SequenceCard, SequenceCardStyle } from '$components/sequence-card';
import { PerMessageProfileListItem } from './PerMessageProfileListItem';
import { SettingTile } from '$components/setting-tile';
import { AsyncStatus, useAsyncCallback } from '$hooks/useAsyncCallback';
import {
  MATRIX_UNSTABLE_COLORS,
  MATRIX_UNSTABLE_PROFILE_PRONOUNS_PROPERTY_NAME,
} from '$unstable/prefixes';
import { downloadJsonFile } from '$app/utils/common';
import { useFilePicker } from '$hooks/useFilePicker';
import { createUploadAtom, useBindUploadAtom } from '$app/state/upload';
import { selectFile } from '$app/utils/dom';
import { ModalOverlay } from '$components/modal-overlay/ModalOverlay';

type PerMessageProfileOverviewProps = {
  onCreateProfile: (profile: PerMessageProfileMsc4461) => void;
  onEditProfile: (profile: PerMessageProfileMsc4461) => void;
};
/**
 * Renders a list of per-message profiles along with an editor.
 * @returns rendering of per message profile list including editor
 */
export function PerMessageProfileOverview({
  onCreateProfile,
  onEditProfile,
}: PerMessageProfileOverviewProps) {
  const mx = useMatrixClient();
  const [profiles, setProfiles] = useState<PerMessageProfileMsc4461[]>([]);

  const [confirmWipeData, setConfirmWipeData] = useState(false);

  useEffect(() => {
    const fetchProfiles = async () => {
      const fetchedProfiles = await getAllPerMessageProfiles(mx);
      setProfiles(fetchedProfiles);
    };
    fetchProfiles();
  }, [mx]);

  const handleEdit = async (profileId: string) => {
    const profile = await getPerMessageProfileById(mx, profileId);
    if (profile) onEditProfile(profile);
  };

  const [addState, handleAdd] = useAsyncCallback(
    useCallback(async () => {
      const newProfile: PerMessageProfileMsc4461 = {
        id: generateShortId(5),
        displayname: 'New Profile',
        trigger: { prefix: [] },
      };
      await addOrUpdatePerMessageProfile(mx, newProfile);
      onCreateProfile(newProfile);
    }, [mx, onCreateProfile])
  );

  // import, export, etc
  const [handlePersonaExportState, handlePersonaExport] = useAsyncCallback<void, Error, []>(
    useCallback(async () => {
      const personas = await new ProfileCatalog(mx).list();
      const data = { personas };
      downloadJsonFile(JSON.stringify(data), "persona");
    }, [mx])
  );

  const [handlePersonaImportState, handlePersonaImport] = useAsyncCallback<void, Error, []>(
    useCallback(async () => {
      const readFile = async (file: File): Promise<string> => {
        return new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result as string);
          reader.onerror = () => reject(new Error("Problem reading JSON file."));

          reader.readAsText(file);
        })
      }

      const file = await selectFile("application/json", false);
      if (!file) throw new Error("No file provided");

      const text = await readFile(file);
      const json = JSON.parse(text);
      if (!json) throw new Error("JSON parsing failed.");
      if (!json.personas) throw new Error("Personas not found in file");

      await new ProfileCatalog(mx).overwrite(json.personas as Persona[]);

      // refetch
      const fetchedProfiles = await getAllPerMessageProfiles(mx);
      setProfiles(fetchedProfiles);
    }, [mx])
  );

  const [handlePersonaWipeState, handlePersonaWipe] = useAsyncCallback<void, Error, []>(
    useCallback(async () => {
      await new ProfileCatalog(mx).overwrite([]);

      // refetch
      const fetchedProfiles = await getAllPerMessageProfiles(mx);
      setProfiles(fetchedProfiles);
      setConfirmWipeData(false);
    }, [mx])
  );

  const manageError = useMemo(() => {
    if (handlePersonaExportState.status == AsyncStatus.Error) return handlePersonaExportState.error;
    if (handlePersonaImportState.status == AsyncStatus.Error) return handlePersonaImportState.error;
    if (handlePersonaWipeState.status == AsyncStatus.Error) return handlePersonaWipeState.error;
    return undefined;
  }, [])

  return (
   <>
    <Box gap="100" direction="Column">
      <Text size="L400">Personas</Text>

      <SequenceCard
        className={SequenceCardStyle}
        variant="SurfaceVariant"
        direction="Column"
        gap="100"
      >
        <SettingTile
          focusId="create-pmp"
          title="Create Persona"
          description="Create Personas to attach custom profiles to messages."
          after={
            <Button
              size="300"
              radii="300"
              onClick={handleAdd}
              disabled={addState.status === AsyncStatus.Loading}
            >
              {addState.status === AsyncStatus.Loading ? (
                <Spinner size="100" variant="Primary" fill="Solid" />
              ) : (
                <Text size="B300">Add</Text>
              )}
            </Button>
          }
        />
      </SequenceCard>

      {profiles.map((profile) => (
        <SequenceCard
          className={SequenceCardStyle}
          variant="SurfaceVariant"
          direction="Column"
          key={`profile-list-item-${profile.id}`}
        >
          <PerMessageProfileListItem
            mx={mx}
            avatarMxcUrl={profile.avatar_url}
            displayName={profile.displayname}
            pronouns={profile[MATRIX_UNSTABLE_PROFILE_PRONOUNS_PROPERTY_NAME]}
            profileId={profile.id}
            nameColorLight={profile[MATRIX_UNSTABLE_COLORS]?.on_light}
            nameColorDark={profile[MATRIX_UNSTABLE_COLORS]?.on_dark}
            onOpenEditor={handleEdit}
          />
        </SequenceCard>
      ))}

      </Box>
    <Box gap="100" direction="Column">
      <Text size="L400">Persona Mass Management</Text>

      <SequenceCard
        className={SequenceCardStyle}
        variant="SurfaceVariant"
        direction="Column"
        gap="100"
      >
        <SettingTile
          focusId="pmp-pk-import"
          title="PluralKit Import"
          description={<>Add or update PluralKit members from <code>system.json</code>. Consider backing up Persona data before importing.</>}
          after={
      
              <Button
                size="400"
                radii="300"
                variant="Primary"
                fill="Solid"
              >
                <Text size="B300">Import PK member data</Text>
              </Button>
        }
          >
          </SettingTile>
        </SequenceCard>
      <SequenceCard
        className={SequenceCardStyle}
        variant="SurfaceVariant"
        direction="Column"
        gap="100"
      >
        <SettingTile
          focusId="pmp-list-export"
          title="Persona management"
          description="Import, export, et cetera." 
          after={
          <>
            {manageError && <Text style={{ color: color.Critical.Main }} size="T300" >{manageError.message}</Text>}
            <Box
              direction="Row"
              justifyContent="End"
              gap="200"
              aria-label="PMP List edit buttons"
            >
                <Button
                  onClick={handlePersonaExport}
                  size="400"
                  radii="300"
                  variant="Primary"
                  fill="Solid"
                >
                  {handlePersonaExportState.status === AsyncStatus.Loading ? (
                    <Spinner variant="Primary" size="400" />
                  ) :
                    <Text size="B300">Export data</Text>
                  }
                </Button>
                <Button
                  onClick={handlePersonaImport}
                  size="400"
                  radii="300"
                  variant="Primary"
                  fill="Soft"
                >
                  {handlePersonaImportState.status === AsyncStatus.Loading ? (
                    <Spinner variant="Primary" size="300" />
                  ) :
                    <Text size="B300">Overwrite data from a backup</Text>
                  }
                </Button>
                <Button
                  onClick={() => setConfirmWipeData(true)}
                  size="400"
                  radii="300"
                  variant="Critical"
                  fill="Solid"
                >
                  <Text size="B300">Wipe all Persona data</Text>
                </Button>
            </Box></>
        }>

          {confirmWipeData && (
            <ModalOverlay requestClose={() => setConfirmWipeData(false)}>
              <Dialog variant="Surface">
                <Header
                  style={{
                    padding: `0 ${config.space.S200} 0 ${config.space.S400}`,
                    borderBottomWidth: config.borderWidth.B300,
                  }}
                  variant="Surface"
                  size="500"
                >
                  <Box grow="Yes">
                    <Text size="H4">Wipe all Persona data</Text>
                  </Box>
                </Header>
                <Box style={{ padding: config.space.S400 }} direction="Column" gap="400">
                  <Text priority="400">
                    Are you sure you want to wipe all Persona data?
                  </Text>
                  <Box direction="Column" gap="200">
                    <Button
                      variant="Critical"
                      onClick={handlePersonaWipe}
                    >
                      <Text size="B400">Delete all data</Text>
                    </Button>
                    <Button variant="Secondary" onClick={() => setConfirmWipeData(false)}>
                      <Text size="B400">Cancel</Text>
                    </Button>
                  </Box>
                </Box>
              </Dialog>
            </ModalOverlay>
          )}
          </SettingTile>
      </SequenceCard>
    </Box>
  </>
  );
}
