
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type Database = {
  
  "graphql_public": {
          Tables: {
            [_ in never]: never
          }
          Views: {
            [_ in never]: never
          }
          Functions: {
            "graphql":
{ Args: { "extensions"?: Json,"operationName"?: string,"query"?: string,"variables"?: Json }; Returns: Json
                           }
          }
          Enums: {
            [_ in never]: never
          }
          CompositeTypes: {
            [_ in never]: never
          }
        },"public": {
          Tables: {
            "access_rules": {
                  Row: {
                    "created_at": string,"created_by": string | null,"id": string,"kind": string,"role": Database["public"]['Enums']["app_role"],"value": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"created_by"?: string | null,"id"?: string,"kind": string,"role": Database["public"]['Enums']["app_role"],"value": string
                  }
                  Update: {
                    "created_at"?: string,"created_by"?: string | null,"id"?: string,"kind"?: string,"role"?: Database["public"]['Enums']["app_role"],"value"?: string
                  }
                  Relationships: [
                    
                  ]
                },"alert_settings": {
                  Row: {
                    "coverage_threshold": number,"email_from": string | null,"email_to": (string)[],"enabled": boolean,"id": number,"resend_secret_id": string | null,"stale_minutes": number,"updated_at": string | null,"updated_by": string | null,"webhook_hint": string | null,"webhook_secret_id": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "coverage_threshold"?: number,"email_from"?: string | null,"email_to"?: (string)[],"enabled"?: boolean,"id"?: number,"resend_secret_id"?: string | null,"stale_minutes"?: number,"updated_at"?: string | null,"updated_by"?: string | null,"webhook_hint"?: string | null,"webhook_secret_id"?: string | null
                  }
                  Update: {
                    "coverage_threshold"?: number,"email_from"?: string | null,"email_to"?: (string)[],"enabled"?: boolean,"id"?: number,"resend_secret_id"?: string | null,"stale_minutes"?: number,"updated_at"?: string | null,"updated_by"?: string | null,"webhook_hint"?: string | null,"webhook_secret_id"?: string | null
                  }
                  Relationships: [
                    
                  ]
                },"alerts": {
                  Row: {
                    "attempts": number,"body": string,"created_at": string,"data": Json | null,"dedupe_key": string,"id": number,"kind": string,"last_error": string | null,"sent_at": string | null,"tenant_id": string | null,"title": string
                  }
                  ComputedFields: never
                  Insert: {
                    "attempts"?: number,"body": string,"created_at"?: string,"data"?: Json | null,"dedupe_key": string,"id"?: never,"kind": string,"last_error"?: string | null,"sent_at"?: string | null,"tenant_id"?: string | null,"title": string
                  }
                  Update: {
                    "attempts"?: number,"body"?: string,"created_at"?: string,"data"?: Json | null,"dedupe_key"?: string,"id"?: never,"kind"?: string,"last_error"?: string | null,"sent_at"?: string | null,"tenant_id"?: string | null,"title"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "alerts_tenant_id_fkey"
      columns: ["tenant_id"]
isOneToOne: false
      referencedRelation: "tenants"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "alerts_tenant_id_fkey"
      columns: ["tenant_id"]
isOneToOne: false
      referencedRelation: "v_tenant_overview"
      referencedColumns: ["id"]
    }
                  ]
                },"api_budget": {
                  Row: {
                    "minute": string,"runs": number,"tenant_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "minute": string,"runs"?: number,"tenant_id": string
                  }
                  Update: {
                    "minute"?: string,"runs"?: number,"tenant_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "api_budget_tenant_id_fkey"
      columns: ["tenant_id"]
isOneToOne: false
      referencedRelation: "tenants"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "api_budget_tenant_id_fkey"
      columns: ["tenant_id"]
isOneToOne: false
      referencedRelation: "v_tenant_overview"
      referencedColumns: ["id"]
    }
                  ]
                },"audit_log": {
                  Row: {
                    "action": string,"created_at": string,"data": Json | null,"id": number,"target": string | null,"user_id": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "action": string,"created_at"?: string,"data"?: Json | null,"id"?: never,"target"?: string | null,"user_id"?: string | null
                  }
                  Update: {
                    "action"?: string,"created_at"?: string,"data"?: Json | null,"id"?: never,"target"?: string | null,"user_id"?: string | null
                  }
                  Relationships: [
                    
                  ]
                },"capability_probes": {
                  Row: {
                    "computer_id": string,"error": string | null,"finished_at": string | null,"id": string,"platform": Database["public"]['Enums']["platform"],"provider": Database["public"]['Enums']["query_provider"],"requested_by": string | null,"sophos_run_id": string | null,"started_at": string,"status": string,"table_count": number | null,"tenant_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "computer_id": string,"error"?: string | null,"finished_at"?: string | null,"id"?: string,"platform": Database["public"]['Enums']["platform"],"provider": Database["public"]['Enums']["query_provider"],"requested_by"?: string | null,"sophos_run_id"?: string | null,"started_at"?: string,"status"?: string,"table_count"?: number | null,"tenant_id": string
                  }
                  Update: {
                    "computer_id"?: string,"error"?: string | null,"finished_at"?: string | null,"id"?: string,"platform"?: Database["public"]['Enums']["platform"],"provider"?: Database["public"]['Enums']["query_provider"],"requested_by"?: string | null,"sophos_run_id"?: string | null,"started_at"?: string,"status"?: string,"table_count"?: number | null,"tenant_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "capability_probes_computer_id_tenant_id_fkey"
      columns: ["computer_id","tenant_id"]
isOneToOne: false
      referencedRelation: "computers"
      referencedColumns: ["id","tenant_id"]
    },{
      foreignKeyName: "capability_probes_computer_id_tenant_id_fkey"
      columns: ["computer_id","tenant_id"]
isOneToOne: false
      referencedRelation: "v_computer_list"
      referencedColumns: ["id","tenant_id"]
    },{
      foreignKeyName: "capability_probes_computer_id_tenant_id_fkey"
      columns: ["computer_id","tenant_id"]
isOneToOne: false
      referencedRelation: "v_computers"
      referencedColumns: ["id","tenant_id"]
    }
                  ]
                },"categories_cache": {
                  Row: {
                    "attention_level": Database["public"]['Enums']["attention_level"] | null,"deprecated": boolean,"description": string | null,"hub_id": string | null,"level": number | null,"name": string,"parent_slug": string | null,"revision": number,"seq": number,"slug": string,"sophos_firewall_category": string | null,"synced_at": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "attention_level"?: Database["public"]['Enums']["attention_level"] | null,"deprecated"?: boolean,"description"?: string | null,"hub_id"?: string | null,"level"?: never,"name": string,"parent_slug"?: string | null,"revision"?: number,"seq"?: number,"slug": string,"sophos_firewall_category"?: string | null,"synced_at"?: string | null
                  }
                  Update: {
                    "attention_level"?: Database["public"]['Enums']["attention_level"] | null,"deprecated"?: boolean,"description"?: string | null,"hub_id"?: string | null,"level"?: never,"name"?: string,"parent_slug"?: string | null,"revision"?: number,"seq"?: number,"slug"?: string,"sophos_firewall_category"?: string | null,"synced_at"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "categories_cache_parent_slug_fkey"
      columns: ["parent_slug"]
isOneToOne: false
      referencedRelation: "categories_cache"
      referencedColumns: ["slug"]
    },{
      foreignKeyName: "categories_cache_parent_slug_fkey"
      columns: ["parent_slug"]
isOneToOne: false
      referencedRelation: "title_classification"
      referencedColumns: ["category_slug"]
    },{
      foreignKeyName: "categories_cache_parent_slug_fkey"
      columns: ["parent_slug"]
isOneToOne: false
      referencedRelation: "title_summary"
      referencedColumns: ["category_slug"]
    },{
      foreignKeyName: "categories_cache_parent_slug_fkey"
      columns: ["parent_slug"]
isOneToOne: false
      referencedRelation: "v_change_log"
      referencedColumns: ["category_slug"]
    },{
      foreignKeyName: "categories_cache_parent_slug_fkey"
      columns: ["parent_slug"]
isOneToOne: false
      referencedRelation: "v_installation_details"
      referencedColumns: ["category_slug"]
    },{
      foreignKeyName: "categories_cache_parent_slug_fkey"
      columns: ["parent_slug"]
isOneToOne: false
      referencedRelation: "v_title_summary"
      referencedColumns: ["category_slug"]
    }
                  ]
                },"change_events": {
                  Row: {
                    "change": Database["public"]['Enums']["change_type"],"computer_id": string,"detected_at": string,"domain": Database["public"]['Enums']["inventory_domain"],"from_version": string | null,"id": string,"installation_id": string | null,"snapshot_id": string,"tenant_id": string,"title_id": string,"to_version": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "change": Database["public"]['Enums']["change_type"],"computer_id": string,"detected_at"?: string,"domain": Database["public"]['Enums']["inventory_domain"],"from_version"?: string | null,"id"?: string,"installation_id"?: string | null,"snapshot_id": string,"tenant_id": string,"title_id": string,"to_version"?: string | null
                  }
                  Update: {
                    "change"?: Database["public"]['Enums']["change_type"],"computer_id"?: string,"detected_at"?: string,"domain"?: Database["public"]['Enums']["inventory_domain"],"from_version"?: string | null,"id"?: string,"installation_id"?: string | null,"snapshot_id"?: string,"tenant_id"?: string,"title_id"?: string,"to_version"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "change_events_computer_id_tenant_id_fkey"
      columns: ["computer_id","tenant_id"]
isOneToOne: false
      referencedRelation: "computers"
      referencedColumns: ["id","tenant_id"]
    },{
      foreignKeyName: "change_events_computer_id_tenant_id_fkey"
      columns: ["computer_id","tenant_id"]
isOneToOne: false
      referencedRelation: "v_computer_list"
      referencedColumns: ["id","tenant_id"]
    },{
      foreignKeyName: "change_events_computer_id_tenant_id_fkey"
      columns: ["computer_id","tenant_id"]
isOneToOne: false
      referencedRelation: "v_computers"
      referencedColumns: ["id","tenant_id"]
    },{
      foreignKeyName: "change_events_installation_id_fkey"
      columns: ["installation_id"]
isOneToOne: false
      referencedRelation: "current_installations"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "change_events_installation_id_fkey"
      columns: ["installation_id"]
isOneToOne: false
      referencedRelation: "installations"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "change_events_installation_id_fkey"
      columns: ["installation_id"]
isOneToOne: false
      referencedRelation: "v_installation_details"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "change_events_installation_id_fkey"
      columns: ["installation_id"]
isOneToOne: false
      referencedRelation: "v_installations"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "change_events_snapshot_id_fkey"
      columns: ["snapshot_id"]
isOneToOne: false
      referencedRelation: "snapshots"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "change_events_title_id_fkey"
      columns: ["title_id"]
isOneToOne: false
      referencedRelation: "software_titles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "change_events_title_id_fkey"
      columns: ["title_id"]
isOneToOne: false
      referencedRelation: "title_classification"
      referencedColumns: ["title_id"]
    },{
      foreignKeyName: "change_events_title_id_fkey"
      columns: ["title_id"]
isOneToOne: false
      referencedRelation: "title_products"
      referencedColumns: ["title_id"]
    },{
      foreignKeyName: "change_events_title_id_fkey"
      columns: ["title_id"]
isOneToOne: false
      referencedRelation: "title_summary"
      referencedColumns: ["title_id"]
    },{
      foreignKeyName: "change_events_title_id_fkey"
      columns: ["title_id"]
isOneToOne: false
      referencedRelation: "v_title_summary"
      referencedColumns: ["title_id"]
    }
                  ]
                },"collector_lease": {
                  Row: {
                    "expires_at": string | null,"holder": string | null,"id": number
                  }
                  ComputedFields: never
                  Insert: {
                    "expires_at"?: string | null,"holder"?: string | null,"id"?: number
                  }
                  Update: {
                    "expires_at"?: string | null,"holder"?: string | null,"id"?: number
                  }
                  Relationships: [
                    
                  ]
                },"collector_logs": {
                  Row: {
                    "created_at": string,"data": Json | null,"id": number,"level": string,"message": string,"step": string,"tenant_id": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"data"?: Json | null,"id"?: never,"level"?: string,"message": string,"step": string,"tenant_id"?: string | null
                  }
                  Update: {
                    "created_at"?: string,"data"?: Json | null,"id"?: never,"level"?: string,"message"?: string,"step"?: string,"tenant_id"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "collector_logs_tenant_id_fkey"
      columns: ["tenant_id"]
isOneToOne: false
      referencedRelation: "tenants"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "collector_logs_tenant_id_fkey"
      columns: ["tenant_id"]
isOneToOne: false
      referencedRelation: "v_tenant_overview"
      referencedColumns: ["id"]
    }
                  ]
                },"computers": {
                  Row: {
                    "associated_user": string | null,"created_at": string,"endpoint_type": string | null,"health": string | null,"hostname": string,"id": string,"last_collected_at": string | null,"last_seen_at": string | null,"missing_syncs": number,"os_build": string | null,"os_name": string | null,"os_version": string | null,"platform": Database["public"]['Enums']["platform"],"retired_at": string | null,"sophos_endpoint_id": string,"tenant_id": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "associated_user"?: string | null,"created_at"?: string,"endpoint_type"?: string | null,"health"?: string | null,"hostname": string,"id"?: string,"last_collected_at"?: string | null,"last_seen_at"?: string | null,"missing_syncs"?: number,"os_build"?: string | null,"os_name"?: string | null,"os_version"?: string | null,"platform": Database["public"]['Enums']["platform"],"retired_at"?: string | null,"sophos_endpoint_id": string,"tenant_id": string,"updated_at"?: string
                  }
                  Update: {
                    "associated_user"?: string | null,"created_at"?: string,"endpoint_type"?: string | null,"health"?: string | null,"hostname"?: string,"id"?: string,"last_collected_at"?: string | null,"last_seen_at"?: string | null,"missing_syncs"?: number,"os_build"?: string | null,"os_name"?: string | null,"os_version"?: string | null,"platform"?: Database["public"]['Enums']["platform"],"retired_at"?: string | null,"sophos_endpoint_id"?: string,"tenant_id"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "computers_tenant_id_fkey"
      columns: ["tenant_id"]
isOneToOne: false
      referencedRelation: "tenants"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "computers_tenant_id_fkey"
      columns: ["tenant_id"]
isOneToOne: false
      referencedRelation: "v_tenant_overview"
      referencedColumns: ["id"]
    }
                  ]
                },"dictionary_cache": {
                  Row: {
                    "attention_level": Database["public"]['Enums']["attention_level"],"canonical_name": string,"category_slug": string,"confidence": number | null,"description": string | null,"hub_seq": number,"kind": Database["public"]['Enums']["title_kind"],"match_key": string,"method": string,"product_key": string | null,"revision": number,"source": string,"status": string,"synced_at": string,"vendor": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "attention_level": Database["public"]['Enums']["attention_level"],"canonical_name": string,"category_slug": string,"confidence"?: number | null,"description"?: string | null,"hub_seq"?: number,"kind": Database["public"]['Enums']["title_kind"],"match_key": string,"method": string,"product_key"?: string | null,"revision"?: number,"source": string,"status"?: string,"synced_at"?: string,"vendor"?: string | null
                  }
                  Update: {
                    "attention_level"?: Database["public"]['Enums']["attention_level"],"canonical_name"?: string,"category_slug"?: string,"confidence"?: number | null,"description"?: string | null,"hub_seq"?: number,"kind"?: Database["public"]['Enums']["title_kind"],"match_key"?: string,"method"?: string,"product_key"?: string | null,"revision"?: number,"source"?: string,"status"?: string,"synced_at"?: string,"vendor"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "dictionary_cache_category_slug_fkey"
      columns: ["category_slug"]
isOneToOne: false
      referencedRelation: "categories_cache"
      referencedColumns: ["slug"]
    },{
      foreignKeyName: "dictionary_cache_category_slug_fkey"
      columns: ["category_slug"]
isOneToOne: false
      referencedRelation: "title_classification"
      referencedColumns: ["category_slug"]
    },{
      foreignKeyName: "dictionary_cache_category_slug_fkey"
      columns: ["category_slug"]
isOneToOne: false
      referencedRelation: "title_summary"
      referencedColumns: ["category_slug"]
    },{
      foreignKeyName: "dictionary_cache_category_slug_fkey"
      columns: ["category_slug"]
isOneToOne: false
      referencedRelation: "v_change_log"
      referencedColumns: ["category_slug"]
    },{
      foreignKeyName: "dictionary_cache_category_slug_fkey"
      columns: ["category_slug"]
isOneToOne: false
      referencedRelation: "v_installation_details"
      referencedColumns: ["category_slug"]
    },{
      foreignKeyName: "dictionary_cache_category_slug_fkey"
      columns: ["category_slug"]
isOneToOne: false
      referencedRelation: "v_title_summary"
      referencedColumns: ["category_slug"]
    }
                  ]
                },"hardware_versions": {
                  Row: {
                    "attrs": NonNullable<Json>,"computer_id": string,"domain": Database["public"]['Enums']["inventory_domain"],"id": string,"item_key": string,"row_hash": string,"snapshot_id": string | null,"tenant_id": string,"valid_from": string,"valid_to": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "attrs": NonNullable<Json>,"computer_id": string,"domain": Database["public"]['Enums']["inventory_domain"],"id"?: string,"item_key"?: string,"row_hash": string,"snapshot_id"?: string | null,"tenant_id": string,"valid_from": string,"valid_to"?: string | null
                  }
                  Update: {
                    "attrs"?: NonNullable<Json>,"computer_id"?: string,"domain"?: Database["public"]['Enums']["inventory_domain"],"id"?: string,"item_key"?: string,"row_hash"?: string,"snapshot_id"?: string | null,"tenant_id"?: string,"valid_from"?: string,"valid_to"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "hardware_versions_computer_id_tenant_id_fkey"
      columns: ["computer_id","tenant_id"]
isOneToOne: false
      referencedRelation: "computers"
      referencedColumns: ["id","tenant_id"]
    },{
      foreignKeyName: "hardware_versions_computer_id_tenant_id_fkey"
      columns: ["computer_id","tenant_id"]
isOneToOne: false
      referencedRelation: "v_computer_list"
      referencedColumns: ["id","tenant_id"]
    },{
      foreignKeyName: "hardware_versions_computer_id_tenant_id_fkey"
      columns: ["computer_id","tenant_id"]
isOneToOne: false
      referencedRelation: "v_computers"
      referencedColumns: ["id","tenant_id"]
    },{
      foreignKeyName: "hardware_versions_snapshot_id_fkey"
      columns: ["snapshot_id"]
isOneToOne: false
      referencedRelation: "snapshots"
      referencedColumns: ["id"]
    }
                  ]
                },"hub_connection": {
                  Row: {
                    "configured_at": string | null,"configured_by": string | null,"failures": number,"id": number,"key_hint": string | null,"key_secret_id": string | null,"last_attempt_at": string | null,"last_error": string | null,"last_seq": number,"next_attempt_at": string | null,"share_unknown_titles": boolean,"synced_at": string | null,"url": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "configured_at"?: string | null,"configured_by"?: string | null,"failures"?: number,"id"?: number,"key_hint"?: string | null,"key_secret_id"?: string | null,"last_attempt_at"?: string | null,"last_error"?: string | null,"last_seq"?: number,"next_attempt_at"?: string | null,"share_unknown_titles"?: boolean,"synced_at"?: string | null,"url"?: string | null
                  }
                  Update: {
                    "configured_at"?: string | null,"configured_by"?: string | null,"failures"?: number,"id"?: number,"key_hint"?: string | null,"key_secret_id"?: string | null,"last_attempt_at"?: string | null,"last_error"?: string | null,"last_seq"?: number,"next_attempt_at"?: string | null,"share_unknown_titles"?: boolean,"synced_at"?: string | null,"url"?: string | null
                  }
                  Relationships: [
                    
                  ]
                },"hub_submissions": {
                  Row: {
                    "description": string | null,"first_seen": string,"id": string,"kind": Database["public"]['Enums']["title_kind"],"match_key": string,"name": string,"sent_at": string | null,"source": string,"vendor": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "description"?: string | null,"first_seen"?: string,"id"?: string,"kind": Database["public"]['Enums']["title_kind"],"match_key": string,"name": string,"sent_at"?: string | null,"source": string,"vendor"?: string | null
                  }
                  Update: {
                    "description"?: string | null,"first_seen"?: string,"id"?: string,"kind"?: Database["public"]['Enums']["title_kind"],"match_key"?: string,"name"?: string,"sent_at"?: string | null,"source"?: string,"vendor"?: string | null
                  }
                  Relationships: [
                    
                  ]
                },"installations": {
                  Row: {
                    "attrs": NonNullable<Json>,"computer_id": string,"domain": Database["public"]['Enums']["inventory_domain"],"first_seen_snapshot": string | null,"id": string,"last_seen_snapshot": string | null,"path": string | null,"query_name": string,"row_hash": string,"scope_key": string,"tenant_id": string,"title_id": string,"username": string | null,"valid_from": string,"valid_to": string | null,"version": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "attrs"?: NonNullable<Json>,"computer_id": string,"domain": Database["public"]['Enums']["inventory_domain"],"first_seen_snapshot"?: string | null,"id"?: string,"last_seen_snapshot"?: string | null,"path"?: string | null,"query_name": string,"row_hash": string,"scope_key"?: string,"tenant_id": string,"title_id": string,"username"?: string | null,"valid_from": string,"valid_to"?: string | null,"version"?: string | null
                  }
                  Update: {
                    "attrs"?: NonNullable<Json>,"computer_id"?: string,"domain"?: Database["public"]['Enums']["inventory_domain"],"first_seen_snapshot"?: string | null,"id"?: string,"last_seen_snapshot"?: string | null,"path"?: string | null,"query_name"?: string,"row_hash"?: string,"scope_key"?: string,"tenant_id"?: string,"title_id"?: string,"username"?: string | null,"valid_from"?: string,"valid_to"?: string | null,"version"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "installations_computer_id_tenant_id_fkey"
      columns: ["computer_id","tenant_id"]
isOneToOne: false
      referencedRelation: "computers"
      referencedColumns: ["id","tenant_id"]
    },{
      foreignKeyName: "installations_computer_id_tenant_id_fkey"
      columns: ["computer_id","tenant_id"]
isOneToOne: false
      referencedRelation: "v_computer_list"
      referencedColumns: ["id","tenant_id"]
    },{
      foreignKeyName: "installations_computer_id_tenant_id_fkey"
      columns: ["computer_id","tenant_id"]
isOneToOne: false
      referencedRelation: "v_computers"
      referencedColumns: ["id","tenant_id"]
    },{
      foreignKeyName: "installations_first_seen_snapshot_fkey"
      columns: ["first_seen_snapshot"]
isOneToOne: false
      referencedRelation: "snapshots"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "installations_last_seen_snapshot_fkey"
      columns: ["last_seen_snapshot"]
isOneToOne: false
      referencedRelation: "snapshots"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "installations_title_id_fkey"
      columns: ["title_id"]
isOneToOne: false
      referencedRelation: "software_titles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "installations_title_id_fkey"
      columns: ["title_id"]
isOneToOne: false
      referencedRelation: "title_classification"
      referencedColumns: ["title_id"]
    },{
      foreignKeyName: "installations_title_id_fkey"
      columns: ["title_id"]
isOneToOne: false
      referencedRelation: "title_products"
      referencedColumns: ["title_id"]
    },{
      foreignKeyName: "installations_title_id_fkey"
      columns: ["title_id"]
isOneToOne: false
      referencedRelation: "title_summary"
      referencedColumns: ["title_id"]
    },{
      foreignKeyName: "installations_title_id_fkey"
      columns: ["title_id"]
isOneToOne: false
      referencedRelation: "v_title_summary"
      referencedColumns: ["title_id"]
    }
                  ]
                },"local_overrides": {
                  Row: {
                    "attention_level": Database["public"]['Enums']["attention_level"] | null,"category_slug": string,"created_at": string,"created_by": string | null,"note": string | null,"title_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "attention_level"?: Database["public"]['Enums']["attention_level"] | null,"category_slug": string,"created_at"?: string,"created_by"?: string | null,"note"?: string | null,"title_id": string
                  }
                  Update: {
                    "attention_level"?: Database["public"]['Enums']["attention_level"] | null,"category_slug"?: string,"created_at"?: string,"created_by"?: string | null,"note"?: string | null,"title_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "local_overrides_category_slug_fkey"
      columns: ["category_slug"]
isOneToOne: false
      referencedRelation: "categories_cache"
      referencedColumns: ["slug"]
    },{
      foreignKeyName: "local_overrides_category_slug_fkey"
      columns: ["category_slug"]
isOneToOne: false
      referencedRelation: "title_classification"
      referencedColumns: ["category_slug"]
    },{
      foreignKeyName: "local_overrides_category_slug_fkey"
      columns: ["category_slug"]
isOneToOne: false
      referencedRelation: "title_summary"
      referencedColumns: ["category_slug"]
    },{
      foreignKeyName: "local_overrides_category_slug_fkey"
      columns: ["category_slug"]
isOneToOne: false
      referencedRelation: "v_change_log"
      referencedColumns: ["category_slug"]
    },{
      foreignKeyName: "local_overrides_category_slug_fkey"
      columns: ["category_slug"]
isOneToOne: false
      referencedRelation: "v_installation_details"
      referencedColumns: ["category_slug"]
    },{
      foreignKeyName: "local_overrides_category_slug_fkey"
      columns: ["category_slug"]
isOneToOne: false
      referencedRelation: "v_title_summary"
      referencedColumns: ["category_slug"]
    },{
      foreignKeyName: "local_overrides_title_id_fkey"
      columns: ["title_id"]
isOneToOne: true
      referencedRelation: "software_titles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "local_overrides_title_id_fkey"
      columns: ["title_id"]
isOneToOne: true
      referencedRelation: "title_classification"
      referencedColumns: ["title_id"]
    },{
      foreignKeyName: "local_overrides_title_id_fkey"
      columns: ["title_id"]
isOneToOne: true
      referencedRelation: "title_products"
      referencedColumns: ["title_id"]
    },{
      foreignKeyName: "local_overrides_title_id_fkey"
      columns: ["title_id"]
isOneToOne: true
      referencedRelation: "title_summary"
      referencedColumns: ["title_id"]
    },{
      foreignKeyName: "local_overrides_title_id_fkey"
      columns: ["title_id"]
isOneToOne: true
      referencedRelation: "v_title_summary"
      referencedColumns: ["title_id"]
    }
                  ]
                },"maintenance_state": {
                  Row: {
                    "at": string,"key": string
                  }
                  ComputedFields: never
                  Insert: {
                    "at": string,"key": string
                  }
                  Update: {
                    "at"?: string,"key"?: string
                  }
                  Relationships: [
                    
                  ]
                },"platform_capabilities": {
                  Row: {
                    "osquery_tables": (string)[],"platform": Database["public"]['Enums']["platform"],"probed_at": string,"tenant_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "osquery_tables"?: (string)[],"platform": Database["public"]['Enums']["platform"],"probed_at"?: string,"tenant_id": string
                  }
                  Update: {
                    "osquery_tables"?: (string)[],"platform"?: Database["public"]['Enums']["platform"],"probed_at"?: string,"tenant_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "platform_capabilities_tenant_id_fkey"
      columns: ["tenant_id"]
isOneToOne: false
      referencedRelation: "tenants"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "platform_capabilities_tenant_id_fkey"
      columns: ["tenant_id"]
isOneToOne: false
      referencedRelation: "v_tenant_overview"
      referencedColumns: ["id"]
    }
                  ]
                },"policies": {
                  Row: {
                    "created_at": string,"created_by": string | null,"default_class": Database["public"]['Enums']["policy_class"],"evaluated_at": string | null,"id": string,"note": string | null,"published_at": string | null,"published_by": string | null,"status": Database["public"]['Enums']["policy_status"],"tenant_id": string,"version": number
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"created_by"?: string | null,"default_class"?: Database["public"]['Enums']["policy_class"],"evaluated_at"?: string | null,"id"?: string,"note"?: string | null,"published_at"?: string | null,"published_by"?: string | null,"status"?: Database["public"]['Enums']["policy_status"],"tenant_id": string,"version": number
                  }
                  Update: {
                    "created_at"?: string,"created_by"?: string | null,"default_class"?: Database["public"]['Enums']["policy_class"],"evaluated_at"?: string | null,"id"?: string,"note"?: string | null,"published_at"?: string | null,"published_by"?: string | null,"status"?: Database["public"]['Enums']["policy_status"],"tenant_id"?: string,"version"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "policies_tenant_id_fkey"
      columns: ["tenant_id"]
isOneToOne: false
      referencedRelation: "tenants"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "policies_tenant_id_fkey"
      columns: ["tenant_id"]
isOneToOne: false
      referencedRelation: "v_tenant_overview"
      referencedColumns: ["id"]
    }
                  ]
                },"policy_class_changes": {
                  Row: {
                    "changed_at": string,"from_class": Database["public"]['Enums']["policy_class"],"id": number,"policy_version": number,"rule_id": string | null,"tenant_id": string,"title_id": string,"to_class": Database["public"]['Enums']["policy_class"],"version": string
                  }
                  ComputedFields: never
                  Insert: {
                    "changed_at"?: string,"from_class": Database["public"]['Enums']["policy_class"],"id"?: never,"policy_version": number,"rule_id"?: string | null,"tenant_id": string,"title_id": string,"to_class": Database["public"]['Enums']["policy_class"],"version": string
                  }
                  Update: {
                    "changed_at"?: string,"from_class"?: Database["public"]['Enums']["policy_class"],"id"?: never,"policy_version"?: number,"rule_id"?: string | null,"tenant_id"?: string,"title_id"?: string,"to_class"?: Database["public"]['Enums']["policy_class"],"version"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "policy_class_changes_rule_id_fkey"
      columns: ["rule_id"]
isOneToOne: false
      referencedRelation: "policy_rules"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "policy_class_changes_tenant_id_fkey"
      columns: ["tenant_id"]
isOneToOne: false
      referencedRelation: "tenants"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "policy_class_changes_tenant_id_fkey"
      columns: ["tenant_id"]
isOneToOne: false
      referencedRelation: "v_tenant_overview"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "policy_class_changes_title_id_fkey"
      columns: ["title_id"]
isOneToOne: false
      referencedRelation: "software_titles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "policy_class_changes_title_id_fkey"
      columns: ["title_id"]
isOneToOne: false
      referencedRelation: "title_classification"
      referencedColumns: ["title_id"]
    },{
      foreignKeyName: "policy_class_changes_title_id_fkey"
      columns: ["title_id"]
isOneToOne: false
      referencedRelation: "title_products"
      referencedColumns: ["title_id"]
    },{
      foreignKeyName: "policy_class_changes_title_id_fkey"
      columns: ["title_id"]
isOneToOne: false
      referencedRelation: "title_summary"
      referencedColumns: ["title_id"]
    },{
      foreignKeyName: "policy_class_changes_title_id_fkey"
      columns: ["title_id"]
isOneToOne: false
      referencedRelation: "v_title_summary"
      referencedColumns: ["title_id"]
    }
                  ]
                },"policy_conditions": {
                  Row: {
                    "case_sensitive": boolean,"field": Database["public"]['Enums']["policy_field"],"id": string,"operator": Database["public"]['Enums']["policy_operator"],"position": number,"rule_id": string,"value": string | null,"value2": string | null,"values": (string)[] | null
                  }
                  ComputedFields: never
                  Insert: {
                    "case_sensitive"?: boolean,"field": Database["public"]['Enums']["policy_field"],"id"?: string,"operator": Database["public"]['Enums']["policy_operator"],"position": number,"rule_id": string,"value"?: string | null,"value2"?: string | null,"values"?: (string)[] | null
                  }
                  Update: {
                    "case_sensitive"?: boolean,"field"?: Database["public"]['Enums']["policy_field"],"id"?: string,"operator"?: Database["public"]['Enums']["policy_operator"],"position"?: number,"rule_id"?: string,"value"?: string | null,"value2"?: string | null,"values"?: (string)[] | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "policy_conditions_rule_id_fkey"
      columns: ["rule_id"]
isOneToOne: false
      referencedRelation: "policy_rules"
      referencedColumns: ["id"]
    }
                  ]
                },"policy_rules": {
                  Row: {
                    "alert_on_new": boolean,"business_purpose": string | null,"class": Database["public"]['Enums']["policy_class"],"created_at": string,"created_by": string | null,"enabled": boolean,"id": string,"kinds": (Database["public"]['Enums']["title_kind"])[],"lineage_id": string,"match": Database["public"]['Enums']["rule_match"],"mitigating_controls": string | null,"name": string,"owner": string | null,"policy_id": string,"position": number,"review_by": string | null,"risk_accepted_by": string | null,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "alert_on_new"?: boolean,"business_purpose"?: string | null,"class": Database["public"]['Enums']["policy_class"],"created_at"?: string,"created_by"?: string | null,"enabled"?: boolean,"id"?: string,"kinds": (Database["public"]['Enums']["title_kind"])[],"lineage_id"?: string,"match"?: Database["public"]['Enums']["rule_match"],"mitigating_controls"?: string | null,"name": string,"owner"?: string | null,"policy_id": string,"position": number,"review_by"?: string | null,"risk_accepted_by"?: string | null,"updated_at"?: string
                  }
                  Update: {
                    "alert_on_new"?: boolean,"business_purpose"?: string | null,"class"?: Database["public"]['Enums']["policy_class"],"created_at"?: string,"created_by"?: string | null,"enabled"?: boolean,"id"?: string,"kinds"?: (Database["public"]['Enums']["title_kind"])[],"lineage_id"?: string,"match"?: Database["public"]['Enums']["rule_match"],"mitigating_controls"?: string | null,"name"?: string,"owner"?: string | null,"policy_id"?: string,"position"?: number,"review_by"?: string | null,"risk_accepted_by"?: string | null,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "policy_rules_policy_id_fkey"
      columns: ["policy_id"]
isOneToOne: false
      referencedRelation: "policies"
      referencedColumns: ["id"]
    }
                  ]
                },"profiles": {
                  Row: {
                    "created_at": string,"display_name": string | null,"email": string,"id": string,"role": Database["public"]['Enums']["app_role"],"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"display_name"?: string | null,"email": string,"id": string,"role"?: Database["public"]['Enums']["app_role"],"updated_at"?: string
                  }
                  Update: {
                    "created_at"?: string,"display_name"?: string | null,"email"?: string,"id"?: string,"role"?: Database["public"]['Enums']["app_role"],"updated_at"?: string
                  }
                  Relationships: [
                    
                  ]
                },"query_catalog": {
                  Row: {
                    "created_at": string,"domain": Database["public"]['Enums']["inventory_domain"],"enabled": boolean,"id": string,"name": string,"platform": Database["public"]['Enums']["platform"],"required_tables": (string)[],"sql": string,"version": number
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"domain": Database["public"]['Enums']["inventory_domain"],"enabled"?: boolean,"id"?: string,"name": string,"platform": Database["public"]['Enums']["platform"],"required_tables"?: (string)[],"sql": string,"version": number
                  }
                  Update: {
                    "created_at"?: string,"domain"?: Database["public"]['Enums']["inventory_domain"],"enabled"?: boolean,"id"?: string,"name"?: string,"platform"?: Database["public"]['Enums']["platform"],"required_tables"?: (string)[],"sql"?: string,"version"?: number
                  }
                  Relationships: [
                    
                  ]
                },"query_runs": {
                  Row: {
                    "cancelled": boolean,"domain": Database["public"]['Enums']["inventory_domain"],"endpoint_ids": (string)[],"error": string | null,"finished_at": string | null,"id": string,"max_duration_seconds": number,"platform": Database["public"]['Enums']["platform"],"priority": boolean,"provider": Database["public"]['Enums']["query_provider"],"query_id": string | null,"query_version": number,"sophos_run_id": string | null,"started_at": string,"status": Database["public"]['Enums']["run_status"],"tenant_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "cancelled"?: boolean,"domain": Database["public"]['Enums']["inventory_domain"],"endpoint_ids"?: (string)[],"error"?: string | null,"finished_at"?: string | null,"id"?: string,"max_duration_seconds"?: number,"platform": Database["public"]['Enums']["platform"],"priority"?: boolean,"provider": Database["public"]['Enums']["query_provider"],"query_id"?: string | null,"query_version": number,"sophos_run_id"?: string | null,"started_at"?: string,"status"?: Database["public"]['Enums']["run_status"],"tenant_id": string
                  }
                  Update: {
                    "cancelled"?: boolean,"domain"?: Database["public"]['Enums']["inventory_domain"],"endpoint_ids"?: (string)[],"error"?: string | null,"finished_at"?: string | null,"id"?: string,"max_duration_seconds"?: number,"platform"?: Database["public"]['Enums']["platform"],"priority"?: boolean,"provider"?: Database["public"]['Enums']["query_provider"],"query_id"?: string | null,"query_version"?: number,"sophos_run_id"?: string | null,"started_at"?: string,"status"?: Database["public"]['Enums']["run_status"],"tenant_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "query_runs_query_id_fkey"
      columns: ["query_id"]
isOneToOne: false
      referencedRelation: "query_catalog"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "query_runs_tenant_id_fkey"
      columns: ["tenant_id"]
isOneToOne: false
      referencedRelation: "tenants"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "query_runs_tenant_id_fkey"
      columns: ["tenant_id"]
isOneToOne: false
      referencedRelation: "v_tenant_overview"
      referencedColumns: ["id"]
    }
                  ]
                },"raw_results": {
                  Row: {
                    "computer_id": string,"id": string,"ingest_error": string | null,"ingested_at": string | null,"query_id": string | null,"received_at": string,"row_count": number,"rows": NonNullable<Json>,"run_id": string,"scan_task_id": string | null,"tenant_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "computer_id": string,"id"?: string,"ingest_error"?: string | null,"ingested_at"?: string | null,"query_id"?: string | null,"received_at"?: string,"row_count": number,"rows": NonNullable<Json>,"run_id": string,"scan_task_id"?: string | null,"tenant_id": string
                  }
                  Update: {
                    "computer_id"?: string,"id"?: string,"ingest_error"?: string | null,"ingested_at"?: string | null,"query_id"?: string | null,"received_at"?: string,"row_count"?: number,"rows"?: NonNullable<Json>,"run_id"?: string,"scan_task_id"?: string | null,"tenant_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "raw_results_computer_id_tenant_id_fkey"
      columns: ["computer_id","tenant_id"]
isOneToOne: false
      referencedRelation: "computers"
      referencedColumns: ["id","tenant_id"]
    },{
      foreignKeyName: "raw_results_computer_id_tenant_id_fkey"
      columns: ["computer_id","tenant_id"]
isOneToOne: false
      referencedRelation: "v_computer_list"
      referencedColumns: ["id","tenant_id"]
    },{
      foreignKeyName: "raw_results_computer_id_tenant_id_fkey"
      columns: ["computer_id","tenant_id"]
isOneToOne: false
      referencedRelation: "v_computers"
      referencedColumns: ["id","tenant_id"]
    },{
      foreignKeyName: "raw_results_query_id_fkey"
      columns: ["query_id"]
isOneToOne: false
      referencedRelation: "query_catalog"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "raw_results_run_id_fkey"
      columns: ["run_id"]
isOneToOne: false
      referencedRelation: "query_runs"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "raw_results_run_id_fkey"
      columns: ["run_id"]
isOneToOne: false
      referencedRelation: "v_recent_runs"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "raw_results_scan_task_id_fkey"
      columns: ["scan_task_id"]
isOneToOne: false
      referencedRelation: "scan_tasks"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "raw_results_scan_task_id_fkey"
      columns: ["scan_task_id"]
isOneToOne: false
      referencedRelation: "v_retry_queue"
      referencedColumns: ["id"]
    }
                  ]
                },"reclassification_requests": {
                  Row: {
                    "admin_note": string | null,"created_at": string,"created_by": string | null,"current_category_slug": string | null,"evidence_url": string | null,"hub_request_id": string,"id": string,"reason": string,"status": string,"suggested_category_slug": string | null,"title_id": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "admin_note"?: string | null,"created_at"?: string,"created_by"?: string | null,"current_category_slug"?: string | null,"evidence_url"?: string | null,"hub_request_id": string,"id"?: string,"reason": string,"status"?: string,"suggested_category_slug"?: string | null,"title_id": string,"updated_at"?: string
                  }
                  Update: {
                    "admin_note"?: string | null,"created_at"?: string,"created_by"?: string | null,"current_category_slug"?: string | null,"evidence_url"?: string | null,"hub_request_id"?: string,"id"?: string,"reason"?: string,"status"?: string,"suggested_category_slug"?: string | null,"title_id"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "reclassification_requests_suggested_category_slug_fkey"
      columns: ["suggested_category_slug"]
isOneToOne: false
      referencedRelation: "categories_cache"
      referencedColumns: ["slug"]
    },{
      foreignKeyName: "reclassification_requests_suggested_category_slug_fkey"
      columns: ["suggested_category_slug"]
isOneToOne: false
      referencedRelation: "title_classification"
      referencedColumns: ["category_slug"]
    },{
      foreignKeyName: "reclassification_requests_suggested_category_slug_fkey"
      columns: ["suggested_category_slug"]
isOneToOne: false
      referencedRelation: "title_summary"
      referencedColumns: ["category_slug"]
    },{
      foreignKeyName: "reclassification_requests_suggested_category_slug_fkey"
      columns: ["suggested_category_slug"]
isOneToOne: false
      referencedRelation: "v_change_log"
      referencedColumns: ["category_slug"]
    },{
      foreignKeyName: "reclassification_requests_suggested_category_slug_fkey"
      columns: ["suggested_category_slug"]
isOneToOne: false
      referencedRelation: "v_installation_details"
      referencedColumns: ["category_slug"]
    },{
      foreignKeyName: "reclassification_requests_suggested_category_slug_fkey"
      columns: ["suggested_category_slug"]
isOneToOne: false
      referencedRelation: "v_title_summary"
      referencedColumns: ["category_slug"]
    },{
      foreignKeyName: "reclassification_requests_title_id_fkey"
      columns: ["title_id"]
isOneToOne: false
      referencedRelation: "software_titles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "reclassification_requests_title_id_fkey"
      columns: ["title_id"]
isOneToOne: false
      referencedRelation: "title_classification"
      referencedColumns: ["title_id"]
    },{
      foreignKeyName: "reclassification_requests_title_id_fkey"
      columns: ["title_id"]
isOneToOne: false
      referencedRelation: "title_products"
      referencedColumns: ["title_id"]
    },{
      foreignKeyName: "reclassification_requests_title_id_fkey"
      columns: ["title_id"]
isOneToOne: false
      referencedRelation: "title_summary"
      referencedColumns: ["title_id"]
    },{
      foreignKeyName: "reclassification_requests_title_id_fkey"
      columns: ["title_id"]
isOneToOne: false
      referencedRelation: "v_title_summary"
      referencedColumns: ["title_id"]
    }
                  ]
                },"saved_searches": {
                  Row: {
                    "created_at": string,"created_by": string | null,"id": string,"name": string,"owner_id": string | null,"params": NonNullable<Json>,"pinned": boolean
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"created_by"?: string | null,"id"?: string,"name": string,"owner_id"?: string | null,"params"?: NonNullable<Json>,"pinned"?: boolean
                  }
                  Update: {
                    "created_at"?: string,"created_by"?: string | null,"id"?: string,"name"?: string,"owner_id"?: string | null,"params"?: NonNullable<Json>,"pinned"?: boolean
                  }
                  Relationships: [
                    
                  ]
                },"scan_cycles": {
                  Row: {
                    "closed_at": string | null,"closes_at": string,"coverage_pct": number | null,"id": string,"opened_at": string,"status": Database["public"]['Enums']["cycle_status"],"tenant_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "closed_at"?: string | null,"closes_at": string,"coverage_pct"?: number | null,"id"?: string,"opened_at"?: string,"status"?: Database["public"]['Enums']["cycle_status"],"tenant_id": string
                  }
                  Update: {
                    "closed_at"?: string | null,"closes_at"?: string,"coverage_pct"?: number | null,"id"?: string,"opened_at"?: string,"status"?: Database["public"]['Enums']["cycle_status"],"tenant_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "scan_cycles_tenant_id_fkey"
      columns: ["tenant_id"]
isOneToOne: false
      referencedRelation: "tenants"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "scan_cycles_tenant_id_fkey"
      columns: ["tenant_id"]
isOneToOne: false
      referencedRelation: "v_tenant_overview"
      referencedColumns: ["id"]
    }
                  ]
                },"scan_settings": {
                  Row: {
                    "batch_size": number,"cycle_time": string,"cycle_weekday": number,"daily_run_limit": number,"max_active_runs": number,"provider": Database["public"]['Enums']["query_provider"],"reserve_pct": number,"retry_time": string,"run_grace_minutes": number,"runs_per_minute": number,"tenant_id": string,"timezone": string,"updated_at": string,"updated_by": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "batch_size"?: number,"cycle_time"?: string,"cycle_weekday"?: number,"daily_run_limit"?: number,"max_active_runs"?: number,"provider"?: Database["public"]['Enums']["query_provider"],"reserve_pct"?: number,"retry_time"?: string,"run_grace_minutes"?: number,"runs_per_minute"?: number,"tenant_id": string,"timezone"?: string,"updated_at"?: string,"updated_by"?: string | null
                  }
                  Update: {
                    "batch_size"?: number,"cycle_time"?: string,"cycle_weekday"?: number,"daily_run_limit"?: number,"max_active_runs"?: number,"provider"?: Database["public"]['Enums']["query_provider"],"reserve_pct"?: number,"retry_time"?: string,"run_grace_minutes"?: number,"runs_per_minute"?: number,"tenant_id"?: string,"timezone"?: string,"updated_at"?: string,"updated_by"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "scan_settings_tenant_id_fkey"
      columns: ["tenant_id"]
isOneToOne: true
      referencedRelation: "tenants"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "scan_settings_tenant_id_fkey"
      columns: ["tenant_id"]
isOneToOne: true
      referencedRelation: "v_tenant_overview"
      referencedColumns: ["id"]
    }
                  ]
                },"scan_tasks": {
                  Row: {
                    "attempts": number,"claimed_at": string | null,"computer_id": string,"cycle_id": string,"domain": Database["public"]['Enums']["inventory_domain"],"id": string,"last_error": string | null,"last_run_id": string | null,"next_attempt_at": string,"priority": boolean,"query_id": string,"status": Database["public"]['Enums']["task_status"],"tenant_id": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "attempts"?: number,"claimed_at"?: string | null,"computer_id": string,"cycle_id": string,"domain": Database["public"]['Enums']["inventory_domain"],"id"?: string,"last_error"?: string | null,"last_run_id"?: string | null,"next_attempt_at"?: string,"priority"?: boolean,"query_id": string,"status"?: Database["public"]['Enums']["task_status"],"tenant_id": string,"updated_at"?: string
                  }
                  Update: {
                    "attempts"?: number,"claimed_at"?: string | null,"computer_id"?: string,"cycle_id"?: string,"domain"?: Database["public"]['Enums']["inventory_domain"],"id"?: string,"last_error"?: string | null,"last_run_id"?: string | null,"next_attempt_at"?: string,"priority"?: boolean,"query_id"?: string,"status"?: Database["public"]['Enums']["task_status"],"tenant_id"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "scan_tasks_computer_id_tenant_id_fkey"
      columns: ["computer_id","tenant_id"]
isOneToOne: false
      referencedRelation: "computers"
      referencedColumns: ["id","tenant_id"]
    },{
      foreignKeyName: "scan_tasks_computer_id_tenant_id_fkey"
      columns: ["computer_id","tenant_id"]
isOneToOne: false
      referencedRelation: "v_computer_list"
      referencedColumns: ["id","tenant_id"]
    },{
      foreignKeyName: "scan_tasks_computer_id_tenant_id_fkey"
      columns: ["computer_id","tenant_id"]
isOneToOne: false
      referencedRelation: "v_computers"
      referencedColumns: ["id","tenant_id"]
    },{
      foreignKeyName: "scan_tasks_cycle_id_tenant_id_fkey"
      columns: ["cycle_id","tenant_id"]
isOneToOne: false
      referencedRelation: "scan_cycles"
      referencedColumns: ["id","tenant_id"]
    },{
      foreignKeyName: "scan_tasks_last_run_id_fkey"
      columns: ["last_run_id"]
isOneToOne: false
      referencedRelation: "query_runs"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "scan_tasks_last_run_id_fkey"
      columns: ["last_run_id"]
isOneToOne: false
      referencedRelation: "v_recent_runs"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "scan_tasks_query_id_fkey"
      columns: ["query_id"]
isOneToOne: false
      referencedRelation: "query_catalog"
      referencedColumns: ["id"]
    }
                  ]
                },"snapshots": {
                  Row: {
                    "applied_at": string | null,"collected_at": string,"computer_id": string,"content_hash": string,"created_at": string,"domain": Database["public"]['Enums']["inventory_domain"],"id": string,"is_baseline": boolean,"outcome": string | null,"query_name": string,"query_version": number,"raw_result_id": string | null,"row_count": number,"scan_task_id": string | null,"tenant_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "applied_at"?: string | null,"collected_at": string,"computer_id": string,"content_hash": string,"created_at"?: string,"domain": Database["public"]['Enums']["inventory_domain"],"id"?: string,"is_baseline"?: boolean,"outcome"?: string | null,"query_name": string,"query_version": number,"raw_result_id"?: string | null,"row_count": number,"scan_task_id"?: string | null,"tenant_id": string
                  }
                  Update: {
                    "applied_at"?: string | null,"collected_at"?: string,"computer_id"?: string,"content_hash"?: string,"created_at"?: string,"domain"?: Database["public"]['Enums']["inventory_domain"],"id"?: string,"is_baseline"?: boolean,"outcome"?: string | null,"query_name"?: string,"query_version"?: number,"raw_result_id"?: string | null,"row_count"?: number,"scan_task_id"?: string | null,"tenant_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "snapshots_computer_id_tenant_id_fkey"
      columns: ["computer_id","tenant_id"]
isOneToOne: false
      referencedRelation: "computers"
      referencedColumns: ["id","tenant_id"]
    },{
      foreignKeyName: "snapshots_computer_id_tenant_id_fkey"
      columns: ["computer_id","tenant_id"]
isOneToOne: false
      referencedRelation: "v_computer_list"
      referencedColumns: ["id","tenant_id"]
    },{
      foreignKeyName: "snapshots_computer_id_tenant_id_fkey"
      columns: ["computer_id","tenant_id"]
isOneToOne: false
      referencedRelation: "v_computers"
      referencedColumns: ["id","tenant_id"]
    },{
      foreignKeyName: "snapshots_raw_result_id_fkey"
      columns: ["raw_result_id"]
isOneToOne: true
      referencedRelation: "raw_results"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "snapshots_scan_task_id_fkey"
      columns: ["scan_task_id"]
isOneToOne: false
      referencedRelation: "scan_tasks"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "snapshots_scan_task_id_fkey"
      columns: ["scan_task_id"]
isOneToOne: false
      referencedRelation: "v_retry_queue"
      referencedColumns: ["id"]
    }
                  ]
                },"software_titles": {
                  Row: {
                    "canonical_name": string,"external_id": string | null,"first_seen_at": string,"id": string,"kind": Database["public"]['Enums']["title_kind"],"match_key": string,"product_base": string | null,"source": string,"vendor": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "canonical_name": string,"external_id"?: string | null,"first_seen_at"?: string,"id"?: string,"kind": Database["public"]['Enums']["title_kind"],"match_key": string,"product_base"?: never,"source": string,"vendor"?: string | null
                  }
                  Update: {
                    "canonical_name"?: string,"external_id"?: string | null,"first_seen_at"?: string,"id"?: string,"kind"?: Database["public"]['Enums']["title_kind"],"match_key"?: string,"product_base"?: never,"source"?: string,"vendor"?: string | null
                  }
                  Relationships: [
                    
                  ]
                },"sophos_connection": {
                  Row: {
                    "client_id": string,"configured_at": string,"configured_by": string | null,"data_region_host": string | null,"id": number,"id_type": string | null,"last_sync_at": string | null,"last_sync_message": string | null,"last_sync_ok": boolean | null,"last_test_at": string | null,"last_test_message": string | null,"last_test_ok": boolean | null,"secret_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "client_id": string,"configured_at"?: string,"configured_by"?: string | null,"data_region_host"?: string | null,"id"?: number,"id_type"?: string | null,"last_sync_at"?: string | null,"last_sync_message"?: string | null,"last_sync_ok"?: boolean | null,"last_test_at"?: string | null,"last_test_message"?: string | null,"last_test_ok"?: boolean | null,"secret_id": string
                  }
                  Update: {
                    "client_id"?: string,"configured_at"?: string,"configured_by"?: string | null,"data_region_host"?: string | null,"id"?: number,"id_type"?: string | null,"last_sync_at"?: string | null,"last_sync_message"?: string | null,"last_sync_ok"?: boolean | null,"last_test_at"?: string | null,"last_test_message"?: string | null,"last_test_ok"?: boolean | null,"secret_id"?: string
                  }
                  Relationships: [
                    
                  ]
                },"tenant_members": {
                  Row: {
                    "created_at": string,"role": Database["public"]['Enums']["app_role"],"tenant_id": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"role"?: Database["public"]['Enums']["app_role"],"tenant_id": string,"user_id": string
                  }
                  Update: {
                    "created_at"?: string,"role"?: Database["public"]['Enums']["app_role"],"tenant_id"?: string,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "tenant_members_tenant_id_fkey"
      columns: ["tenant_id"]
isOneToOne: false
      referencedRelation: "tenants"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "tenant_members_tenant_id_fkey"
      columns: ["tenant_id"]
isOneToOne: false
      referencedRelation: "v_tenant_overview"
      referencedColumns: ["id"]
    }
                  ]
                },"tenants": {
                  Row: {
                    "created_at": string,"data_region_host": string | null,"id": string,"id_type": string,"last_synced_at": string | null,"name": string,"sophos_tenant_id": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"data_region_host"?: string | null,"id"?: string,"id_type": string,"last_synced_at"?: string | null,"name": string,"sophos_tenant_id": string,"updated_at"?: string
                  }
                  Update: {
                    "created_at"?: string,"data_region_host"?: string | null,"id"?: string,"id_type"?: string,"last_synced_at"?: string | null,"name"?: string,"sophos_tenant_id"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    
                  ]
                },"title_version_policy": {
                  Row: {
                    "class": Database["public"]['Enums']["policy_class"],"evaluated_at": string,"policy_version": number,"rule_id": string | null,"tenant_id": string,"title_id": string,"version": string
                  }
                  ComputedFields: never
                  Insert: {
                    "class": Database["public"]['Enums']["policy_class"],"evaluated_at"?: string,"policy_version": number,"rule_id"?: string | null,"tenant_id": string,"title_id": string,"version"?: string
                  }
                  Update: {
                    "class"?: Database["public"]['Enums']["policy_class"],"evaluated_at"?: string,"policy_version"?: number,"rule_id"?: string | null,"tenant_id"?: string,"title_id"?: string,"version"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "title_version_policy_rule_id_fkey"
      columns: ["rule_id"]
isOneToOne: false
      referencedRelation: "policy_rules"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "title_version_policy_tenant_id_fkey"
      columns: ["tenant_id"]
isOneToOne: false
      referencedRelation: "tenants"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "title_version_policy_tenant_id_fkey"
      columns: ["tenant_id"]
isOneToOne: false
      referencedRelation: "v_tenant_overview"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "title_version_policy_title_id_fkey"
      columns: ["title_id"]
isOneToOne: false
      referencedRelation: "software_titles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "title_version_policy_title_id_fkey"
      columns: ["title_id"]
isOneToOne: false
      referencedRelation: "title_classification"
      referencedColumns: ["title_id"]
    },{
      foreignKeyName: "title_version_policy_title_id_fkey"
      columns: ["title_id"]
isOneToOne: false
      referencedRelation: "title_products"
      referencedColumns: ["title_id"]
    },{
      foreignKeyName: "title_version_policy_title_id_fkey"
      columns: ["title_id"]
isOneToOne: false
      referencedRelation: "title_summary"
      referencedColumns: ["title_id"]
    },{
      foreignKeyName: "title_version_policy_title_id_fkey"
      columns: ["title_id"]
isOneToOne: false
      referencedRelation: "v_title_summary"
      referencedColumns: ["title_id"]
    }
                  ]
                }
          }
          Views: {
            "current_installations": {
                  Row: {
                    "attrs": Json | null,"computer_id": string,"domain": Database["public"]['Enums']["inventory_domain"],"first_seen_snapshot": string | null,"id": string,"last_seen_snapshot": string | null,"path": string | null,"scope_key": string | null,"tenant_id": string,"title_id": string,"user_masked": boolean | null,"username": string | null,"valid_from": string,"valid_to": string | null,"version": string | null
                  }
                  ComputedFields: never
                  Relationships: [
                    {
      foreignKeyName: "installations_computer_id_tenant_id_fkey"
      columns: ["computer_id","tenant_id"]
isOneToOne: false
      referencedRelation: "computers"
      referencedColumns: ["id","tenant_id"]
    },{
      foreignKeyName: "installations_computer_id_tenant_id_fkey"
      columns: ["computer_id","tenant_id"]
isOneToOne: false
      referencedRelation: "v_computer_list"
      referencedColumns: ["id","tenant_id"]
    },{
      foreignKeyName: "installations_computer_id_tenant_id_fkey"
      columns: ["computer_id","tenant_id"]
isOneToOne: false
      referencedRelation: "v_computers"
      referencedColumns: ["id","tenant_id"]
    },{
      foreignKeyName: "installations_first_seen_snapshot_fkey"
      columns: ["first_seen_snapshot"]
isOneToOne: false
      referencedRelation: "snapshots"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "installations_last_seen_snapshot_fkey"
      columns: ["last_seen_snapshot"]
isOneToOne: false
      referencedRelation: "snapshots"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "installations_title_id_fkey"
      columns: ["title_id"]
isOneToOne: false
      referencedRelation: "software_titles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "installations_title_id_fkey"
      columns: ["title_id"]
isOneToOne: false
      referencedRelation: "title_classification"
      referencedColumns: ["title_id"]
    },{
      foreignKeyName: "installations_title_id_fkey"
      columns: ["title_id"]
isOneToOne: false
      referencedRelation: "title_products"
      referencedColumns: ["title_id"]
    },{
      foreignKeyName: "installations_title_id_fkey"
      columns: ["title_id"]
isOneToOne: false
      referencedRelation: "title_summary"
      referencedColumns: ["title_id"]
    },{
      foreignKeyName: "installations_title_id_fkey"
      columns: ["title_id"]
isOneToOne: false
      referencedRelation: "v_title_summary"
      referencedColumns: ["title_id"]
    }
                  ]
                },"title_classification": {
                  Row: {
                    "attention_level": Database["public"]['Enums']["attention_level"] | null,"category_slug": string | null,"confidence": number | null,"level1_name": string | null,"level2_name": string | null,"method": string | null,"origin": string | null,"title_id": string
                  }
                  ComputedFields: never
                  Relationships: [
                    
                  ]
                },"title_policy": {
                  Row: {
                    "class": Database["public"]['Enums']["policy_class"] | null,"mixed_versions": boolean | null,"rule_id": string | null,"tenant_id": string,"title_id": string
                  }
                  ComputedFields: never
                  Relationships: [
                    {
      foreignKeyName: "installations_title_id_fkey"
      columns: ["title_id"]
isOneToOne: false
      referencedRelation: "software_titles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "installations_title_id_fkey"
      columns: ["title_id"]
isOneToOne: false
      referencedRelation: "title_classification"
      referencedColumns: ["title_id"]
    },{
      foreignKeyName: "installations_title_id_fkey"
      columns: ["title_id"]
isOneToOne: false
      referencedRelation: "title_products"
      referencedColumns: ["title_id"]
    },{
      foreignKeyName: "installations_title_id_fkey"
      columns: ["title_id"]
isOneToOne: false
      referencedRelation: "title_summary"
      referencedColumns: ["title_id"]
    },{
      foreignKeyName: "installations_title_id_fkey"
      columns: ["title_id"]
isOneToOne: false
      referencedRelation: "v_title_summary"
      referencedColumns: ["title_id"]
    }
                  ]
                },"title_products": {
                  Row: {
                    "product_key": string | null,"title_id": string
                  }
                  ComputedFields: never
                  Relationships: [
                    
                  ]
                },"title_summary": {
                  Row: {
                    "attention_level": Database["public"]['Enums']["attention_level"] | null,"canonical_name": string,"category_slug": string | null,"computers": number | null,"external_id": string | null,"first_seen": string | null,"kind": Database["public"]['Enums']["title_kind"],"latest_version": string | null,"source": string,"tenant_id": string,"title_id": string,"vendor": string | null,"versions": number | null
                  }
                  ComputedFields: never
                  Relationships: [
                    
                  ]
                },"v_capability_probes_latest": {
                  Row: {
                    "computer_id": string,"error": string | null,"finished_at": string | null,"hostname": string,"id": string,"platform": Database["public"]['Enums']["platform"],"provider": Database["public"]['Enums']["query_provider"],"started_at": string,"status": string,"table_count": number | null,"tenant_id": string,"tenant_name": string
                  }
                  ComputedFields: never
                  Relationships: [
                    {
      foreignKeyName: "capability_probes_computer_id_tenant_id_fkey"
      columns: ["computer_id","tenant_id"]
isOneToOne: false
      referencedRelation: "computers"
      referencedColumns: ["id","tenant_id"]
    },{
      foreignKeyName: "capability_probes_computer_id_tenant_id_fkey"
      columns: ["computer_id","tenant_id"]
isOneToOne: false
      referencedRelation: "v_computer_list"
      referencedColumns: ["id","tenant_id"]
    },{
      foreignKeyName: "capability_probes_computer_id_tenant_id_fkey"
      columns: ["computer_id","tenant_id"]
isOneToOne: false
      referencedRelation: "v_computers"
      referencedColumns: ["id","tenant_id"]
    }
                  ]
                },"v_change_log": {
                  Row: {
                    "attention_level": Database["public"]['Enums']["attention_level"] | null,"canonical_name": string,"category_slug": string | null,"change": Database["public"]['Enums']["change_type"],"computer_id": string,"detected_at": string,"domain": Database["public"]['Enums']["inventory_domain"],"external_id": string | null,"from_version": string | null,"hostname": string,"id": string,"kind": Database["public"]['Enums']["title_kind"],"level1_name": string | null,"level2_name": string | null,"platform": Database["public"]['Enums']["platform"],"snapshot_id": string,"source": string,"tenant_id": string,"title_id": string,"to_version": string | null
                  }
                  ComputedFields: never
                  Relationships: [
                    {
      foreignKeyName: "change_events_computer_id_tenant_id_fkey"
      columns: ["computer_id","tenant_id"]
isOneToOne: false
      referencedRelation: "computers"
      referencedColumns: ["id","tenant_id"]
    },{
      foreignKeyName: "change_events_computer_id_tenant_id_fkey"
      columns: ["computer_id","tenant_id"]
isOneToOne: false
      referencedRelation: "v_computer_list"
      referencedColumns: ["id","tenant_id"]
    },{
      foreignKeyName: "change_events_computer_id_tenant_id_fkey"
      columns: ["computer_id","tenant_id"]
isOneToOne: false
      referencedRelation: "v_computers"
      referencedColumns: ["id","tenant_id"]
    },{
      foreignKeyName: "change_events_snapshot_id_fkey"
      columns: ["snapshot_id"]
isOneToOne: false
      referencedRelation: "snapshots"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "change_events_title_id_fkey"
      columns: ["title_id"]
isOneToOne: false
      referencedRelation: "software_titles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "change_events_title_id_fkey"
      columns: ["title_id"]
isOneToOne: false
      referencedRelation: "title_classification"
      referencedColumns: ["title_id"]
    },{
      foreignKeyName: "change_events_title_id_fkey"
      columns: ["title_id"]
isOneToOne: false
      referencedRelation: "title_products"
      referencedColumns: ["title_id"]
    },{
      foreignKeyName: "change_events_title_id_fkey"
      columns: ["title_id"]
isOneToOne: false
      referencedRelation: "title_summary"
      referencedColumns: ["title_id"]
    },{
      foreignKeyName: "change_events_title_id_fkey"
      columns: ["title_id"]
isOneToOne: false
      referencedRelation: "v_title_summary"
      referencedColumns: ["title_id"]
    }
                  ]
                },"v_computer_list": {
                  Row: {
                    "associated_user": string | null,"attention": Json | null,"attention_level1_slugs": (string)[] | null,"attention_slugs": (string)[] | null,"cycle_status": string | null,"endpoint_type": string | null,"extensions": number | null,"health": string | null,"hostname": string,"id": string,"last_collected_at": string | null,"last_error": string | null,"last_seen_at": string | null,"next_attempt_at": string | null,"os_build": string | null,"os_name": string | null,"os_version": string | null,"packages": number | null,"platform": Database["public"]['Enums']["platform"],"programs": number | null,"retired_at": string | null,"tenant_id": string,"user_masked": boolean | null
                  }
                  ComputedFields: never
                  Relationships: [
                    {
      foreignKeyName: "computers_tenant_id_fkey"
      columns: ["tenant_id"]
isOneToOne: false
      referencedRelation: "tenants"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "computers_tenant_id_fkey"
      columns: ["tenant_id"]
isOneToOne: false
      referencedRelation: "v_tenant_overview"
      referencedColumns: ["id"]
    }
                  ]
                },"v_computers": {
                  Row: {
                    "associated_user": string | null,"created_at": string,"health": string | null,"hostname": string,"id": string,"last_collected_at": string | null,"last_seen_at": string | null,"missing_syncs": number,"os_build": string | null,"os_name": string | null,"os_version": string | null,"platform": Database["public"]['Enums']["platform"],"retired_at": string | null,"sophos_endpoint_id": string,"tenant_id": string,"updated_at": string,"user_masked": boolean | null
                  }
                  ComputedFields: never
                  Relationships: [
                    {
      foreignKeyName: "computers_tenant_id_fkey"
      columns: ["tenant_id"]
isOneToOne: false
      referencedRelation: "tenants"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "computers_tenant_id_fkey"
      columns: ["tenant_id"]
isOneToOne: false
      referencedRelation: "v_tenant_overview"
      referencedColumns: ["id"]
    }
                  ]
                },"v_installation_details": {
                  Row: {
                    "attention_level": Database["public"]['Enums']["attention_level"] | null,"attrs": Json | null,"canonical_name": string,"category_slug": string | null,"computer_id": string,"confidence": number | null,"domain": Database["public"]['Enums']["inventory_domain"],"external_id": string | null,"first_seen_snapshot": string | null,"hostname": string,"id": string,"kind": Database["public"]['Enums']["title_kind"],"last_seen_snapshot": string | null,"level1_name": string | null,"level2_name": string | null,"method": string | null,"origin": string | null,"path": string | null,"platform": Database["public"]['Enums']["platform"],"policy_class": Database["public"]['Enums']["policy_class"] | null,"scope_key": string | null,"source": string,"tenant_id": string,"title_id": string,"user_masked": boolean | null,"username": string | null,"valid_from": string,"valid_to": string | null,"vendor": string | null,"version": string | null
                  }
                  ComputedFields: never
                  Relationships: [
                    {
      foreignKeyName: "installations_computer_id_tenant_id_fkey"
      columns: ["computer_id","tenant_id"]
isOneToOne: false
      referencedRelation: "computers"
      referencedColumns: ["id","tenant_id"]
    },{
      foreignKeyName: "installations_computer_id_tenant_id_fkey"
      columns: ["computer_id","tenant_id"]
isOneToOne: false
      referencedRelation: "v_computer_list"
      referencedColumns: ["id","tenant_id"]
    },{
      foreignKeyName: "installations_computer_id_tenant_id_fkey"
      columns: ["computer_id","tenant_id"]
isOneToOne: false
      referencedRelation: "v_computers"
      referencedColumns: ["id","tenant_id"]
    },{
      foreignKeyName: "installations_first_seen_snapshot_fkey"
      columns: ["first_seen_snapshot"]
isOneToOne: false
      referencedRelation: "snapshots"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "installations_last_seen_snapshot_fkey"
      columns: ["last_seen_snapshot"]
isOneToOne: false
      referencedRelation: "snapshots"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "installations_title_id_fkey"
      columns: ["title_id"]
isOneToOne: false
      referencedRelation: "software_titles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "installations_title_id_fkey"
      columns: ["title_id"]
isOneToOne: false
      referencedRelation: "title_classification"
      referencedColumns: ["title_id"]
    },{
      foreignKeyName: "installations_title_id_fkey"
      columns: ["title_id"]
isOneToOne: false
      referencedRelation: "title_products"
      referencedColumns: ["title_id"]
    },{
      foreignKeyName: "installations_title_id_fkey"
      columns: ["title_id"]
isOneToOne: false
      referencedRelation: "title_summary"
      referencedColumns: ["title_id"]
    },{
      foreignKeyName: "installations_title_id_fkey"
      columns: ["title_id"]
isOneToOne: false
      referencedRelation: "v_title_summary"
      referencedColumns: ["title_id"]
    }
                  ]
                },"v_installations": {
                  Row: {
                    "attrs": Json | null,"computer_id": string,"domain": Database["public"]['Enums']["inventory_domain"],"first_seen_snapshot": string | null,"id": string,"last_seen_snapshot": string | null,"path": string | null,"scope_key": string | null,"tenant_id": string,"title_id": string,"user_masked": boolean | null,"username": string | null,"valid_from": string,"valid_to": string | null,"version": string | null
                  }
                  ComputedFields: never
                  Relationships: [
                    {
      foreignKeyName: "installations_computer_id_tenant_id_fkey"
      columns: ["computer_id","tenant_id"]
isOneToOne: false
      referencedRelation: "computers"
      referencedColumns: ["id","tenant_id"]
    },{
      foreignKeyName: "installations_computer_id_tenant_id_fkey"
      columns: ["computer_id","tenant_id"]
isOneToOne: false
      referencedRelation: "v_computer_list"
      referencedColumns: ["id","tenant_id"]
    },{
      foreignKeyName: "installations_computer_id_tenant_id_fkey"
      columns: ["computer_id","tenant_id"]
isOneToOne: false
      referencedRelation: "v_computers"
      referencedColumns: ["id","tenant_id"]
    },{
      foreignKeyName: "installations_first_seen_snapshot_fkey"
      columns: ["first_seen_snapshot"]
isOneToOne: false
      referencedRelation: "snapshots"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "installations_last_seen_snapshot_fkey"
      columns: ["last_seen_snapshot"]
isOneToOne: false
      referencedRelation: "snapshots"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "installations_title_id_fkey"
      columns: ["title_id"]
isOneToOne: false
      referencedRelation: "software_titles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "installations_title_id_fkey"
      columns: ["title_id"]
isOneToOne: false
      referencedRelation: "title_classification"
      referencedColumns: ["title_id"]
    },{
      foreignKeyName: "installations_title_id_fkey"
      columns: ["title_id"]
isOneToOne: false
      referencedRelation: "title_products"
      referencedColumns: ["title_id"]
    },{
      foreignKeyName: "installations_title_id_fkey"
      columns: ["title_id"]
isOneToOne: false
      referencedRelation: "title_summary"
      referencedColumns: ["title_id"]
    },{
      foreignKeyName: "installations_title_id_fkey"
      columns: ["title_id"]
isOneToOne: false
      referencedRelation: "v_title_summary"
      referencedColumns: ["title_id"]
    }
                  ]
                },"v_policy_class_changes": {
                  Row: {
                    "canonical_name": string,"changed_at": string,"external_id": string | null,"from_class": Database["public"]['Enums']["policy_class"],"id": number,"kind": Database["public"]['Enums']["title_kind"],"policy_version": number,"rule_lineage_id": string | null,"rule_name": string | null,"source": string,"tenant_id": string,"title_id": string,"to_class": Database["public"]['Enums']["policy_class"],"vendor": string | null,"version": string
                  }
                  ComputedFields: never
                  Relationships: [
                    {
      foreignKeyName: "policy_class_changes_tenant_id_fkey"
      columns: ["tenant_id"]
isOneToOne: false
      referencedRelation: "tenants"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "policy_class_changes_tenant_id_fkey"
      columns: ["tenant_id"]
isOneToOne: false
      referencedRelation: "v_tenant_overview"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "policy_class_changes_title_id_fkey"
      columns: ["title_id"]
isOneToOne: false
      referencedRelation: "software_titles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "policy_class_changes_title_id_fkey"
      columns: ["title_id"]
isOneToOne: false
      referencedRelation: "title_classification"
      referencedColumns: ["title_id"]
    },{
      foreignKeyName: "policy_class_changes_title_id_fkey"
      columns: ["title_id"]
isOneToOne: false
      referencedRelation: "title_products"
      referencedColumns: ["title_id"]
    },{
      foreignKeyName: "policy_class_changes_title_id_fkey"
      columns: ["title_id"]
isOneToOne: false
      referencedRelation: "title_summary"
      referencedColumns: ["title_id"]
    },{
      foreignKeyName: "policy_class_changes_title_id_fkey"
      columns: ["title_id"]
isOneToOne: false
      referencedRelation: "v_title_summary"
      referencedColumns: ["title_id"]
    }
                  ]
                },"v_recent_runs": {
                  Row: {
                    "cancelled": boolean,"collected": number | null,"domain": Database["public"]['Enums']["inventory_domain"],"duration_seconds": number | null,"endpoints": number | null,"error": string | null,"errors": number | null,"finished_at": string | null,"id": string,"no_response": number | null,"platform": Database["public"]['Enums']["platform"],"priority": boolean,"provider": Database["public"]['Enums']["query_provider"],"query_name": string | null,"query_version": number,"started_at": string,"status": Database["public"]['Enums']["run_status"],"tenant_id": string
                  }
                  ComputedFields: never
                  Relationships: [
                    {
      foreignKeyName: "query_runs_tenant_id_fkey"
      columns: ["tenant_id"]
isOneToOne: false
      referencedRelation: "tenants"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "query_runs_tenant_id_fkey"
      columns: ["tenant_id"]
isOneToOne: false
      referencedRelation: "v_tenant_overview"
      referencedColumns: ["id"]
    }
                  ]
                },"v_retry_queue": {
                  Row: {
                    "attempts": number,"computer_id": string,"domain": Database["public"]['Enums']["inventory_domain"],"hostname": string,"id": string,"last_error": string | null,"last_seen_at": string | null,"next_attempt_at": string,"platform": Database["public"]['Enums']["platform"],"query_name": string,"status": Database["public"]['Enums']["task_status"],"tenant_id": string,"updated_at": string
                  }
                  ComputedFields: never
                  Relationships: [
                    {
      foreignKeyName: "scan_tasks_computer_id_tenant_id_fkey"
      columns: ["computer_id","tenant_id"]
isOneToOne: false
      referencedRelation: "computers"
      referencedColumns: ["id","tenant_id"]
    },{
      foreignKeyName: "scan_tasks_computer_id_tenant_id_fkey"
      columns: ["computer_id","tenant_id"]
isOneToOne: false
      referencedRelation: "v_computer_list"
      referencedColumns: ["id","tenant_id"]
    },{
      foreignKeyName: "scan_tasks_computer_id_tenant_id_fkey"
      columns: ["computer_id","tenant_id"]
isOneToOne: false
      referencedRelation: "v_computers"
      referencedColumns: ["id","tenant_id"]
    }
                  ]
                },"v_tenant_overview": {
                  Row: {
                    "active_computers": number | null,"created_at": string,"data_region_host": string | null,"id": string,"id_type": string,"last_synced_at": string | null,"name": string,"retired_computers": number | null,"role": Database["public"]['Enums']["app_role"] | null,"sophos_tenant_id": string
                  }
                  ComputedFields: never
                  Relationships: [
                    
                  ]
                },"v_title_summary": {
                  Row: {
                    "attention_level": Database["public"]['Enums']["attention_level"] | null,"canonical_name": string,"category_slug": string | null,"computers": number | null,"external_id": string | null,"first_seen": string | null,"kind": Database["public"]['Enums']["title_kind"],"latest_version": string | null,"source": string,"tenant_id": string,"title_id": string,"vendor": string | null,"versions": number | null
                  }
                  ComputedFields: never
                  Relationships: [
                    
                  ]
                }
          }
          Functions: {
            "access_role_for":
{ Args: { "p_email": string }; Returns: Database["public"]['Enums']["app_role"]
                           },
"acquire_collector_lease":
{ Args: { "p_holder": string,"p_ttl_seconds": number }; Returns: boolean
                           },
"add_access_rule":
{ Args: { "p_kind": string,"p_role": Database["public"]['Enums']["app_role"],"p_value": string }; Returns: string
                           },
"add_new_computer_tasks":
{ Args: { "p_cycle_id": string }; Returns: number
                           },
"apply_computer_sync":
{ Args: { "p_endpoints": Json,"p_tenant_id": string }; Returns: Json
                           },
"apply_dictionary_changes":
{ Args: { "p_categories": Json,"p_entries": Json,"p_next_seq": number }; Returns: Json
                           },
"apply_hardware_snapshot":
{ Args: { "p_items": Json,"prev": Omit<Database["public"]['Tables']["snapshots"]['Row'], Database["public"]['Tables']["snapshots"]['ComputedFields']>,"s": Omit<Database["public"]['Tables']["snapshots"]['Row'], Database["public"]['Tables']["snapshots"]['ComputedFields']> }; Returns: string
                           },
"apply_snapshot":
{ Args: { "p_items": Json,"p_snapshot_id": string }; Returns: string
                           },
"apply_software_snapshot":
{ Args: { "p_items": Json,"prev": Omit<Database["public"]['Tables']["snapshots"]['Row'], Database["public"]['Tables']["snapshots"]['ComputedFields']>,"s": Omit<Database["public"]['Tables']["snapshots"]['Row'], Database["public"]['Tables']["snapshots"]['ComputedFields']> }; Returns: string
                           },
"budget_overview":
{ Args: { "p_tenant_id"?: string }; Returns: {
              "active_runs": number,"daily_run_limit": number,"max_active_runs": number,"normal_left": number,"reserve_left": number,"reserve_pct": number,"runs_per_minute": number,"runs_this_minute": number,"runs_today": number,"tenant_id": string,"tenant_name": string
            }[]
                           },
"budget_snapshot":
{ Args: { "p_tenant_id": string }; Returns: {
              "active_runs": number,"runs_this_minute": number,"runs_today": number
            }[]
                           },
"can_contribute":
{ Args: Record<PropertyKey, never>; Returns: boolean
                           },
"can_scan":
{ Args: Record<PropertyKey, never>; Returns: boolean
                           },
"claim_dispatch_batch":
{ Args: { "p_limit": number,"p_query_id": string,"p_reserve_only"?: boolean,"p_tenant_id": string }; Returns: {
              "computer_id": string,"priority": boolean,"sophos_endpoint_id": string,"task_id": string
            }[]
                           },
"clear_alert_channel":
{ Args: { "p_channel": string }; Returns: undefined
                           },
"clear_hub_connection":
{ Args: Record<PropertyKey, never>; Returns: undefined
                           },
"clear_sophos_credential":
{ Args: Record<PropertyKey, never>; Returns: undefined
                           },
"close_cycle":
{ Args: { "p_cycle_id": string,"p_status"?: Database["public"]['Enums']["cycle_status"] }; Returns: undefined
                           },
"complete_cycles":
{ Args: { "p_tenant_id": string }; Returns: number
                           },
"computer_cycle_tasks":
{ Args: { "p_computer_id": string }; Returns: {
              "attempts": number,"domain": Database["public"]['Enums']["inventory_domain"],"last_error": string,"next_attempt_at": string,"query_name": string,"status": Database["public"]['Enums']["task_status"],"updated_at": string
            }[]
                           },
"csv_field":
{ Args: { "p_value": string }; Returns: string
                           },
"csv_time":
{ Args: { "p_value": string }; Returns: string
                           },
"current_app_role":
{ Args: Record<PropertyKey, never>; Returns: Database["public"]['Enums']["app_role"]
                           },
"current_queries":
{ Args: Record<PropertyKey, never>; Returns: {
              "created_at": string,
"domain": Database["public"]['Enums']["inventory_domain"],
"enabled": boolean,
"id": string,
"name": string,
"platform": Database["public"]['Enums']["platform"],
"required_tables": (string)[],
"sql": string,
"version": number
            }[]
                          SetofOptions: {
        from: "*"
        to: "query_catalog"
        isOneToOne: false
        isSetofReturn: true
      } },
"cycle_overview":
{ Args: { "p_tenant_id"?: string }; Returns: {
              "closes_at": string,"collected": number,"computers": number,"computers_collected": number,"coverage_pct": number,"cycle_id": string,"dispatched": number,"errors": number,"missed": number,"next_retry_at": string,"opened_at": string,"pending": number,"retrying": number,"skipped": number,"tasks": number,"tenant_id": string,"tenant_name": string
            }[]
                           },
"defer_offline_tasks":
{ Args: { "p_next_at": string,"p_reason": string,"p_task_ids": (string)[] }; Returns: number
                           },
"delete_access_rule":
{ Args: { "p_id": string }; Returns: undefined
                           },
"detect_alerts":
{ Args: Record<PropertyKey, never>; Returns: number
                           },
"due_task_groups":
{ Args: { "p_tenant_id": string }; Returns: {
              "due": number,"due_priority": number,"name": string,"platform": Database["public"]['Enums']["platform"],"query_id": string,"sql": string,"version": number
            }[]
                           },
"export_csv":
{ Args: { "p_dataset": string,"p_filters"?: Json }; Returns: string
                           },
"finish_run":
{ Args: { "p_cancelled": boolean,"p_error": string,"p_run_id": string,"p_status": Database["public"]['Enums']["run_status"] }; Returns: number
                           },
"get_alert_secrets":
{ Args: Record<PropertyKey, never>; Returns: {
              "email_from": string,"email_to": (string)[],"enabled": boolean,"resend_key": string,"webhook_url": string
            }[]
                           },
"get_alert_status":
{ Args: Record<PropertyKey, never>; Returns: {
              "coverage_threshold": number,"email_configured": boolean,"email_from": string,"email_to": (string)[],"enabled": boolean,"last_error": string,"last_sent_at": string,"pending": number,"stale_minutes": number,"updated_at": string,"webhook_configured": boolean,"webhook_hint": string
            }[]
                           },
"get_hub_credential":
{ Args: Record<PropertyKey, never>; Returns: {
              "client_key": string,"last_seq": number,"share_unknown_titles": boolean,"url": string
            }[]
                           },
"get_hub_status":
{ Args: Record<PropertyKey, never>; Returns: {
              "configured": boolean,"configured_at": string,"delayed": boolean,"key_hint": string,"last_attempt_at": string,"last_error": string,"last_seq": number,"next_attempt_at": string,"pending_submissions": number,"share_unknown_titles": boolean,"synced_at": string,"url": string
            }[]
                           },
"get_sophos_connection_status":
{ Args: Record<PropertyKey, never>; Returns: {
              "client_id_hint": string,"configured": boolean,"configured_at": string,"configured_by_email": string,"data_region_host": string,"id_type": string,"last_sync_at": string,"last_sync_message": string,"last_sync_ok": boolean,"last_test_at": string,"last_test_message": string,"last_test_ok": boolean
            }[]
                           },
"get_sophos_credential":
{ Args: Record<PropertyKey, never>; Returns: {
              "client_id": string,"client_secret": string
            }[]
                           },
"hub_sync_finished":
{ Args: { "p_error"?: string,"p_ok": boolean }; Returns: string
                           },
"ingest_snapshot":
{ Args: { "p_payload": Json,"p_raw_result_id": string }; Returns: Json
                           },
"insert_cycle_tasks":
{ Args: { "p_computer_id"?: string,"p_cycle_id": string }; Returns: number
                           },
"invoke_alerts":
{ Args: Record<PropertyKey, never>; Returns: number
                           },
"invoke_collector":
{ Args: Record<PropertyKey, never>; Returns: number
                           },
"is_admin":
{ Args: Record<PropertyKey, never>; Returns: boolean
                           },
"like_contains":
{ Args: { "p_text": string }; Returns: string
                           },
"list_users":
{ Args: Record<PropertyKey, never>; Returns: {
              "access": string,"created_at": string,"display_name": string,"email": string,"id": string,"last_sign_in_at": string,"role": Database["public"]['Enums']["app_role"]
            }[]
                           },
"mark_ingest_error":
{ Args: { "p_error": string,"p_raw_result_id": string }; Returns: undefined
                           },
"mask_user_path":
{ Args: { "value": string }; Returns: string
                           },
"missing_tables":
{ Args: { "p_query_id": string,"p_tenant_id": string }; Returns: (string)[]
                           },
"my_tenant_roles":
{ Args: Record<PropertyKey, never>; Returns: {
              "role": Database["public"]['Enums']["app_role"],"tenant_id": string
            }[]
                           },
"needs_attention":
{ Args: { "p_limit"?: number,"p_tenant_id"?: string }; Returns: {
              "attention_level": Database["public"]['Enums']["attention_level"],"category_slug": string,"computers": number,"level1_name": string,"level2_name": string,"titles": number
            }[]
                           },
"open_cycle":
{ Args: { "p_closes_at": string,"p_period_start": string,"p_tenant_id": string }; Returns: string
                           },
"overview_stats":
{ Args: { "p_tenant_id"?: string }; Returns: Json
                           },
"policy_delete_rule":
{ Args: { "p_lineage_id": string,"p_tenant_id": string }; Returns: undefined
                           },
"policy_discard_draft":
{ Args: { "p_tenant_id": string }; Returns: undefined
                           },
"policy_due_tenants":
{ Args: Record<PropertyKey, never>; Returns: {
              "full_run": boolean,"policy_id": string,"tenant_id": string
            }[]
                           },
"policy_ensure_draft":
{ Args: { "p_tenant_id": string }; Returns: string
                           },
"policy_eval_inputs":
{ Args: { "p_after_title"?: string,"p_after_version"?: string,"p_limit"?: number,"p_only_new"?: boolean,"p_tenant_id": string }; Returns: {
              "category_name": string,"category_slug": string,"external_id": string,"kind": Database["public"]['Enums']["title_kind"],"name": string,"subcategory_name": string,"subcategory_slug": string,"title_id": string,"vendor": string,"version": string
            }[]
                           },
"policy_evaluation_finished":
{ Args: { "p_policy_id": string }; Returns: undefined
                           },
"policy_get":
{ Args: { "p_tenant_id": string }; Returns: Json
                           },
"policy_json":
{ Args: { "p_policy_id": string }; Returns: Json
                           },
"policy_move_rule":
{ Args: { "p_lineage_id": string,"p_position": number,"p_tenant_id": string }; Returns: number
                           },
"policy_overview":
{ Args: { "p_tenant_id"?: string }; Returns: Json
                           },
"policy_place_rule":
{ Args: { "p_draft": string,"p_position": number,"p_rule_id": string }; Returns: number
                           },
"policy_preview_inputs":
{ Args: { "p_tenant_id": string }; Returns: {
              "category_name": string,"category_slug": string,"computers": number,"current_class": Database["public"]['Enums']["policy_class"],"current_rule_id": string,"external_id": string,"installations": number,"kind": Database["public"]['Enums']["title_kind"],"name": string,"subcategory_name": string,"subcategory_slug": string,"title_id": string,"vendor": string,"version": string
            }[]
                           },
"policy_publish":
{ Args: { "p_tenant_id": string }; Returns: Json
                           },
"policy_published":
{ Args: { "p_tenant_id": string }; Returns: Json
                           },
"policy_require_admin":
{ Args: { "p_tenant_id": string }; Returns: undefined
                           },
"policy_rule_history":
{ Args: { "p_lineage_id": string,"p_tenant_id": string }; Returns: Json
                           },
"policy_save_rule":
{ Args: { "p_rule": Json,"p_tenant_id": string }; Returns: string
                           },
"policy_set_default_class":
{ Args: { "p_class": Database["public"]['Enums']["policy_class"],"p_tenant_id": string }; Returns: undefined
                           },
"policy_set_rule_enabled":
{ Args: { "p_enabled": boolean,"p_lineage_id": string,"p_tenant_id": string }; Returns: undefined
                           },
"policy_store_results":
{ Args: { "p_alert"?: boolean,"p_policy_id": string,"p_results": Json,"p_tenant_id": string }; Returns: Json
                           },
"product_name":
{ Args: { "p_name": string }; Returns: string
                           },
"purge_raw_results":
{ Args: { "p_days"?: number }; Returns: number
                           },
"query_catalog_status":
{ Args: { "p_tenant_id"?: string }; Returns: {
              "domain": Database["public"]['Enums']["inventory_domain"],"enabled": boolean,"last_probed_at": string,"missing_tables": (string)[],"name": string,"platform": Database["public"]['Enums']["platform"],"query_id": string,"required_tables": (string)[],"tenants_missing": number,"tenants_not_probed": number,"tenants_ok": number,"version": number
            }[]
                           },
"record_api_run":
{ Args: { "p_runs"?: number,"p_tenant_id": string }; Returns: undefined
                           },
"record_dispatch":
{ Args: { "p_endpoint_ids": (string)[],"p_priority": boolean,"p_provider": Database["public"]['Enums']["query_provider"],"p_query_id": string,"p_sophos_run_id": string,"p_task_ids": (string)[],"p_tenant_id": string }; Returns: string
                           },
"refresh_skipped_tasks":
{ Args: { "p_tenant_id": string }; Returns: number
                           },
"refresh_title_summary_if_due":
{ Args: Record<PropertyKey, never>; Returns: boolean
                           },
"release_collector_lease":
{ Args: { "p_holder": string }; Returns: undefined
                           },
"release_tasks":
{ Args: { "p_error": string,"p_task_ids": (string)[] }; Returns: undefined
                           },
"remove_user":
{ Args: { "p_user_id": string }; Returns: undefined
                           },
"scan_now":
{ Args: { "p_computer_id": string }; Returns: number
                           },
"schedule_retries":
{ Args: { "p_later_at"?: string,"p_next_at": string,"p_tenant_id": string }; Returns: number
                           },
"search_titles":
{ Args: { "p_as_of"?: string,"p_attention"?: (Database["public"]['Enums']["attention_level"])[],"p_category"?: string,"p_desc"?: boolean,"p_kind"?: Database["public"]['Enums']["title_kind"],"p_limit"?: number,"p_offset"?: number,"p_platform"?: Database["public"]['Enums']["platform"],"p_policy"?: (Database["public"]['Enums']["policy_class"])[],"p_query"?: string,"p_sort"?: string,"p_source"?: string,"p_tenant_id"?: string,"p_user"?: string,"p_version_below"?: string }; Returns: {
              "attention_level": Database["public"]['Enums']["attention_level"],"canonical_name": string,"category_slug": string,"computers": number,"confidence": number,"external_id": string,"first_seen": string,"kind": Database["public"]['Enums']["title_kind"],"latest_version": string,"level1_name": string,"level2_name": string,"method": string,"mixed_versions": boolean,"origin": string,"policy_class": Database["public"]['Enums']["policy_class"],"policy_rule_lineage_id": string,"policy_rule_name": string,"product_key": string,"source": string,"spellings": number,"title_id": string,"total_count": number,"vendor": string,"versions": number
            }[]
                           },
"set_alert_settings":
{ Args: { "p_coverage_threshold"?: number,"p_email_from"?: string,"p_email_to"?: (string)[],"p_enabled"?: boolean,"p_resend_key"?: string,"p_stale_minutes"?: number,"p_webhook_url"?: string }; Returns: undefined
                           },
"set_hub_connection":
{ Args: { "p_key": string,"p_url": string }; Returns: undefined
                           },
"set_hub_sharing":
{ Args: { "p_share": boolean }; Returns: undefined
                           },
"set_sophos_credential":
{ Args: { "p_client_id": string,"p_client_secret": string }; Returns: undefined
                           },
"set_task_outcome":
{ Args: { "p_error": string,"p_run_id": string,"p_sophos_endpoint_id": string,"p_status": Database["public"]['Enums']["task_status"] }; Returns: undefined
                           },
"set_user_role":
{ Args: { "p_role": Database["public"]['Enums']["app_role"],"p_user_id": string }; Returns: undefined
                           },
"store_endpoint_result":
{ Args: { "p_rows": Json,"p_run_id": string,"p_sophos_endpoint_id": string }; Returns: boolean
                           },
"title_group_ids":
{ Args: { "p_title_id": string }; Returns: (string)[]
                           },
"title_versions":
{ Args: { "p_tenant_id"?: string,"p_title_id": string }; Returns: {
              "computers": number,"version": string
            }[]
                           },
"vendor_key":
{ Args: { "p_vendor": string }; Returns: string
                           },
"version_key":
{ Args: { "v": string }; Returns: (number)[]
                           },
"weekly_changes":
{ Args: { "p_tenant_id"?: string,"p_weeks"?: number }; Returns: {
              "added": number,"removed": number,"updated": number,"week_start": string
            }[]
                           }
          }
          Enums: {
            "app_role": "admin"|"operator"|"viewer","attention_level": "info"|"review"|"not_allowed","change_type": "added"|"removed"|"updated","cycle_status": "open"|"closed"|"complete","inventory_domain": "hardware"|"disks"|"programs"|"extensions"|"ide_extensions"|"packages","platform": "windows"|"macos"|"linux","policy_class": "core_system"|"sanctioned_app"|"tolerated_app"|"unsanctioned_app","policy_field": "vendor"|"name"|"category"|"subcategory"|"version"|"external_id","policy_operator": "equals"|"not_equals"|"contains"|"not_contains"|"starts_with"|"ends_with"|"regex"|"in"|"not_in"|"gt"|"gte"|"lt"|"lte"|"between","policy_status": "draft"|"published"|"archived","query_provider": "live_endpoint_search"|"live_discover_rest","rule_match": "all"|"any","run_status": "running"|"finished"|"failed","task_status": "pending"|"dispatched"|"collected"|"no_response"|"retry_scheduled"|"missed"|"error"|"skipped","title_kind": "program"|"extension"|"ide_extension"|"package"
          }
          CompositeTypes: {
            [_ in never]: never
          }
        }
}

