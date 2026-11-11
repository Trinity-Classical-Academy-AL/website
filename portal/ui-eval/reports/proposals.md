# Proposals for Bryant

These are in the v5 export and still short of the field gate. They are not changed here, because each one either needs a data source Bryant has not named or would add behavior the export does not settle.

- Event detail and the “Going” state (`P-EventDetail`, `P-EventGoing`): no `/events/:id` route. Events admin was left out on purpose.
- Guardian calendar Subscribe (`G-Cal`) and Documents Download (`G-Docs`): still the placeholders. Documents and forms need a source.
- Password fields show a visibility control in the export (`Show`). The portal uses the existing password component. Confirm the label before restyling it.
- Account name is still one field. The export’s edit-name sheet has first and last (`U-Name`).
