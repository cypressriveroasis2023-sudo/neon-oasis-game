# Native Shop attestation — implementation status

The proposal-only draft from commit `9229fa773f9a154d1bbd0391d18879e1e7767a72`
was authorized for local implementation and synthetic testing. That work is now
complete. The current exact design, production installation scope, trust boundary,
fields disclosed, validation limits and rollback are in
[NATIVE_SHOP_ATTESTATION_APPROVAL.md](NATIVE_SHOP_ATTESTATION_APPROVAL.md).

Production SQL/EXECUTE, bridge deployment, paired signing key and activation
remain separately held. All four legacy release flags remain false in the install
candidate. No account, key, grant or production data was changed, and no live
checkout success is claimed. Parent owns integration and production approval.