type DatabaseWithoutInternals = Omit<Database, '__InternalSupabase'>

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
  ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
      Row: infer R
    }
    ? R
    : never
  : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
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
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never
> = DefaultSchemaEnumNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
  ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
  : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never
> = PublicCompositeTypeNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
  ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
  : never

export const Constants = {
  "graphql_public": {
          Enums: {
            
          }
        },"public": {
          Enums: {
            "app_role": ["admin", "operator", "viewer"],"attention_level": ["info", "review", "not_allowed"],"change_type": ["added", "removed", "updated"],"cycle_status": ["open", "closed", "complete"],"inventory_domain": ["hardware", "disks", "programs", "extensions", "ide_extensions", "packages"],"platform": ["windows", "macos", "linux"],"policy_class": ["core_system", "sanctioned_app", "tolerated_app", "unsanctioned_app"],"policy_field": ["vendor", "name", "category", "subcategory", "version", "external_id"],"policy_operator": ["equals", "not_equals", "contains", "not_contains", "starts_with", "ends_with", "regex", "in", "not_in", "gt", "gte", "lt", "lte", "between"],"policy_status": ["draft", "published", "archived"],"query_provider": ["live_endpoint_search", "live_discover_rest"],"rule_match": ["all", "any"],"run_status": ["running", "finished", "failed"],"task_status": ["pending", "dispatched", "collected", "no_response", "retry_scheduled", "missed", "error", "skipped"],"title_kind": ["program", "extension", "ide_extension", "package"]
          }
        }
} as const
