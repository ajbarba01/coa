import { CapStateSchema } from '@coa/console-viewmodel';

/** One channel name per bridged method. */
export const IPC_GET_CAP = 'coa:getCap';

/** Payload validated at the IPC boundary (both sides). */
export const CapResultSchema = CapStateSchema;
