import { isMobileTauri } from '$utils/platform';
import {
  getNativeCallCapabilities,
  type NativeCallCapabilities,
} from '@sableclient/tauri-plugin-livekit-mobile';

const supportsNativeCall = (capabilities: NativeCallCapabilities): boolean =>
  capabilities.supported && capabilities.microphone;

let availabilityPromise: Promise<boolean> | undefined;

const isStableVerdict = (capabilities: NativeCallCapabilities): boolean =>
  !capabilities.supported || capabilities.microphone;

export const getNativeCallAvailability = (): Promise<boolean> => {
  if (!isMobileTauri()) return Promise.resolve(false);
  const probe = (availabilityPromise ??= getNativeCallCapabilities().then(
    (capabilities) => {
      if (!isStableVerdict(capabilities)) availabilityPromise = undefined;
      return supportsNativeCall(capabilities);
    },
    () => {
      availabilityPromise = undefined;
      return false;
    }
  ));
  return probe;
};

export const resetNativeCallAvailabilityForTests = (): void => {
  availabilityPromise = undefined;
};
