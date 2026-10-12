# Private camera-board service-location import

The private Sites board opens a dedicated lookup in the existing COS Owner workspace. The workspace retains its current sign-in and server-held mHelpDesk token manager. No mHelpDesk token or COS session is transferred to Sites. The new Owner-only endpoint is a bounded, read-only preview and makes no equipment, job, tracker or vendor changes.

The lookup requires one active Helios equipment candidate with a full, unique normalized unit label. An optional job number must be found on that equipment's ticket list and independently rechecked. The installation address comes from a service location belonging to the verified customer. Customer billing addresses, contacts, notes, credentials and raw records are excluded. Assignment changes during the lookup invalidate the preview. Duplicate or incomplete source records do not establish a map location.

Source coordinates are reused when available. Missing coordinates can receive a unique matching Census address estimate, which remains unverified. The Owner reviews equipment and address, then explicitly returns a safe location draft to the fixed private board origin. The board checks the expected source window, origin, nonce, unit, field allowlist and observation age before filling the form. Saving placement and confirming the exact installation point remain separate actions.

The board detects non-JSON access pages without discarding form inputs. A same-origin full-tab setup handoff can copy the draft for normal top-level sign-in and saving. It never replays a write after an unknown response. Existing tracker records remain protected from the new-unit setup writer.

Validation includes focused reader security/identity tests, existing partner and ticket regression tests, TypeScript and build checks, and the private board's source/write/draft contracts. Full browser behavior and live source reads require the intended signed-in Owner session; source fixtures and static publication do not establish those results.
