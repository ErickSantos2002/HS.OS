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
    PostgrestVersion: "14.15"
  }
  public: {
    Tables: {
      access_logs: {
        Row: {
          action: string
          created_at: string | null
          id: string
          metadata: Json | null
          user_id: string | null
        }
        Insert: {
          action: string
          created_at?: string | null
          id?: string
          metadata?: Json | null
          user_id?: string | null
        }
        Update: {
          action?: string
          created_at?: string | null
          id?: string
          metadata?: Json | null
          user_id?: string | null
        }
        Relationships: []
      }
      agent_activity: {
        Row: {
          activity_type: string
          agent_id: string
          channel: string | null
          created_at: string
          id: string
          metadata: Json
          result: Json | null
          status: string
          steps: Json
          title: string
          updated_at: string
          user_id: string | null
        }
        Insert: {
          activity_type: string
          agent_id: string
          channel?: string | null
          created_at?: string
          id?: string
          metadata?: Json
          result?: Json | null
          status?: string
          steps?: Json
          title: string
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          activity_type?: string
          agent_id?: string
          channel?: string | null
          created_at?: string
          id?: string
          metadata?: Json
          result?: Json | null
          status?: string
          steps?: Json
          title?: string
          updated_at?: string
          user_id?: string | null
        }
        Relationships: []
      }
      agent_activity_log: {
        Row: {
          agent_emoji: string | null
          agent_id: string
          agent_name: string
          detail: string
          event_type: string
          id: string
          session_key: string | null
          status: string
          timestamp: string
          tool_name: string | null
        }
        Insert: {
          agent_emoji?: string | null
          agent_id: string
          agent_name: string
          detail: string
          event_type: string
          id?: string
          session_key?: string | null
          status?: string
          timestamp?: string
          tool_name?: string | null
        }
        Update: {
          agent_emoji?: string | null
          agent_id?: string
          agent_name?: string
          detail?: string
          event_type?: string
          id?: string
          session_key?: string | null
          status?: string
          timestamp?: string
          tool_name?: string | null
        }
        Relationships: []
      }
      agent_avatars: {
        Row: {
          agent_id: string
          avatar_data: string
          avatar_url: string | null
          id: string
          updated_at: string | null
        }
        Insert: {
          agent_id: string
          avatar_data: string
          avatar_url?: string | null
          id?: string
          updated_at?: string | null
        }
        Update: {
          agent_id?: string
          avatar_data?: string
          avatar_url?: string | null
          id?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      agent_context_state: {
        Row: {
          agent_id: string
          context_tokens: number
          model: string | null
          session_key: string
          total_tokens: number
          updated_at: string
        }
        Insert: {
          agent_id: string
          context_tokens?: number
          model?: string | null
          session_key: string
          total_tokens?: number
          updated_at?: string
        }
        Update: {
          agent_id?: string
          context_tokens?: number
          model?: string | null
          session_key?: string
          total_tokens?: number
          updated_at?: string
        }
        Relationships: []
      }
      agent_creation_log: {
        Row: {
          agent_id: string
          briefing: string
          created_at: string
          created_by: string | null
          id: string
          lia_error: string | null
          lia_http_status: number | null
          lia_response: string | null
          lia_session: string | null
          responded_at: string | null
          status: string
        }
        Insert: {
          agent_id: string
          briefing: string
          created_at?: string
          created_by?: string | null
          id?: string
          lia_error?: string | null
          lia_http_status?: number | null
          lia_response?: string | null
          lia_session?: string | null
          responded_at?: string | null
          status?: string
        }
        Update: {
          agent_id?: string
          briefing?: string
          created_at?: string
          created_by?: string | null
          id?: string
          lia_error?: string | null
          lia_http_status?: number | null
          lia_response?: string | null
          lia_session?: string | null
          responded_at?: string | null
          status?: string
        }
        Relationships: []
      }
      agent_crons: {
        Row: {
          agent_id: string
          created_at: string
          description: string | null
          enabled: boolean
          expression: string
          id: string
          last_run: string | null
          name: string
          next_run: string | null
        }
        Insert: {
          agent_id: string
          created_at?: string
          description?: string | null
          enabled?: boolean
          expression?: string
          id?: string
          last_run?: string | null
          name?: string
          next_run?: string | null
        }
        Update: {
          agent_id?: string
          created_at?: string
          description?: string | null
          enabled?: boolean
          expression?: string
          id?: string
          last_run?: string | null
          name?: string
          next_run?: string | null
        }
        Relationships: []
      }
      agent_files: {
        Row: {
          agent_id: string
          content: string | null
          file_name: string
          id: string
          origin: string
          pending_write: boolean
          synced_at: string | null
          written_at: string | null
        }
        Insert: {
          agent_id: string
          content?: string | null
          file_name: string
          id?: string
          origin?: string
          pending_write?: boolean
          synced_at?: string | null
          written_at?: string | null
        }
        Update: {
          agent_id?: string
          content?: string | null
          file_name?: string
          id?: string
          origin?: string
          pending_write?: boolean
          synced_at?: string | null
          written_at?: string | null
        }
        Relationships: []
      }
      agent_integrations: {
        Row: {
          agent_id: string | null
          config: Json | null
          created_at: string | null
          description: string | null
          id: string
          name: string
          status: string | null
          type: string | null
        }
        Insert: {
          agent_id?: string | null
          config?: Json | null
          created_at?: string | null
          description?: string | null
          id?: string
          name: string
          status?: string | null
          type?: string | null
        }
        Update: {
          agent_id?: string | null
          config?: Json | null
          created_at?: string | null
          description?: string | null
          id?: string
          name?: string
          status?: string | null
          type?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "agent_integrations_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "agent_profiles"
            referencedColumns: ["agent_id"]
          },
        ]
      }
      agent_profiles: {
        Row: {
          access_type: string
          agent_id: string
          allowed_user_ids: string[]
          avatar_url: string | null
          behavior: string | null
          channels: string[] | null
          color: string | null
          convai_agent_id: string | null
          crons_description: string | null
          department: string | null
          description: string | null
          emoji: string | null
          guardrails: Json
          integrations_used: string[] | null
          is_leader: boolean
          is_official: boolean
          leader_id: string | null
          model: string | null
          name: string | null
          openclaw_id: string | null
          persona_description: string | null
          role: string | null
          skills_description: string | null
          skills_tags: string[] | null
          sort_order: number | null
          specialty: string | null
          status: string
          tts_voice_id: string | null
          tts_voice_name: string | null
          updated_at: string | null
          voice_model: string | null
          workspace: string | null
        }
        Insert: {
          access_type?: string
          agent_id: string
          allowed_user_ids?: string[]
          avatar_url?: string | null
          behavior?: string | null
          channels?: string[] | null
          color?: string | null
          convai_agent_id?: string | null
          crons_description?: string | null
          department?: string | null
          description?: string | null
          emoji?: string | null
          guardrails?: Json
          integrations_used?: string[] | null
          is_leader?: boolean
          is_official?: boolean
          leader_id?: string | null
          model?: string | null
          name?: string | null
          openclaw_id?: string | null
          persona_description?: string | null
          role?: string | null
          skills_description?: string | null
          skills_tags?: string[] | null
          sort_order?: number | null
          specialty?: string | null
          status?: string
          tts_voice_id?: string | null
          tts_voice_name?: string | null
          updated_at?: string | null
          voice_model?: string | null
          workspace?: string | null
        }
        Update: {
          access_type?: string
          agent_id?: string
          allowed_user_ids?: string[]
          avatar_url?: string | null
          behavior?: string | null
          channels?: string[] | null
          color?: string | null
          convai_agent_id?: string | null
          crons_description?: string | null
          department?: string | null
          description?: string | null
          emoji?: string | null
          guardrails?: Json
          integrations_used?: string[] | null
          is_leader?: boolean
          is_official?: boolean
          leader_id?: string | null
          model?: string | null
          name?: string | null
          openclaw_id?: string | null
          persona_description?: string | null
          role?: string | null
          skills_description?: string | null
          skills_tags?: string[] | null
          sort_order?: number | null
          specialty?: string | null
          status?: string
          tts_voice_id?: string | null
          tts_voice_name?: string | null
          updated_at?: string | null
          voice_model?: string | null
          workspace?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "agent_profiles_leader_id_fkey"
            columns: ["leader_id"]
            isOneToOne: false
            referencedRelation: "agent_profiles"
            referencedColumns: ["agent_id"]
          },
        ]
      }
      agent_results: {
        Row: {
          agent_id: string
          category: string | null
          created_at: string
          description: string | null
          id: string
          metadata: Json
          title: string
          user_id: string | null
          value: number | null
        }
        Insert: {
          agent_id: string
          category?: string | null
          created_at?: string
          description?: string | null
          id?: string
          metadata?: Json
          title?: string
          user_id?: string | null
          value?: number | null
        }
        Update: {
          agent_id?: string
          category?: string | null
          created_at?: string
          description?: string | null
          id?: string
          metadata?: Json
          title?: string
          user_id?: string | null
          value?: number | null
        }
        Relationships: []
      }
      agent_skills: {
        Row: {
          agent_id: string
          created_at: string
          id: string
          installed_by: string
          skill_id: string
          sync_error: string | null
          sync_status: string
        }
        Insert: {
          agent_id: string
          created_at?: string
          id?: string
          installed_by?: string
          skill_id: string
          sync_error?: string | null
          sync_status?: string
        }
        Update: {
          agent_id?: string
          created_at?: string
          id?: string
          installed_by?: string
          skill_id?: string
          sync_error?: string | null
          sync_status?: string
        }
        Relationships: [
          {
            foreignKeyName: "agent_skills_skill_id_fkey"
            columns: ["skill_id"]
            isOneToOne: false
            referencedRelation: "skills"
            referencedColumns: ["id"]
          },
        ]
      }
      agent_stats: {
        Row: {
          agent_id: string
          collected_at: string | null
          cost_today: number | null
          errors_today: number | null
          id: string
          last_active: string | null
          last_channel: string | null
          latest_updated_at: string | null
          max_total_tokens: number | null
          messages_today: number | null
          model: string | null
          session_count: number | null
          status: string | null
          tokens_today: number | null
          top_sessions: Json | null
          user_id: string | null
        }
        Insert: {
          agent_id: string
          collected_at?: string | null
          cost_today?: number | null
          errors_today?: number | null
          id?: string
          last_active?: string | null
          last_channel?: string | null
          latest_updated_at?: string | null
          max_total_tokens?: number | null
          messages_today?: number | null
          model?: string | null
          session_count?: number | null
          status?: string | null
          tokens_today?: number | null
          top_sessions?: Json | null
          user_id?: string | null
        }
        Update: {
          agent_id?: string
          collected_at?: string | null
          cost_today?: number | null
          errors_today?: number | null
          id?: string
          last_active?: string | null
          last_channel?: string | null
          latest_updated_at?: string | null
          max_total_tokens?: number | null
          messages_today?: number | null
          model?: string | null
          session_count?: number | null
          status?: string | null
          tokens_today?: number | null
          top_sessions?: Json | null
          user_id?: string | null
        }
        Relationships: []
      }
      agent_tasks: {
        Row: {
          agent_id: string
          checkpoint_data: Json
          chunks: Json
          completed_at: string | null
          created_at: string
          created_by: string | null
          id: string
          status: string
          title: string
          updated_at: string
        }
        Insert: {
          agent_id: string
          checkpoint_data?: Json
          chunks?: Json
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          status?: string
          title: string
          updated_at?: string
        }
        Update: {
          agent_id?: string
          checkpoint_data?: Json
          chunks?: Json
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          status?: string
          title?: string
          updated_at?: string
        }
        Relationships: []
      }
      agent_templates: {
        Row: {
          agent_id: string
          color: string | null
          created_at: string
          department: string | null
          emoji: string | null
          identity_template: string
          is_default_active: boolean
          is_leader_template: boolean
          name: string
          role: string | null
          sort_order: number
          soul_template: string
          specialty: string | null
          suggested_channels: string[]
          updated_at: string
        }
        Insert: {
          agent_id: string
          color?: string | null
          created_at?: string
          department?: string | null
          emoji?: string | null
          identity_template: string
          is_default_active?: boolean
          is_leader_template?: boolean
          name: string
          role?: string | null
          sort_order?: number
          soul_template: string
          specialty?: string | null
          suggested_channels?: string[]
          updated_at?: string
        }
        Update: {
          agent_id?: string
          color?: string | null
          created_at?: string
          department?: string | null
          emoji?: string | null
          identity_template?: string
          is_default_active?: boolean
          is_leader_template?: boolean
          name?: string
          role?: string | null
          sort_order?: number
          soul_template?: string
          specialty?: string | null
          suggested_channels?: string[]
          updated_at?: string
        }
        Relationships: []
      }
      agent_token_snapshots: {
        Row: {
          agent_id: string
          cache_read: number | null
          cache_write: number | null
          context_tokens: number | null
          context_window: number | null
          created_at: string | null
          estimated_cost_usd: number | null
          id: string
          input_tokens: number | null
          model: string | null
          output_tokens: number | null
          session_count: number | null
          snapshot_at: string
          total_tokens: number | null
        }
        Insert: {
          agent_id: string
          cache_read?: number | null
          cache_write?: number | null
          context_tokens?: number | null
          context_window?: number | null
          created_at?: string | null
          estimated_cost_usd?: number | null
          id?: string
          input_tokens?: number | null
          model?: string | null
          output_tokens?: number | null
          session_count?: number | null
          snapshot_at: string
          total_tokens?: number | null
        }
        Update: {
          agent_id?: string
          cache_read?: number | null
          cache_write?: number | null
          context_tokens?: number | null
          context_window?: number | null
          created_at?: string | null
          estimated_cost_usd?: number | null
          id?: string
          input_tokens?: number | null
          model?: string | null
          output_tokens?: number | null
          session_count?: number | null
          snapshot_at?: string
          total_tokens?: number | null
        }
        Relationships: []
      }
      agent_turn_events: {
        Row: {
          acted: boolean
          created_at: string
          decision: string
          detail: string | null
          id: string
          observed: string
          session_key: string
          turn_id: string | null
        }
        Insert: {
          acted?: boolean
          created_at?: string
          decision: string
          detail?: string | null
          id?: string
          observed: string
          session_key: string
          turn_id?: string | null
        }
        Update: {
          acted?: boolean
          created_at?: string
          decision?: string
          detail?: string | null
          id?: string
          observed?: string
          session_key?: string
          turn_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "agent_turn_events_turn_id_fkey"
            columns: ["turn_id"]
            isOneToOne: false
            referencedRelation: "agent_turns"
            referencedColumns: ["id"]
          },
        ]
      }
      agent_turns: {
        Row: {
          agent_id: string
          attempts: number
          delivered_at: string | null
          detail: string | null
          dispatched_at: string
          id: string
          last_checked_at: string | null
          last_decision: string | null
          nudged_at: string | null
          origin_agent_id: string | null
          session_key: string
          source: string
          status: string
          user_id: string | null
          user_message_ts: string
          warned_hard_at: string | null
          warned_soft_at: string | null
        }
        Insert: {
          agent_id: string
          attempts?: number
          delivered_at?: string | null
          detail?: string | null
          dispatched_at?: string
          id?: string
          last_checked_at?: string | null
          last_decision?: string | null
          nudged_at?: string | null
          origin_agent_id?: string | null
          session_key: string
          source?: string
          status?: string
          user_id?: string | null
          user_message_ts: string
          warned_hard_at?: string | null
          warned_soft_at?: string | null
        }
        Update: {
          agent_id?: string
          attempts?: number
          delivered_at?: string | null
          detail?: string | null
          dispatched_at?: string
          id?: string
          last_checked_at?: string | null
          last_decision?: string | null
          nudged_at?: string | null
          origin_agent_id?: string | null
          session_key?: string
          source?: string
          status?: string
          user_id?: string | null
          user_message_ts?: string
          warned_hard_at?: string | null
          warned_soft_at?: string | null
        }
        Relationships: []
      }
      app_settings: {
        Row: {
          id: string
          key: string
          updated_at: string | null
          value: Json
        }
        Insert: {
          id?: string
          key: string
          updated_at?: string | null
          value?: Json
        }
        Update: {
          id?: string
          key?: string
          updated_at?: string | null
          value?: Json
        }
        Relationships: []
      }
      arena_agents: {
        Row: {
          agent_id: string
          arena_id: string
          created_at: string | null
          id: string
          is_primary: boolean | null
          role_description: string | null
          role_name: string | null
        }
        Insert: {
          agent_id: string
          arena_id: string
          created_at?: string | null
          id?: string
          is_primary?: boolean | null
          role_description?: string | null
          role_name?: string | null
        }
        Update: {
          agent_id?: string
          arena_id?: string
          created_at?: string | null
          id?: string
          is_primary?: boolean | null
          role_description?: string | null
          role_name?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "arena_agents_arena_id_fkey"
            columns: ["arena_id"]
            isOneToOne: false
            referencedRelation: "arenas"
            referencedColumns: ["id"]
          },
        ]
      }
      arena_messages: {
        Row: {
          agent_id: string | null
          agent_role: string | null
          artifact_html: string | null
          content: string | null
          created_at: string | null
          id: string
          role: string
          session_id: string
        }
        Insert: {
          agent_id?: string | null
          agent_role?: string | null
          artifact_html?: string | null
          content?: string | null
          created_at?: string | null
          id?: string
          role: string
          session_id: string
        }
        Update: {
          agent_id?: string | null
          agent_role?: string | null
          artifact_html?: string | null
          content?: string | null
          created_at?: string | null
          id?: string
          role?: string
          session_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "arena_messages_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "arena_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      arena_sessions: {
        Row: {
          arena_id: string
          context_summary: string | null
          created_at: string | null
          id: string
          parent_session_id: string | null
          title: string | null
          updated_at: string | null
        }
        Insert: {
          arena_id: string
          context_summary?: string | null
          created_at?: string | null
          id?: string
          parent_session_id?: string | null
          title?: string | null
          updated_at?: string | null
        }
        Update: {
          arena_id?: string
          context_summary?: string | null
          created_at?: string | null
          id?: string
          parent_session_id?: string | null
          title?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "arena_sessions_arena_id_fkey"
            columns: ["arena_id"]
            isOneToOne: false
            referencedRelation: "arenas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "arena_sessions_parent_session_id_fkey"
            columns: ["parent_session_id"]
            isOneToOne: false
            referencedRelation: "arena_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      arena_templates: {
        Row: {
          agents: Json | null
          base_prompt: string | null
          created_at: string | null
          description: string | null
          emoji: string | null
          id: string
          is_default: boolean | null
          name: string
          suggested_sessions: string[] | null
        }
        Insert: {
          agents?: Json | null
          base_prompt?: string | null
          created_at?: string | null
          description?: string | null
          emoji?: string | null
          id?: string
          is_default?: boolean | null
          name: string
          suggested_sessions?: string[] | null
        }
        Update: {
          agents?: Json | null
          base_prompt?: string | null
          created_at?: string | null
          description?: string | null
          emoji?: string | null
          id?: string
          is_default?: boolean | null
          name?: string
          suggested_sessions?: string[] | null
        }
        Relationships: []
      }
      arenas: {
        Row: {
          agents: Json | null
          convai_agent_id: string | null
          created_at: string
          created_by: string
          description: string | null
          emoji: string | null
          id: string
          name: string
          opening_message: string | null
          prompt: string | null
          react_code: string | null
          voice_id: string | null
        }
        Insert: {
          agents?: Json | null
          convai_agent_id?: string | null
          created_at?: string
          created_by?: string
          description?: string | null
          emoji?: string | null
          id?: string
          name: string
          opening_message?: string | null
          prompt?: string | null
          react_code?: string | null
          voice_id?: string | null
        }
        Update: {
          agents?: Json | null
          convai_agent_id?: string | null
          created_at?: string
          created_by?: string
          description?: string | null
          emoji?: string | null
          id?: string
          name?: string
          opening_message?: string | null
          prompt?: string | null
          react_code?: string | null
          voice_id?: string | null
        }
        Relationships: []
      }
      artifact_titles: {
        Row: {
          created_at: string
          id: string
          message_id: string
          title: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          message_id: string
          title: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          message_id?: string
          title?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "artifact_titles_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
        ]
      }
      artifacts_published: {
        Row: {
          created_at: string | null
          created_by: string
          expires_at: string | null
          html_content: string
          id: string
          is_public: boolean | null
          title: string | null
          views: number | null
        }
        Insert: {
          created_at?: string | null
          created_by: string
          expires_at?: string | null
          html_content: string
          id?: string
          is_public?: boolean | null
          title?: string | null
          views?: number | null
        }
        Update: {
          created_at?: string | null
          created_by?: string
          expires_at?: string | null
          html_content?: string
          id?: string
          is_public?: boolean | null
          title?: string | null
          views?: number | null
        }
        Relationships: []
      }
      automation_runs: {
        Row: {
          automation_id: string | null
          cron_job_name: string | null
          error_message: string | null
          finished_at: string | null
          id: string
          output: string | null
          started_at: string
          status: string | null
        }
        Insert: {
          automation_id?: string | null
          cron_job_name?: string | null
          error_message?: string | null
          finished_at?: string | null
          id?: string
          output?: string | null
          started_at?: string
          status?: string | null
        }
        Update: {
          automation_id?: string | null
          cron_job_name?: string | null
          error_message?: string | null
          finished_at?: string | null
          id?: string
          output?: string | null
          started_at?: string
          status?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "automation_runs_automation_id_fkey"
            columns: ["automation_id"]
            isOneToOne: false
            referencedRelation: "automations"
            referencedColumns: ["id"]
          },
        ]
      }
      automations: {
        Row: {
          agent_id: string | null
          created_at: string
          created_by: string | null
          id: string
          instruction: string
          is_active: boolean
          last_run_at: string | null
          last_run_status: string | null
          name: string
          scheduled_day: string | null
          scheduled_time: string | null
          trigger_event: string | null
          type: string
          updated_at: string
        }
        Insert: {
          agent_id?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          instruction: string
          is_active?: boolean
          last_run_at?: string | null
          last_run_status?: string | null
          name: string
          scheduled_day?: string | null
          scheduled_time?: string | null
          trigger_event?: string | null
          type: string
          updated_at?: string
        }
        Update: {
          agent_id?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          instruction?: string
          is_active?: boolean
          last_run_at?: string | null
          last_run_status?: string | null
          name?: string
          scheduled_day?: string | null
          scheduled_time?: string | null
          trigger_event?: string | null
          type?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "automations_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "agent_profiles"
            referencedColumns: ["agent_id"]
          },
        ]
      }
      branding: {
        Row: {
          company_name: string
          favicon_url: string | null
          id: string
          logo: string | null
          logo_dark: string | null
          logo_light: string | null
          mark_dark: string | null
          mark_light: string | null
          primary_color: string
          pwa_icon_url: string | null
          updated_at: string | null
        }
        Insert: {
          company_name?: string
          favicon_url?: string | null
          id?: string
          logo?: string | null
          logo_dark?: string | null
          logo_light?: string | null
          mark_dark?: string | null
          mark_light?: string | null
          primary_color?: string
          pwa_icon_url?: string | null
          updated_at?: string | null
        }
        Update: {
          company_name?: string
          favicon_url?: string | null
          id?: string
          logo?: string | null
          logo_dark?: string | null
          logo_light?: string | null
          mark_dark?: string | null
          mark_light?: string | null
          primary_color?: string
          pwa_icon_url?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      channel_agent_activity: {
        Row: {
          agent_id: string
          channel_id: string
          finished_at: string | null
          passo: string | null
          started_at: string
          updated_at: string
        }
        Insert: {
          agent_id: string
          channel_id: string
          finished_at?: string | null
          passo?: string | null
          started_at?: string
          updated_at?: string
        }
        Update: {
          agent_id?: string
          channel_id?: string
          finished_at?: string | null
          passo?: string | null
          started_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "channel_agent_activity_channel_id_fkey"
            columns: ["channel_id"]
            isOneToOne: false
            referencedRelation: "channels"
            referencedColumns: ["id"]
          },
        ]
      }
      channel_members: {
        Row: {
          added_at: string
          channel: string | null
          channel_id: string
          id: string
          joined_at: string
          member_id: string
          member_type: string
          user_id: string
        }
        Insert: {
          added_at?: string
          channel?: string | null
          channel_id: string
          id?: string
          joined_at?: string
          member_id: string
          member_type?: string
          user_id: string
        }
        Update: {
          added_at?: string
          channel?: string | null
          channel_id?: string
          id?: string
          joined_at?: string
          member_id?: string
          member_type?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "channel_members_channel_id_fkey"
            columns: ["channel_id"]
            isOneToOne: false
            referencedRelation: "channels"
            referencedColumns: ["id"]
          },
        ]
      }
      channel_messages: {
        Row: {
          attachments: Json | null
          audio_url: string | null
          author_avatar: string | null
          author_id: string
          author_name: string
          author_type: Database["public"]["Enums"]["author_type"]
          channel_id: string
          content: string
          created_at: string
          deleted_at: string | null
          edited_at: string | null
          id: string
          thread_id: string | null
        }
        Insert: {
          attachments?: Json | null
          audio_url?: string | null
          author_avatar?: string | null
          author_id: string
          author_name: string
          author_type?: Database["public"]["Enums"]["author_type"]
          channel_id: string
          content: string
          created_at?: string
          deleted_at?: string | null
          edited_at?: string | null
          id?: string
          thread_id?: string | null
        }
        Update: {
          attachments?: Json | null
          audio_url?: string | null
          author_avatar?: string | null
          author_id?: string
          author_name?: string
          author_type?: Database["public"]["Enums"]["author_type"]
          channel_id?: string
          content?: string
          created_at?: string
          deleted_at?: string | null
          edited_at?: string | null
          id?: string
          thread_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "channel_messages_channel_id_fkey"
            columns: ["channel_id"]
            isOneToOne: false
            referencedRelation: "channels"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "channel_messages_thread_id_fkey"
            columns: ["thread_id"]
            isOneToOne: false
            referencedRelation: "channel_messages"
            referencedColumns: ["id"]
          },
        ]
      }
      channels: {
        Row: {
          created_at: string
          created_by: string
          description: string | null
          id: string
          name: string
          type: Database["public"]["Enums"]["channel_type"]
        }
        Insert: {
          created_at?: string
          created_by: string
          description?: string | null
          id?: string
          name: string
          type?: Database["public"]["Enums"]["channel_type"]
        }
        Update: {
          created_at?: string
          created_by?: string
          description?: string | null
          id?: string
          name?: string
          type?: Database["public"]["Enums"]["channel_type"]
        }
        Relationships: []
      }
      company_profile: {
        Row: {
          company_name: string | null
          created_at: string
          description: string | null
          employees_count: string | null
          extra_context: string | null
          founder_name: string | null
          id: string
          onboarding_notified_at: string | null
          products_services: string | null
          revenue: string | null
          segment: string | null
          target_audience: string | null
          tone: string | null
          updated_at: string
        }
        Insert: {
          company_name?: string | null
          created_at?: string
          description?: string | null
          employees_count?: string | null
          extra_context?: string | null
          founder_name?: string | null
          id?: string
          onboarding_notified_at?: string | null
          products_services?: string | null
          revenue?: string | null
          segment?: string | null
          target_audience?: string | null
          tone?: string | null
          updated_at?: string
        }
        Update: {
          company_name?: string | null
          created_at?: string
          description?: string | null
          employees_count?: string | null
          extra_context?: string | null
          founder_name?: string | null
          id?: string
          onboarding_notified_at?: string | null
          products_services?: string | null
          revenue?: string | null
          segment?: string | null
          target_audience?: string | null
          tone?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      conversations: {
        Row: {
          agent_id: string
          content: string | null
          created_at: string
          id: string
          media: Json | null
          role: string
          user_id: string
        }
        Insert: {
          agent_id: string
          content?: string | null
          created_at?: string
          id?: string
          media?: Json | null
          role: string
          user_id: string
        }
        Update: {
          agent_id?: string
          content?: string | null
          created_at?: string
          id?: string
          media?: Json | null
          role?: string
          user_id?: string
        }
        Relationships: []
      }
      cron_jobs: {
        Row: {
          agent: string | null
          collected_at: string | null
          cron_expression: string | null
          enabled: boolean | null
          id: string
          last_run: string | null
          name: string | null
          next_run: string | null
          prompt: string | null
          status: string | null
        }
        Insert: {
          agent?: string | null
          collected_at?: string | null
          cron_expression?: string | null
          enabled?: boolean | null
          id: string
          last_run?: string | null
          name?: string | null
          next_run?: string | null
          prompt?: string | null
          status?: string | null
        }
        Update: {
          agent?: string | null
          collected_at?: string | null
          cron_expression?: string | null
          enabled?: boolean | null
          id?: string
          last_run?: string | null
          name?: string | null
          next_run?: string | null
          prompt?: string | null
          status?: string | null
        }
        Relationships: []
      }
      dm_reads: {
        Row: {
          channel_id: string
          last_read_at: string
          user_id: string
        }
        Insert: {
          channel_id: string
          last_read_at?: string
          user_id: string
        }
        Update: {
          channel_id?: string
          last_read_at?: string
          user_id?: string
        }
        Relationships: []
      }
      drafts: {
        Row: {
          content: string
          created_at: string
          draft_key: string
          id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          content?: string
          created_at?: string
          draft_key: string
          id?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          content?: string
          created_at?: string
          draft_key?: string
          id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      email_send_log: {
        Row: {
          created_at: string
          error_message: string | null
          id: string
          message_id: string | null
          metadata: Json | null
          recipient_email: string
          status: string
          template_name: string
        }
        Insert: {
          created_at?: string
          error_message?: string | null
          id?: string
          message_id?: string | null
          metadata?: Json | null
          recipient_email: string
          status: string
          template_name: string
        }
        Update: {
          created_at?: string
          error_message?: string | null
          id?: string
          message_id?: string | null
          metadata?: Json | null
          recipient_email?: string
          status?: string
          template_name?: string
        }
        Relationships: []
      }
      email_send_state: {
        Row: {
          auth_email_ttl_minutes: number
          batch_size: number
          id: number
          retry_after_until: string | null
          send_delay_ms: number
          transactional_email_ttl_minutes: number
          updated_at: string
        }
        Insert: {
          auth_email_ttl_minutes?: number
          batch_size?: number
          id?: number
          retry_after_until?: string | null
          send_delay_ms?: number
          transactional_email_ttl_minutes?: number
          updated_at?: string
        }
        Update: {
          auth_email_ttl_minutes?: number
          batch_size?: number
          id?: number
          retry_after_until?: string | null
          send_delay_ms?: number
          transactional_email_ttl_minutes?: number
          updated_at?: string
        }
        Relationships: []
      }
      email_unsubscribe_tokens: {
        Row: {
          created_at: string
          email: string
          id: string
          token: string
          used_at: string | null
        }
        Insert: {
          created_at?: string
          email: string
          id?: string
          token: string
          used_at?: string | null
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
          token?: string
          used_at?: string | null
        }
        Relationships: []
      }
      gateway_health: {
        Row: {
          collected_at: string | null
          id: string
          latency_ms: number | null
          status: string | null
          uptime_seconds: number | null
          version: string | null
        }
        Insert: {
          collected_at?: string | null
          id?: string
          latency_ms?: number | null
          status?: string | null
          uptime_seconds?: number | null
          version?: string | null
        }
        Update: {
          collected_at?: string | null
          id?: string
          latency_ms?: number | null
          status?: string | null
          uptime_seconds?: number | null
          version?: string | null
        }
        Relationships: []
      }
      generated_documents: {
        Row: {
          agent_id: string | null
          created_at: string
          doc_type: string
          id: string
          size_bytes: number
          storage_path: string
          title: string
          user_id: string
        }
        Insert: {
          agent_id?: string | null
          created_at?: string
          doc_type: string
          id?: string
          size_bytes?: number
          storage_path: string
          title: string
          user_id: string
        }
        Update: {
          agent_id?: string | null
          created_at?: string
          doc_type?: string
          id?: string
          size_bytes?: number
          storage_path?: string
          title?: string
          user_id?: string
        }
        Relationships: []
      }
      integration_rate_limit: {
        Row: {
          count: number
          user_id: string
          window_start: string
        }
        Insert: {
          count?: number
          user_id: string
          window_start?: string
        }
        Update: {
          count?: number
          user_id?: string
          window_start?: string
        }
        Relationships: []
      }
      integration_secrets: {
        Row: {
          created_at: string
          name: string
          updated_at: string
          value: string
        }
        Insert: {
          created_at?: string
          name: string
          updated_at?: string
          value: string
        }
        Update: {
          created_at?: string
          name?: string
          updated_at?: string
          value?: string
        }
        Relationships: []
      }
      integration_templates: {
        Row: {
          created_at: string
          icon: string | null
          id: string
          integration_type: string
          label: string
          playbook: Json | null
          setup_guide: string | null
          updated_at: string
          validation_endpoint: string | null
          validation_method: string | null
        }
        Insert: {
          created_at?: string
          icon?: string | null
          id?: string
          integration_type: string
          label: string
          playbook?: Json | null
          setup_guide?: string | null
          updated_at?: string
          validation_endpoint?: string | null
          validation_method?: string | null
        }
        Update: {
          created_at?: string
          icon?: string | null
          id?: string
          integration_type?: string
          label?: string
          playbook?: Json | null
          setup_guide?: string | null
          updated_at?: string
          validation_endpoint?: string | null
          validation_method?: string | null
        }
        Relationships: []
      }
      integrations: {
        Row: {
          added_by_agent: string | null
          agents_using: string[]
          category: string
          created_at: string
          credentials: Json | null
          description: string | null
          icon: string | null
          id: string
          integration_type: string | null
          is_configured: boolean
          key_name: string
          key_preview: string | null
          last_validated_at: string | null
          last_validation_error: string | null
          last_validation_ok: boolean | null
          name: string
          template_id: string | null
          type: string | null
          updated_at: string
        }
        Insert: {
          added_by_agent?: string | null
          agents_using?: string[]
          category: string
          created_at?: string
          credentials?: Json | null
          description?: string | null
          icon?: string | null
          id?: string
          integration_type?: string | null
          is_configured?: boolean
          key_name: string
          key_preview?: string | null
          last_validated_at?: string | null
          last_validation_error?: string | null
          last_validation_ok?: boolean | null
          name: string
          template_id?: string | null
          type?: string | null
          updated_at?: string
        }
        Update: {
          added_by_agent?: string | null
          agents_using?: string[]
          category?: string
          created_at?: string
          credentials?: Json | null
          description?: string | null
          icon?: string | null
          id?: string
          integration_type?: string | null
          is_configured?: boolean
          key_name?: string
          key_preview?: string | null
          last_validated_at?: string | null
          last_validation_error?: string | null
          last_validation_ok?: boolean | null
          name?: string
          template_id?: string | null
          type?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      live_artifacts: {
        Row: {
          agent_id: string | null
          created_at: string
          deleted_at: string | null
          description: string | null
          expires_at: string | null
          html_content: string
          id: string
          is_public: boolean
          is_published: boolean
          last_refreshed_at: string | null
          metadata: Json | null
          published_at: string | null
          published_slug: string | null
          refresh_interval: number
          title: string
          updated_at: string
          user_id: string
          view_count: number
        }
        Insert: {
          agent_id?: string | null
          created_at?: string
          deleted_at?: string | null
          description?: string | null
          expires_at?: string | null
          html_content: string
          id?: string
          is_public?: boolean
          is_published?: boolean
          last_refreshed_at?: string | null
          metadata?: Json | null
          published_at?: string | null
          published_slug?: string | null
          refresh_interval?: number
          title: string
          updated_at?: string
          user_id: string
          view_count?: number
        }
        Update: {
          agent_id?: string | null
          created_at?: string
          deleted_at?: string | null
          description?: string | null
          expires_at?: string | null
          html_content?: string
          id?: string
          is_public?: boolean
          is_published?: boolean
          last_refreshed_at?: string | null
          metadata?: Json | null
          published_at?: string | null
          published_slug?: string | null
          refresh_interval?: number
          title?: string
          updated_at?: string
          user_id?: string
          view_count?: number
        }
        Relationships: []
      }
      llm_provider_ops: {
        Row: {
          created_at: string
          error: string | null
          id: string
          op: string
          payload: Json | null
          provider_id: string
          result: Json | null
          status: string
        }
        Insert: {
          created_at?: string
          error?: string | null
          id?: string
          op: string
          payload?: Json | null
          provider_id: string
          result?: Json | null
          status?: string
        }
        Update: {
          created_at?: string
          error?: string | null
          id?: string
          op?: string
          payload?: Json | null
          provider_id?: string
          result?: Json | null
          status?: string
        }
        Relationships: []
      }
      message_reactions: {
        Row: {
          created_at: string
          emoji: string
          id: string
          message_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          emoji: string
          id?: string
          message_id: string
          user_id?: string
        }
        Update: {
          created_at?: string
          emoji?: string
          id?: string
          message_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "message_reactions_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "channel_messages"
            referencedColumns: ["id"]
          },
        ]
      }
      model_pricing: {
        Row: {
          cached_input_per_1m: number | null
          input_per_1m: number
          model: string
          output_per_1m: number
          source: string | null
          updated_at: string
        }
        Insert: {
          cached_input_per_1m?: number | null
          input_per_1m: number
          model: string
          output_per_1m: number
          source?: string | null
          updated_at?: string
        }
        Update: {
          cached_input_per_1m?: number | null
          input_per_1m?: number
          model?: string
          output_per_1m?: number
          source?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      notifications: {
        Row: {
          agent_id: string | null
          author_name: string
          channel_id: string | null
          content_preview: string
          created_at: string
          id: string
          message_id: string | null
          read: boolean
          user_id: string
        }
        Insert: {
          agent_id?: string | null
          author_name: string
          channel_id?: string | null
          content_preview?: string
          created_at?: string
          id?: string
          message_id?: string | null
          read?: boolean
          user_id: string
        }
        Update: {
          agent_id?: string | null
          author_name?: string
          channel_id?: string | null
          content_preview?: string
          created_at?: string
          id?: string
          message_id?: string | null
          read?: boolean
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notifications_channel_id_fkey"
            columns: ["channel_id"]
            isOneToOne: false
            referencedRelation: "channels"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notifications_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "channel_messages"
            referencedColumns: ["id"]
          },
        ]
      }
      onboarding_progress: {
        Row: {
          completed_at: string | null
          created_at: string
          current_step: number
          id: string
          step_data: Json
          updated_at: string
          user_id: string
        }
        Insert: {
          completed_at?: string | null
          created_at?: string
          current_step?: number
          id?: string
          step_data?: Json
          updated_at?: string
          user_id: string
        }
        Update: {
          completed_at?: string | null
          created_at?: string
          current_step?: number
          id?: string
          step_data?: Json
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string | null
          custom_status: string | null
          custom_status_emoji: string | null
          custom_status_set_at: string | null
          email: string
          full_name: string | null
          id: string
          last_seen_at: string | null
          status: string
          updated_at: string | null
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string | null
          custom_status?: string | null
          custom_status_emoji?: string | null
          custom_status_set_at?: string | null
          email: string
          full_name?: string | null
          id: string
          last_seen_at?: string | null
          status?: string
          updated_at?: string | null
        }
        Update: {
          avatar_url?: string | null
          created_at?: string | null
          custom_status?: string | null
          custom_status_emoji?: string | null
          custom_status_set_at?: string | null
          email?: string
          full_name?: string | null
          id?: string
          last_seen_at?: string | null
          status?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      push_subscriptions: {
        Row: {
          auth: string
          created_at: string
          endpoint: string
          id: string
          last_used_at: string
          p256dh: string
          user_agent: string | null
          user_id: string
        }
        Insert: {
          auth: string
          created_at?: string
          endpoint: string
          id?: string
          last_used_at?: string
          p256dh: string
          user_agent?: string | null
          user_id: string
        }
        Update: {
          auth?: string
          created_at?: string
          endpoint?: string
          id?: string
          last_used_at?: string
          p256dh?: string
          user_agent?: string | null
          user_id?: string
        }
        Relationships: []
      }
      routine_phrases: {
        Row: {
          agent_id: string | null
          atualizado: string
          cron_id: string
          frase: string
          impressao: string
          nome: string | null
        }
        Insert: {
          agent_id?: string | null
          atualizado?: string
          cron_id: string
          frase: string
          impressao: string
          nome?: string | null
        }
        Update: {
          agent_id?: string | null
          atualizado?: string
          cron_id?: string
          frase?: string
          impressao?: string
          nome?: string | null
        }
        Relationships: []
      }
      setup_config: {
        Row: {
          created_at: string | null
          id: string
          onboarding_notified_at: string | null
          seed_completed: boolean | null
          seed_completed_at: string | null
        }
        Insert: {
          created_at?: string | null
          id?: string
          onboarding_notified_at?: string | null
          seed_completed?: boolean | null
          seed_completed_at?: string | null
        }
        Update: {
          created_at?: string | null
          id?: string
          onboarding_notified_at?: string | null
          seed_completed?: boolean | null
          seed_completed_at?: string | null
        }
        Relationships: []
      }
      skills: {
        Row: {
          content: string
          created_at: string
          description: string | null
          id: string
          is_default: boolean
          last_synced_at: string | null
          name: string
          slug: string
          source: string
          source_url: string | null
          sync_status: string
          updated_at: string
          version: string
        }
        Insert: {
          content: string
          created_at?: string
          description?: string | null
          id?: string
          is_default?: boolean
          last_synced_at?: string | null
          name: string
          slug: string
          source?: string
          source_url?: string | null
          sync_status?: string
          updated_at?: string
          version?: string
        }
        Update: {
          content?: string
          created_at?: string
          description?: string | null
          id?: string
          is_default?: boolean
          last_synced_at?: string | null
          name?: string
          slug?: string
          source?: string
          source_url?: string | null
          sync_status?: string
          updated_at?: string
          version?: string
        }
        Relationships: []
      }
      subagent_watch: {
        Row: {
          agent_id: string
          child_key: string
          completed_at: string | null
          first_seen_at: string
          label: string | null
          nudged_at: string | null
          parent_session_key: string
          resolved_at: string | null
          status: string
        }
        Insert: {
          agent_id: string
          child_key: string
          completed_at?: string | null
          first_seen_at?: string
          label?: string | null
          nudged_at?: string | null
          parent_session_key: string
          resolved_at?: string | null
          status?: string
        }
        Update: {
          agent_id?: string
          child_key?: string
          completed_at?: string | null
          first_seen_at?: string
          label?: string | null
          nudged_at?: string | null
          parent_session_key?: string
          resolved_at?: string | null
          status?: string
        }
        Relationships: []
      }
      suppressed_emails: {
        Row: {
          created_at: string
          email: string
          id: string
          metadata: Json | null
          reason: string
        }
        Insert: {
          created_at?: string
          email: string
          id?: string
          metadata?: Json | null
          reason: string
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
          metadata?: Json | null
          reason?: string
        }
        Relationships: []
      }
      team_agents: {
        Row: {
          agent_id: string
          id: string
          team_id: string
        }
        Insert: {
          agent_id: string
          id?: string
          team_id: string
        }
        Update: {
          agent_id?: string
          id?: string
          team_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "team_agents_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      teams: {
        Row: {
          color: string | null
          created_at: string
          description: string | null
          emoji: string | null
          id: string
          name: string
        }
        Insert: {
          color?: string | null
          created_at?: string
          description?: string | null
          emoji?: string | null
          id?: string
          name: string
        }
        Update: {
          color?: string | null
          created_at?: string
          description?: string | null
          emoji?: string | null
          id?: string
          name?: string
        }
        Relationships: []
      }
      usage_daily: {
        Row: {
          cache_hit_rate: number | null
          collected_at: string | null
          cost_total: number | null
          date: string
          error_rate: number | null
          id: string
          messages_total: number | null
          tokens_total: number | null
          tool_calls: number | null
        }
        Insert: {
          cache_hit_rate?: number | null
          collected_at?: string | null
          cost_total?: number | null
          date: string
          error_rate?: number | null
          id?: string
          messages_total?: number | null
          tokens_total?: number | null
          tool_calls?: number | null
        }
        Update: {
          cache_hit_rate?: number | null
          collected_at?: string | null
          cost_total?: number | null
          date?: string
          error_rate?: number | null
          id?: string
          messages_total?: number | null
          tokens_total?: number | null
          tool_calls?: number | null
        }
        Relationships: []
      }
      usage_events: {
        Row: {
          agent_id: string
          cached_tokens: number
          cost_usd: number | null
          external_id: string | null
          id: number
          input_tokens: number
          kind: string
          label: string | null
          meta: Json | null
          model: string | null
          output_tokens: number
          session_key: string | null
          source: string
          total_tokens: number
          ts: string
          user_id: string | null
        }
        Insert: {
          agent_id: string
          cached_tokens?: number
          cost_usd?: number | null
          external_id?: string | null
          id?: number
          input_tokens?: number
          kind: string
          label?: string | null
          meta?: Json | null
          model?: string | null
          output_tokens?: number
          session_key?: string | null
          source: string
          total_tokens?: number
          ts?: string
          user_id?: string | null
        }
        Update: {
          agent_id?: string
          cached_tokens?: number
          cost_usd?: number | null
          external_id?: string | null
          id?: number
          input_tokens?: number
          kind?: string
          label?: string | null
          meta?: Json | null
          model?: string | null
          output_tokens?: number
          session_key?: string | null
          source?: string
          total_tokens?: number
          ts?: string
          user_id?: string | null
        }
        Relationships: []
      }
      usage_session_state: {
        Row: {
          agent_id: string
          first_seen_at: string
          label: string | null
          last_cost_usd: number
          last_seen_at: string
          last_tokens: number
          model: string | null
          session_key: string
        }
        Insert: {
          agent_id: string
          first_seen_at?: string
          label?: string | null
          last_cost_usd?: number
          last_seen_at?: string
          last_tokens?: number
          model?: string | null
          session_key: string
        }
        Update: {
          agent_id?: string
          first_seen_at?: string
          label?: string | null
          last_cost_usd?: number
          last_seen_at?: string
          last_tokens?: number
          model?: string | null
          session_key?: string
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          created_at: string | null
          id: string
          role: Database["public"]["Enums"]["app_role"]
          updated_at: string | null
          user_id: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          updated_at?: string | null
          user_id: string
        }
        Update: {
          created_at?: string | null
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          updated_at?: string | null
          user_id?: string
        }
        Relationships: []
      }
      vps_config: {
        Row: {
          admin_token: string
          collector_version: string | null
          created_at: string
          gateway_url: string
          gateway_version: string | null
          id: string
          is_connected: boolean
          last_ping: string | null
          updated_at: string
        }
        Insert: {
          admin_token?: string
          collector_version?: string | null
          created_at?: string
          gateway_url?: string
          gateway_version?: string | null
          id?: string
          is_connected?: boolean
          last_ping?: string | null
          updated_at?: string
        }
        Update: {
          admin_token?: string
          collector_version?: string | null
          created_at?: string
          gateway_url?: string
          gateway_version?: string | null
          id?: string
          is_connected?: boolean
          last_ping?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      wiki_documents: {
        Row: {
          content: string | null
          created_at: string
          created_by: string
          id: string
          is_pinned: boolean
          order_index: number
          space_id: string
          title: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          content?: string | null
          created_at?: string
          created_by: string
          id?: string
          is_pinned?: boolean
          order_index?: number
          space_id: string
          title?: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          content?: string | null
          created_at?: string
          created_by?: string
          id?: string
          is_pinned?: boolean
          order_index?: number
          space_id?: string
          title?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "wiki_documents_space_id_fkey"
            columns: ["space_id"]
            isOneToOne: false
            referencedRelation: "wiki_spaces"
            referencedColumns: ["id"]
          },
        ]
      }
      wiki_spaces: {
        Row: {
          color: string | null
          created_at: string
          created_by: string
          description: string | null
          icon: string | null
          id: string
          name: string
          order_index: number
          parent_id: string | null
        }
        Insert: {
          color?: string | null
          created_at?: string
          created_by: string
          description?: string | null
          icon?: string | null
          id?: string
          name: string
          order_index?: number
          parent_id?: string | null
        }
        Update: {
          color?: string | null
          created_at?: string
          created_by?: string
          description?: string | null
          icon?: string | null
          id?: string
          name?: string
          order_index?: number
          parent_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "wiki_spaces_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "wiki_spaces"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      usage_by_agent_day: {
        Row: {
          agent_id: string | null
          custo_usd: number | null
          dia: string | null
          eventos: number | null
          input_tokens: number | null
          output_tokens: number | null
          tokens: number | null
        }
        Relationships: []
      }
      usage_by_model_day: {
        Row: {
          custo_usd: number | null
          dia: string | null
          eventos: number | null
          model: string | null
          tokens: number | null
        }
        Relationships: []
      }
      usage_by_task_day: {
        Row: {
          agent_id: string | null
          custo_usd: number | null
          dia: string | null
          eventos: number | null
          kind: string | null
          tarefa: string | null
          tokens: number | null
        }
        Relationships: []
      }
    }
    Functions: {
      check_invoke_rate: {
        Args: { _limit: number; _user_id: string; _window_secs: number }
        Returns: boolean
      }
      cleanup_agent_activity_log: { Args: never; Returns: undefined }
      delete_email: {
        Args: { message_id: number; queue_name: string }
        Returns: boolean
      }
      email_queue_dispatch: { Args: never; Returns: undefined }
      enqueue_email: {
        Args: { payload: Json; queue_name: string }
        Returns: number
      }
      find_or_create_agent_agent_dm: {
        Args: { _recipient_agent_id: string; _sender_agent_id: string }
        Returns: string
      }
      find_or_create_agent_dm: {
        Args: {
          _agent_id: string
          _agent_name: string
          _target_user_id: string
        }
        Returns: string
      }
      find_or_create_dm: {
        Args: { _target_name: string; _target_user_id: string }
        Returns: string
      }
      get_agents_last_activity:
        | {
            Args: { _agent_ids: string[] }
            Returns: {
              agent_id: string
              last_active: string
              last_content: string
            }[]
          }
        | {
            Args: { _agent_ids: string[]; _user_id?: string }
            Returns: {
              agent_id: string
              last_active: string
              last_content: string
            }[]
          }
      get_fleet_productivity: {
        Args: { _since: string }
        Returns: {
          agent_id: string
          conv_count: number
          result_count: number
        }[]
      }
      get_user_agent_activity: {
        Args: { _since: string }
        Returns: {
          agent_id: string
          last_active: string
          session_count: number
          user_id: string
        }[]
      }
      get_user_role: {
        Args: { _user_id: string }
        Returns: Database["public"]["Enums"]["app_role"]
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      invoke_edge_function: { Args: { _fn: string }; Returns: undefined }
      is_channel_member: {
        Args: { _channel_id: string; _user_id: string }
        Returns: boolean
      }
      is_public_channel: { Args: { _channel_id: string }; Returns: boolean }
      move_to_dlq: {
        Args: {
          dlq_name: string
          message_id: number
          payload: Json
          source_queue: string
        }
        Returns: number
      }
      read_email_batch: {
        Args: { batch_size: number; queue_name: string; vt: number }
        Returns: {
          message: Json
          msg_id: number
          read_ct: number
        }[]
      }
      run_zombie_watchdog: { Args: never; Returns: undefined }
      upsert_platform_vault: {
        Args: { _project_url: string; _service_role_key: string }
        Returns: undefined
      }
    }
    Enums: {
      app_role: "super_admin" | "member" | "user"
      author_type: "human" | "agent"
      channel_type: "public" | "private" | "dm"
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
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
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
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
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
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
      app_role: ["super_admin", "member", "user"],
      author_type: ["human", "agent"],
      channel_type: ["public", "private", "dm"],
    },
  },
} as const
