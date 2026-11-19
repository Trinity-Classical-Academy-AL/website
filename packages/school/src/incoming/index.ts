export { CONTACT_TYPES, contactType, incomingWritesAllowed, incomingDate, incomingDetailsText } from './model.ts';
export type { ContactType, IncomingRow, IncomingInput, IncomingDetails, IncomingActivity } from './model.ts';
export { listIncoming, incomingActivity, markContacted, markProspectEmailed, addIncomingNote } from './repository.ts';
