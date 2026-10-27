import { createHandoff } from './handoff';

/** The email address and service address of a `cashfold://add-device` link, for the add-device screen. A link never carries a secret, so there is no field for one. */
export interface AddDevicePrefill {
  readonly email?: string;
  readonly server?: string;
}
export const addDevicePrefill = createHandoff<AddDevicePrefill>();
