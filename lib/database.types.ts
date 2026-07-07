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
      _migrations: {
        Row: {
          applied_at: string
          name: string
        }
        Insert: {
          applied_at?: string
          name: string
        }
        Update: {
          applied_at?: string
          name?: string
        }
        Relationships: []
      }
      board_assets: {
        Row: {
          board_id: string
          created_at: string
          id: string
          name: string
          sort_order: number
          url: string | null
        }
        Insert: {
          board_id: string
          created_at?: string
          id?: string
          name: string
          sort_order?: number
          url?: string | null
        }
        Update: {
          board_id?: string
          created_at?: string
          id?: string
          name?: string
          sort_order?: number
          url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "board_assets_board_id_fkey"
            columns: ["board_id"]
            isOneToOne: false
            referencedRelation: "boards"
            referencedColumns: ["id"]
          },
        ]
      }
      boards: {
        Row: {
          created_at: string
          id: string
          kind: string
          owner_id: string | null
          project_id: string | null
          shared: boolean
          title: string
        }
        Insert: {
          created_at?: string
          id?: string
          kind: string
          owner_id?: string | null
          project_id?: string | null
          shared?: boolean
          title: string
        }
        Update: {
          created_at?: string
          id?: string
          kind?: string
          owner_id?: string | null
          project_id?: string | null
          shared?: boolean
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "boards_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "boards_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      clients: {
        Row: {
          created_at: string
          id: string
          memo: string | null
          name: string
        }
        Insert: {
          created_at?: string
          id?: string
          memo?: string | null
          name: string
        }
        Update: {
          created_at?: string
          id?: string
          memo?: string | null
          name?: string
        }
        Relationships: []
      }
      comments: {
        Row: {
          author_id: string
          body: string
          created_at: string
          id: string
          internal: boolean
          task_id: string
        }
        Insert: {
          author_id: string
          body: string
          created_at?: string
          id?: string
          internal?: boolean
          task_id: string
        }
        Update: {
          author_id?: string
          body?: string
          created_at?: string
          id?: string
          internal?: boolean
          task_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "comments_author_id_fkey"
            columns: ["author_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "comments_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      direction_logs: {
        Row: {
          author_id: string
          body: string
          created_at: string
          id: string
          project_id: string
          status: string
          supersedes: string | null
        }
        Insert: {
          author_id: string
          body: string
          created_at?: string
          id?: string
          project_id: string
          status?: string
          supersedes?: string | null
        }
        Update: {
          author_id?: string
          body?: string
          created_at?: string
          id?: string
          project_id?: string
          status?: string
          supersedes?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "direction_logs_author_id_fkey"
            columns: ["author_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "direction_logs_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "direction_logs_supersedes_fkey"
            columns: ["supersedes"]
            isOneToOne: false
            referencedRelation: "direction_logs"
            referencedColumns: ["id"]
          },
        ]
      }
      events: {
        Row: {
          actor_id: string | null
          board_id: string | null
          created_at: string
          id: number
          payload: Json
          project_id: string | null
          task_id: string | null
          type: string
        }
        Insert: {
          actor_id?: string | null
          board_id?: string | null
          created_at?: string
          id?: never
          payload?: Json
          project_id?: string | null
          task_id?: string | null
          type: string
        }
        Update: {
          actor_id?: string | null
          board_id?: string | null
          created_at?: string
          id?: never
          payload?: Json
          project_id?: string | null
          task_id?: string | null
          type?: string
        }
        Relationships: []
      }
      feed_cursors: {
        Row: {
          last_seen_at: string
          project_id: string
          user_id: string
        }
        Insert: {
          last_seen_at?: string
          project_id: string
          user_id: string
        }
        Update: {
          last_seen_at?: string
          project_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "feed_cursors_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "feed_cursors_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      meeting_comments: {
        Row: {
          author_id: string
          body: string
          created_at: string
          id: string
          meeting_id: string
          resolved: boolean
        }
        Insert: {
          author_id: string
          body: string
          created_at?: string
          id?: string
          meeting_id: string
          resolved?: boolean
        }
        Update: {
          author_id?: string
          body?: string
          created_at?: string
          id?: string
          meeting_id?: string
          resolved?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "meeting_comments_author_id_fkey"
            columns: ["author_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "meeting_comments_meeting_id_fkey"
            columns: ["meeting_id"]
            isOneToOne: false
            referencedRelation: "meetings"
            referencedColumns: ["id"]
          },
        ]
      }
      meeting_items: {
        Row: {
          body: string
          created_at: string
          id: string
          kind: string
          meeting_id: string
          sort_order: number
        }
        Insert: {
          body: string
          created_at?: string
          id?: string
          kind: string
          meeting_id: string
          sort_order?: number
        }
        Update: {
          body?: string
          created_at?: string
          id?: string
          kind?: string
          meeting_id?: string
          sort_order?: number
        }
        Relationships: [
          {
            foreignKeyName: "meeting_items_meeting_id_fkey"
            columns: ["meeting_id"]
            isOneToOne: false
            referencedRelation: "meetings"
            referencedColumns: ["id"]
          },
        ]
      }
      meeting_revisions: {
        Row: {
          created_at: string
          edited_by: string | null
          id: number
          meeting_id: string
          snapshot: Json
        }
        Insert: {
          created_at?: string
          edited_by?: string | null
          id?: never
          meeting_id: string
          snapshot: Json
        }
        Update: {
          created_at?: string
          edited_by?: string | null
          id?: never
          meeting_id?: string
          snapshot?: Json
        }
        Relationships: [
          {
            foreignKeyName: "meeting_revisions_edited_by_fkey"
            columns: ["edited_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "meeting_revisions_meeting_id_fkey"
            columns: ["meeting_id"]
            isOneToOne: false
            referencedRelation: "meetings"
            referencedColumns: ["id"]
          },
        ]
      }
      meetings: {
        Row: {
          author_id: string
          board_id: string
          body: string | null
          created_at: string
          id: string
          met_at: string
          round: number
          title: string | null
          updated_at: string
        }
        Insert: {
          author_id: string
          board_id: string
          body?: string | null
          created_at?: string
          id?: string
          met_at: string
          round: number
          title?: string | null
          updated_at?: string
        }
        Update: {
          author_id?: string
          board_id?: string
          body?: string | null
          created_at?: string
          id?: string
          met_at?: string
          round?: number
          title?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "meetings_author_id_fkey"
            columns: ["author_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "meetings_board_id_fkey"
            columns: ["board_id"]
            isOneToOne: false
            referencedRelation: "boards"
            referencedColumns: ["id"]
          },
        ]
      }
      milestones: {
        Row: {
          created_at: string
          due_date: string
          id: string
          label: string
          project_id: string
        }
        Insert: {
          created_at?: string
          due_date: string
          id?: string
          label: string
          project_id: string
        }
        Update: {
          created_at?: string
          due_date?: string
          id?: string
          label?: string
          project_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "milestones_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      personal_notes: {
        Row: {
          body: string
          id: string
          project_id: string | null
          task_id: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          body: string
          id?: string
          project_id?: string | null
          task_id?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          body?: string
          id?: string
          project_id?: string | null
          task_id?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "personal_notes_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "personal_notes_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "personal_notes_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      proc_items: {
        Row: {
          buffer_days: number
          category: string
          created_at: string
          id: string
          lead_weeks: number
          memo: string | null
          name: string
          ordered_at: string | null
          project_id: string
          task_id: string | null
          vendor: string | null
        }
        Insert: {
          buffer_days?: number
          category: string
          created_at?: string
          id?: string
          lead_weeks: number
          memo?: string | null
          name: string
          ordered_at?: string | null
          project_id: string
          task_id?: string | null
          vendor?: string | null
        }
        Update: {
          buffer_days?: number
          category?: string
          created_at?: string
          id?: string
          lead_weeks?: number
          memo?: string | null
          name?: string
          ordered_at?: string | null
          project_id?: string
          task_id?: string | null
          vendor?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "proc_items_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "proc_items_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          color: string
          created_at: string
          id: string
          name: string
          role: string
        }
        Insert: {
          color: string
          created_at?: string
          id: string
          name: string
          role: string
        }
        Update: {
          color?: string
          created_at?: string
          id?: string
          name?: string
          role?: string
        }
        Relationships: []
      }
      projects: {
        Row: {
          client_id: string
          code: string
          created_at: string
          id: string
          name: string
          prod_anchor_date: string | null
          status: string
        }
        Insert: {
          client_id: string
          code: string
          created_at?: string
          id?: string
          name: string
          prod_anchor_date?: string | null
          status?: string
        }
        Update: {
          client_id?: string
          code?: string
          created_at?: string
          id?: string
          name?: string
          prod_anchor_date?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "projects_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      ref_images: {
        Row: {
          created_at: string
          doc_group: string | null
          filename: string | null
          hidden: boolean
          id: string
          kind: string
          memo: string | null
          sort_order: number
          starred: boolean
          uploader_id: string
          url: string
          verdict: string | null
          verdict_at: string | null
          verdict_by: string | null
          verdict_memo: string | null
          zone_id: string
        }
        Insert: {
          created_at?: string
          doc_group?: string | null
          filename?: string | null
          hidden?: boolean
          id?: string
          kind: string
          memo?: string | null
          sort_order?: number
          starred?: boolean
          uploader_id: string
          url: string
          verdict?: string | null
          verdict_at?: string | null
          verdict_by?: string | null
          verdict_memo?: string | null
          zone_id: string
        }
        Update: {
          created_at?: string
          doc_group?: string | null
          filename?: string | null
          hidden?: boolean
          id?: string
          kind?: string
          memo?: string | null
          sort_order?: number
          starred?: boolean
          uploader_id?: string
          url?: string
          verdict?: string | null
          verdict_at?: string | null
          verdict_by?: string | null
          verdict_memo?: string | null
          zone_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ref_images_uploader_id_fkey"
            columns: ["uploader_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ref_images_verdict_by_fkey"
            columns: ["verdict_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ref_images_zone_id_fkey"
            columns: ["zone_id"]
            isOneToOne: false
            referencedRelation: "ref_zones"
            referencedColumns: ["id"]
          },
        ]
      }
      ref_zones: {
        Row: {
          batch_label: string | null
          board_id: string
          created_at: string
          id: string
          sort_order: number
          title: string
        }
        Insert: {
          batch_label?: string | null
          board_id: string
          created_at?: string
          id?: string
          sort_order?: number
          title: string
        }
        Update: {
          batch_label?: string | null
          board_id?: string
          created_at?: string
          id?: string
          sort_order?: number
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "ref_zones_board_id_fkey"
            columns: ["board_id"]
            isOneToOne: false
            referencedRelation: "boards"
            referencedColumns: ["id"]
          },
        ]
      }
      share_links: {
        Row: {
          created_at: string
          created_by: string
          expires_at: string | null
          id: string
          include_board: boolean
          project_id: string
          revoked: boolean
          show_verdict_badge: boolean
          token: string
        }
        Insert: {
          created_at?: string
          created_by: string
          expires_at?: string | null
          id?: string
          include_board?: boolean
          project_id: string
          revoked?: boolean
          show_verdict_badge?: boolean
          token: string
        }
        Update: {
          created_at?: string
          created_by?: string
          expires_at?: string | null
          id?: string
          include_board?: boolean
          project_id?: string
          revoked?: boolean
          show_verdict_badge?: boolean
          token?: string
        }
        Relationships: [
          {
            foreignKeyName: "share_links_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "share_links_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      task_files: {
        Row: {
          approved: boolean
          created_at: string
          id: string
          kind: string
          name: string
          task_id: string
          uploader_id: string
          url: string
          version: number
        }
        Insert: {
          approved?: boolean
          created_at?: string
          id?: string
          kind: string
          name: string
          task_id: string
          uploader_id: string
          url: string
          version?: number
        }
        Update: {
          approved?: boolean
          created_at?: string
          id?: string
          kind?: string
          name?: string
          task_id?: string
          uploader_id?: string
          url?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "task_files_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_files_uploader_id_fkey"
            columns: ["uploader_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      task_finance: {
        Row: {
          fee: number | null
          memo: string | null
          paid_at: string | null
          task_id: string
          withholding: boolean
        }
        Insert: {
          fee?: number | null
          memo?: string | null
          paid_at?: string | null
          task_id: string
          withholding?: boolean
        }
        Update: {
          fee?: number | null
          memo?: string | null
          paid_at?: string | null
          task_id?: string
          withholding?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "task_finance_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: true
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      tasks: {
        Row: {
          assignee_id: string | null
          created_at: string
          description: string | null
          end_date: string
          id: string
          name: string
          project_id: string
          sort_order: number
          start_date: string
          status: string
          updated_at: string
        }
        Insert: {
          assignee_id?: string | null
          created_at?: string
          description?: string | null
          end_date: string
          id?: string
          name: string
          project_id: string
          sort_order?: number
          start_date: string
          status?: string
          updated_at?: string
        }
        Update: {
          assignee_id?: string | null
          created_at?: string
          description?: string | null
          end_date?: string
          id?: string
          name?: string
          project_id?: string
          sort_order?: number
          start_date?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "tasks_assignee_id_fkey"
            columns: ["assignee_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      can_access_task: { Args: { p_task_id: string }; Returns: boolean }
      can_access_zone: { Args: { p_zone_id: string }; Returns: boolean }
      can_delete_on_board: { Args: { p_board_id: string }; Returns: boolean }
      can_edit_board: { Args: { p_board_id: string }; Returns: boolean }
      can_edit_zone: { Args: { p_zone_id: string }; Returns: boolean }
      can_view_board: { Args: { p_board_id: string }; Returns: boolean }
      is_assigned_to_client: { Args: { p_client_id: string }; Returns: boolean }
      is_assigned_to_project: {
        Args: { p_project_id: string }
        Returns: boolean
      }
      is_director: { Args: never; Returns: boolean }
      is_system_context: { Args: never; Returns: boolean }
      save_meeting: {
        Args: {
          p_body: string
          p_items: Json
          p_meeting_id: string
          p_met_at: string
          p_title: string
        }
        Returns: undefined
      }
      set_direction_status: {
        Args: { p_log_id: string; p_status: string }
        Returns: undefined
      }
      set_verdict: {
        Args: { p_image_id: string; p_memo?: string; p_verdict: string }
        Returns: undefined
      }
    }
    Enums: {
      [_ in never]: never
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
    Enums: {},
  },
} as const
