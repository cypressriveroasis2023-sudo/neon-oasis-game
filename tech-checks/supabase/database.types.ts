// Generated from live Supabase project goqrnolcvqnirjmzaeyk on 2026-09-19.
// Source-controlled baseline for Tech Check / OnSite Vision. Regenerate after schema changes.
// Do not hand-edit generated table/RPC signatures.

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      app_notifications: {
        Row: {
          assignment_id: string | null
          body: string
          created_at: string
          id: string
          kind: string
          read_at: string | null
          recipient_user_id: string
          ticket_no: string | null
          title: string
          unit_tag: string | null
        }
        Insert: {
          assignment_id?: string | null
          body: string
          created_at?: string
          id?: string
          kind: string
          read_at?: string | null
          recipient_user_id: string
          ticket_no?: string | null
          title: string
          unit_tag?: string | null
        }
        Update: {
          assignment_id?: string | null
          body?: string
          created_at?: string
          id?: string
          kind?: string
          read_at?: string | null
          recipient_user_id?: string
          ticket_no?: string | null
          title?: string
          unit_tag?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "app_notifications_assignment_id_fkey"
            columns: ["assignment_id"]
            isOneToOne: false
            referencedRelation: "job_assignments"
            referencedColumns: ["id"]
          },
        ]
      }
      asset_inventory: {
        Row: {
          asset_category: string
          asset_type: string
          assigned_to: string | null
          assigned_to_name: string | null
          availability_status: string
          created_at: string
          created_by: string | null
          created_by_name: string | null
          last_event: string | null
          notes: string | null
          unit_key: string
          unit_tag: string
          updated_at: string
        }
        Insert: {
          asset_category: string
          asset_type: string
          assigned_to?: string | null
          assigned_to_name?: string | null
          availability_status?: string
          created_at?: string
          created_by?: string | null
          created_by_name?: string | null
          last_event?: string | null
          notes?: string | null
          unit_key: string
          unit_tag: string
          updated_at?: string
        }
        Update: {
          asset_category?: string
          asset_type?: string
          assigned_to?: string | null
          assigned_to_name?: string | null
          availability_status?: string
          created_at?: string
          created_by?: string | null
          created_by_name?: string | null
          last_event?: string | null
          notes?: string | null
          unit_key?: string
          unit_tag?: string
          updated_at?: string
        }
        Relationships: []
      }
      asset_inventory_history: {
        Row: {
          action: string
          actor_id: string | null
          actor_name: string | null
          created_at: string
          from_status: string | null
          from_user_id: string | null
          from_user_name: string | null
          id: string
          notes: string | null
          to_status: string | null
          to_user_id: string | null
          to_user_name: string | null
          unit_key: string
          unit_tag: string
        }
        Insert: {
          action: string
          actor_id?: string | null
          actor_name?: string | null
          created_at?: string
          from_status?: string | null
          from_user_id?: string | null
          from_user_name?: string | null
          id?: string
          notes?: string | null
          to_status?: string | null
          to_user_id?: string | null
          to_user_name?: string | null
          unit_key: string
          unit_tag: string
        }
        Update: {
          action?: string
          actor_id?: string | null
          actor_name?: string | null
          created_at?: string
          from_status?: string | null
          from_user_id?: string | null
          from_user_name?: string | null
          id?: string
          notes?: string | null
          to_status?: string | null
          to_user_id?: string | null
          to_user_name?: string | null
          unit_key?: string
          unit_tag?: string
        }
        Relationships: [
          {
            foreignKeyName: "asset_inventory_history_unit_key_fkey"
            columns: ["unit_key"]
            isOneToOne: false
            referencedRelation: "asset_inventory"
            referencedColumns: ["unit_key"]
          },
        ]
      }
      handoff_evidence: {
        Row: {
          created_at: string
          created_by: string
          created_by_name: string
          id: string
          kind: string
          original_name: string | null
          prep_item_id: string | null
          prep_ticket_id: string
          stage: string
          storage_path: string
        }
        Insert: {
          created_at?: string
          created_by: string
          created_by_name: string
          id?: string
          kind: string
          original_name?: string | null
          prep_item_id?: string | null
          prep_ticket_id: string
          stage: string
          storage_path: string
        }
        Update: {
          created_at?: string
          created_by?: string
          created_by_name?: string
          id?: string
          kind?: string
          original_name?: string | null
          prep_item_id?: string | null
          prep_ticket_id?: string
          stage?: string
          storage_path?: string
        }
        Relationships: [
          {
            foreignKeyName: "handoff_evidence_prep_item_id_fkey"
            columns: ["prep_item_id"]
            isOneToOne: false
            referencedRelation: "prep_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "handoff_evidence_prep_ticket_id_fkey"
            columns: ["prep_ticket_id"]
            isOneToOne: false
            referencedRelation: "prep_tickets"
            referencedColumns: ["id"]
          },
        ]
      }
      job_assignments: {
        Row: {
          assigned_at: string
          assigned_by: string
          assigned_by_name: string
          assigned_role: string
          assignee_name: string
          assignee_user_id: string | null
          assignment_scope: string
          battery_replacement_qty: number
          camera_replacement_qty: number
          cancelled_at: string | null
          claimed_at: string | null
          completed_at: string | null
          equipment_manifest: Json
          id: string
          job_description: string | null
          micro_sd_qty: number
          notes: string | null
          prep_ticket_id: string | null
          requested_unit_count: number | null
          requires_it_handoff: boolean
          return_equipment_manifest: Json
          scheduled_for: string
          scheduled_time: string | null
          sim_replacement_qty: number
          site: string | null
          solar_panel_qty: number
          started_at: string | null
          status: string
          ticket_no: string
          unit_summary: string | null
          updated_at: string
          work_type: string
        }
        Insert: {
          assigned_at?: string
          assigned_by: string
          assigned_by_name: string
          assigned_role: string
          assignee_name: string
          assignee_user_id?: string | null
          assignment_scope?: string
          battery_replacement_qty?: number
          camera_replacement_qty?: number
          cancelled_at?: string | null
          claimed_at?: string | null
          completed_at?: string | null
          equipment_manifest?: Json
          id?: string
          job_description?: string | null
          micro_sd_qty?: number
          notes?: string | null
          prep_ticket_id?: string | null
          requested_unit_count?: number | null
          requires_it_handoff?: boolean
          return_equipment_manifest?: Json
          scheduled_for?: string
          scheduled_time?: string | null
          sim_replacement_qty?: number
          site?: string | null
          solar_panel_qty?: number
          started_at?: string | null
          status?: string
          ticket_no: string
          unit_summary?: string | null
          updated_at?: string
          work_type?: string
        }
        Update: {
          assigned_at?: string
          assigned_by?: string
          assigned_by_name?: string
          assigned_role?: string
          assignee_name?: string
          assignee_user_id?: string | null
          assignment_scope?: string
          battery_replacement_qty?: number
          camera_replacement_qty?: number
          cancelled_at?: string | null
          claimed_at?: string | null
          completed_at?: string | null
          equipment_manifest?: Json
          id?: string
          job_description?: string | null
          micro_sd_qty?: number
          notes?: string | null
          prep_ticket_id?: string | null
          requested_unit_count?: number | null
          requires_it_handoff?: boolean
          return_equipment_manifest?: Json
          scheduled_for?: string
          scheduled_time?: string | null
          sim_replacement_qty?: number
          site?: string | null
          solar_panel_qty?: number
          started_at?: string | null
          status?: string
          ticket_no?: string
          unit_summary?: string | null
          updated_at?: string
          work_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "job_assignments_prep_ticket_id_fkey"
            columns: ["prep_ticket_id"]
            isOneToOne: false
            referencedRelation: "prep_tickets"
            referencedColumns: ["id"]
          },
        ]
      }
      morning_checks: {
        Row: {
          closed_ticket_nos: string[]
          id: string
          is_test: boolean
          mhelp_reviewed: boolean
          service_tech_id: string
          submitted_at: string
          taking_trailer: boolean
          trailer_checks: Json | null
          truck_checks: Json
        }
        Insert: {
          closed_ticket_nos?: string[]
          id?: string
          is_test?: boolean
          mhelp_reviewed: boolean
          service_tech_id: string
          submitted_at?: string
          taking_trailer?: boolean
          trailer_checks?: Json | null
          truck_checks: Json
        }
        Update: {
          closed_ticket_nos?: string[]
          id?: string
          is_test?: boolean
          mhelp_reviewed?: boolean
          service_tech_id?: string
          submitted_at?: string
          taking_trailer?: boolean
          trailer_checks?: Json | null
          truck_checks?: Json
        }
        Relationships: []
      }
      notification_preferences: {
        Row: {
          browser_notifications: boolean
          equipment_ready_service: boolean
          new_assignments: boolean
          owner_actions: boolean
          returned_units: boolean
          updated_at: string
          user_id: string
        }
        Insert: {
          browser_notifications?: boolean
          equipment_ready_service?: boolean
          new_assignments?: boolean
          owner_actions?: boolean
          returned_units?: boolean
          updated_at?: string
          user_id: string
        }
        Update: {
          browser_notifications?: boolean
          equipment_ready_service?: boolean
          new_assignments?: boolean
          owner_actions?: boolean
          returned_units?: boolean
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      owner_ai_alert_acknowledgements: {
        Row: {
          acknowledged_at: string
          acknowledged_by: string | null
          acknowledged_by_name: string | null
          alert_detail: string | null
          alert_key: string
          assignment_id: string
          id: number
          resolution_note: string | null
          resolved_at: string | null
          ticket_no: string | null
        }
        Insert: {
          acknowledged_at?: string
          acknowledged_by?: string | null
          acknowledged_by_name?: string | null
          alert_detail?: string | null
          alert_key: string
          assignment_id: string
          id?: number
          resolution_note?: string | null
          resolved_at?: string | null
          ticket_no?: string | null
        }
        Update: {
          acknowledged_at?: string
          acknowledged_by?: string | null
          acknowledged_by_name?: string | null
          alert_detail?: string | null
          alert_key?: string
          assignment_id?: string
          id?: number
          resolution_note?: string | null
          resolved_at?: string | null
          ticket_no?: string | null
        }
        Relationships: []
      }
      password_reset_requests: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          expires_at: string
          fulfilled_at: string | null
          id: string
          requested_at: string
          status: string
          token_hash: string
          user_id: string
          username: string
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          expires_at?: string
          fulfilled_at?: string | null
          id?: string
          requested_at?: string
          status?: string
          token_hash: string
          user_id: string
          username: string
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          expires_at?: string
          fulfilled_at?: string | null
          id?: string
          requested_at?: string
          status?: string
          token_hash?: string
          user_id?: string
          username?: string
        }
        Relationships: []
      }
      prep_items: {
        Row: {
          ai_tag_scan_at: string | null
          ai_tag_scan_confidence: number | null
          ai_tag_scan_detected: string | null
          ai_tag_scan_engine: string | null
          ai_tag_scan_expected: string | null
          ai_tag_scan_status: string | null
          battery_count: number | null
          delivery_batteries_charged_ok: boolean
          delivery_camera_app_ok: boolean
          delivery_customer_email_app_ok: boolean
          delivery_monitoring_ok: boolean
          delivery_recording_ok: boolean
          delivery_sd_formatted_ok: boolean
          delivery_sim_ok: boolean
          delivery_ticket_count_ok: boolean
          equipment_type: string
          functions_ok: boolean | null
          helios_3x1tb_sd_ok: boolean
          helios_alibi_vigilant_ok: boolean
          helios_battery_120v_charged_ok: boolean
          helios_battery_box_installed_ok: boolean
          helios_camera_router_programming_ok: boolean
          helios_camera1_hardware_ok: boolean
          helios_camera1_ports_ok: boolean
          helios_camera2_hardware_ok: boolean
          helios_camera2_ports_ok: boolean
          helios_cameras_12v_ok: boolean
          helios_cerbo_network_ok: boolean
          helios_cerbo_vrm_ok: boolean
          helios_proxicast_4x4_ok: boolean
          helios_ptz_assembly_ok: boolean
          helios_ptz_plate_4bolts_ok: boolean
          helios_ptz_ports_ok: boolean
          helios_rear_unit_tag_ok: boolean
          helios_router_sim_ok: boolean
          helios_speaker_24v_ok: boolean
          helios_speaker_ports_ok: boolean
          id: string
          item_order: number
          photo_tag_match_ok: boolean
          power_ok: boolean | null
          prep_ticket_id: string
          purpose: Database["public"]["Enums"]["prep_purpose"]
          required_battery_count: number
          safe_ok: boolean | null
          service_battery_count: number | null
          service_unit_confirmed: boolean | null
          service_verified_at: string | null
          service_verified_by: string | null
          solar_mppt_tested_ok: boolean
          solar_mppt_updated_ok: boolean
          solar_panels_match_ok: boolean
          solar_pv_charging_ok: boolean
          spare_checked_out_at: string | null
          spare_checked_out_to: string | null
          spare_checked_out_to_name: string | null
          spare_it_checked_out_at: string | null
          spare_it_checked_out_by: string | null
          spare_it_checked_out_by_name: string | null
          spare_outcome: string | null
          spare_outcome_at: string | null
          spare_outcome_by: string | null
          spare_outcome_by_name: string | null
          ticket_item_match_ok: boolean
          unit_tag: string | null
          verified_at: string | null
          verified_by: string | null
        }
        Insert: {
          ai_tag_scan_at?: string | null
          ai_tag_scan_confidence?: number | null
          ai_tag_scan_detected?: string | null
          ai_tag_scan_engine?: string | null
          ai_tag_scan_expected?: string | null
          ai_tag_scan_status?: string | null
          battery_count?: number | null
          delivery_batteries_charged_ok?: boolean
          delivery_camera_app_ok?: boolean
          delivery_customer_email_app_ok?: boolean
          delivery_monitoring_ok?: boolean
          delivery_recording_ok?: boolean
          delivery_sd_formatted_ok?: boolean
          delivery_sim_ok?: boolean
          delivery_ticket_count_ok?: boolean
          equipment_type: string
          functions_ok?: boolean | null
          helios_3x1tb_sd_ok?: boolean
          helios_alibi_vigilant_ok?: boolean
          helios_battery_120v_charged_ok?: boolean
          helios_battery_box_installed_ok?: boolean
          helios_camera_router_programming_ok?: boolean
          helios_camera1_hardware_ok?: boolean
          helios_camera1_ports_ok?: boolean
          helios_camera2_hardware_ok?: boolean
          helios_camera2_ports_ok?: boolean
          helios_cameras_12v_ok?: boolean
          helios_cerbo_network_ok?: boolean
          helios_cerbo_vrm_ok?: boolean
          helios_proxicast_4x4_ok?: boolean
          helios_ptz_assembly_ok?: boolean
          helios_ptz_plate_4bolts_ok?: boolean
          helios_ptz_ports_ok?: boolean
          helios_rear_unit_tag_ok?: boolean
          helios_router_sim_ok?: boolean
          helios_speaker_24v_ok?: boolean
          helios_speaker_ports_ok?: boolean
          id?: string
          item_order: number
          photo_tag_match_ok?: boolean
          power_ok?: boolean | null
          prep_ticket_id: string
          purpose: Database["public"]["Enums"]["prep_purpose"]
          required_battery_count?: number
          safe_ok?: boolean | null
          service_battery_count?: number | null
          service_unit_confirmed?: boolean | null
          service_verified_at?: string | null
          service_verified_by?: string | null
          solar_mppt_tested_ok?: boolean
          solar_mppt_updated_ok?: boolean
          solar_panels_match_ok?: boolean
          solar_pv_charging_ok?: boolean
          spare_checked_out_at?: string | null
          spare_checked_out_to?: string | null
          spare_checked_out_to_name?: string | null
          spare_it_checked_out_at?: string | null
          spare_it_checked_out_by?: string | null
          spare_it_checked_out_by_name?: string | null
          spare_outcome?: string | null
          spare_outcome_at?: string | null
          spare_outcome_by?: string | null
          spare_outcome_by_name?: string | null
          ticket_item_match_ok?: boolean
          unit_tag?: string | null
          verified_at?: string | null
          verified_by?: string | null
        }
        Update: {
          ai_tag_scan_at?: string | null
          ai_tag_scan_confidence?: number | null
          ai_tag_scan_detected?: string | null
          ai_tag_scan_engine?: string | null
          ai_tag_scan_expected?: string | null
          ai_tag_scan_status?: string | null
          battery_count?: number | null
          delivery_batteries_charged_ok?: boolean
          delivery_camera_app_ok?: boolean
          delivery_customer_email_app_ok?: boolean
          delivery_monitoring_ok?: boolean
          delivery_recording_ok?: boolean
          delivery_sd_formatted_ok?: boolean
          delivery_sim_ok?: boolean
          delivery_ticket_count_ok?: boolean
          equipment_type?: string
          functions_ok?: boolean | null
          helios_3x1tb_sd_ok?: boolean
          helios_alibi_vigilant_ok?: boolean
          helios_battery_120v_charged_ok?: boolean
          helios_battery_box_installed_ok?: boolean
          helios_camera_router_programming_ok?: boolean
          helios_camera1_hardware_ok?: boolean
          helios_camera1_ports_ok?: boolean
          helios_camera2_hardware_ok?: boolean
          helios_camera2_ports_ok?: boolean
          helios_cameras_12v_ok?: boolean
          helios_cerbo_network_ok?: boolean
          helios_cerbo_vrm_ok?: boolean
          helios_proxicast_4x4_ok?: boolean
          helios_ptz_assembly_ok?: boolean
          helios_ptz_plate_4bolts_ok?: boolean
          helios_ptz_ports_ok?: boolean
          helios_rear_unit_tag_ok?: boolean
          helios_router_sim_ok?: boolean
          helios_speaker_24v_ok?: boolean
          helios_speaker_ports_ok?: boolean
          id?: string
          item_order?: number
          photo_tag_match_ok?: boolean
          power_ok?: boolean | null
          prep_ticket_id?: string
          purpose?: Database["public"]["Enums"]["prep_purpose"]
          required_battery_count?: number
          safe_ok?: boolean | null
          service_battery_count?: number | null
          service_unit_confirmed?: boolean | null
          service_verified_at?: string | null
          service_verified_by?: string | null
          solar_mppt_tested_ok?: boolean
          solar_mppt_updated_ok?: boolean
          solar_panels_match_ok?: boolean
          solar_pv_charging_ok?: boolean
          spare_checked_out_at?: string | null
          spare_checked_out_to?: string | null
          spare_checked_out_to_name?: string | null
          spare_it_checked_out_at?: string | null
          spare_it_checked_out_by?: string | null
          spare_it_checked_out_by_name?: string | null
          spare_outcome?: string | null
          spare_outcome_at?: string | null
          spare_outcome_by?: string | null
          spare_outcome_by_name?: string | null
          ticket_item_match_ok?: boolean
          unit_tag?: string | null
          verified_at?: string | null
          verified_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "prep_items_prep_ticket_id_fkey"
            columns: ["prep_ticket_id"]
            isOneToOne: false
            referencedRelation: "prep_tickets"
            referencedColumns: ["id"]
          },
        ]
      }
      prep_tickets: {
        Row: {
          battery_replacement_qty: number
          camera_replacement_qty: number
          closed_at: string | null
          closed_by: string | null
          closed_by_name: string | null
          created_at: string
          created_by: string
          equipment_manifest: Json
          expected_unit_count: number | null
          id: string
          is_test: boolean
          micro_sd_qty: number
          released_at: string | null
          released_by: string | null
          released_by_name: string | null
          requested_unit_count: number | null
          service_parts_confirmed: boolean
          service_parts_confirmed_at: string | null
          service_parts_confirmed_by: string | null
          service_parts_confirmed_by_name: string | null
          sim_replacement_qty: number
          site: string | null
          solar_panel_qty: number
          status: Database["public"]["Enums"]["prep_status"]
          ticket_no: string
          work_type: string
        }
        Insert: {
          battery_replacement_qty?: number
          camera_replacement_qty?: number
          closed_at?: string | null
          closed_by?: string | null
          closed_by_name?: string | null
          created_at?: string
          created_by: string
          equipment_manifest?: Json
          expected_unit_count?: number | null
          id?: string
          is_test?: boolean
          micro_sd_qty?: number
          released_at?: string | null
          released_by?: string | null
          released_by_name?: string | null
          requested_unit_count?: number | null
          service_parts_confirmed?: boolean
          service_parts_confirmed_at?: string | null
          service_parts_confirmed_by?: string | null
          service_parts_confirmed_by_name?: string | null
          sim_replacement_qty?: number
          site?: string | null
          solar_panel_qty?: number
          status?: Database["public"]["Enums"]["prep_status"]
          ticket_no: string
          work_type?: string
        }
        Update: {
          battery_replacement_qty?: number
          camera_replacement_qty?: number
          closed_at?: string | null
          closed_by?: string | null
          closed_by_name?: string | null
          created_at?: string
          created_by?: string
          equipment_manifest?: Json
          expected_unit_count?: number | null
          id?: string
          is_test?: boolean
          micro_sd_qty?: number
          released_at?: string | null
          released_by?: string | null
          released_by_name?: string | null
          requested_unit_count?: number | null
          service_parts_confirmed?: boolean
          service_parts_confirmed_at?: string | null
          service_parts_confirmed_by?: string | null
          service_parts_confirmed_by_name?: string | null
          sim_replacement_qty?: number
          site?: string | null
          solar_panel_qty?: number
          status?: Database["public"]["Enums"]["prep_status"]
          ticket_no?: string
          work_type?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          active: boolean
          archived_at: string | null
          archived_by: string | null
          archived_reason: string | null
          created_at: string
          email: string | null
          email_handoff_updates: boolean
          email_job_assignments: boolean
          email_owner_copies: boolean
          full_name: string | null
          must_change_password: boolean
          notification_email: string | null
          password_changed_at: string | null
          role: Database["public"]["Enums"]["app_role"]
          updated_at: string
          user_id: string
          username: string | null
        }
        Insert: {
          active?: boolean
          archived_at?: string | null
          archived_by?: string | null
          archived_reason?: string | null
          created_at?: string
          email?: string | null
          email_handoff_updates?: boolean
          email_job_assignments?: boolean
          email_owner_copies?: boolean
          full_name?: string | null
          must_change_password?: boolean
          notification_email?: string | null
          password_changed_at?: string | null
          role?: Database["public"]["Enums"]["app_role"]
          updated_at?: string
          user_id: string
          username?: string | null
        }
        Update: {
          active?: boolean
          archived_at?: string | null
          archived_by?: string | null
          archived_reason?: string | null
          created_at?: string
          email?: string | null
          email_handoff_updates?: boolean
          email_job_assignments?: boolean
          email_owner_copies?: boolean
          full_name?: string | null
          must_change_password?: boolean
          notification_email?: string | null
          password_changed_at?: string | null
          role?: Database["public"]["Enums"]["app_role"]
          updated_at?: string
          user_id?: string
          username?: string | null
        }
        Relationships: []
      }
      push_config: {
        Row: {
          key: string
          updated_at: string
          value: string
        }
        Insert: {
          key: string
          updated_at?: string
          value: string
        }
        Update: {
          key?: string
          updated_at?: string
          value?: string
        }
        Relationships: []
      }
      push_subscriptions: {
        Row: {
          auth: string
          created_at: string
          enabled: boolean
          endpoint: string
          id: string
          p256dh: string
          updated_at: string
          user_agent: string | null
          user_id: string
        }
        Insert: {
          auth: string
          created_at?: string
          enabled?: boolean
          endpoint: string
          id?: string
          p256dh: string
          updated_at?: string
          user_agent?: string | null
          user_id: string
        }
        Update: {
          auth?: string
          created_at?: string
          enabled?: boolean
          endpoint?: string
          id?: string
          p256dh?: string
          updated_at?: string
          user_agent?: string | null
          user_id?: string
        }
        Relationships: []
      }
      reports: {
        Row: {
          actor_id: string | null
          actor_name: string | null
          created_at: string
          id: number
          is_test: boolean
          kind: string
          reason: string | null
          text: string
          ticket_no: string | null
        }
        Insert: {
          actor_id?: string | null
          actor_name?: string | null
          created_at?: string
          id?: never
          is_test?: boolean
          kind: string
          reason?: string | null
          text: string
          ticket_no?: string | null
        }
        Update: {
          actor_id?: string | null
          actor_name?: string | null
          created_at?: string
          id?: never
          is_test?: boolean
          kind?: string
          reason?: string | null
          text?: string
          ticket_no?: string | null
        }
        Relationships: []
      }
      service_solar_checks: {
        Row: {
          assignment_id: string | null
          batteries_charged_ok: boolean
          battery_configuration: string | null
          battery_count: number
          battery_description: string | null
          cerbo_online_ok: boolean | null
          cerbo_updated_ok: boolean | null
          completed_at: string | null
          handoff_accepted_at: string | null
          handoff_accepted_by: string | null
          handoff_accepted_by_name: string | null
          helios_battery_box_charging_ok: boolean | null
          helios_field_4_sandbags_ok: boolean
          helios_field_box_mounted_ok: boolean
          helios_field_cameras_aimed_ok: boolean
          helios_field_completed_at: string | null
          helios_field_completed_by: string | null
          helios_field_completed_by_name: string | null
          helios_field_it_online_verified_ok: boolean
          helios_field_mast_lock_bolt_ok: boolean
          helios_field_panel_45deg_ok: boolean
          helios_field_panel_bolt_ok: boolean
          helios_field_ptz_secured_ok: boolean
          helios_field_pv_connected_ok: boolean
          helios_field_recording_ok: boolean
          helios_field_switch_pv_ok: boolean
          helios_field_tower_20ft_ok: boolean
          helios_field_unit_battery_on_ok: boolean
          helios_owner_verified_at: string | null
          helios_owner_verified_by: string | null
          helios_owner_verified_by_name: string | null
          helios_yard_ptz_wrapped_ok: boolean
          helios_yard_pv_connected_ok: boolean
          helios_yard_solar_charging_ok: boolean
          helios_yard_switch_pv_ok: boolean
          helios_yard_updates_status_ok: boolean
          helios_yard_victron_bluetooth_ok: boolean
          id: string
          mppt_tested_ok: boolean
          mppt_updated_ok: boolean
          prep_ticket_id: string
          service_tech_id: string
          service_tech_name: string
          solar_charging_ok: boolean
          solar_panel_count: number
          solar_panels_verified: boolean
          stand_tag: string | null
          stand_verified: boolean
          updated_at: string
        }
        Insert: {
          assignment_id?: string | null
          batteries_charged_ok?: boolean
          battery_configuration?: string | null
          battery_count?: number
          battery_description?: string | null
          cerbo_online_ok?: boolean | null
          cerbo_updated_ok?: boolean | null
          completed_at?: string | null
          handoff_accepted_at?: string | null
          handoff_accepted_by?: string | null
          handoff_accepted_by_name?: string | null
          helios_battery_box_charging_ok?: boolean | null
          helios_field_4_sandbags_ok?: boolean
          helios_field_box_mounted_ok?: boolean
          helios_field_cameras_aimed_ok?: boolean
          helios_field_completed_at?: string | null
          helios_field_completed_by?: string | null
          helios_field_completed_by_name?: string | null
          helios_field_it_online_verified_ok?: boolean
          helios_field_mast_lock_bolt_ok?: boolean
          helios_field_panel_45deg_ok?: boolean
          helios_field_panel_bolt_ok?: boolean
          helios_field_ptz_secured_ok?: boolean
          helios_field_pv_connected_ok?: boolean
          helios_field_recording_ok?: boolean
          helios_field_switch_pv_ok?: boolean
          helios_field_tower_20ft_ok?: boolean
          helios_field_unit_battery_on_ok?: boolean
          helios_owner_verified_at?: string | null
          helios_owner_verified_by?: string | null
          helios_owner_verified_by_name?: string | null
          helios_yard_ptz_wrapped_ok?: boolean
          helios_yard_pv_connected_ok?: boolean
          helios_yard_solar_charging_ok?: boolean
          helios_yard_switch_pv_ok?: boolean
          helios_yard_updates_status_ok?: boolean
          helios_yard_victron_bluetooth_ok?: boolean
          id?: string
          mppt_tested_ok?: boolean
          mppt_updated_ok?: boolean
          prep_ticket_id: string
          service_tech_id: string
          service_tech_name: string
          solar_charging_ok?: boolean
          solar_panel_count?: number
          solar_panels_verified?: boolean
          stand_tag?: string | null
          stand_verified?: boolean
          updated_at?: string
        }
        Update: {
          assignment_id?: string | null
          batteries_charged_ok?: boolean
          battery_configuration?: string | null
          battery_count?: number
          battery_description?: string | null
          cerbo_online_ok?: boolean | null
          cerbo_updated_ok?: boolean | null
          completed_at?: string | null
          handoff_accepted_at?: string | null
          handoff_accepted_by?: string | null
          handoff_accepted_by_name?: string | null
          helios_battery_box_charging_ok?: boolean | null
          helios_field_4_sandbags_ok?: boolean
          helios_field_box_mounted_ok?: boolean
          helios_field_cameras_aimed_ok?: boolean
          helios_field_completed_at?: string | null
          helios_field_completed_by?: string | null
          helios_field_completed_by_name?: string | null
          helios_field_it_online_verified_ok?: boolean
          helios_field_mast_lock_bolt_ok?: boolean
          helios_field_panel_45deg_ok?: boolean
          helios_field_panel_bolt_ok?: boolean
          helios_field_ptz_secured_ok?: boolean
          helios_field_pv_connected_ok?: boolean
          helios_field_recording_ok?: boolean
          helios_field_switch_pv_ok?: boolean
          helios_field_tower_20ft_ok?: boolean
          helios_field_unit_battery_on_ok?: boolean
          helios_owner_verified_at?: string | null
          helios_owner_verified_by?: string | null
          helios_owner_verified_by_name?: string | null
          helios_yard_ptz_wrapped_ok?: boolean
          helios_yard_pv_connected_ok?: boolean
          helios_yard_solar_charging_ok?: boolean
          helios_yard_switch_pv_ok?: boolean
          helios_yard_updates_status_ok?: boolean
          helios_yard_victron_bluetooth_ok?: boolean
          id?: string
          mppt_tested_ok?: boolean
          mppt_updated_ok?: boolean
          prep_ticket_id?: string
          service_tech_id?: string
          service_tech_name?: string
          solar_charging_ok?: boolean
          solar_panel_count?: number
          solar_panels_verified?: boolean
          stand_tag?: string | null
          stand_verified?: boolean
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "service_solar_checks_assignment_id_fkey"
            columns: ["assignment_id"]
            isOneToOne: false
            referencedRelation: "job_assignments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "service_solar_checks_prep_ticket_id_fkey"
            columns: ["prep_ticket_id"]
            isOneToOne: true
            referencedRelation: "prep_tickets"
            referencedColumns: ["id"]
          },
        ]
      }
      service_solar_evidence: {
        Row: {
          category: string
          created_at: string
          created_by: string
          created_by_name: string
          id: string
          kind: string
          original_name: string | null
          prep_ticket_id: string
          storage_path: string
        }
        Insert: {
          category: string
          created_at?: string
          created_by: string
          created_by_name: string
          id?: string
          kind: string
          original_name?: string | null
          prep_ticket_id: string
          storage_path: string
        }
        Update: {
          category?: string
          created_at?: string
          created_by?: string
          created_by_name?: string
          id?: string
          kind?: string
          original_name?: string | null
          prep_ticket_id?: string
          storage_path?: string
        }
        Relationships: [
          {
            foreignKeyName: "service_solar_evidence_prep_ticket_id_fkey"
            columns: ["prep_ticket_id"]
            isOneToOne: false
            referencedRelation: "prep_tickets"
            referencedColumns: ["id"]
          },
        ]
      }
      team_access_history: {
        Row: {
          action: string
          actor_id: string | null
          actor_name: string | null
          created_at: string
          detail: string | null
          id: string
          new_active: boolean | null
          new_role: string | null
          old_active: boolean | null
          old_role: string | null
          user_id: string | null
          user_name: string
        }
        Insert: {
          action: string
          actor_id?: string | null
          actor_name?: string | null
          created_at?: string
          detail?: string | null
          id?: string
          new_active?: boolean | null
          new_role?: string | null
          old_active?: boolean | null
          old_role?: string | null
          user_id?: string | null
          user_name: string
        }
        Update: {
          action?: string
          actor_id?: string | null
          actor_name?: string | null
          created_at?: string
          detail?: string | null
          id?: string
          new_active?: boolean | null
          new_role?: string | null
          old_active?: boolean | null
          old_role?: string | null
          user_id?: string | null
          user_name?: string
        }
        Relationships: []
      }
      technician_training_state: {
        Row: {
          last_help_opened_at: string | null
          updated_at: string
          user_id: string
          walkthrough_completed_at: string | null
        }
        Insert: {
          last_help_opened_at?: string | null
          updated_at?: string
          user_id: string
          walkthrough_completed_at?: string | null
        }
        Update: {
          last_help_opened_at?: string | null
          updated_at?: string
          user_id?: string
          walkthrough_completed_at?: string | null
        }
        Relationships: []
      }
      truck_spare_batteries: {
        Row: {
          accepted_at: string | null
          battery_type: string
          created_at: string
          equipment_type: string
          id: string
          it_checked_out_at: string | null
          it_checked_out_by: string | null
          it_checked_out_by_name: string | null
          prep_ticket_id: string
          prepared_by: string
          prepared_by_name: string
          qty_prepared: number
          qty_returned: number
          qty_used: number
          ready_ok: boolean
          resolved_at: string | null
          service_tech_id: string | null
          service_tech_name: string | null
          status: string
          ticket_no: string
          updated_at: string
        }
        Insert: {
          accepted_at?: string | null
          battery_type: string
          created_at?: string
          equipment_type: string
          id?: string
          it_checked_out_at?: string | null
          it_checked_out_by?: string | null
          it_checked_out_by_name?: string | null
          prep_ticket_id: string
          prepared_by: string
          prepared_by_name: string
          qty_prepared: number
          qty_returned?: number
          qty_used?: number
          ready_ok?: boolean
          resolved_at?: string | null
          service_tech_id?: string | null
          service_tech_name?: string | null
          status?: string
          ticket_no: string
          updated_at?: string
        }
        Update: {
          accepted_at?: string | null
          battery_type?: string
          created_at?: string
          equipment_type?: string
          id?: string
          it_checked_out_at?: string | null
          it_checked_out_by?: string | null
          it_checked_out_by_name?: string | null
          prep_ticket_id?: string
          prepared_by?: string
          prepared_by_name?: string
          qty_prepared?: number
          qty_returned?: number
          qty_used?: number
          ready_ok?: boolean
          resolved_at?: string | null
          service_tech_id?: string | null
          service_tech_name?: string | null
          status?: string
          ticket_no?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "truck_spare_batteries_prep_ticket_id_fkey"
            columns: ["prep_ticket_id"]
            isOneToOne: false
            referencedRelation: "prep_tickets"
            referencedColumns: ["id"]
          },
        ]
      }
      unit_registry: {
        Row: {
          created_at: string
          current_holder_id: string | null
          current_holder_name: string | null
          equipment_type: string | null
          last_event: string | null
          lifecycle_status: string
          prep_item_id: string | null
          prep_ticket_id: string | null
          ticket_no: string | null
          unit_key: string
          unit_tag: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          current_holder_id?: string | null
          current_holder_name?: string | null
          equipment_type?: string | null
          last_event?: string | null
          lifecycle_status: string
          prep_item_id?: string | null
          prep_ticket_id?: string | null
          ticket_no?: string | null
          unit_key: string
          unit_tag: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          current_holder_id?: string | null
          current_holder_name?: string | null
          equipment_type?: string | null
          last_event?: string | null
          lifecycle_status?: string
          prep_item_id?: string | null
          prep_ticket_id?: string | null
          ticket_no?: string | null
          unit_key?: string
          unit_tag?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "unit_registry_prep_item_id_fkey"
            columns: ["prep_item_id"]
            isOneToOne: false
            referencedRelation: "prep_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "unit_registry_prep_ticket_id_fkey"
            columns: ["prep_ticket_id"]
            isOneToOne: false
            referencedRelation: "prep_tickets"
            referencedColumns: ["id"]
          },
        ]
      }
      unit_returns: {
        Row: {
          accessories_ok: boolean | null
          batteries_ok: boolean | null
          completed_at: string | null
          created_at: string
          damage_notes: string | null
          electronics_ok: boolean | null
          equipment_type: string | null
          id: string
          intake_photo_paths: string[]
          it_received_at: string | null
          it_tech_id: string | null
          it_tech_name: string | null
          mhelp_confirmed_at: string | null
          mhelp_inventory_confirmed: boolean
          physical_condition_ok: boolean | null
          power_functions_ok: boolean | null
          prep_item_id: string | null
          prep_ticket_id: string | null
          return_notes: string | null
          return_photo_paths: string[]
          returned_at: string
          sd_cards_ok: boolean | null
          service_tech_id: string
          service_tech_name: string
          status: string
          tag_scan_at: string | null
          tag_scan_confidence: number | null
          tag_scan_detected: string | null
          tag_scan_engine: string | null
          tag_scan_expected: string | null
          tag_scan_status: string | null
          ticket_no: string
          unit_tag: string
          updated_at: string
        }
        Insert: {
          accessories_ok?: boolean | null
          batteries_ok?: boolean | null
          completed_at?: string | null
          created_at?: string
          damage_notes?: string | null
          electronics_ok?: boolean | null
          equipment_type?: string | null
          id?: string
          intake_photo_paths?: string[]
          it_received_at?: string | null
          it_tech_id?: string | null
          it_tech_name?: string | null
          mhelp_confirmed_at?: string | null
          mhelp_inventory_confirmed?: boolean
          physical_condition_ok?: boolean | null
          power_functions_ok?: boolean | null
          prep_item_id?: string | null
          prep_ticket_id?: string | null
          return_notes?: string | null
          return_photo_paths?: string[]
          returned_at?: string
          sd_cards_ok?: boolean | null
          service_tech_id: string
          service_tech_name: string
          status?: string
          tag_scan_at?: string | null
          tag_scan_confidence?: number | null
          tag_scan_detected?: string | null
          tag_scan_engine?: string | null
          tag_scan_expected?: string | null
          tag_scan_status?: string | null
          ticket_no: string
          unit_tag: string
          updated_at?: string
        }
        Update: {
          accessories_ok?: boolean | null
          batteries_ok?: boolean | null
          completed_at?: string | null
          created_at?: string
          damage_notes?: string | null
          electronics_ok?: boolean | null
          equipment_type?: string | null
          id?: string
          intake_photo_paths?: string[]
          it_received_at?: string | null
          it_tech_id?: string | null
          it_tech_name?: string | null
          mhelp_confirmed_at?: string | null
          mhelp_inventory_confirmed?: boolean
          physical_condition_ok?: boolean | null
          power_functions_ok?: boolean | null
          prep_item_id?: string | null
          prep_ticket_id?: string | null
          return_notes?: string | null
          return_photo_paths?: string[]
          returned_at?: string
          sd_cards_ok?: boolean | null
          service_tech_id?: string
          service_tech_name?: string
          status?: string
          tag_scan_at?: string | null
          tag_scan_confidence?: number | null
          tag_scan_detected?: string | null
          tag_scan_engine?: string | null
          tag_scan_expected?: string | null
          tag_scan_status?: string | null
          ticket_no?: string
          unit_tag?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "unit_returns_prep_item_id_fkey"
            columns: ["prep_item_id"]
            isOneToOne: false
            referencedRelation: "prep_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "unit_returns_prep_ticket_id_fkey"
            columns: ["prep_ticket_id"]
            isOneToOne: false
            referencedRelation: "prep_tickets"
            referencedColumns: ["id"]
          },
        ]
      }
      vision_action_audit: {
        Row: {
          action_type: string
          after_state: Json | null
          before_state: Json | null
          cancelled_at: string | null
          canonical_payload: Json
          confirmed_at: string | null
          conversation_id: string | null
          created_at: string
          error_text: string | null
          executable: boolean
          executed_at: string | null
          id: string
          requested_by: string
          requested_by_name: string
          requested_payload: Json
          requires_confirmation: boolean
          status: string
          ticket_no: string | null
          updated_at: string
          user_message: string | null
          validation: Json
        }
        Insert: {
          action_type: string
          after_state?: Json | null
          before_state?: Json | null
          cancelled_at?: string | null
          canonical_payload?: Json
          confirmed_at?: string | null
          conversation_id?: string | null
          created_at?: string
          error_text?: string | null
          executable?: boolean
          executed_at?: string | null
          id?: string
          requested_by: string
          requested_by_name: string
          requested_payload?: Json
          requires_confirmation?: boolean
          status?: string
          ticket_no?: string | null
          updated_at?: string
          user_message?: string | null
          validation?: Json
        }
        Update: {
          action_type?: string
          after_state?: Json | null
          before_state?: Json | null
          cancelled_at?: string | null
          canonical_payload?: Json
          confirmed_at?: string | null
          conversation_id?: string | null
          created_at?: string
          error_text?: string | null
          executable?: boolean
          executed_at?: string | null
          id?: string
          requested_by?: string
          requested_by_name?: string
          requested_payload?: Json
          requires_confirmation?: boolean
          status?: string
          ticket_no?: string | null
          updated_at?: string
          user_message?: string | null
          validation?: Json
        }
        Relationships: []
      }
      workflow_checkpoints: {
        Row: {
          after_data: Json | null
          before_data: Json | null
          changed_by: string | null
          changed_by_name: string | null
          created_at: string
          id: string
          operation: string
          record_id: string
          restored_at: string | null
          restored_by: string | null
          restored_by_name: string | null
          source_table: string
          ticket_no: string
        }
        Insert: {
          after_data?: Json | null
          before_data?: Json | null
          changed_by?: string | null
          changed_by_name?: string | null
          created_at?: string
          id?: string
          operation: string
          record_id: string
          restored_at?: string | null
          restored_by?: string | null
          restored_by_name?: string | null
          source_table: string
          ticket_no: string
        }
        Update: {
          after_data?: Json | null
          before_data?: Json | null
          changed_by?: string | null
          changed_by_name?: string | null
          created_at?: string
          id?: string
          operation?: string
          record_id?: string
          restored_at?: string | null
          restored_by?: string | null
          restored_by_name?: string | null
          source_table?: string
          ticket_no?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      accept_helios_handoff_v1: {
        Args: { p_prep_id: string; p_verifications: Json }
        Returns: undefined
      }
      actor_display_name: { Args: never; Returns: string }
      add_it_prep_item: {
        Args: {
          p_equipment_type: string
          p_prep_id: string
          p_purpose: string
          p_recon_battery_count?: number
        }
        Returns: string
      }
      add_it_truck_spare_unit: {
        Args: {
          p_equipment_type: string
          p_prep_id: string
          p_recon_battery_count?: number
        }
        Returns: string
      }
      admin_set_user_role: {
        Args: {
          p_active?: boolean
          p_role: Database["public"]["Enums"]["app_role"]
          p_user_id: string
        }
        Returns: undefined
      }
      claim_my_department_assignment: {
        Args: { p_assignment_id: string }
        Returns: string
      }
      close_prep_ticket: {
        Args: { p_prep_id: string; p_verifications: Json }
        Returns: undefined
      }
      complete_my_password_change: { Args: never; Returns: undefined }
      configure_it_prep_item: {
        Args: {
          p_equipment_type: string
          p_item_id: string
          p_purpose: string
          p_required_battery_count?: number
        }
        Returns: undefined
      }
      confirm_it_unit_photo_tag: {
        Args: { p_item_id: string; p_matches: boolean }
        Returns: undefined
      }
      confirm_service_parts: { Args: { p_prep_id: string }; Returns: undefined }
      create_it_prep: {
        Args: { p_requirements: Json; p_site: string; p_ticket_no: string }
        Returns: string
      }
      create_it_prep_shell: {
        Args: {
          p_expected_unit_count: number
          p_site: string
          p_ticket_no: string
        }
        Returns: string
      }
      create_it_prep_shell_v2: {
        Args: {
          p_battery_replacement_qty?: number
          p_camera_replacement_qty?: number
          p_expected_unit_count: number
          p_micro_sd_qty?: number
          p_sim_replacement_qty?: number
          p_site: string
          p_solar_panel_qty?: number
          p_ticket_no: string
        }
        Returns: string
      }
      create_it_prep_shell_v3: {
        Args: {
          p_battery_replacement_qty?: number
          p_camera_replacement_qty?: number
          p_equipment_manifest?: Json
          p_micro_sd_qty?: number
          p_requested_unit_count: number
          p_sim_replacement_qty?: number
          p_site: string
          p_solar_panel_qty?: number
          p_ticket_no: string
        }
        Returns: string
      }
      create_it_prep_shell_v4: {
        Args: {
          p_battery_replacement_qty?: number
          p_camera_replacement_qty?: number
          p_equipment_manifest?: Json
          p_micro_sd_qty?: number
          p_requested_unit_count: number
          p_sim_replacement_qty?: number
          p_site: string
          p_solar_panel_qty?: number
          p_ticket_no: string
          p_work_type?: string
        }
        Returns: string
      }
      current_app_role: {
        Args: never
        Returns: Database["public"]["Enums"]["app_role"]
      }
      delete_it_prep: { Args: { p_prep_id: string }; Returns: undefined }
      delete_it_prep_with_reason: {
        Args: { p_prep_id: string; p_reason: string }
        Returns: undefined
      }
      enqueue_app_notification: {
        Args: {
          p_assignment_id?: string
          p_body: string
          p_kind: string
          p_recipient: string
          p_ticket_no?: string
          p_title: string
          p_unit_tag?: string
        }
        Returns: undefined
      }
      get_tech_check_job_context_v1: {
        Args: { p_ticket_no: string }
        Returns: Json
      }
      it_checkout_truck_spare_battery: {
        Args: { p_spare_id: string }
        Returns: undefined
      }
      it_checkout_truck_spare_unit: {
        Args: { p_item_id: string }
        Returns: undefined
      }
      link_my_assignment_to_prep: {
        Args: { p_assignment_id: string; p_prep_id: string }
        Returns: undefined
      }
      log_tech_change: {
        Args: {
          p_is_test?: boolean
          p_kind: string
          p_reason: string
          p_text?: string
          p_ticket_no: string
        }
        Returns: undefined
      }
      mark_all_my_notifications_read: { Args: never; Returns: undefined }
      mark_my_notification_read: {
        Args: { p_notification_id: string }
        Returns: undefined
      }
      my_available_assignments: {
        Args: { p_role: string }
        Returns: {
          assigned_at: string
          assigned_by: string
          assigned_by_name: string
          assigned_role: string
          assignee_name: string
          assignee_user_id: string | null
          assignment_scope: string
          battery_replacement_qty: number
          camera_replacement_qty: number
          cancelled_at: string | null
          claimed_at: string | null
          completed_at: string | null
          equipment_manifest: Json
          id: string
          job_description: string | null
          micro_sd_qty: number
          notes: string | null
          prep_ticket_id: string | null
          requested_unit_count: number | null
          requires_it_handoff: boolean
          return_equipment_manifest: Json
          scheduled_for: string
          scheduled_time: string | null
          sim_replacement_qty: number
          site: string | null
          solar_panel_qty: number
          started_at: string | null
          status: string
          ticket_no: string
          unit_summary: string | null
          updated_at: string
          work_type: string
        }[]
        SetofOptions: {
          from: "*"
          to: "job_assignments"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      normalize_unit_key: { Args: { p_tag: string }; Returns: string }
      notification_enabled: {
        Args: { p_kind: string; p_user_id: string }
        Returns: boolean
      }
      owner_add_inventory_asset: {
        Args: {
          p_asset_category: string
          p_asset_type: string
          p_notes?: string
          p_unit_tag: string
        }
        Returns: string
      }
      owner_assign_inventory_asset: {
        Args: { p_unit_key: string; p_user_id: string }
        Returns: undefined
      }
      owner_assign_job: {
        Args: {
          p_assigned_role: string
          p_assignee_user_id: string
          p_notes?: string
          p_site: string
          p_ticket_no: string
        }
        Returns: string
      }
      owner_assign_job_v2: {
        Args: {
          p_assigned_role: string
          p_assignee_user_id: string
          p_job_description?: string
          p_notes?: string
          p_site: string
          p_ticket_no: string
          p_unit_summary?: string
        }
        Returns: string
      }
      owner_assign_job_v3: {
        Args: {
          p_assigned_role: string
          p_assignee_user_id: string
          p_battery_replacement_qty?: number
          p_camera_replacement_qty?: number
          p_job_description?: string
          p_micro_sd_qty?: number
          p_notes?: string
          p_sim_replacement_qty?: number
          p_site: string
          p_solar_panel_qty?: number
          p_ticket_no: string
          p_unit_summary?: string
        }
        Returns: string
      }
      owner_assign_job_v4: {
        Args: {
          p_assigned_role: string
          p_assignee_user_id?: string
          p_battery_replacement_qty?: number
          p_camera_replacement_qty?: number
          p_job_description?: string
          p_micro_sd_qty?: number
          p_notes?: string
          p_requires_it_handoff?: boolean
          p_sim_replacement_qty?: number
          p_site: string
          p_solar_panel_qty?: number
          p_ticket_no: string
          p_unit_summary?: string
        }
        Returns: string
      }
      owner_assign_job_v5: {
        Args: {
          p_assigned_role: string
          p_assignee_user_id?: string
          p_battery_replacement_qty?: number
          p_camera_replacement_qty?: number
          p_equipment_manifest?: Json
          p_job_description?: string
          p_micro_sd_qty?: number
          p_notes?: string
          p_requires_it_handoff?: boolean
          p_sim_replacement_qty?: number
          p_site: string
          p_solar_panel_qty?: number
          p_ticket_no: string
          p_unit_summary?: string
        }
        Returns: string
      }
      owner_assign_job_v6: {
        Args: {
          p_assigned_role: string
          p_assignee_user_id?: string
          p_battery_replacement_qty?: number
          p_camera_replacement_qty?: number
          p_equipment_manifest?: Json
          p_job_description?: string
          p_micro_sd_qty?: number
          p_notes?: string
          p_requested_unit_count?: number
          p_requires_it_handoff?: boolean
          p_sim_replacement_qty?: number
          p_site: string
          p_solar_panel_qty?: number
          p_ticket_no: string
          p_unit_summary?: string
        }
        Returns: string
      }
      owner_assign_job_v7: {
        Args: {
          p_assigned_role: string
          p_assignee_user_id?: string
          p_battery_replacement_qty?: number
          p_camera_replacement_qty?: number
          p_equipment_manifest?: Json
          p_job_description?: string
          p_micro_sd_qty?: number
          p_notes?: string
          p_requested_unit_count?: number
          p_requires_it_handoff?: boolean
          p_scheduled_for?: string
          p_sim_replacement_qty?: number
          p_site: string
          p_solar_panel_qty?: number
          p_ticket_no: string
          p_unit_summary?: string
        }
        Returns: string
      }
      owner_assign_job_v8: {
        Args: {
          p_assigned_role: string
          p_assignee_user_id?: string
          p_battery_replacement_qty?: number
          p_camera_replacement_qty?: number
          p_equipment_manifest?: Json
          p_job_description?: string
          p_micro_sd_qty?: number
          p_notes?: string
          p_requested_unit_count?: number
          p_requires_it_handoff?: boolean
          p_scheduled_for?: string
          p_sim_replacement_qty?: number
          p_site: string
          p_solar_panel_qty?: number
          p_ticket_no: string
          p_unit_summary?: string
          p_work_type?: string
        }
        Returns: string
      }
      owner_cancel_job_assignment: {
        Args: { p_assignment_id: string }
        Returns: undefined
      }
      owner_clear_test_data: { Args: never; Returns: undefined }
      owner_clear_workspaces: { Args: { p_reason: string }; Returns: undefined }
      owner_create_test_prep: {
        Args: { p_requirements: Json; p_site: string; p_ticket_no: string }
        Returns: string
      }
      owner_reassign_job_assignment: {
        Args: { p_assignee_user_id?: string; p_assignment_id: string }
        Returns: undefined
      }
      owner_remove_unit_return: {
        Args: { p_return_id: string }
        Returns: undefined
      }
      owner_restore_workflow_checkpoint: {
        Args: { p_checkpoint_id: string }
        Returns: undefined
      }
      owner_review_password_reset: {
        Args: { p_approve: boolean; p_request_id: string }
        Returns: undefined
      }
      owner_set_inventory_asset_status: {
        Args: { p_notes?: string; p_status: string; p_unit_key: string }
        Returns: undefined
      }
      owner_start_fresh: { Args: never; Returns: undefined }
      owner_verify_helios_install_v1: {
        Args: { p_prep_id: string }
        Returns: undefined
      }
      record_handoff_evidence: {
        Args: {
          p_kind: string
          p_original_name?: string
          p_prep_id: string
          p_stage: string
          p_storage_path: string
        }
        Returns: string
      }
      record_it_unit_ai_tag_scan: {
        Args: {
          p_confidence?: number
          p_detected?: string
          p_engine?: string
          p_item_id: string
          p_status: string
        }
        Returns: undefined
      }
      record_service_solar_evidence: {
        Args: {
          p_category: string
          p_kind: string
          p_original_name?: string
          p_prep_id: string
          p_storage_path: string
        }
        Returns: string
      }
      record_unit_handoff_evidence: {
        Args: {
          p_item_id: string
          p_kind: string
          p_original_name?: string
          p_prep_id: string
          p_stage: string
          p_storage_path: string
        }
        Returns: string
      }
      release_prep: { Args: { p_prep_id: string }; Returns: undefined }
      reopen_it_prep: { Args: { p_prep_id: string }; Returns: undefined }
      reopen_it_prep_with_reason: {
        Args: { p_prep_id: string; p_reason: string }
        Returns: undefined
      }
      require_role: {
        Args: { allowed: Database["public"]["Enums"]["app_role"][] }
        Returns: undefined
      }
      resolve_my_truck_spare_battery: {
        Args: { p_spare_id: string; p_used_qty: number }
        Returns: undefined
      }
      resolve_my_truck_spare_unit: {
        Args: { p_item_id: string; p_outcome: string }
        Returns: undefined
      }
      save_it_helios_deploy_checks_v1: {
        Args: {
          p_3x1tb_sd_ok: boolean
          p_alibi_vigilant_ok: boolean
          p_battery_120v_charged_ok: boolean
          p_battery_box_installed_ok: boolean
          p_camera_app_ok: boolean
          p_camera_router_programming_ok: boolean
          p_camera1_hardware_ok: boolean
          p_camera1_ports_ok: boolean
          p_camera2_hardware_ok: boolean
          p_camera2_ports_ok: boolean
          p_cameras_12v_ok: boolean
          p_cerbo_network_ok: boolean
          p_cerbo_vrm_ok: boolean
          p_customer_email_app_ok: boolean
          p_item_id: string
          p_monitoring_ok: boolean
          p_proxicast_4x4_ok: boolean
          p_ptz_assembly_ok: boolean
          p_ptz_plate_4bolts_ok: boolean
          p_ptz_ports_ok: boolean
          p_rear_unit_tag_ok: boolean
          p_recording_ok: boolean
          p_router_sim_ok: boolean
          p_sd_formatted_ok: boolean
          p_sim_ok: boolean
          p_speaker_24v_ok: boolean
          p_speaker_ports_ok: boolean
        }
        Returns: undefined
      }
      save_it_helios_port_checks: {
        Args: {
          p_camera1_ports_ok: boolean
          p_camera2_ports_ok: boolean
          p_item_id: string
          p_ptz_ports_ok: boolean
          p_speaker_ports_ok: boolean
        }
        Returns: undefined
      }
      save_it_prep_item_draft:
        | {
            Args: {
              p_batteries_charged_ok?: boolean
              p_battery_count: number
              p_camera_app_ok?: boolean
              p_functions_ok: boolean
              p_item_id: string
              p_monitoring_ok?: boolean
              p_mppt_tested_ok?: boolean
              p_mppt_updated_ok?: boolean
              p_power_ok: boolean
              p_pv_charging_ok?: boolean
              p_recording_ok?: boolean
              p_safe_ok: boolean
              p_sd_formatted_ok?: boolean
              p_sim_ok?: boolean
              p_solar_panels_match_ok?: boolean
              p_ticket_count_ok?: boolean
              p_ticket_item_match_ok?: boolean
              p_unit_tag: string
            }
            Returns: undefined
          }
        | {
            Args: {
              p_batteries_charged_ok?: boolean
              p_battery_count: number
              p_camera_app_ok?: boolean
              p_customer_email_app_ok?: boolean
              p_functions_ok: boolean
              p_item_id: string
              p_monitoring_ok?: boolean
              p_mppt_tested_ok?: boolean
              p_mppt_updated_ok?: boolean
              p_power_ok: boolean
              p_pv_charging_ok?: boolean
              p_recording_ok?: boolean
              p_safe_ok: boolean
              p_sd_formatted_ok?: boolean
              p_sim_ok?: boolean
              p_solar_panels_match_ok?: boolean
              p_ticket_count_ok?: boolean
              p_ticket_item_match_ok?: boolean
              p_unit_tag: string
            }
            Returns: undefined
          }
      save_it_truck_spare_battery: {
        Args: {
          p_battery_type: string
          p_equipment_type: string
          p_prep_id: string
          p_qty: number
          p_ready_ok: boolean
        }
        Returns: undefined
      }
      save_my_helios_field_install_v1: {
        Args: {
          p_4_sandbags_ok: boolean
          p_box_mounted_ok: boolean
          p_cameras_aimed_ok: boolean
          p_it_online_verified_ok: boolean
          p_mast_lock_bolt_ok: boolean
          p_panel_45deg_ok: boolean
          p_panel_bolt_ok: boolean
          p_prep_id: string
          p_ptz_secured_ok: boolean
          p_pv_connected_ok: boolean
          p_recording_ok: boolean
          p_switch_pv_ok: boolean
          p_tower_20ft_ok: boolean
          p_unit_battery_on_ok: boolean
        }
        Returns: undefined
      }
      save_my_notification_preferences: {
        Args: {
          p_browser_notifications: boolean
          p_equipment_ready_service: boolean
          p_new_assignments: boolean
          p_owner_actions: boolean
          p_returned_units: boolean
        }
        Returns: undefined
      }
      save_my_service_solar_check: {
        Args: {
          p_batteries_charged_ok: boolean
          p_battery_count: number
          p_cerbo_online_ok: boolean
          p_cerbo_updated_ok: boolean
          p_mppt_tested_ok: boolean
          p_mppt_updated_ok: boolean
          p_prep_id: string
          p_solar_charging_ok: boolean
          p_solar_panel_count: number
          p_solar_panels_verified: boolean
          p_stand_tag: string
          p_stand_verified: boolean
        }
        Returns: {
          assignment_id: string | null
          batteries_charged_ok: boolean
          battery_configuration: string | null
          battery_count: number
          battery_description: string | null
          cerbo_online_ok: boolean | null
          cerbo_updated_ok: boolean | null
          completed_at: string | null
          handoff_accepted_at: string | null
          handoff_accepted_by: string | null
          handoff_accepted_by_name: string | null
          helios_battery_box_charging_ok: boolean | null
          helios_field_4_sandbags_ok: boolean
          helios_field_box_mounted_ok: boolean
          helios_field_cameras_aimed_ok: boolean
          helios_field_completed_at: string | null
          helios_field_completed_by: string | null
          helios_field_completed_by_name: string | null
          helios_field_it_online_verified_ok: boolean
          helios_field_mast_lock_bolt_ok: boolean
          helios_field_panel_45deg_ok: boolean
          helios_field_panel_bolt_ok: boolean
          helios_field_ptz_secured_ok: boolean
          helios_field_pv_connected_ok: boolean
          helios_field_recording_ok: boolean
          helios_field_switch_pv_ok: boolean
          helios_field_tower_20ft_ok: boolean
          helios_field_unit_battery_on_ok: boolean
          helios_owner_verified_at: string | null
          helios_owner_verified_by: string | null
          helios_owner_verified_by_name: string | null
          helios_yard_ptz_wrapped_ok: boolean
          helios_yard_pv_connected_ok: boolean
          helios_yard_solar_charging_ok: boolean
          helios_yard_switch_pv_ok: boolean
          helios_yard_updates_status_ok: boolean
          helios_yard_victron_bluetooth_ok: boolean
          id: string
          mppt_tested_ok: boolean
          mppt_updated_ok: boolean
          prep_ticket_id: string
          service_tech_id: string
          service_tech_name: string
          solar_charging_ok: boolean
          solar_panel_count: number
          solar_panels_verified: boolean
          stand_tag: string | null
          stand_verified: boolean
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "service_solar_checks"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      save_my_service_solar_check_v2: {
        Args: {
          p_batteries_charged_ok: boolean
          p_battery_count: number
          p_cerbo_online_ok: boolean
          p_cerbo_updated_ok: boolean
          p_mppt_tested_ok: boolean
          p_mppt_updated_ok: boolean
          p_prep_id: string
          p_solar_charging_ok: boolean
          p_solar_panel_count: number
          p_solar_panels_verified: boolean
          p_stand_tag: string
          p_stand_verified: boolean
        }
        Returns: {
          assignment_id: string | null
          batteries_charged_ok: boolean
          battery_configuration: string | null
          battery_count: number
          battery_description: string | null
          cerbo_online_ok: boolean | null
          cerbo_updated_ok: boolean | null
          completed_at: string | null
          handoff_accepted_at: string | null
          handoff_accepted_by: string | null
          handoff_accepted_by_name: string | null
          helios_battery_box_charging_ok: boolean | null
          helios_field_4_sandbags_ok: boolean
          helios_field_box_mounted_ok: boolean
          helios_field_cameras_aimed_ok: boolean
          helios_field_completed_at: string | null
          helios_field_completed_by: string | null
          helios_field_completed_by_name: string | null
          helios_field_it_online_verified_ok: boolean
          helios_field_mast_lock_bolt_ok: boolean
          helios_field_panel_45deg_ok: boolean
          helios_field_panel_bolt_ok: boolean
          helios_field_ptz_secured_ok: boolean
          helios_field_pv_connected_ok: boolean
          helios_field_recording_ok: boolean
          helios_field_switch_pv_ok: boolean
          helios_field_tower_20ft_ok: boolean
          helios_field_unit_battery_on_ok: boolean
          helios_owner_verified_at: string | null
          helios_owner_verified_by: string | null
          helios_owner_verified_by_name: string | null
          helios_yard_ptz_wrapped_ok: boolean
          helios_yard_pv_connected_ok: boolean
          helios_yard_solar_charging_ok: boolean
          helios_yard_switch_pv_ok: boolean
          helios_yard_updates_status_ok: boolean
          helios_yard_victron_bluetooth_ok: boolean
          id: string
          mppt_tested_ok: boolean
          mppt_updated_ok: boolean
          prep_ticket_id: string
          service_tech_id: string
          service_tech_name: string
          solar_charging_ok: boolean
          solar_panel_count: number
          solar_panels_verified: boolean
          stand_tag: string | null
          stand_verified: boolean
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "service_solar_checks"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      save_my_service_solar_check_v3: {
        Args: {
          p_batteries_charged_ok: boolean
          p_battery_configuration: string
          p_cerbo_online_ok?: boolean
          p_cerbo_updated_ok?: boolean
          p_helios_battery_box_charging_ok?: boolean
          p_mppt_tested_ok: boolean
          p_mppt_updated_ok: boolean
          p_prep_id: string
          p_solar_charging_ok: boolean
          p_solar_panel_count: number
          p_solar_panels_verified: boolean
          p_stand_tag: string
        }
        Returns: {
          assignment_id: string | null
          batteries_charged_ok: boolean
          battery_configuration: string | null
          battery_count: number
          battery_description: string | null
          cerbo_online_ok: boolean | null
          cerbo_updated_ok: boolean | null
          completed_at: string | null
          handoff_accepted_at: string | null
          handoff_accepted_by: string | null
          handoff_accepted_by_name: string | null
          helios_battery_box_charging_ok: boolean | null
          helios_field_4_sandbags_ok: boolean
          helios_field_box_mounted_ok: boolean
          helios_field_cameras_aimed_ok: boolean
          helios_field_completed_at: string | null
          helios_field_completed_by: string | null
          helios_field_completed_by_name: string | null
          helios_field_it_online_verified_ok: boolean
          helios_field_mast_lock_bolt_ok: boolean
          helios_field_panel_45deg_ok: boolean
          helios_field_panel_bolt_ok: boolean
          helios_field_ptz_secured_ok: boolean
          helios_field_pv_connected_ok: boolean
          helios_field_recording_ok: boolean
          helios_field_switch_pv_ok: boolean
          helios_field_tower_20ft_ok: boolean
          helios_field_unit_battery_on_ok: boolean
          helios_owner_verified_at: string | null
          helios_owner_verified_by: string | null
          helios_owner_verified_by_name: string | null
          helios_yard_ptz_wrapped_ok: boolean
          helios_yard_pv_connected_ok: boolean
          helios_yard_solar_charging_ok: boolean
          helios_yard_switch_pv_ok: boolean
          helios_yard_updates_status_ok: boolean
          helios_yard_victron_bluetooth_ok: boolean
          id: string
          mppt_tested_ok: boolean
          mppt_updated_ok: boolean
          prep_ticket_id: string
          service_tech_id: string
          service_tech_name: string
          solar_charging_ok: boolean
          solar_panel_count: number
          solar_panels_verified: boolean
          stand_tag: string | null
          stand_verified: boolean
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "service_solar_checks"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      save_my_service_solar_check_v4: {
        Args: {
          p_batteries_charged_ok: boolean
          p_battery_configuration: string
          p_cerbo_online_ok?: boolean
          p_cerbo_updated_ok?: boolean
          p_helios_battery_box_charging_ok?: boolean
          p_helios_yard_ptz_wrapped_ok?: boolean
          p_helios_yard_pv_connected_ok?: boolean
          p_helios_yard_solar_charging_ok?: boolean
          p_helios_yard_switch_pv_ok?: boolean
          p_helios_yard_updates_status_ok?: boolean
          p_helios_yard_victron_bluetooth_ok?: boolean
          p_mppt_tested_ok: boolean
          p_mppt_updated_ok: boolean
          p_prep_id: string
          p_solar_charging_ok: boolean
          p_solar_panel_count: number
          p_solar_panels_verified: boolean
          p_stand_tag: string
        }
        Returns: {
          assignment_id: string | null
          batteries_charged_ok: boolean
          battery_configuration: string | null
          battery_count: number
          battery_description: string | null
          cerbo_online_ok: boolean | null
          cerbo_updated_ok: boolean | null
          completed_at: string | null
          handoff_accepted_at: string | null
          handoff_accepted_by: string | null
          handoff_accepted_by_name: string | null
          helios_battery_box_charging_ok: boolean | null
          helios_field_4_sandbags_ok: boolean
          helios_field_box_mounted_ok: boolean
          helios_field_cameras_aimed_ok: boolean
          helios_field_completed_at: string | null
          helios_field_completed_by: string | null
          helios_field_completed_by_name: string | null
          helios_field_it_online_verified_ok: boolean
          helios_field_mast_lock_bolt_ok: boolean
          helios_field_panel_45deg_ok: boolean
          helios_field_panel_bolt_ok: boolean
          helios_field_ptz_secured_ok: boolean
          helios_field_pv_connected_ok: boolean
          helios_field_recording_ok: boolean
          helios_field_switch_pv_ok: boolean
          helios_field_tower_20ft_ok: boolean
          helios_field_unit_battery_on_ok: boolean
          helios_owner_verified_at: string | null
          helios_owner_verified_by: string | null
          helios_owner_verified_by_name: string | null
          helios_yard_ptz_wrapped_ok: boolean
          helios_yard_pv_connected_ok: boolean
          helios_yard_solar_charging_ok: boolean
          helios_yard_switch_pv_ok: boolean
          helios_yard_updates_status_ok: boolean
          helios_yard_victron_bluetooth_ok: boolean
          id: string
          mppt_tested_ok: boolean
          mppt_updated_ok: boolean
          prep_ticket_id: string
          service_tech_id: string
          service_tech_name: string
          solar_charging_ok: boolean
          solar_panel_count: number
          solar_panels_verified: boolean
          stand_tag: string | null
          stand_verified: boolean
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "service_solar_checks"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      service_solar_context: {
        Args: { p_prep_id: string }
        Returns: {
          assignment_id: string
          has_helios: boolean
          need_solar: boolean
          need_stand: boolean
        }[]
      }
      service_solar_context_v2: {
        Args: { p_prep_id: string }
        Returns: {
          assignment_id: string
          expected_batteries: number
          expected_solar_panels: number
          has_helios: boolean
          has_ranger: boolean
          need_solar: boolean
          need_stand: boolean
          ranger_count: number
          solar_spotter_count: number
        }[]
      }
      set_my_job_assignment_status: {
        Args: { p_assignment_id: string; p_status: string }
        Returns: undefined
      }
      set_prep_parts: {
        Args: {
          p_battery_replacement_qty: number
          p_camera_replacement_qty: number
          p_micro_sd_qty: number
          p_prep_id: string
          p_sim_replacement_qty: number
          p_solar_panel_qty: number
        }
        Returns: undefined
      }
      submit_morning_check: {
        Args: {
          p_closed_ticket_nos?: string[]
          p_mhelp_reviewed: boolean
          p_taking_trailer: boolean
          p_trailer_checks: Json
          p_truck_checks: Json
        }
        Returns: string
      }
      update_it_prep_item_definition: {
        Args: {
          p_equipment_type: string
          p_item_id: string
          p_purpose: string
          p_recon_battery_count?: number
        }
        Returns: undefined
      }
      update_it_prep_structure: {
        Args: {
          p_items: Json
          p_prep_id: string
          p_site: string
          p_ticket_no: string
        }
        Returns: undefined
      }
      verify_and_release_prep_item: {
        Args: {
          p_battery_count: number
          p_functions_ok: boolean
          p_item_id: string
          p_power_ok: boolean
          p_safe_ok: boolean
          p_unit_tag: string
        }
        Returns: Json
      }
      verify_delivery_item_checks:
        | {
            Args: {
              p_batteries_charged_ok: boolean
              p_camera_app_ok: boolean
              p_item_id: string
              p_monitoring_ok: boolean
              p_sim_ok: boolean
              p_ticket_count_ok: boolean
            }
            Returns: undefined
          }
        | {
            Args: {
              p_batteries_charged_ok: boolean
              p_camera_app_ok: boolean
              p_item_id: string
              p_monitoring_ok: boolean
              p_recording_ok: boolean
              p_sd_formatted_ok: boolean
              p_sim_ok: boolean
              p_ticket_count_ok: boolean
            }
            Returns: undefined
          }
        | {
            Args: {
              p_batteries_charged_ok: boolean
              p_camera_app_ok: boolean
              p_customer_email_app_ok: boolean
              p_item_id: string
              p_monitoring_ok: boolean
              p_recording_ok: boolean
              p_sd_formatted_ok: boolean
              p_sim_ok: boolean
              p_ticket_count_ok: boolean
            }
            Returns: undefined
          }
      verify_prep_item: {
        Args: {
          p_battery_count: number
          p_functions_ok: boolean
          p_item_id: string
          p_power_ok: boolean
          p_safe_ok: boolean
          p_unit_tag: string
        }
        Returns: undefined
      }
      vision_action_job_snapshot_v1: {
        Args: { p_ticket_no: string }
        Returns: Json
      }
      vision_cancel_action_v1: { Args: { p_action_id: string }; Returns: Json }
      vision_execute_action_v1: { Args: { p_action_id: string }; Returns: Json }
      vision_prepare_action_v1: {
        Args: {
          p_action: Json
          p_conversation_id: string
          p_user_message?: string
        }
        Returns: Json
      }
    }
    Enums: {
      app_role: "pending" | "it" | "service" | "owner"
      prep_purpose: "BACKUP" | "SWAP" | "DELIVERY"
      prep_status: "draft" | "released" | "closed"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: ["pending", "it", "service", "owner"],
      prep_purpose: ["BACKUP", "SWAP", "DELIVERY"],
      prep_status: ["draft", "released", "closed"],
    },
  },
} as const
