-- REVIEW CANDIDATE. Captured from read-only legacy catalog 2026-10-17.
-- Refuse any changed writer before touching ANY function. Existing bodies,
-- signatures, ACLs, ownership, role checks and search paths are retained.
-- The sole edit is the shared transaction gate before each first statement.
begin;
create temp table techcheck_reviewed_writers_v6(schema_name text,name text,arguments text,language text,sha256 text) on commit drop;
insert into techcheck_reviewed_writers_v6 select x.schema,x.name,x.arguments,x.language,x.sha256 from jsonb_to_recordset($manifest$
[
  {
    "schema": "public",
    "name": "accept_helios_handoff_v1",
    "arguments": "p_prep_id uuid, p_verifications jsonb",
    "language": "plpgsql",
    "sha256": "f5ca15089ce364052782818d47c27ccc66c09cff2edadcfcdb7ffa25d6794bd0"
  },
  {
    "schema": "public",
    "name": "activate_truck_spares_on_close",
    "arguments": "",
    "language": "plpgsql",
    "sha256": "0825b1e63fc8c11371618a17a192746f23fad006eccfb83e60dba230dac2e6f1"
  },
  {
    "schema": "public",
    "name": "add_it_prep_item",
    "arguments": "p_prep_id uuid, p_equipment_type text, p_purpose text, p_recon_battery_count integer",
    "language": "plpgsql",
    "sha256": "8a1d197531c5056beeca39f87dbe31c00ee0465ab7afb8045202cf687e4529ec"
  },
  {
    "schema": "public",
    "name": "add_it_prep_item_v2",
    "arguments": "p_prep_id uuid, p_item_order integer, p_equipment_type text, p_purpose text, p_recon_battery_count integer",
    "language": "plpgsql",
    "sha256": "aa7d171ee15024c8ac594e9801ef050b172628232aba239202b936ec89844c24"
  },
  {
    "schema": "public",
    "name": "add_it_truck_spare_unit",
    "arguments": "p_prep_id uuid, p_equipment_type text, p_recon_battery_count integer",
    "language": "plpgsql",
    "sha256": "1eac0a0b3d55f8e014dcd1791663d633b2ad1cebddecfe5763ab9e848beace43"
  },
  {
    "schema": "public",
    "name": "claim_my_department_assignment",
    "arguments": "p_assignment_id uuid",
    "language": "plpgsql",
    "sha256": "8dadac9bdc105a2d550aaa2505ebd7f0e774eda01c9b50f7c7cb43d3dac3b038"
  },
  {
    "schema": "public",
    "name": "close_prep_ticket",
    "arguments": "p_prep_id uuid, p_verifications jsonb",
    "language": "plpgsql",
    "sha256": "e4bff6ed267248ae7b938127d82b918c324fd8bf8db80860540a08a424ea18c7"
  },
  {
    "schema": "public",
    "name": "close_stale_service_truck_restock_requests_v1",
    "arguments": "",
    "language": "plpgsql",
    "sha256": "efea635cfeb52ffb8512acc6cef5608d5162b2436cf6ecdd4568edbf09a68d76"
  },
  {
    "schema": "public",
    "name": "configure_it_prep_item",
    "arguments": "p_item_id uuid, p_equipment_type text, p_purpose text, p_required_battery_count integer",
    "language": "plpgsql",
    "sha256": "f570b406857def85f8ec15f4bb96e1fa8c3bde406f1c3dc3ae89add787ea373f"
  },
  {
    "schema": "public",
    "name": "confirm_it_unit_photo_tag",
    "arguments": "p_item_id uuid, p_matches boolean",
    "language": "plpgsql",
    "sha256": "2d10081cd512e8d87862cb9f1a53164c528dac190d0d5e49865a3a229226f41b"
  },
  {
    "schema": "public",
    "name": "confirm_service_parts",
    "arguments": "p_prep_id uuid",
    "language": "plpgsql",
    "sha256": "7b7fa23ec21e1495c101c9e3f572145051acab0c08cb6b2895588279995c8864"
  },
  {
    "schema": "public",
    "name": "create_it_prep",
    "arguments": "p_ticket_no text, p_site text, p_requirements jsonb",
    "language": "plpgsql",
    "sha256": "d6de29db7b9d77c1c1c79792e12179b62c24e0bf087db7cdb7d808e4724724a4"
  },
  {
    "schema": "public",
    "name": "create_it_prep_shell",
    "arguments": "p_ticket_no text, p_site text, p_expected_unit_count integer",
    "language": "plpgsql",
    "sha256": "e09826c24d4429630d53dec5d29e9a12aaa73e91d25f3f442c8ba5bea00827e5"
  },
  {
    "schema": "public",
    "name": "create_it_prep_shell_v2",
    "arguments": "p_ticket_no text, p_site text, p_expected_unit_count integer, p_solar_panel_qty integer, p_battery_replacement_qty integer, p_camera_replacement_qty integer, p_sim_replacement_qty integer, p_micro_sd_qty integer",
    "language": "plpgsql",
    "sha256": "e53614d6f46632f25394b8757508484dad1bdb857bbce9cd787ec95126eb8c2c"
  },
  {
    "schema": "public",
    "name": "create_it_prep_shell_v3",
    "arguments": "p_ticket_no text, p_site text, p_requested_unit_count integer, p_equipment_manifest jsonb, p_solar_panel_qty integer, p_battery_replacement_qty integer, p_camera_replacement_qty integer, p_sim_replacement_qty integer, p_micro_sd_qty integer",
    "language": "plpgsql",
    "sha256": "b26f235603957bf599687bba5442ac6f48fd1eeb89738c0ae11b31905909a7f7"
  },
  {
    "schema": "public",
    "name": "create_it_prep_shell_v4",
    "arguments": "p_ticket_no text, p_site text, p_requested_unit_count integer, p_equipment_manifest jsonb, p_solar_panel_qty integer, p_battery_replacement_qty integer, p_camera_replacement_qty integer, p_sim_replacement_qty integer, p_micro_sd_qty integer, p_work_type text",
    "language": "plpgsql",
    "sha256": "fda37d26fac003bff27daecc08c2a6690805ad8ac43e586f6114b621294207c3"
  },
  {
    "schema": "public",
    "name": "delete_it_prep",
    "arguments": "p_prep_id uuid",
    "language": "plpgsql",
    "sha256": "3064b4b8b4e31907900be113459789844ef7fe0f3f620943017ef664317f6896"
  },
  {
    "schema": "public",
    "name": "delete_it_prep_with_reason",
    "arguments": "p_prep_id uuid, p_reason text",
    "language": "plpgsql",
    "sha256": "164e16c1b7ef77dbeae6617c39b4810240850e3622169f1c06e7cf2a091b910f"
  },
  {
    "schema": "public",
    "name": "ensure_service_truck_baseline_v1",
    "arguments": "p_service_tech_id uuid",
    "language": "plpgsql",
    "sha256": "4852d2b8340fa98600a9df38811cae39a55c796b16615426424e4f174fb77ba7"
  },
  {
    "schema": "public",
    "name": "finalize_service_solar_progress_v1",
    "arguments": "p_prep_id uuid",
    "language": "plpgsql",
    "sha256": "a83f2bbe24e6d6a4f49c608927bb4d7790a090bf59f21d56bb5f430df49b46f9"
  },
  {
    "schema": "public",
    "name": "guard_unit_return_conflict",
    "arguments": "",
    "language": "plpgsql",
    "sha256": "a59ed9592151e3fcd127453573d39b384b5bad3a1ebd44c0584aef0af3f61db2"
  },
  {
    "schema": "public",
    "name": "it_add_service_truck_stock_v1",
    "arguments": "p_service_tech_id uuid, p_item_type text, p_qty_added integer",
    "language": "plpgsql",
    "sha256": "b7255a720d62907a2dbf1f23046593cd5275638fce9fa2337a76ddd2694e125a"
  },
  {
    "schema": "public",
    "name": "it_adjust_service_truck_inventory_v3",
    "arguments": "p_service_tech_id uuid, p_kind text, p_slot text, p_value text, p_checks jsonb, p_verified boolean, p_note text",
    "language": "plpgsql",
    "sha256": "9a16d7d5b1c7e4dfacf82d7c08ca64b7fbd4cc3fa7d0d147bb360ae7a69ff013"
  },
  {
    "schema": "public",
    "name": "it_checkout_truck_spare_battery",
    "arguments": "p_spare_id uuid",
    "language": "plpgsql",
    "sha256": "b354b0dc12c01c6a486323d1fadce2d2cfacc6be430778a708a5fdd725eda19a"
  },
  {
    "schema": "public",
    "name": "it_checkout_truck_spare_unit",
    "arguments": "p_item_id uuid",
    "language": "plpgsql",
    "sha256": "d267abb839dc5c95210c324bf61e027e2f18fc0fd9c05f9c39c5f6bc81b04922"
  },
  {
    "schema": "public",
    "name": "it_confirm_swap_site_registration_v1",
    "arguments": "p_item_id uuid",
    "language": "plpgsql",
    "sha256": "d78361d90a953b5cf4452d900a6469544c111e0b25fc6ec704c0771e6dda0265"
  },
  {
    "schema": "public",
    "name": "it_load_service_truck_sim_v1",
    "arguments": "p_service_tech_id uuid, p_slot_no integer, p_sim_number text, p_number_verified boolean",
    "language": "plpgsql",
    "sha256": "bd74aa3f4f27efe83d9a3fc2140cabd04cb8a62060ac6db980971894581bf184"
  },
  {
    "schema": "public",
    "name": "it_load_service_truck_unit_v1",
    "arguments": "p_service_tech_id uuid, p_equipment_type text, p_unit_tag text, p_checks jsonb",
    "language": "plpgsql",
    "sha256": "4c2701df2aff69dd907b41478fcad60f099613ea0bade5a2d11c6a0c02b86735"
  },
  {
    "schema": "public",
    "name": "it_mark_return_needs_replacement_v1",
    "arguments": "p_return_id uuid, p_damage_notes text, p_intake_photo_paths text[]",
    "language": "plpgsql",
    "sha256": "119af9ac4621ef2b76810486efe80c737bed376e1b05e8c833a3e1869eafaf3c"
  },
  {
    "schema": "public",
    "name": "it_prepare_service_truck_battery_restock_v1",
    "arguments": "p_request_id uuid, p_qty_issued integer",
    "language": "plpgsql",
    "sha256": "e094033fc8389a16f58469f9c441a807c2b155c8439da54fd5d38a2f9dcf0d14"
  },
  {
    "schema": "public",
    "name": "it_prepare_service_truck_sim_restock_v1",
    "arguments": "p_request_id uuid, p_replacement_sim_number text, p_number_verified boolean",
    "language": "plpgsql",
    "sha256": "a4d109aa8762b7b1a3ba788d03652798b65a9d72d1d39729680afe08480610a8"
  },
  {
    "schema": "public",
    "name": "it_prepare_service_truck_unit_restock_v1",
    "arguments": "p_request_id uuid, p_replacement_unit_tag text, p_checks jsonb",
    "language": "plpgsql",
    "sha256": "6a991ca63b16a7fcc8954045e057c2bd1e8a14b6f6748bf4239a2ded572b8b2c"
  },
  {
    "schema": "public",
    "name": "it_update_offline_escalation_v1",
    "arguments": "p_escalation_id uuid, p_it_notes text, p_action text, p_backup_prep_item_id uuid",
    "language": "plpgsql",
    "sha256": "563498c8b2514fe35b21792d6483ca6ddb72161fc876a8544b4b80de75ac7af1"
  },
  {
    "schema": "public",
    "name": "link_my_assignment_to_prep",
    "arguments": "p_assignment_id uuid, p_prep_id uuid",
    "language": "plpgsql",
    "sha256": "f86804ddb5cdc438e867e5a1b5bb4ad28260d4e1fff53f4821be825e6aea0e88"
  },
  {
    "schema": "public",
    "name": "log_service_truck_inventory_audit_v1",
    "arguments": "",
    "language": "plpgsql",
    "sha256": "992a01a440df75b1e1d68fb6e1035af03396e5a72a7b5ef8fa65046426227964"
  },
  {
    "schema": "public",
    "name": "owner_add_inventory_asset",
    "arguments": "p_unit_tag text, p_asset_type text, p_asset_category text, p_notes text",
    "language": "plpgsql",
    "sha256": "8a993968e13d6a20e60f30701d063847269e86862767e8b2fb41284271283470"
  },
  {
    "schema": "public",
    "name": "owner_adjust_service_truck_inventory_v2",
    "arguments": "p_service_tech_id uuid, p_kind text, p_slot text, p_value text",
    "language": "plpgsql",
    "sha256": "f4db41484b60dc5efef65eb48f74e4bbd265926ab7ca0b96a576557283167d0f"
  },
  {
    "schema": "public",
    "name": "owner_assign_inventory_asset",
    "arguments": "p_unit_key text, p_user_id uuid",
    "language": "plpgsql",
    "sha256": "f8e273cee0a59034e7640b7e51afba001546304d95c9e1d4ce74b775672e270d"
  },
  {
    "schema": "public",
    "name": "owner_clear_test_data",
    "arguments": "",
    "language": "plpgsql",
    "sha256": "00ec5570fa800f4d5a3a5b89122a3ac8cfaa880f01339f80342f672088617ec4"
  },
  {
    "schema": "public",
    "name": "owner_clear_workspaces",
    "arguments": "p_reason text",
    "language": "plpgsql",
    "sha256": "a62b9d5a15764f1f82ef906459c5fb75584e016d26d03aac10e76d5de31bf26c"
  },
  {
    "schema": "public",
    "name": "owner_create_test_prep",
    "arguments": "p_ticket_no text, p_site text, p_requirements jsonb",
    "language": "plpgsql",
    "sha256": "325ccbba67179722840f36e73a08c2d3969cd9f36f2e23fc7a64a47b43750f35"
  },
  {
    "schema": "public",
    "name": "owner_remove_unit_return",
    "arguments": "p_return_id uuid",
    "language": "plpgsql",
    "sha256": "65e24ae15c0f84ed97e0524c8712f4737dd2af0c80e34ce814434990e705441f"
  },
  {
    "schema": "public",
    "name": "owner_restore_workflow_checkpoint",
    "arguments": "p_checkpoint_id uuid",
    "language": "plpgsql",
    "sha256": "0d1d6a55839d3fd86d82ad13874fbe1400972c860669a2153d7883cea31b19c3"
  },
  {
    "schema": "public",
    "name": "owner_save_service_truck_inventory_batch_v1",
    "arguments": "p_service_tech_id uuid, p_payload jsonb",
    "language": "plpgsql",
    "sha256": "ba46afc0890bf8fc44869bfbdad6eaccf4087eab27f3d00090afdbbdbd122eac"
  },
  {
    "schema": "public",
    "name": "owner_set_inventory_asset_status",
    "arguments": "p_unit_key text, p_status text, p_notes text",
    "language": "plpgsql",
    "sha256": "691b77fb9475a9eca83eec1a54e6fd8e4f461f4e3c64cdf4d0b0f09dc74001c3"
  },
  {
    "schema": "public",
    "name": "owner_set_service_truck_stock_count_v1",
    "arguments": "p_service_tech_id uuid, p_item_type text, p_qty integer",
    "language": "plpgsql",
    "sha256": "c66ef074759d733caabd6701e05ae2d58708a09dc2c77013230b6ce97e5abf59"
  },
  {
    "schema": "public",
    "name": "owner_start_fresh",
    "arguments": "",
    "language": "plpgsql",
    "sha256": "d4ee0e0373bfb024540c05f3325e1febe585cfddd8e329fa85c1ebb38f8178e2"
  },
  {
    "schema": "public",
    "name": "owner_test_ensure_assignment_v1",
    "arguments": "p_ticket_no text, p_role text, p_test_tech_id uuid",
    "language": "plpgsql",
    "sha256": "ac622cdec94bf38d9276ca7b22bdbb8447f5891c2ca4d96ab2af469915d5d129"
  },
  {
    "schema": "public",
    "name": "owner_test_link_assignment_to_prep_v1",
    "arguments": "p_assignment_id uuid, p_prep_id uuid",
    "language": "plpgsql",
    "sha256": "fc7563b2b19e4c177def5eebadd954c50b9a9723ce80b02391e612291536cbe8"
  },
  {
    "schema": "public",
    "name": "owner_test_set_assignment_status_v1",
    "arguments": "p_assignment_id uuid, p_status text",
    "language": "plpgsql",
    "sha256": "1ef7cefd14b61ccf206491af49d50fad6d8daede0f72b4481976572d6f766619"
  },
  {
    "schema": "public",
    "name": "owner_update_ticket_equipment_v1",
    "arguments": "p_ticket_no text, p_equipment_manifest jsonb",
    "language": "plpgsql",
    "sha256": "d489f840c9ec059381f52dcfc7fdcef778d19143dac084a7319a19dd32863cd6"
  },
  {
    "schema": "public",
    "name": "owner_verify_helios_install_v1",
    "arguments": "p_prep_id uuid",
    "language": "plpgsql",
    "sha256": "bcee96271f97cbc3804e423924fa2a778f86be921bceffff5b78cb1ffb8601b6"
  },
  {
    "schema": "public",
    "name": "record_handoff_evidence",
    "arguments": "p_prep_id uuid, p_stage text, p_kind text, p_storage_path text, p_original_name text",
    "language": "plpgsql",
    "sha256": "a5760c839a61a95cec328fcb7bcd70ba9a6d64f05d91e4b8bafba4f45306374a"
  },
  {
    "schema": "public",
    "name": "record_it_unit_ai_tag_scan",
    "arguments": "p_item_id uuid, p_status text, p_detected text, p_confidence numeric, p_engine text",
    "language": "plpgsql",
    "sha256": "f64b17f9823a5e87873b5b56ea42a061965a5842129c056d64ed1f65b44593a6"
  },
  {
    "schema": "public",
    "name": "record_service_solar_evidence",
    "arguments": "p_prep_id uuid, p_category text, p_kind text, p_storage_path text, p_original_name text",
    "language": "plpgsql",
    "sha256": "1f7e60e1acefb314b4df4f7650c370a49728bf71e5a009a0b9e5fe07fbbcf71e"
  },
  {
    "schema": "public",
    "name": "record_unit_handoff_evidence",
    "arguments": "p_prep_id uuid, p_item_id uuid, p_stage text, p_kind text, p_storage_path text, p_original_name text",
    "language": "plpgsql",
    "sha256": "bd5097393694649b682d56709c32898ad2b4c2669fb3f74683679c95f164125b"
  },
  {
    "schema": "public",
    "name": "refresh_service_truck_restock_requests_v1",
    "arguments": "",
    "language": "sql",
    "sha256": "7043cafb6d31fb3c72da3b222d256d854759151c0ccebad55e507bcd6a0ab489"
  },
  {
    "schema": "public",
    "name": "release_prep",
    "arguments": "p_prep_id uuid",
    "language": "plpgsql",
    "sha256": "4cd309e1e4b85817de9c6c6492c0734993af2605ac9bfc7a1f9c805de763eef0"
  },
  {
    "schema": "public",
    "name": "reopen_it_prep",
    "arguments": "p_prep_id uuid",
    "language": "plpgsql",
    "sha256": "a7ecd5d75d75bac3287ea74c85aff338a19e09b0e21ca48410b690f5e8daa46a"
  },
  {
    "schema": "public",
    "name": "reopen_it_prep_with_reason",
    "arguments": "p_prep_id uuid, p_reason text",
    "language": "plpgsql",
    "sha256": "249f3a99e2f505708f3d8a4facd9d49fd27908d42bd7d0d6407445f9a54e2f59"
  },
  {
    "schema": "public",
    "name": "reopen_service_solar_progress_v1",
    "arguments": "p_prep_id uuid",
    "language": "plpgsql",
    "sha256": "bf47fe5a2b4ba95740d337b2650ae669724adcfd4d79b54d7a1947821e48491c"
  },
  {
    "schema": "public",
    "name": "repair_workflow_issue_v1",
    "arguments": "p_issue_key text",
    "language": "plpgsql",
    "sha256": "3a183340da2454949a09b7439c2ceed5adb6664d935441adc2cea52533b270c0"
  },
  {
    "schema": "public",
    "name": "resolve_my_truck_spare_unit_v2",
    "arguments": "p_item_id uuid, p_outcome text, p_return_photo_paths text[], p_return_id uuid",
    "language": "plpgsql",
    "sha256": "70451d41688d6714db3d83db9f597cf4e375131ad07727a7beb116ccb9095415"
  },
  {
    "schema": "public",
    "name": "restart_service_verification_questions_v1",
    "arguments": "p_prep_id uuid",
    "language": "plpgsql",
    "sha256": "54f5631e6d196833c8462121a51856eaa286fb24327543ef762968c656e09277"
  },
  {
    "schema": "public",
    "name": "save_it_camera_family_checks_v1",
    "arguments": "p_item_id uuid, p_programmed_ok boolean, p_port_81_ok boolean, p_port_554_ok boolean, p_recon_camera_count integer",
    "language": "plpgsql",
    "sha256": "e863cd0492d6153861ec6b4a4b6a0a70d903ac9b48ae4875832dc0e38d0decd4"
  },
  {
    "schema": "public",
    "name": "save_it_helios_deploy_checks_v1",
    "arguments": "p_item_id uuid, p_camera1_hardware_ok boolean, p_camera2_hardware_ok boolean, p_ptz_assembly_ok boolean, p_proxicast_4x4_ok boolean, p_router_sim_ok boolean, p_speaker_24v_ok boolean, p_cameras_12v_ok boolean, p_ptz_plate_4bolts_ok boolean, p_cerbo_network_ok boolean, p_cerbo_vrm_ok boolean, p_rear_unit_tag_ok boolean, p_battery_box_installed_ok boolean, p_battery_120v_charged_ok boolean, p_camera_router_programming_ok boolean, p_alibi_vigilant_ok boolean, p_3x1tb_sd_ok boolean, p_camera1_ports_ok boolean, p_camera2_ports_ok boolean, p_ptz_ports_ok boolean, p_speaker_ports_ok boolean, p_sim_ok boolean, p_camera_app_ok boolean, p_customer_email_app_ok boolean, p_monitoring_ok boolean, p_sd_formatted_ok boolean, p_recording_ok boolean",
    "language": "plpgsql",
    "sha256": "cbca9177064db7900580cecf10fd3df32a38eb7844241a41ca3af65900107d93"
  },
  {
    "schema": "public",
    "name": "save_it_helios_port_checks",
    "arguments": "p_item_id uuid, p_camera1_ports_ok boolean, p_camera2_ports_ok boolean, p_ptz_ports_ok boolean, p_speaker_ports_ok boolean",
    "language": "plpgsql",
    "sha256": "6ffac8ed41f89b3ffccb7ce721416135a2ecd1e8533eb16851440461b11dc340"
  },
  {
    "schema": "public",
    "name": "save_it_prep_item_draft",
    "arguments": "p_item_id uuid, p_unit_tag text, p_battery_count integer, p_power_ok boolean, p_functions_ok boolean, p_safe_ok boolean, p_sim_ok boolean, p_camera_app_ok boolean, p_batteries_charged_ok boolean, p_monitoring_ok boolean, p_ticket_count_ok boolean, p_sd_formatted_ok boolean, p_recording_ok boolean, p_mppt_updated_ok boolean, p_mppt_tested_ok boolean, p_pv_charging_ok boolean, p_solar_panels_match_ok boolean, p_ticket_item_match_ok boolean, p_customer_email_app_ok boolean",
    "language": "plpgsql",
    "sha256": "8fc4e58847cfb7c5a909d935f1bae0a876febe3c6e10a20a10cc4e9d1bbad79b"
  },
  {
    "schema": "public",
    "name": "save_it_prep_item_draft",
    "arguments": "p_item_id uuid, p_unit_tag text, p_battery_count integer, p_power_ok boolean, p_functions_ok boolean, p_safe_ok boolean, p_sim_ok boolean, p_camera_app_ok boolean, p_batteries_charged_ok boolean, p_monitoring_ok boolean, p_ticket_count_ok boolean, p_sd_formatted_ok boolean, p_recording_ok boolean, p_mppt_updated_ok boolean, p_mppt_tested_ok boolean, p_pv_charging_ok boolean, p_solar_panels_match_ok boolean, p_ticket_item_match_ok boolean",
    "language": "plpgsql",
    "sha256": "a19b3ea364df74003940467e40f0bfe48dbc445da585615a8eed8eb84a8427be"
  },
  {
    "schema": "public",
    "name": "save_it_truck_spare_battery",
    "arguments": "p_prep_id uuid, p_equipment_type text, p_battery_type text, p_qty integer, p_ready_ok boolean",
    "language": "plpgsql",
    "sha256": "915c8eab7919bd963fb4f19c278e651b1ed9130729dc2b7b9219e1be10c163a6"
  },
  {
    "schema": "public",
    "name": "save_my_helios_field_install_v1",
    "arguments": "p_prep_id uuid, p_box_mounted_ok boolean, p_pv_connected_ok boolean, p_ptz_secured_ok boolean, p_switch_pv_ok boolean, p_unit_battery_on_ok boolean, p_it_online_verified_ok boolean, p_cameras_aimed_ok boolean, p_recording_ok boolean, p_tower_20ft_ok boolean, p_mast_lock_bolt_ok boolean, p_panel_45deg_ok boolean, p_panel_bolt_ok boolean, p_4_sandbags_ok boolean",
    "language": "plpgsql",
    "sha256": "f1d76e06d590082c51851864ce872060ae8ccd2b2fc82332270f00a81d284ebc"
  },
  {
    "schema": "public",
    "name": "save_my_ranger_field_check_v1",
    "arguments": "p_item_id uuid, p_victron_updated_ok boolean",
    "language": "plpgsql",
    "sha256": "109a2253810153a0df9958bab3195695b306562559a0fc9b80027c1caeb3beb6"
  },
  {
    "schema": "public",
    "name": "save_my_service_solar_check",
    "arguments": "p_prep_id uuid, p_stand_tag text, p_stand_verified boolean, p_mppt_updated_ok boolean, p_mppt_tested_ok boolean, p_cerbo_updated_ok boolean, p_cerbo_online_ok boolean, p_solar_panel_count integer, p_solar_panels_verified boolean, p_battery_count integer, p_batteries_charged_ok boolean, p_solar_charging_ok boolean",
    "language": "plpgsql",
    "sha256": "5c3ec21701931fc28be30a147adf48de12957a2b8f4aad03487e02c85be67516"
  },
  {
    "schema": "public",
    "name": "save_my_service_solar_check_v2",
    "arguments": "p_prep_id uuid, p_stand_tag text, p_stand_verified boolean, p_mppt_updated_ok boolean, p_mppt_tested_ok boolean, p_cerbo_updated_ok boolean, p_cerbo_online_ok boolean, p_solar_panel_count integer, p_solar_panels_verified boolean, p_battery_count integer, p_batteries_charged_ok boolean, p_solar_charging_ok boolean",
    "language": "plpgsql",
    "sha256": "dd88ed8c44aa7ff154b6286ac57ba199e9fb1277bd969d31133ef3598a5481de"
  },
  {
    "schema": "public",
    "name": "save_my_service_solar_check_v3",
    "arguments": "p_prep_id uuid, p_stand_tag text, p_battery_configuration text, p_mppt_updated_ok boolean, p_mppt_tested_ok boolean, p_solar_panel_count integer, p_solar_panels_verified boolean, p_batteries_charged_ok boolean, p_solar_charging_ok boolean, p_cerbo_updated_ok boolean, p_cerbo_online_ok boolean, p_helios_battery_box_charging_ok boolean",
    "language": "plpgsql",
    "sha256": "cdf6ef6012f3c11cb453a20f8c42c3716fcda3c6ce767a9afeaeed94594ed797"
  },
  {
    "schema": "public",
    "name": "save_my_service_solar_check_v4",
    "arguments": "p_prep_id uuid, p_stand_tag text, p_battery_configuration text, p_mppt_updated_ok boolean, p_mppt_tested_ok boolean, p_solar_panel_count integer, p_solar_panels_verified boolean, p_batteries_charged_ok boolean, p_solar_charging_ok boolean, p_cerbo_updated_ok boolean, p_cerbo_online_ok boolean, p_helios_battery_box_charging_ok boolean, p_helios_yard_pv_connected_ok boolean, p_helios_yard_switch_pv_ok boolean, p_helios_yard_victron_bluetooth_ok boolean, p_helios_yard_updates_status_ok boolean, p_helios_yard_solar_charging_ok boolean, p_helios_yard_ptz_wrapped_ok boolean",
    "language": "plpgsql",
    "sha256": "b319f75c35243a483ec77008181981a5f7d10a36c01a8497d990a161d8ea02cf"
  },
  {
    "schema": "public",
    "name": "save_service_alibi_camera_check_v1",
    "arguments": "p_prep_id uuid, p_value boolean",
    "language": "plpgsql",
    "sha256": "145c9864d262469a25abd05166701bdbc416c98885cc37815b4f86957a28fdd3"
  },
  {
    "schema": "public",
    "name": "save_service_helios_field_check_v1",
    "arguments": "p_prep_id uuid, p_field text, p_value boolean",
    "language": "plpgsql",
    "sha256": "869dd52394c60923e8dacf7152bc554231e4a7c2b330f6b4bcd15e3a4cff6de9"
  },
  {
    "schema": "public",
    "name": "save_service_solar_progress_v1",
    "arguments": "p_prep_id uuid, p_field text, p_value text",
    "language": "plpgsql",
    "sha256": "59fd8177d568a235d68b3411d57f554116d1e719df0ff9367fab1b3dcfd26f33"
  },
  {
    "schema": "public",
    "name": "service_accept_truck_restock_v1",
    "arguments": "p_request_id uuid",
    "language": "plpgsql",
    "sha256": "4158a546606db6ff06d4043e7f180976439c3b9cb00f6de08dfd6f4751d7ea58"
  },
  {
    "schema": "public",
    "name": "service_link_offline_failed_return_v1",
    "arguments": "p_escalation_id uuid, p_return_id uuid",
    "language": "plpgsql",
    "sha256": "15e69e2fb778c167041583bcad46dbdeca563a4eb202d9ab93fdf8c0215dcbc1"
  },
  {
    "schema": "public",
    "name": "service_resolve_swap_unit_v1",
    "arguments": "p_item_id uuid, p_used boolean",
    "language": "plpgsql",
    "sha256": "1891d19cf978727d7c144e0185e6d438ef39a2bf77414d14f7185bc2f05ff26f"
  },
  {
    "schema": "public",
    "name": "service_return_110v_stand_to_shop_v1",
    "arguments": "p_ticket_no text, p_unit_tag text, p_notes text, p_return_photo_paths text[], p_return_id uuid",
    "language": "plpgsql",
    "sha256": "5612cd22cd7cc4b87336d1af6521cac117c273112cbfe1f806d9224d62330c40"
  },
  {
    "schema": "public",
    "name": "service_return_110v_stand_to_shop_v2",
    "arguments": "p_ticket_no text, p_unit_tag text, p_notes text, p_return_photo_paths text[], p_return_id uuid, p_pole_bent boolean, p_brick_fascia_damaged boolean",
    "language": "plpgsql",
    "sha256": "70d81d9f3de5254d3ca93fa77ebad54bd68e5447fb70c6dfd5b2e98860628bb4"
  },
  {
    "schema": "public",
    "name": "service_return_110v_stand_to_shop_v3",
    "arguments": "p_ticket_no text, p_unit_tag text, p_notes text, p_return_photo_paths text[], p_return_id uuid, p_damage_found boolean",
    "language": "plpgsql",
    "sha256": "06248bf0e5c56bbb8a46fed3d472d13a6d9ebaa15d22b296b576c455a8cf8928"
  },
  {
    "schema": "public",
    "name": "service_save_my_truck_inventory_v1",
    "arguments": "p_units jsonb, p_sims jsonb",
    "language": "plpgsql",
    "sha256": "5719bb1e67431082b3542733722c44f7ed69f8a8b139b86c3425e7c40f43d491"
  },
  {
    "schema": "public",
    "name": "service_save_my_truck_inventory_v2",
    "arguments": "p_units jsonb, p_sims jsonb, p_recon_battery_qty integer, p_agm_12v_110ah_qty integer, p_litime_12v_100ah_qty integer",
    "language": "plpgsql",
    "sha256": "93358596b8b3a265a7ca2d0881432f6e6b4a59dd6966dba7af8ac521fc132325"
  },
  {
    "schema": "public",
    "name": "service_save_my_truck_inventory_v3",
    "arguments": "p_units jsonb, p_sims jsonb, p_recon_battery_qty integer, p_agm_12v_110ah_qty integer, p_litime_12v_100ah_qty integer, p_battery_12v_35ah_qty integer",
    "language": "plpgsql",
    "sha256": "4432fda6dfaebe3295c5560e7ee4ff57fe86da48ad330613a6b778c99f82685b"
  },
  {
    "schema": "public",
    "name": "service_use_permanent_truck_unit_v1",
    "arguments": "p_ticket_no text, p_equipment_type text, p_old_unit_tag text",
    "language": "plpgsql",
    "sha256": "7856c402b1fc054d2710e7782f714a6915c8db23615db38e27731908d4650530"
  },
  {
    "schema": "public",
    "name": "service_use_truck_sim_v1",
    "arguments": "p_ticket_no text, p_slot_no integer",
    "language": "plpgsql",
    "sha256": "109f24e10b7dfdfbbd5415c520b70966eddb8d6be19bf2f106adeb919fdff39a"
  },
  {
    "schema": "public",
    "name": "set_my_job_assignment_status",
    "arguments": "p_assignment_id uuid, p_status text",
    "language": "plpgsql",
    "sha256": "0c86b670e6f61699f000288a3e5c9ddd12aca7cdfe2c4ede62a115838e902493"
  },
  {
    "schema": "public",
    "name": "set_prep_parts",
    "arguments": "p_prep_id uuid, p_solar_panel_qty integer, p_battery_replacement_qty integer, p_camera_replacement_qty integer, p_sim_replacement_qty integer, p_micro_sd_qty integer",
    "language": "plpgsql",
    "sha256": "29c9c8491c31ad7aab89b7b57dad78072c32b5f2ecb1ec5e99e0f59cc3672e5d"
  },
  {
    "schema": "public",
    "name": "submit_my_service_truck_inventory_check_v3",
    "arguments": "p_unit_confirmations jsonb, p_sim_confirmations jsonb, p_recon_battery_qty integer, p_agm_12v_110ah_qty integer, p_litime_12v_100ah_qty integer, p_battery_12v_35ah_qty integer",
    "language": "plpgsql",
    "sha256": "6a391cdf55d5dda3b8127b431b616bd5b165e1e787ec755d2833ca411c2c2641"
  },
  {
    "schema": "public",
    "name": "sync_pickup_assignment_completion_from_return_v1",
    "arguments": "",
    "language": "plpgsql",
    "sha256": "63134c39f02aac122aa44feee0e65e3834646e8f11d7383388fe446ecf186bdd"
  },
  {
    "schema": "public",
    "name": "sync_unit_registry_from_prep_item",
    "arguments": "",
    "language": "plpgsql",
    "sha256": "903383f7424d39fd0197d77c5471a27f97d2ef67eed06a5f276ff6815c76ed0f"
  },
  {
    "schema": "public",
    "name": "sync_unit_registry_from_prep_ticket",
    "arguments": "",
    "language": "plpgsql",
    "sha256": "c5e43443ef3e2bab353e04aeb39165f7e85129719ada2fe2d45902b06a4b7dd8"
  },
  {
    "schema": "public",
    "name": "sync_unit_registry_from_return",
    "arguments": "",
    "language": "plpgsql",
    "sha256": "954945838d0d7e6268777dddae08ffdc364d73b03c0ba470948cd253b18b1bdb"
  },
  {
    "schema": "public",
    "name": "update_it_prep_item_definition",
    "arguments": "p_item_id uuid, p_equipment_type text, p_purpose text, p_recon_battery_count integer",
    "language": "plpgsql",
    "sha256": "76235fde960d211050a235b58e93e654db7bad200c83815435cce1ec661a9898"
  },
  {
    "schema": "public",
    "name": "update_it_prep_structure",
    "arguments": "p_prep_id uuid, p_ticket_no text, p_site text, p_items jsonb",
    "language": "plpgsql",
    "sha256": "252b217402c1ba1b4df88803f24bf194fb0ef0d97bfd9d55bec5447331bc2bfb"
  },
  {
    "schema": "public",
    "name": "verify_delivery_item_checks",
    "arguments": "p_item_id uuid, p_sim_ok boolean, p_camera_app_ok boolean, p_batteries_charged_ok boolean, p_monitoring_ok boolean, p_ticket_count_ok boolean, p_sd_formatted_ok boolean, p_recording_ok boolean, p_customer_email_app_ok boolean",
    "language": "plpgsql",
    "sha256": "2bcd81ed22752884591b3f8867b7000bc4c1c23bd76b1cc860878402f6daf5dd"
  },
  {
    "schema": "public",
    "name": "verify_delivery_item_checks",
    "arguments": "p_item_id uuid, p_sim_ok boolean, p_camera_app_ok boolean, p_batteries_charged_ok boolean, p_monitoring_ok boolean, p_ticket_count_ok boolean, p_sd_formatted_ok boolean, p_recording_ok boolean",
    "language": "plpgsql",
    "sha256": "b2acf8e193fed192ecb566285d8daa99b24f53db05e5b8a55d7d5be1b2500d52"
  },
  {
    "schema": "public",
    "name": "verify_delivery_item_checks",
    "arguments": "p_item_id uuid, p_sim_ok boolean, p_camera_app_ok boolean, p_batteries_charged_ok boolean, p_monitoring_ok boolean, p_ticket_count_ok boolean",
    "language": "plpgsql",
    "sha256": "a5d5f7c485ff37f7ecac2ea28cc5d1459e42f0a331226e28af82e5183d4bf626"
  },
  {
    "schema": "public",
    "name": "verify_prep_item",
    "arguments": "p_item_id uuid, p_unit_tag text, p_battery_count integer, p_power_ok boolean, p_functions_ok boolean, p_safe_ok boolean",
    "language": "plpgsql",
    "sha256": "59b6277e50b92cde2fcdbb37bd70ac63e8a8499078e273cf9e7c534686c7ce14"
  },
  {
    "schema": "public",
    "name": "vision_execute_action_v1",
    "arguments": "p_action_id uuid",
    "language": "plpgsql",
    "sha256": "b09e96a721c3b5b4d597073e90e2c4748bc27da29696b60e6e31c3bd637f6f33"
  },
  {
    "schema": "public",
    "name": "vision_prepare_action_v1",
    "arguments": "p_conversation_id text, p_action jsonb, p_user_message text",
    "language": "plpgsql",
    "sha256": "672bd1a4b605853fb40d0f0ff158cc9b3f6af97e87ecef424bbd33bd7a293144"
  }
]
$manifest$::jsonb) as x(schema text,name text,arguments text,language text,sha256 text);
do $install$
declare expected record;current_oid oid;definition text;updated text;
begin
 -- Validate the entire reviewed set first. A drift requires a new review.
 for expected in select * from techcheck_reviewed_writers_v6 loop
  select p.oid into current_oid from pg_proc p join pg_namespace n on n.oid=p.pronamespace join pg_language l on l.oid=p.prolang
   where n.nspname=expected.schema_name and p.proname=expected.name and pg_get_function_identity_arguments(p.oid)=expected.arguments and l.lanname=expected.language;
  if current_oid is null or encode(sha256(convert_to(pg_get_functiondef(current_oid),'UTF8')),'hex')<>expected.sha256 then raise exception 'Reviewed custody writer changed: %.%(%)',expected.schema_name,expected.name,expected.arguments;end if;
 end loop;
 -- Catch a newly introduced writer instead of silently omitting it.
 if exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','app_private') and p.prokind='f'
  and p.prosrc ~* '(equipment_master|unit_registry|prep_items|prep_tickets|unit_returns|asset_inventory|service_truck_units|service_truck_restock_requests)'
  and p.prosrc ~* '(insert[[:space:]]+into|update[[:space:]]+|delete[[:space:]]+from|for[[:space:]]+update)'
  and p.proname not like '%techcheck%' and p.proname not like '%service_daily_report%'
  and not exists(select 1 from techcheck_reviewed_writers_v6 e where e.schema_name=n.nspname and e.name=p.proname and e.arguments=pg_get_function_identity_arguments(p.oid))) then raise exception 'An unreviewed inventory writer was introduced.';end if;
 for expected in select * from techcheck_reviewed_writers_v6 order by schema_name,name,arguments loop
  select p.oid into current_oid from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname=expected.schema_name and p.proname=expected.name and pg_get_function_identity_arguments(p.oid)=expected.arguments;
  definition:=pg_get_functiondef(current_oid);
  if expected.language='plpgsql' then
   updated:=regexp_replace(definition,'(\n[ \t]*begin[ \t]*\n)',E'\\1  perform pg_advisory_xact_lock(hashtextextended(''techcheck-shared-custody-v6'',6));\n','i');
  else
   -- The only reviewed SQL writer has this exact dollar delimiter.
   updated:=replace(definition,E'AS $function$\n',E'AS $function$\n  select pg_advisory_xact_lock(hashtextextended(''techcheck-shared-custody-v6'',6));\n');
  end if;
  if updated=definition then raise exception 'Could not locate the reviewed writer entry: %.%',expected.schema_name,expected.name;end if;
  execute updated;
 end loop;
end$install$;
commit;
