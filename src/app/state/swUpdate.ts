import { atom } from 'jotai';

export const swUpdateRegistrationAtom = atom<ServiceWorkerRegistration | undefined>(undefined);
